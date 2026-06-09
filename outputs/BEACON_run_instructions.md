# BEACON Prototype Run Instructions

## Open the app prototype

Open this file in a browser:

`outputs/beacon_app_prototype.html`

Recommended browser for real BLE pairing:

- Chrome on macOS, Windows, or Android
- Web Bluetooth is not supported on iPhone Safari

If BLE is unavailable, tap **Simulate** in the app. The full product flow still works.

## Try the demo flow

1. Open the prototype.
2. Tap **Simulate**.
3. Open **Contacts** and add or toggle trusted contacts.
4. Go back to **Home**.
5. Tap **Press BEACON**.
6. Open **Map**.
7. Tap **Navigate** to open route directions.
8. Tap **I'm safe** to send the all-clear state.

## Connect an ESP32 button

1. Open the Arduino IDE.
2. Install/select an ESP32 board package if needed.
3. Open:

`outputs/beacon_esp32_ble_button/beacon_esp32_ble_button.ino`

4. Wire a button between **GPIO 0** and **GND**.
5. Upload the sketch.
6. Open the prototype in Chrome.
7. Tap **Pair BEACON**.
8. Select **BEACON-001**.
9. Press the hardware button.

The app listens for this BLE service:

`4fafc201-1fb5-459e-8fcc-c5c9c331914b`

And this button characteristic:

`beb5483e-36e1-4688-b7f5-ea07361b26a8`

## Important limitation

This is a browser prototype so you can test the experience immediately. The production mobile app should be built in React Native with native BLE, push notifications, background behavior, and a real backend.
