#!/usr/bin/env python3
"""Mac BLE-to-Telegram gateway for the Vaporsense emergency beacon."""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from datetime import datetime
import json
import os
from pathlib import Path
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    import certifi
except ImportError:  # pragma: no cover - optional CA bundle.
    certifi = None

try:
    from bleak import BleakClient, BleakScanner
    from bleak.exc import BleakError
except ImportError:  # pragma: no cover - depends on local machine packages.
    BleakClient = None
    BleakScanner = None

    class BleakError(Exception):
        pass


DEVICE_NAME = "Beacon-001"
SERVICE_UUID = "00001234-0000-1000-8000-00805f9b34fb"
CHARACTERISTIC_UUID = "00005678-0000-1000-8000-00805f9b34fb"
ALERT_COOLDOWN_SECONDS = 5.0
DEFAULT_CONFIG_PATH = Path(__file__).with_name("telegram_ble_gateway.local.json")


@dataclass(frozen=True)
class TelegramConfig:
    bot_token: str
    chat_id: str


def log(message: str) -> None:
    timestamp = datetime.now().isoformat(timespec="seconds")
    print(f"[{timestamp}] {message}", flush=True)


def load_local_config(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    with path.open("r", encoding="utf-8") as config_file:
        data = json.load(config_file)

    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")

    return {str(key): str(value) for key, value in data.items()}


def load_telegram_config(config_path: Path) -> TelegramConfig:
    local_config = load_local_config(config_path)
    bot_token = (
        os.getenv("TELEGRAM_BOT_TOKEN")
        or local_config.get("TELEGRAM_BOT_TOKEN")
        or local_config.get("bot_token")
    )
    chat_id = (
        os.getenv("TELEGRAM_CHAT_ID")
        or local_config.get("TELEGRAM_CHAT_ID")
        or local_config.get("chat_id")
    )

    missing = []
    if not bot_token:
        missing.append("TELEGRAM_BOT_TOKEN")
    if not chat_id:
        missing.append("TELEGRAM_CHAT_ID")
    if missing:
        example = (
            '{\n'
            '  "bot_token": "123456789:replace-me",\n'
            '  "chat_id": "123456789"\n'
            "}"
        )
        raise SystemExit(
            "Missing Telegram credentials: "
            + ", ".join(missing)
            + "\nSet TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, or create "
            + f"{config_path} with:\n{example}"
        )

    return TelegramConfig(bot_token=bot_token, chat_id=chat_id)


def send_telegram_message(config: TelegramConfig, text: str) -> None:
    token = urllib.parse.quote(config.bot_token, safe=":")
    endpoint = f"https://api.telegram.org/bot{token}/sendMessage"
    ssl_context = (
        ssl.create_default_context(cafile=certifi.where())
        if certifi is not None
        else ssl.create_default_context()
    )
    payload = urllib.parse.urlencode(
        {
            "chat_id": config.chat_id,
            "text": text,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "vaporsense-ble-telegram-gateway/1.0",
        },
        method="POST",
    )

    try:
        response = urllib.request.urlopen(request, timeout=15, context=ssl_context)
    except ssl.SSLCertVerificationError as exc:
        raise RuntimeError(
            "Telegram HTTPS certificate verification failed. "
            "Install certifi with: python3 -m pip install -r requirements-telegram-gateway.txt"
        ) from exc

    with response:
        response_body = response.read().decode("utf-8")

    try:
        decoded = json.loads(response_body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Telegram returned non-JSON response: {response_body}") from exc

    if not decoded.get("ok"):
        raise RuntimeError(f"Telegram API rejected message: {decoded}")


def build_online_message(device_name: str) -> str:
    return "\n".join(
        [
            "🟢 BEACON ONLINE",
            f"Device: {device_name}",
            "BLE service: 0x1234",
            f"Gateway: {socket.gethostname()}",
        ]
    )


def build_emergency_message(device_name: str, alert_count: int) -> str:
    return "\n".join(
        [
            "🚨 EMERGENCY ALERT 🚨",
            f"Device: {device_name}",
            f"Alert count: {alert_count}",
            "Please check now.",
        ]
    )


class BeaconGateway:
    def __init__(
        self,
        device_name: str,
        telegram_config: TelegramConfig | None,
        dry_run: bool,
        scan_timeout: float,
    ) -> None:
        self.device_name = device_name
        self.telegram_config = telegram_config
        self.dry_run = dry_run
        self.scan_timeout = scan_timeout
        self.alert_count = 0
        self.last_alert_sent_at = 0.0
        self.online_notified_devices: set[str] = set()

    async def run_forever(self) -> None:
        if BleakScanner is None or BleakClient is None:
            raise SystemExit(
                "The 'bleak' package is required for BLE scanning.\n"
                "Install it with: python3 -m pip install -r requirements-telegram-gateway.txt"
            )

        while True:
            device = await self.find_beacon()
            if device is None:
                await asyncio.sleep(2)
                continue

            try:
                await self.listen_to_beacon(device)
            except BleakError as exc:
                log(f"BLE error: {exc}")
            except Exception as exc:  # Keep the gateway alive after transient failures.
                log(f"Gateway error: {exc}")

            log("Re-scanning in 2 seconds")
            await asyncio.sleep(2)

    async def find_beacon(self):
        target_service = SERVICE_UUID.lower()

        def matches_target(device, advertisement_data) -> bool:
            advertised_name = advertisement_data.local_name or device.name or ""
            advertised_services = {
                service_uuid.lower()
                for service_uuid in (advertisement_data.service_uuids or [])
            }
            return (
                advertised_name == self.device_name
                or target_service in advertised_services
            )

        log(f"Scanning for {self.device_name} ({self.scan_timeout:.0f}s timeout)")
        device = await BleakScanner.find_device_by_filter(
            matches_target,
            timeout=self.scan_timeout,
        )

        if device is None:
            log("Beacon not found")
            return None

        log(f"Found beacon: name={device.name or 'unknown'} address={device.address}")
        return device

    async def listen_to_beacon(self, device) -> None:
        def disconnected_callback(_client) -> None:
            log("Beacon disconnected")

        async with BleakClient(device, disconnected_callback=disconnected_callback) as client:
            log(f"Connected to {self.device_name}")
            await self.verify_characteristic(client)

            device_key = device.address or self.device_name
            if device_key not in self.online_notified_devices:
                if await self.send_message(build_online_message(self.device_name)):
                    self.online_notified_devices.add(device_key)

            event_loop = asyncio.get_running_loop()

            def notification_handler(_sender, data: bytearray) -> None:
                value = int(data[0]) if data else 0
                event_loop.create_task(self.handle_alert_value(value))

            await client.start_notify(CHARACTERISTIC_UUID, notification_handler)
            log("Subscribed to alert characteristic 0x5678")

            while client.is_connected:
                await asyncio.sleep(1)

    async def verify_characteristic(self, client: BleakClient) -> None:
        if hasattr(client, "get_services"):
            services = await client.get_services()
        else:
            services = client.services

        characteristic_uuids = {
            characteristic.uuid.lower()
            for service in services
            for characteristic in service.characteristics
        }

        if CHARACTERISTIC_UUID.lower() not in characteristic_uuids:
            raise BleakError(
                f"Connected device does not expose characteristic {CHARACTERISTIC_UUID}"
            )

    async def handle_alert_value(self, value: int) -> None:
        if value == 0:
            log("Alert state reset to 0")
            return

        if value != 1:
            log(f"Ignoring unexpected alert value: {value}")
            return

        now = time.monotonic()
        seconds_since_last = now - self.last_alert_sent_at
        if seconds_since_last < ALERT_COOLDOWN_SECONDS:
            remaining = ALERT_COOLDOWN_SECONDS - seconds_since_last
            log(f"Alert suppressed by cooldown ({remaining:.1f}s remaining)")
            return

        self.alert_count += 1
        self.last_alert_sent_at = now
        log(f"Emergency alert received; count={self.alert_count}")
        await self.send_message(build_emergency_message(self.device_name, self.alert_count))

    async def send_message(self, message: str) -> bool:
        if self.dry_run:
            log("[dry-run] Telegram message:")
            print(message, flush=True)
            return True

        if self.telegram_config is None:
            log("Telegram credentials are not configured")
            return False

        try:
            await asyncio.to_thread(send_telegram_message, self.telegram_config, message)
        except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
            log(f"Telegram send failed: {exc}")
            return False

        log("Telegram message sent")
        return True


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Listen for Beacon-001 BLE alerts and forward them to Telegram."
    )
    parser.add_argument(
        "--device-name",
        default=DEVICE_NAME,
        help=f"BLE device name to scan for. Default: {DEVICE_NAME}",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(os.getenv("TELEGRAM_GATEWAY_CONFIG", DEFAULT_CONFIG_PATH)),
        help=f"Local JSON credential file. Default: {DEFAULT_CONFIG_PATH}",
    )
    parser.add_argument(
        "--scan-timeout",
        type=float,
        default=30.0,
        help="Seconds to scan before retrying. Default: 30",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print Telegram messages instead of sending them.",
    )
    parser.add_argument(
        "--test-telegram",
        action="store_true",
        help="Send the online Telegram message once, then exit.",
    )
    return parser.parse_args(argv)


async def async_main(args: argparse.Namespace) -> None:
    telegram_config = None if args.dry_run else load_telegram_config(args.config)
    gateway = BeaconGateway(
        device_name=args.device_name,
        telegram_config=telegram_config,
        dry_run=args.dry_run,
        scan_timeout=args.scan_timeout,
    )

    if args.test_telegram:
        await gateway.send_message(build_online_message(args.device_name))
        return

    await gateway.run_forever()


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        asyncio.run(async_main(args))
    except KeyboardInterrupt:
        log("Stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
