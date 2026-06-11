import Foundation
import UIKit
import CoreBluetooth
import UserNotifications

private let serviceUUID  = CBUUID(string: "00001234-0000-1000-8000-00805f9b34fb")
private let charUUID     = CBUUID(string: "00005678-0000-1000-8000-00805f9b34fb")
private let deviceName   = "Beacon-001"
private let cooldown: TimeInterval = 5.0
private let udTokenKey   = "beacon_telegram_token"
private let udChatIdsKey = "beacon_telegram_chat_ids"

/// Manages its own CoreBluetooth connection so Telegram alerts and local
/// notifications are delivered even when the app is fully backgrounded.
class BeaconBackgroundGateway: NSObject {
    static let shared = BeaconBackgroundGateway()

    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var alertChar: CBCharacteristic?
    private var lastAlertTime: Date = .distantPast
    private(set) var isRunning = false

    // MARK: – Credentials (persisted in UserDefaults)

    var botToken: String {
        get { UserDefaults.standard.string(forKey: udTokenKey) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: udTokenKey) }
    }

    var chatIds: [String] {
        get {
            let raw = UserDefaults.standard.string(forKey: udChatIdsKey) ?? ""
            return raw.split(separator: ",")
                      .map { $0.trimmingCharacters(in: .whitespaces) }
                      .filter { !$0.isEmpty }
        }
        set {
            UserDefaults.standard.set(newValue.joined(separator: ","), forKey: udChatIdsKey)
        }
    }

    // MARK: – Lifecycle

    func start() {
        guard !isRunning else { return }
        isRunning = true
        if central == nil {
            central = CBCentralManager(
                delegate: self,
                queue: nil,
                options: [CBCentralManagerOptionRestoreIdentifierKey: "BeaconGateway"]
            )
        } else if central!.state == .poweredOn {
            startScan()
        }
    }

    func stop() {
        isRunning = false
        if let p = peripheral { central?.cancelPeripheralConnection(p) }
        central?.stopScan()
        peripheral = nil
        alertChar = nil
    }

    // MARK: – Private

    private func startScan() {
        guard isRunning else { return }
        central?.scanForPeripherals(withServices: [serviceUUID], options: nil)
    }

    private func onButtonPress() {
        let now = Date()
        guard now.timeIntervalSince(lastAlertTime) >= cooldown else { return }
        lastAlertTime = now

        DispatchQueue.main.async {
            // Only act natively when the app is backgrounded.
            // When foregrounded, JavaScript handles Telegram + notifications.
            let state = UIApplication.shared.applicationState
            if state == .background || state == .inactive {
                self.sendTelegramAlerts()
                self.scheduleLocalNotification()
            }
        }
    }

    private func sendTelegramAlerts() {
        let token = botToken
        let ids   = chatIds
        guard !token.isEmpty, !ids.isEmpty else { return }

        let time = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .short)
        let text = "🚨 BEACON EMERGENCY ALERT\n\nTime: \(time)\nYour beacon button was pressed.\n\nPlease check on them immediately."

        for chatId in ids {
            guard let url = URL(string: "https://api.telegram.org/bot\(token)/sendMessage") else { continue }
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONSerialization.data(withJSONObject: [
                "chat_id": chatId,
                "text": text
            ])
            URLSession.shared.dataTask(with: req).resume()
        }
    }

    private func scheduleLocalNotification() {
        let content = UNMutableNotificationContent()
        content.title = "🚨 BEACON ALERT"
        content.body  = "Your beacon button was pressed. Tap to open."
        content.sound = .defaultCritical
        let req = UNNotificationRequest(
            identifier: "beacon-\(Date().timeIntervalSince1970)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(req)
    }
}

// MARK: – CBCentralManagerDelegate

extension BeaconBackgroundGateway: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn { startScan() }
    }

    func centralManager(_ central: CBCentralManager,
                        willRestoreState dict: [String: Any]) {
        let restored = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] ?? []
        for p in restored where p.name == deviceName {
            peripheral = p
            p.delegate = self
            central.connect(p)
        }
    }

    func centralManager(_ central: CBCentralManager,
                        didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any],
                        rssi RSSI: NSNumber) {
        let name = peripheral.name
            ?? (advertisementData[CBAdvertisementDataLocalNameKey] as? String)
            ?? ""
        guard name == deviceName else { return }
        self.peripheral = peripheral
        central.stopScan()
        central.connect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.delegate = self
        peripheral.discoverServices([serviceUUID])
    }

    func centralManager(_ central: CBCentralManager,
                        didDisconnectPeripheral peripheral: CBPeripheral,
                        error: Error?) {
        self.peripheral = nil
        self.alertChar  = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            self?.startScan()
        }
    }
}

// MARK: – CBPeripheralDelegate

extension BeaconBackgroundGateway: CBPeripheralDelegate {
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let svc = peripheral.services?.first(where: { $0.uuid == serviceUUID }) else { return }
        peripheral.discoverCharacteristics([charUUID], for: svc)
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didDiscoverCharacteristicsFor service: CBService,
                    error: Error?) {
        guard let ch = service.characteristics?.first(where: { $0.uuid == charUUID }) else { return }
        alertChar = ch
        peripheral.setNotifyValue(true, for: ch)
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didUpdateValueFor characteristic: CBCharacteristic,
                    error: Error?) {
        guard characteristic.uuid == charUUID,
              let byte = characteristic.value?.first,
              byte == 0x01 else { return }
        onButtonPress()
    }
}
