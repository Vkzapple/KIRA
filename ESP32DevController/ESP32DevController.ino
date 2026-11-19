/* =====================================================================
   ESP32 Dev Module  —  Node aktuator + sensor

   Fungsi:
     1. PCA9685 (I2C) menggerakkan 3 servo:
          CH0 + CH1 -> servo SINKRON (arah sama, bisa di-invert/di-offset)
          CH2       -> servo TERPISAH (independen)
     2. Modul HW-039 = driver motor BTS7960 (1 modul) untuk roda/mekanisme:
          RPWM/LPWM -> PWM 20 kHz, arah maju/mundur
        HW-039 BUKAN sensor hujan. Tidak ada sensor hujan di node ini.
     3. Sensor soil moisture (analog, ADC1)
     4. Konek ke backend GRENVIS (Go) lewat WebSocket sebagai device:
          ws://<server>:8080/ws/device?token=<DEVICE_TOKEN>
        - kirim telemetry tiap 2 detik
        - terima perintah: move, servo, probe, camera
     5. Tidak ada dashboard/server HTTP di ESP32. Semua tampilan dan
        kontrol ada di website GRENVIS lewat backend.
     6. ESP32-CAM konek sendiri ke backend yang sama (lihat sketch CAM)

   Library (Library Manager):
     - Adafruit PWM Servo Driver Library  (otomatis tarik Adafruit BusIO)
     - ArduinoJson 7.x
     - WebSockets  (Markus Sattler / Links2004)

   Board: "ESP32 Dev Module"
   ===================================================================== */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
#include <ArduinoJson.h>
#include <math.h>

/* ============================ KONFIGURASI ============================ */

#define WIFI_SSID "GANTI_SSID"
#define WIFI_PASS "GANTI_PASSWORD"

// ---- Backend GRENVIS ----
// Isi IP/host laptop atau server tempat `grenvis-server` berjalan.
#define BACKEND_HOST  "192.168.1.10"
#define BACKEND_PORT  8080
#define DEVICE_TOKEN  "change-me-device-token"   // harus sama dengan .env backend
#define DEVICE_ID     "grenvis-01-dev"
#define DEVICE_NAME   "GRENVIS Dev"
#define FIRMWARE_VER  "1.1.0"

// ---- Pin ----
#define PIN_SDA      21
#define PIN_SCL      22
#define PIN_SOIL     34   // ADC1, input only

// ---- PCA9685 ----
#define PCA_ADDR       0x40
#define CH_SYNC_A      0
#define CH_SYNC_B      1
#define CH_AUX         2
#define SERVO_FREQ     50
#define SERVO_MIN_US   500
#define SERVO_MAX_US   2500
#define SERVO_HOME     90

// Servo kedua bergerak bersama servo pertama.
// Kalau mekaniknya kebalik, set SYNC_B_INVERT = true.
#define SYNC_B_INVERT  false
#define SYNC_B_OFFSET  0
#define AUX_INVERT     false

// Langkah perintah dari web (derajat)
#define STEP_SERVO     5

// ---- Kalibrasi soil moisture (12-bit, 0..4095) ----
// Ukur sendiri: kering di udara, basah di air. Nilai di bawah = contoh umum.
#define SOIL_DRY_RAW        2600
#define SOIL_WET_RAW        1100

// ---- Modul HW-039: driver motor BTS7960 (1 modul) ----
// R_EN dan L_EN dihubungkan ke 3V3. B+ / B- ke supply motor, GND disatukan.
#define PIN_MOTOR_RPWM   26
#define PIN_MOTOR_LPWM   27
#define MOTOR_PWM_FREQ   20000    // 20 kHz, di atas ambang dengar
#define MOTOR_PWM_BITS   8        // duty 0..255
#define MOTOR_SPEED      180      // kecepatan default (0..255)
#define MOTOR_RAMP_MS    300      // waktu dari 0 ke duty penuh
#define MOTOR_DEADTIME_MS 120     // jeda saat balik arah
#define CH_MOTOR_RPWM    4        // kanal LEDC (core 2.x)
#define CH_MOTOR_LPWM    5

#define TELEMETRY_MS   2000

/* ============================== GLOBAL =============================== */

Adafruit_PWMServoDriver pwm(PCA_ADDR);
WebSocketsClient  backend;

float syncNow = SERVO_HOME, syncTarget = SERVO_HOME;
float auxNow  = SERVO_HOME, auxTarget  = SERVO_HOME;

int soilRaw = 0;
int soilPct = 0;

bool backendUp = false;
uint32_t lastTelemetry = 0;

// Motor BTS7960: nilai -255..255 (negatif = mundur).
int      motorTarget   = 0;
int      motorNow      = 0;
int      motorApplied  = 0;
uint32_t motorDeadUntil = 0;

/* =========================== PROTOTYPES ============================= */

void readSensors();
void updateServos();
void applyAllServos();
void initMotor();
void updateMotor();
void setMotorTarget(int value);
void applyMotor(int value);
void stopMotor();
void handleCommand(const String &msg);
void sendHello();
void sendTelemetry(bool force = false);
void startBackend();

/* ============================== SETUP =============================== */

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println(F("== ESP32 Dev Controller =="));

  // I2C + PCA9685
  Wire.begin(PIN_SDA, PIN_SCL);
  pwm.begin();
  pwm.setOscillatorFrequency(27000000);
  pwm.setPWMFreq(SERVO_FREQ);
  delay(10);
  syncNow = syncTarget = SERVO_HOME;
  auxNow  = auxTarget  = SERVO_HOME;
  applyAllServos();

  // Driver motor HW-039 / BTS7960
  initMotor();

  // Sensor soil moisture
  pinMode(PIN_SOIL, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_SOIL, ADC_11db);

  // WiFi
  WiFi.mode(WIFI_STA);
  WiFi.setHostname("esp32-dev");
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print(F("WiFi connect"));
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    Serial.print('.');
    delay(400);
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(F("IP: "));
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(F("WiFi gagal, lanjut (auto reconnect aktif)"));
  }

  // Backend WebSocket (satu-satunya jalur kontrol & telemetry)
  startBackend();

  readSensors();
  Serial.println(F("Siap. Menunggu koneksi backend..."));
}

/* =============================== LOOP =============================== */

void loop() {
  backend.loop();
  readSensors();
  updateServos();
  updateMotor();
  sendTelemetry();

  // WiFi reconnect manual kalau perlu
  static uint32_t lastWifiCheck = 0;
  if (WiFi.status() != WL_CONNECTED) {
    stopMotor();   // jangan tinggalkan motor berputar saat jaringan putus
    if (millis() - lastWifiCheck > 5000) {
      lastWifiCheck = millis();
      WiFi.reconnect();
    }
  }

  delay(2);
}

/* ============================== SENSOR =============================== */

int pctFromRaw(int raw, int dry, int wet) {
  if (dry == wet) return 0;
  float p = (float)(dry - raw) * 100.0f / (float)(dry - wet);
  int v = (int)lroundf(p);
  if (v < 0) v = 0;
  if (v > 100) v = 100;
  return v;
}

int readAverage(uint8_t pin, uint8_t samples) {
  uint32_t sum = 0;
  for (uint8_t i = 0; i < samples; i++) {
    sum += analogRead(pin);
    delay(2);
  }
  return (int)(sum / samples);
}

void readSensors() {
  static uint32_t last = 0;
  if (millis() - last < 1000) return;
  last = millis();

  soilRaw = readAverage(PIN_SOIL, 8);
  soilPct = pctFromRaw(soilRaw, SOIL_DRY_RAW, SOIL_WET_RAW);

  // Bantu kalibrasi lewat Serial Monitor
  static uint32_t lastPrint = 0;
  if (millis() - lastPrint > 5000) {
    lastPrint = millis();
    Serial.printf("[SENSOR] soil raw=%d (%d%%)\n", soilRaw, soilPct);
  }
}

/* ============================== SERVO =============================== */

void setServoAngle(uint8_t ch, float deg, bool invert, int offset) {
  float a = deg + (float)offset;
  if (a < 0) a = 0;
  if (a > 180) a = 180;
  if (invert) a = 180.0f - a;
  uint16_t us = (uint16_t)lroundf(
      (float)SERVO_MIN_US + (a / 180.0f) * (float)(SERVO_MAX_US - SERVO_MIN_US));
  pwm.writeMicroseconds(ch, us);
}

void applyAllServos() {
  setServoAngle(CH_SYNC_A, syncNow, false, 0);
  setServoAngle(CH_SYNC_B, syncNow, SYNC_B_INVERT, SYNC_B_OFFSET);
  setServoAngle(CH_AUX,    auxNow,  AUX_INVERT,    0);
}

void updateServos() {
  static uint32_t last = 0;
  if (millis() - last < 20) return;
  last = millis();

  bool changed = false;

  if (fabsf(syncTarget - syncNow) > 0.05f) {
    syncNow += constrain(syncTarget - syncNow, -2.5f, 2.5f);
    changed = true;
  } else if (syncNow != syncTarget) {
    syncNow = syncTarget;
    changed = true;
  }

  if (fabsf(auxTarget - auxNow) > 0.05f) {
    auxNow += constrain(auxTarget - auxNow, -2.5f, 2.5f);
    changed = true;
  } else if (auxNow != auxTarget) {
    auxNow = auxTarget;
    changed = true;
  }

  if (changed) applyAllServos();
}

/* =============================== MOTOR =============================== */

// Tulis duty ke pin LEDC. Core ESP32 3.x memakai nomor pin,
// core 2.x memakai nomor kanal.
void writeMotorPWM(uint8_t pin, uint8_t channel, uint8_t duty) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  (void)channel;
  ledcWrite(pin, duty);
#else
  (void)pin;
  ledcWrite(channel, duty);
#endif
}

void initMotor() {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(PIN_MOTOR_RPWM, MOTOR_PWM_FREQ, MOTOR_PWM_BITS);
  ledcAttach(PIN_MOTOR_LPWM, MOTOR_PWM_FREQ, MOTOR_PWM_BITS);
#else
  ledcSetup(CH_MOTOR_RPWM, MOTOR_PWM_FREQ, MOTOR_PWM_BITS);
  ledcAttachPin(PIN_MOTOR_RPWM, CH_MOTOR_RPWM);
  ledcSetup(CH_MOTOR_LPWM, MOTOR_PWM_FREQ, MOTOR_PWM_BITS);
  ledcAttachPin(PIN_MOTOR_LPWM, CH_MOTOR_LPWM);
#endif
  motorApplied = 1;   // paksa apply pertama
  applyMotor(0);
  Serial.println(F("[MOTOR] HW-039 / BTS7960 siap (RPWM=26, LPWM=27)"));
}

// v > 0 maju, v < 0 mundur, 0 berhenti (coast).
void applyMotor(int v) {
  if (v == motorApplied) return;
  motorApplied = v;

  uint8_t forward = v > 0 ? (uint8_t)v : 0;
  uint8_t reverse = v < 0 ? (uint8_t)(-v) : 0;

  writeMotorPWM(PIN_MOTOR_RPWM, CH_MOTOR_RPWM, forward);
  writeMotorPWM(PIN_MOTOR_LPWM, CH_MOTOR_LPWM, reverse);
}

void setMotorTarget(int value) {
  value = constrain(value, -255, 255);

  int nowSign = (motorNow > 0) - (motorNow < 0);
  int newSign = (value > 0) - (value < 0);
  if (nowSign != 0 && newSign != 0 && nowSign != newSign) {
    // Balik arah: rem dulu, beri jeda supaya H-bridge tidak shoot-through.
    motorNow = 0;
    applyMotor(0);
    motorDeadUntil = millis() + MOTOR_DEADTIME_MS;
  }
  motorTarget = value;
}

void updateMotor() {
  static uint32_t last = 0;
  if (millis() - last < 20) return;
  last = millis();

  if ((int32_t)(millis() - motorDeadUntil) < 0) return;

  int step = (255 * 20) / MOTOR_RAMP_MS;
  if (step < 1) step = 1;

  if (motorNow < motorTarget) {
    motorNow = min(motorTarget, motorNow + step);
  } else if (motorNow > motorTarget) {
    motorNow = max(motorTarget, motorNow - step);
  }
  applyMotor(motorNow);
}

void stopMotor() {
  motorTarget = 0;
  motorNow = 0;
  applyMotor(0);
}

/* ============================== TELEMETRY =========================== */

void sendTelemetry(bool force) {
  if (!backendUp) return;
  if (!force && millis() - lastTelemetry < TELEMETRY_MS) return;
  lastTelemetry = millis();

  JsonDocument d;
  d["type"]        = "telemetry";
  d["soil"]        = soilPct;
  d["soilRaw"]     = soilRaw;
  d["sync"]        = (int)lroundf(syncNow);
  d["aux"]         = (int)lroundf(auxNow);
  d["motor"]       = motorNow;
  d["motorTarget"] = motorTarget;
  d["rssi"]        = WiFi.RSSI();
  d["uptime"]      = (uint32_t)(millis() / 1000);

  String s;
  serializeJson(d, s);
  backend.sendTXT(s);
}

/* ============================ WEBSOCKET ============================= */

void sendHello() {
  JsonDocument h;
  h["type"]     = "hello";
  h["deviceId"] = DEVICE_ID;
  h["name"]     = DEVICE_NAME;
  h["kind"]     = "esp32dev";
  h["firmware"] = FIRMWARE_VER;
  h["ip"]       = WiFi.localIP().toString();

  String s;
  serializeJson(h, s);
  backend.sendTXT(s);
}

void startBackend() {
  String path = "/ws/device?token=";
  path += DEVICE_TOKEN;

  backend.setReconnectInterval(3000);
  backend.enableHeartbeat(15000, 3000, 2);
  backend.onEvent([](WStype_t type, uint8_t *payload, size_t len) {
    if (type == WStype_CONNECTED) {
      backendUp = true;
      Serial.printf("[WS] backend terhubung ke %s:%u\n", BACKEND_HOST, BACKEND_PORT);
      sendHello();
      sendTelemetry(true);
    } else if (type == WStype_DISCONNECTED) {
      backendUp = false;
      stopMotor();   // jangan tinggalkan motor berputar tanpa kendali
      Serial.println(F("[WS] backend terputus, mencoba ulang..."));
    } else if (type == WStype_TEXT) {
      handleCommand(String((char *)payload, len));
    }
  });

  backend.begin(BACKEND_HOST, BACKEND_PORT, path.c_str());
}

void handleCommand(const String &msg) {
  JsonDocument doc;
  if (deserializeJson(doc, msg)) {
    Serial.println(F("[WS] JSON invalid"));
    return;
  }

  const char *type = doc["type"] | "";
  Serial.printf("[CMD] %s\n", msg.c_str());

  if (!strcmp(type, "servo")) {
    if (!doc["sync"].isNull()) {
      syncTarget = constrain(doc["sync"].as<float>(), 0.0f, 180.0f);
    }
    if (!doc["aux"].isNull()) {
      auxTarget = constrain(doc["aux"].as<float>(), 0.0f, 180.0f);
    }
    return;
  }

  if (!strcmp(type, "probe")) {
    const char *dir = doc["dir"] | "";
    if (!strcmp(dir, "up"))   auxTarget = constrain(auxTarget + STEP_SERVO, 0.0f, 180.0f);
    if (!strcmp(dir, "down")) auxTarget = constrain(auxTarget - STEP_SERVO, 0.0f, 180.0f);
    return;
  }

  if (!strcmp(type, "camera")) {
    const char *dir = doc["dir"] | "";
    if (!strcmp(dir, "right")) syncTarget = constrain(syncTarget + STEP_SERVO, 0.0f, 180.0f);
    if (!strcmp(dir, "left"))  syncTarget = constrain(syncTarget - STEP_SERVO, 0.0f, 180.0f);
    return;
  }

  if (!strcmp(type, "move")) {
    // Satu modul HW-039/BTS7960 = satu motor: maju/mundur/berhenti.
    // Belok (kiri/kanan) butuh modul kedua atau servo kemudi terpisah.
    const char *dir = doc["dir"] | "";
    int speed = doc["speed"] | MOTOR_SPEED;
    if (speed < 0) speed = 0;
    if (speed > 255) speed = 255;

    if (!strcmp(dir, "forward")) {
      setMotorTarget(speed);
    } else if (!strcmp(dir, "backward")) {
      setMotorTarget(-speed);
    } else if (!strcmp(dir, "stop")) {
      setMotorTarget(0);
    } else if (!strcmp(dir, "left") || !strcmp(dir, "right")) {
      Serial.println(F("[MOTOR] belok butuh 2 modul HW-039/BTS7960"));
    }
    return;
  }

  // "ai" dan "capture" ditangani ESP32-CAM (device terpisah di backend).
  if (!strcmp(type, "ai") || !strcmp(type, "capture")) return;
  if (!strcmp(type, "hello_ack") || !strcmp(type, "pong")) return;

  Serial.printf("[CMD] tipe tidak dikenal: %s\n", type);
}
