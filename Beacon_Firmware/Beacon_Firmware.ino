#include <bluefruit.h>
#include <Adafruit_TinyUSB.h>

static const char DEVICE_NAME[] = "Beacon-001";
static const uint16_t ALERT_SERVICE_UUID = 0x1234;
static const uint16_t ALERT_CHARACTERISTIC_UUID = 0x5678;

#ifndef BEACON_BUTTON_PIN
#define BEACON_BUTTON_PIN D1
#endif

static const uint32_t DEBOUNCE_MS = 25;

BLEService alertService(ALERT_SERVICE_UUID);
BLECharacteristic alertCharacteristic(ALERT_CHARACTERISTIC_UUID);

bool stableButtonPressed = false;
bool lastButtonReading = false;
uint32_t lastButtonChangeMs = 0;
uint8_t alertState = 0;

void startAdvertising();
void setAlertState(bool active);
void connectCallback(uint16_t connHandle);
void disconnectCallback(uint16_t connHandle, uint8_t reason);

void setup() {
  Serial.begin(115200);
  uint32_t serialStartMs = millis();
  while (!Serial && millis() - serialStartMs < 3000) {
    delay(10);
  }

  Serial.println();
  Serial.println("Beacon firmware booting");
  Serial.print("Device name: ");
  Serial.println(DEVICE_NAME);
  Serial.print("Alert service UUID: 0x");
  Serial.println(ALERT_SERVICE_UUID, HEX);
  Serial.print("Alert characteristic UUID: 0x");
  Serial.println(ALERT_CHARACTERISTIC_UUID, HEX);
  Serial.print("Button pin: ");
  Serial.println(BEACON_BUTTON_PIN);

  pinMode(BEACON_BUTTON_PIN, INPUT_PULLUP);
  stableButtonPressed = digitalRead(BEACON_BUTTON_PIN) == LOW;
  lastButtonReading = stableButtonPressed;

  Bluefruit.begin();
  Bluefruit.setTxPower(4);
  Bluefruit.setName(DEVICE_NAME);
  Bluefruit.Periph.setConnectCallback(connectCallback);
  Bluefruit.Periph.setDisconnectCallback(disconnectCallback);

  alertService.begin();

  alertCharacteristic.setProperties(CHR_PROPS_READ | CHR_PROPS_NOTIFY);
  alertCharacteristic.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
  alertCharacteristic.setFixedLen(1);
  alertCharacteristic.begin();
  alertCharacteristic.write8(0);

  Serial.println("Alert characteristic initialized to 0");
  startAdvertising();
}

void loop() {
  bool pressed = digitalRead(BEACON_BUTTON_PIN) == LOW;

  if (pressed != lastButtonReading) {
    lastButtonReading = pressed;
    lastButtonChangeMs = millis();
  }

  if (millis() - lastButtonChangeMs >= DEBOUNCE_MS &&
      pressed != stableButtonPressed) {
    stableButtonPressed = pressed;
    setAlertState(stableButtonPressed);
  }

  delay(5);
}

void startAdvertising() {
  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addService(alertService);
  bool nameInPrimaryPacket = Bluefruit.Advertising.addName();
  Bluefruit.ScanResponse.addName();

  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(32, 244);
  Bluefruit.Advertising.setFastTimeout(30);
  Bluefruit.Advertising.start(0);

  Serial.print("Advertising as ");
  Serial.println(DEVICE_NAME);
  if (!nameInPrimaryPacket) {
    Serial.println("Full device name did not fit in primary advertising packet; scan response still includes it");
  }
}

void setAlertState(bool active) {
  alertState = active ? 1 : 0;
  alertCharacteristic.write8(alertState);

  if (Bluefruit.connected()) {
    alertCharacteristic.notify8(alertState);
  }

  if (active) {
    Serial.println("Button pressed; alert state set to 1 and notification sent");
  } else {
    Serial.println("Button released; alert state reset to 0 and notification sent");
  }
}

void connectCallback(uint16_t connHandle) {
  BLEConnection *connection = Bluefruit.Connection(connHandle);
  char centralName[32] = {0};

  if (connection) {
    connection->getPeerName(centralName, sizeof(centralName));
  }

  Serial.print("Connected to central");
  if (centralName[0] != '\0') {
    Serial.print(": ");
    Serial.print(centralName);
  }
  Serial.println();
}

void disconnectCallback(uint16_t connHandle, uint8_t reason) {
  (void)connHandle;

  Serial.print("Disconnected; reason 0x");
  Serial.println(reason, HEX);
  Serial.println("Advertising will restart automatically");
}
