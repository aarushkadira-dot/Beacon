/* BEACON BLE module
 *
 * Talks to a physical Beacon-001 keychain over @capacitor-community/bluetooth-le.
 * Exposes window.BeaconBLE with the contract used by the rest of the app.
 *
 * Device contract (matches firmware):
 *   name:           "Beacon-001"
 *   service UUID:   00001234-0000-1000-8000-00805f9b34fb
 *   char UUID:      00005678-0000-1000-8000-00805f9b34fb  (NOTIFY + READ)
 *   value 0x01:     button pressed
 *   value 0x00:     button released / idle
 */
(function () {
  const BEACON_NAME = "Beacon-001";
  const SERVICE = "00001234-0000-1000-8000-00805f9b34fb";
  const CHAR = "00005678-0000-1000-8000-00805f9b34fb";
  const STORAGE_KEY = "beacon_device_id";

  let status = "disconnected"; // 'disconnected' | 'scanning' | 'connecting' | 'connected'
  let deviceId = null;
  let listenerHandles = [];
  let pressCallback = null;
  let statusListeners = [];

  function ble() {
    const p =
      window.Capacitor &&
      window.Capacitor.Plugins &&
      window.Capacitor.Plugins.BluetoothLe;
    if (!p) {
      throw new Error(
        "Bluetooth plugin not available. Run on a real iOS or Android device — BLE doesn't work in simulators."
      );
    }
    return p;
  }

  function setStatus(next) {
    if (status === next) return;
    status = next;
    statusListeners.forEach((fn) => {
      try { fn(status); } catch (_) {}
    });
  }

  /* Notification values can come back as a DataView, base64 string, or array
   * depending on platform + plugin version. Normalize to a single byte. */
  function readByteValue(event) {
    const v = event && event.value;
    if (v == null) return null;
    if (typeof v === "object" && typeof v.getUint8 === "function") {
      return v.getUint8(0);
    }
    if (typeof v === "string") {
      try {
        return atob(v).charCodeAt(0);
      } catch (_) {
        return null;
      }
    }
    if (Array.isArray(v)) return v[0];
    if (typeof v === "number") return v;
    return null;
  }

  async function initBLE() {
    await ble().initialize({ androidNeverForLocation: true });
  }

  /* Scans for a device named "Beacon-001". Resolves with { deviceId, name } or null. */
  async function scanForBeacon(timeoutMs = 10000) {
    setStatus("scanning");
    let found = null;
    const handle = await ble().addListener("onScanResult", (result) => {
      if (found) return;
      const dev = result && result.device;
      const name = (dev && dev.name) || (result && result.localName);
      if (name === BEACON_NAME && dev && dev.deviceId) {
        found = { deviceId: dev.deviceId, name };
      }
    });
    try {
      await ble().requestLEScan({
        services: [SERVICE],
        allowDuplicates: false,
      });
      const start = Date.now();
      while (!found && Date.now() - start < timeoutMs) {
        await new Promise((r) => setTimeout(r, 150));
      }
    } finally {
      try { await ble().stopLEScan(); } catch (_) {}
      try { await handle.remove(); } catch (_) {}
      setStatus(found ? "disconnected" : "disconnected");
    }
    return found;
  }

  async function connectToBeacon(devId) {
    setStatus("connecting");
    try {
      const dh = await ble().addListener(
        "disconnected|" + devId,
        () => {
          deviceId = null;
          setStatus("disconnected");
        }
      );
      listenerHandles.push(dh);
      await ble().connect({ deviceId: devId });
      deviceId = devId;
      try {
        localStorage.setItem(STORAGE_KEY, devId);
      } catch (_) {}
      setStatus("connected");
    } catch (err) {
      setStatus("disconnected");
      throw err;
    }
  }

  async function subscribeToButtonPress(callback) {
    if (!deviceId) throw new Error("Not connected to a BEACON device.");
    pressCallback = callback;
    const key = `notification|${deviceId}|${SERVICE}|${CHAR}`;
    const h = await ble().addListener(key, (event) => {
      const byte = readByteValue(event);
      if (byte === 0x01 && pressCallback) {
        try { pressCallback(); } catch (_) {}
      }
      // 0x00 (release) is ignored on purpose.
    });
    listenerHandles.push(h);
    await ble().startNotifications({
      deviceId,
      service: SERVICE,
      characteristic: CHAR,
    });
  }

  async function disconnect() {
    const id = deviceId;
    try {
      if (id) {
        try {
          await ble().stopNotifications({
            deviceId: id,
            service: SERVICE,
            characteristic: CHAR,
          });
        } catch (_) {}
        await ble().disconnect({ deviceId: id });
      }
    } finally {
      for (const h of listenerHandles) {
        try { await h.remove(); } catch (_) {}
      }
      listenerHandles = [];
      deviceId = null;
      pressCallback = null;
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      setStatus("disconnected");
    }
  }

  /* Tries to reconnect to the previously paired device. Returns true on success. */
  async function reconnectFromStorage() {
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) {}
    if (!saved) return false;
    try {
      await connectToBeacon(saved);
      return true;
    } catch (_) {
      return false;
    }
  }

  function getConnectionStatus() {
    return status;
  }

  function onStatusChange(fn) {
    statusListeners.push(fn);
    return () => {
      statusListeners = statusListeners.filter((x) => x !== fn);
    };
  }

  function getDeviceId() {
    return deviceId;
  }

  window.BeaconBLE = {
    initBLE,
    scanForBeacon,
    connectToBeacon,
    subscribeToButtonPress,
    disconnect,
    reconnectFromStorage,
    getConnectionStatus,
    onStatusChange,
    getDeviceId,
    BEACON_NAME,
    SERVICE,
    CHAR,
  };
})();
