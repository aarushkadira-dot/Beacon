import Capacitor

@objc(BeaconGatewayPlugin)
public class BeaconGatewayPlugin: CAPPlugin {

    /// Call once after the user saves Telegram credentials in Settings.
    /// Persists them and starts the background gateway if not already running.
    @objc func configure(_ call: CAPPluginCall) {
        let token = call.getString("botToken") ?? ""
        let ids   = call.getString("chatIds")  ?? ""

        let gw = BeaconBackgroundGateway.shared
        gw.botToken = token
        gw.chatIds  = ids.split(separator: ",")
                        .map { $0.trimmingCharacters(in: .whitespaces) }
                        .filter { !$0.isEmpty }

        if !token.isEmpty && !gw.chatIds.isEmpty {
            gw.start()
        } else {
            gw.stop()
        }
        call.resolve()
    }

    /// Explicitly start scanning / connecting (called on app launch if creds are saved).
    @objc func start(_ call: CAPPluginCall) {
        BeaconBackgroundGateway.shared.start()
        call.resolve()
    }

    /// Stop the gateway (called when user explicitly disconnects).
    @objc func stop(_ call: CAPPluginCall) {
        BeaconBackgroundGateway.shared.stop()
        call.resolve()
    }
}
