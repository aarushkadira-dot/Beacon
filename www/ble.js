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
  const BEACON_NAME_PREFIX = "Beacon-";
  const SERVICE = "00001234-0000-1000-8000-00805f9b34fb";
  const CHAR = "00005678-0000-1000-8000-00805f9b34fb";
  const STORAGE_KEY = "beacon_device_id";
  const UUID_BASE_SUFFIX = "-0000-1000-8000-00805f9b34fb";

  let status = "disconnected"; // 'disconnected' | 'scanning' | 'connecting' | 'connected'
  let deviceId = null;
  let scanHandle = null;
  let scanActive = false;
  let disconnectHandle = null;
  let notificationHandle = null;
  let notificationDeviceId = null;
  let notificationSubscribed = false;
  let lastButtonByte = null;
  let pressCallback = null;
  let statusListeners = [];
  let connectionToken = 0;

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

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeUuid(uuid) {
    if (!uuid) return "";
    const compact = String(uuid).toLowerCase().replace(/[{}-]/g, "");
    if (/^[0-9a-f]{4}$/.test(compact)) {
      return "0000" + compact + UUID_BASE_SUFFIX;
    }
    if (/^[0-9a-f]{8}$/.test(compact)) {
      return compact + UUID_BASE_SUFFIX;
    }
    if (/^[0-9a-f]{32}$/.test(compact)) {
      return (
        compact.slice(0, 8) + "-" +
        compact.slice(8, 12) + "-" +
        compact.slice(12, 16) + "-" +
        compact.slice(16, 20) + "-" +
        compact.slice(20)
      );
    }
    return String(uuid).toLowerCase();
  }

  function uuidMatches(uuid, expected) {
    return normalizeUuid(uuid) === normalizeUuid(expected);
  }

  function toArray(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return [];
    return Object.keys(value).map((key) => value[key]);
  }

  function removeHandle(handle) {
    if (!handle || typeof handle.remove !== "function") {
      return Promise.resolve();
    }
    return handle.remove().catch(function () {});
  }

  /* Notification values can come back as a DataView, base64 string, or array
   * depending on platform + plugin version. Normalize to a single byte. */
  function readByteValue(event) {
    const v = event && event.value;
    if (v == null) return null;
    if (typeof v === "object" && typeof v.getUint8 === "function") {
      return v.getUint8(0);
    }
    if (typeof ArrayBuffer !== "undefined") {
      if (v instanceof ArrayBuffer && v.byteLength > 0) {
        return new DataView(v).getUint8(0);
      }
      if (ArrayBuffer.isView && ArrayBuffer.isView(v) && v.length > 0) {
        return v[0];
      }
    }
    if (typeof v === "string") {
      if (/^[0-9a-fA-F]{1,2}$/.test(v.trim())) {
        return parseInt(v.trim(), 16);
      }
      try {
        return atob(v).charCodeAt(0);
      } catch (_) {
        return null;
      }
    }
    if (Array.isArray(v)) return v[0];
    if (typeof v === "number") return v;
    if (typeof v === "object" && Array.isArray(v.data)) return v.data[0];
    return null;
  }

  async function initBLE() {
    await ble().initialize({ androidNeverForLocation: true });
  }

  function scanResultToCandidate(result, mode) {
    const dev = result && result.device ? result.device : result;
    const id = (dev && dev.deviceId) || (result && result.deviceId);
    const name =
      (dev && (dev.name || dev.localName)) ||
      (result && (result.localName || result.name));

    if (!id) return null;
    if (mode === "service") {
      return { deviceId: id, name: name || BEACON_NAME };
    }
    if (name === BEACON_NAME || (name && name.indexOf(BEACON_NAME_PREFIX) === 0)) {
      return { deviceId: id, name };
    }
    return null;
  }

  async function stopScan() {
    try {
      if (scanActive) {
        try { await ble().stopLEScan(); } catch (_) {}
      }
    } finally {
      scanActive = false;
      await removeHandle(scanHandle);
      scanHandle = null;
    }
  }

  async function scanOnce(options, timeoutMs, mode) {
    if (timeoutMs <= 0) return null;
    await stopScan();
    let found = null;
    scanHandle = await ble().addListener("onScanResult", (result) => {
      if (found) return;
      found = scanResultToCandidate(result, mode);
    });
    try {
      await ble().requestLEScan(options);
      scanActive = true;
      const start = Date.now();
      while (!found && Date.now() - start < timeoutMs) {
        await delay(150);
      }
      return found;
    } finally {
      await stopScan();
    }
  }

  async function stopButtonNotifications(stopNative) {
    const id = notificationDeviceId || deviceId;
    if (stopNative && notificationSubscribed && id) {
      try {
        await ble().stopNotifications({
          deviceId: id,
          service: SERVICE,
          characteristic: CHAR,
        });
      } catch (_) {}
    }
    await removeHandle(notificationHandle);
    notificationHandle = null;
    notificationDeviceId = null;
    notificationSubscribed = false;
    lastButtonByte = null;
    pressCallback = null;
  }

  async function clearConnection(options) {
    const opts = options || {};
    const id = deviceId;
    await stopScan();
    await stopButtonNotifications(opts.stopNotifications !== false);
    await removeHandle(disconnectHandle);
    disconnectHandle = null;
    if (opts.disconnectDevice && id) {
      try { await ble().disconnect({ deviceId: id }); } catch (_) {}
    }
    deviceId = null;
    if (opts.forgetDevice) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    }
    if (opts.updateStatus !== false) {
      setStatus("disconnected");
    }
  }

  async function clearAfterNativeDisconnect(disconnectedDeviceId) {
    if (deviceId && disconnectedDeviceId && deviceId !== disconnectedDeviceId) {
      return;
    }
    deviceId = null;
    await stopButtonNotifications(false);
    await removeHandle(disconnectHandle);
    disconnectHandle = null;
    setStatus("disconnected");
  }

  function getServiceList(result) {
    if (!result) return [];
    return toArray(result.services || result);
  }

  function getCharacteristicList(service) {
    if (!service) return [];
    return toArray(service.characteristics || service.characteristic || []);
  }

  async function verifyBeaconContract(devId) {
    const plugin = ble();
    let sawService = false;
    let sawCharacteristic = false;

    if (typeof plugin.getServices === "function") {
      const result = await plugin.getServices({ deviceId: devId });
      const services = getServiceList(result);
      const service = services.find((item) => uuidMatches(item && item.uuid, SERVICE));
      if (service) {
        sawService = true;
        sawCharacteristic = getCharacteristicList(service).some((item) => {
          return uuidMatches(
            item && (item.uuid || item.characteristic || item.characteristicUuid),
            CHAR
          );
        });
      }
      if (sawService && sawCharacteristic) return;
    }

    if (typeof plugin.read === "function") {
      await plugin.read({
        deviceId: devId,
        service: SERVICE,
        characteristic: CHAR,
      });
      return;
    }

    if (!sawService) {
      throw new Error("Connected device does not expose the BEACON service.");
    }
    throw new Error("Connected device does not expose the BEACON button characteristic.");
  }

  /* Scans by service first, then falls back to name/namePrefix for iOS cases
   * where the custom 16-bit service filter does not surface the advertisement. */
  async function scanForBeacon(timeoutMs = 10000) {
    connectionToken += 1;
    await clearConnection({ disconnectDevice: true, updateStatus: false });
    setStatus("scanning");

    const deadline = Date.now() + timeoutMs;
    const remaining = () => Math.max(0, deadline - Date.now());
    const serviceMs = Math.min(remaining(), Math.max(2500, Math.round(timeoutMs * 0.6)));
    const exactNameMs = Math.min(remaining(), Math.max(1200, Math.round(timeoutMs * 0.2)));
    let found = null;

    try {
      found = await scanOnce({
        services: [SERVICE],
        allowDuplicates: false,
      }, serviceMs, "service");

      if (!found && remaining() > 0) {
        found = await scanOnce({
          name: BEACON_NAME,
          allowDuplicates: false,
        }, exactNameMs, "name");
      }

      if (!found && remaining() > 0) {
        found = await scanOnce({
          namePrefix: BEACON_NAME_PREFIX,
          allowDuplicates: false,
        }, remaining(), "namePrefix");
      }
    } finally {
      await stopScan();
      if (!deviceId) setStatus("disconnected");
    }

    return found;
  }

  async function connectToBeacon(devId) {
    if (!devId) throw new Error("Missing BEACON device id.");
    const token = connectionToken + 1;
    connectionToken = token;
    await clearConnection({ disconnectDevice: true, updateStatus: false });
    setStatus("connecting");

    let nativeConnected = false;
    try {
      disconnectHandle = await ble().addListener("disconnected|" + devId, () => {
        if (token !== connectionToken && deviceId !== devId) return;
        clearAfterNativeDisconnect(devId).catch(function () {});
      });

      await ble().connect({ deviceId: devId });
      nativeConnected = true;
      await verifyBeaconContract(devId);

      if (token !== connectionToken) {
        throw new Error("BEACON connection was replaced by a newer request.");
      }

      deviceId = devId;
      try { localStorage.setItem(STORAGE_KEY, devId); } catch (_) {}
      setStatus("connected");
    } catch (err) {
      if (nativeConnected) {
        try { await ble().disconnect({ deviceId: devId }); } catch (_) {}
      }
      if (token === connectionToken) {
        await removeHandle(disconnectHandle);
        disconnectHandle = null;
        deviceId = null;
        setStatus("disconnected");
      }
      throw err;
    }
  }

  async function subscribeToButtonPress(callback) {
    if (!deviceId) throw new Error("Not connected to a BEACON device.");
    if (notificationHandle && notificationDeviceId === deviceId && notificationSubscribed) {
      pressCallback = callback;
      return;
    }

    await stopButtonNotifications(true);
    pressCallback = callback;
    const id = deviceId;
    const key = `notification|${id}|${SERVICE}|${CHAR}`;
    notificationHandle = await ble().addListener(key, (event) => {
      const byte = readByteValue(event);
      if (byte === 0x00) {
        lastButtonByte = byte;
        return;
      }
      if (byte === 0x01 && lastButtonByte !== 0x01 && pressCallback) {
        lastButtonByte = byte;
        try { pressCallback(); } catch (_) {}
        return;
      }
      if (byte !== null) {
        lastButtonByte = byte;
      }
    });
    notificationDeviceId = id;
    try {
      await ble().startNotifications({
        deviceId: id,
        service: SERVICE,
        characteristic: CHAR,
      });
      notificationSubscribed = true;
    } catch (err) {
      await stopButtonNotifications(false);
      throw err;
    }
  }

  async function disconnect() {
    connectionToken += 1;
    await clearConnection({ disconnectDevice: true, forgetDevice: true });
  }

  /* Reconnects to the saved iOS/Android device id when possible. If that id is
   * stale, rescan and replace localStorage with the current peripheral id. */
  async function reconnectFromStorage(timeoutMs = 10000) {
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) {}
    if (!saved) return false;
    try {
      await connectToBeacon(saved);
      return true;
    } catch (_) {}

    const found = await scanForBeacon(timeoutMs);
    if (!found) return false;
    try {
      await connectToBeacon(found.deviceId);
      return true;
    } catch (_) {}
    return false;
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
