# Telegram BLE Gateway

This project uses the XIAO nRF52840 as a BLE beacon and a nearby Mac as the Telegram gateway. The board advertises as `Beacon-001`, exposes service `0x1234`, and notifies characteristic `0x5678` with `1` on button press and `0` on release.

## Firmware

The firmware is in `Beacon_Firmware/Beacon_Firmware.ino`. It is intended for the Seeed Studio XIAO nRF52840 with the Bluefruit-compatible Seeed nRF52 board package.

Install the Seeed board package in Arduino IDE using this Board Manager URL:

```text
https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json
```

With `arduino-cli`, the equivalent setup is:

```sh
arduino-cli config add board_manager.additional_urls https://files.seeedstudio.com/arduino/package_seeeduino_boards_index.json
arduino-cli core update-index
arduino-cli core install Seeeduino:nrf52
arduino-cli compile --fqbn Seeeduino:nrf52:xiaonRF52840 Beacon_Firmware
```

For the Sense board, use:

```sh
arduino-cli compile --fqbn Seeeduino:nrf52:xiaonRF52840Sense Beacon_Firmware
```

The default button pin is digital pin `1` (`D1`) with `INPUT_PULLUP`, so wire the button between `D1` and `GND`. If your beacon uses a different pin, change `BEACON_BUTTON_PIN` near the top of the sketch.

## Mac Gateway

Install the Python BLE dependency:

```sh
python3 -m pip install -r requirements-telegram-gateway.txt
```

Credentials are read from environment variables first:

```sh
export TELEGRAM_BOT_TOKEN="123456789:replace-me"
export TELEGRAM_CHAT_ID="123456789"
python3 telegram_ble_gateway.py
```

For local convenience, you can also create `telegram_ble_gateway.local.json`; it is ignored by Git:

```json
{
  "bot_token": "123456789:replace-me",
  "chat_id": "123456789"
}
```

Useful checks:

```sh
python3 telegram_ble_gateway.py --dry-run --test-telegram
python3 telegram_ble_gateway.py --test-telegram
python3 telegram_ble_gateway.py --dry-run
```
