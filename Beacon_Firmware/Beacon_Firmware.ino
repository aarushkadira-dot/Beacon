#include <bluefruit.h>

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);

  // Blink twice = code started
  digitalWrite(LED_BUILTIN, LOW);
  delay(200);
  digitalWrite(LED_BUILTIN, HIGH);
  delay(200);
  digitalWrite(LED_BUILTIN, LOW);
  delay(200);
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);

  if (!Bluefruit.begin(1, 0)) {
    // BLE failed = fast blink forever
    while (true) {
      digitalWrite(LED_BUILTIN, LOW);
      delay(100);
      digitalWrite(LED_BUILTIN, HIGH);
      delay(100);
    }
  }

  Bluefruit.setTxPower(4);
  Bluefruit.setName("Beacon-001");

  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addName();
  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(32, 244);
  Bluefruit.Advertising.setFastTimeout(30);
  Bluefruit.Advertising.start(0);

  // Solid ON = BLE advertising
  digitalWrite(LED_BUILTIN, LOW);
}

void loop() {
  delay(1000);
}
