/*
  BEACON ESP32 BLE Button

  Board: ESP32 Dev Module or similar
  Button: connect one side to GPIO 0 and the other side to GND
  Optional LED: built-in LED on GPIO 2, if your board has one

  This sketch advertises a BLE device named "BEACON-001".
  When the button is pressed, it notifies the paired app with:
  PRESS:EMERGENCY:<battery_percent>

  The UUIDs match outputs/beacon_app_prototype.html.
*/

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define BUTTON_PIN 0
#define LED_PIN 2

static const char *DEVICE_NAME = "BEACON-001";
static const char *SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
static const char *BUTTON_CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

BLECharacteristic *buttonCharacteristic = nullptr;

bool deviceConnected = false;
bool lastButtonState = HIGH;
unsigned long lastDebounceTime = 0;
const unsigned long debounceDelayMs = 60;

class BeaconServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) {
    deviceConnected = true;
    digitalWrite(LED_PIN, HIGH);
  }

  void onDisconnect(BLEServer *server) {
    deviceConnected = false;
    digitalWrite(LED_PIN, LOW);
    BLEDevice::startAdvertising();
  }
};

int readBatteryPercent() {
  // MVP placeholder. Later, read a battery voltage divider and convert it.
  return 84;
}

void sendBeaconPress() {
  if (!deviceConnected || buttonCharacteristic == nullptr) {
    return;
  }

  int battery = readBatteryPercent();
  String payload = "PRESS:EMERGENCY:" + String(battery);
  buttonCharacteristic->setValue(payload.c_str());
  buttonCharacteristic->notify();
}

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.begin(115200);
  Serial.println("Starting BEACON BLE button...");

  BLEDevice::init(DEVICE_NAME);
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new BeaconServerCallbacks());

  BLEService *service = server->createService(SERVICE_UUID);

  buttonCharacteristic = service->createCharacteristic(
    BUTTON_CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_NOTIFY
  );

  buttonCharacteristic->addDescriptor(new BLE2902());
  buttonCharacteristic->setValue("READY:84");

  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("BEACON-001 is advertising.");
}

void loop() {
  bool reading = digitalRead(BUTTON_PIN);

  if (reading != lastButtonState) {
    lastDebounceTime = millis();
  }

  if ((millis() - lastDebounceTime) > debounceDelayMs) {
    static bool pressHandled = false;

    if (reading == LOW && !pressHandled) {
      Serial.println("BEACON press detected.");
      sendBeaconPress();
      pressHandled = true;
    }

    if (reading == HIGH) {
      pressHandled = false;
    }
  }

  lastButtonState = reading;
  delay(10);
}
