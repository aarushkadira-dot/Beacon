# BEACON App Prototype

BEACON is a safety button product concept. This prototype shows the first app experience:

- Pair or simulate a BEACON device
- Manage trusted contacts
- Trigger an emergency alert
- Show the alert location on a map-style screen
- Open route directions
- Send an all-clear state

## Open Locally

Open:

```text
outputs/beacon_app_prototype.html
```

Or run a local server:

```bash
cd outputs
python3 -m http.server 4173
```

Then open:

```text
http://localhost:4173/beacon_app_prototype.html
```

## Testing the BLE Connection

The app talks to the Beacon-001 keychain over Bluetooth Low Energy via the
`@capacitor-community/bluetooth-le` plugin. All BLE code lives in
`www/ble.js`, exposed as `window.BeaconBLE`.

**You need real hardware to test this end-to-end.** The iOS Simulator and
Android emulator have no Bluetooth radio, so scanning/connecting always fails
there. The simulated-pair flow still works in either environment.

### iOS — real device

1. Plug an iPhone into the Mac, unlock it, trust the computer.
2. Open `ios/App/App.xcworkspace` in Xcode.
3. Select the App target → **Signing & Capabilities** → pick your Team.
4. Pick the connected iPhone as the run destination → press ▶.
5. The first launch will prompt for **Bluetooth** and **Contacts** permission — allow both.
6. In onboarding step 3, tap **Pair a real device**. With the Beacon-001 powered on
   and nearby, the toast will progress: *Scanning → Found Beacon-001 → Connecting → paired and listening*.
7. Press the physical button on the keychain. The app's status card turns red
   and shows ALERT ACTIVE, and an entry appears in the alert timeline.
8. Tap **I'm Safe** and enter your PIN to resolve the alert.
9. Quit and reopen the app — it auto-reconnects (`tryAutoReconnect` on boot
   reads `beacon_device_id` from localStorage).

### Android — real device

1. Enable developer mode + USB debugging on the phone, plug it in.
2. `npx cap open android`, then **Run** in Android Studio.
3. Same flow as above — grant Bluetooth + Location permission when prompted.

### Edge cases worth checking

- Scanning timeout: 10s. Cover by hiding/turning off the device — toast should say "No BEACON found nearby".
- Out-of-range disconnect: walk away with the device. The status pill should flip
  to "Not paired" (`disconnected|<deviceId>` event fires).
- Cold-start reconnect: kill the app, walk back into range, reopen — should
  reconnect silently and re-subscribe to notifications.
- Permission denied: deny Bluetooth on first launch → next pair attempt should
  show a permission-related error toast (not a silent fail).
- Background: iOS keeps central connections alive briefly when backgrounded
  thanks to the `bluetooth-central` background mode in Info.plist, but Apple
  may suspend the WebView. Press detection while the app is killed is **not
  reliable** on iOS without state preservation/restoration, which the plugin
  doesn't fully expose — production will need a small native module.

### BLE module API (`window.BeaconBLE`)

```
initBLE()
scanForBeacon(timeoutMs = 10000)  -> { deviceId, name } | null
connectToBeacon(deviceId)         // persists to localStorage.beacon_device_id
subscribeToButtonPress(callback)  // fires on byte 0x01, ignores 0x00
disconnect()
reconnectFromStorage()            -> boolean
getConnectionStatus()             -> 'disconnected' | 'scanning' | 'connecting' | 'connected'
onStatusChange(fn)                -> unsubscribe()
```

## Hardware Prototype

The ESP32 BLE sketch is here:

```text
outputs/beacon_esp32_ble_button/beacon_esp32_ble_button.ino
```

It advertises as `BEACON-001` and sends a BLE notification when the button is pressed.

## Files

- `outputs/beacon_app_prototype.html` - browser app prototype
- `outputs/beacon_esp32_ble_button/beacon_esp32_ble_button.ino` - ESP32 BLE firmware
- `outputs/BEACON_app_blueprint.md` - product and architecture blueprint
- `outputs/BEACON_run_instructions.md` - setup and demo instructions
