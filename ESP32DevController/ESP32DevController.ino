/* =====================================================================
   ESP32 Dev Module  —  Node aktuator + sensor

   Fungsi:
     1. PCA9685 (I2C) menggerakkan 3 servo:
          CH0, CH1, CH2 -> tiga servo yang masing-masing INDEPENDEN
          (tiap kanal punya target sudut sendiri, tidak diselaraskan)
     2. Modul L298N (H-bridge) untuk 2 motor (kiri + kanan):
          Kanal A: ENA + IN1/IN2 -> motor kiri
          Kanal B: ENB + IN3/IN4 -> motor kanan
          Maju/mundur + belok pivot kiri/kanan
        Tidak ada sensor hujan di node ini.
     3. Sensor soil moisture (analog, ADC1)
     4. Sensor ultrasonik HC-SR04 untuk mendeteksi objek di depan robot
     5. Konek ke backend KIRA (Go) lewat WebSocket sebagai device:
          ws://<server>:8080/ws/device?token=<DEVICE_TOKEN>
        - kirim telemetry tiap 2 detik
        - terima perintah: move, servo (ch0/ch1/ch2), probe, camera
     6. Tidak ada dashboard/server HTTP di ESP32. Semua tampilan dan
        kontrol ada di website KIRA lewat backend.
     7. ESP32-CAM konek sendiri ke backend yang sama (lihat sketch CAM)

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

#define WIFI_SSID "R-408"
#define WIFI_PASS "*ruang408"

// ---- Backend KIRA ----
// Isi IP/host laptop atau server tempat `kira-server` berjalan.
#define BACKEND_HOST  "10.4.0.88"
#define BACKEND_PORT  8080
#define DEVICE_TOKEN  "kira123"   // harus sama dengan .env backend
#define DEVICE_ID     "kira-01-dev"
#define DEVICE_NAME   "KIRA Dev"
#define FIRMWARE_VER  "1.5.0"

// ---- Pin ----
#define PIN_SDA      21
#define PIN_SCL      22
#define PIN_SOIL     34   // ADC1, input only
#define PIN_ULTRASONIC_TRIG 5    // output trigger HC-SR04
#define PIN_ULTRASONIC_ECHO 18   // input echo (wajib lewat pembagi tegangan)

// ---- PCA9685 ----
#define PCA_ADDR       0x40
#define CH_SERVO0      0
#define CH_SERVO1      1
#define CH_SERVO2      2
#define SERVO_FREQ     50
#define SERVO_MIN_US   500
#define SERVO_MAX_US   2500
#define SERVO_HOME     90

// Tiap servo dikontrol sendiri-sendiri. Kalau arah mekaniknya kebalik,
// set SERVOx_INVERT = true; OFFSET menggeser sudut (derajat) untuk kalibrasi.
#define SERVO0_INVERT  false
#define SERVO0_OFFSET  0
#define SERVO1_INVERT  false
#define SERVO1_OFFSET  0
#define SERVO2_INVERT  false
#define SERVO2_OFFSET  0

// Langkah perintah dari web (derajat)
#define STEP_SERVO     5

// ---- Kalibrasi soil moisture (12-bit, 0..4095) ----
// Ukur sendiri: kering di udara, basah di air. Nilai di bawah = contoh umum.
#define SOIL_DRY_RAW        2600
#define SOIL_WET_RAW        1100

// ---- HC-SR04: deteksi objek di depan robot ----
// ECHO HC-SR04 mengeluarkan 5V. Turunkan ke 3.3V dengan pembagi 1k/2k
// sebelum masuk GPIO 18, supaya ESP32 tidak rusak.
#define ULTRASONIC_INTERVAL_MS 250    // jeda antar pembacaan
#define ULTRASONIC_TIMEOUT_US  20000  // ±3.4 m; 0 = tidak ada pantulan
#define ULTRASONIC_SAMPLES     3      // median dari 3 pantulan
#define OBSTACLE_CM            20     // jarak aman (cm) sebelum dianggap penghalang

// ---- Modul L298N: driver 2 motor DC (kanal A = kiri, kanal B = kanan) ----
// ENA/ENB = PWM kecepatan, IN1..IN4 = arah. GND logic dan supply motor disatukan.
// Lepas jumper ENA dan ENB supaya PWM dari ESP32 benar-benar mengatur kecepatan.
// Jumper 5V onboard L298N hanya untuk supply logic; jangan memberi daya ESP32.
#define PIN_MOTOR_LEFT_ENA    26
#define PIN_MOTOR_LEFT_IN1    27
#define PIN_MOTOR_LEFT_IN2    25
#define PIN_MOTOR_RIGHT_ENA   33
#define PIN_MOTOR_RIGHT_IN1   32
#define PIN_MOTOR_RIGHT_IN2   16
#define MOTOR_LEFT_INVERT     0       // 1 = balik arah motor kiri
#define MOTOR_RIGHT_INVERT    0       // 1 = balik arah motor kanan
#define MOTOR_PWM_FREQ   20000    // 20 kHz, di atas ambang dengar (L298N maks. 40 kHz)
#define MOTOR_PWM_BITS   8        // duty 0..255
#define MOTOR_SPEED      180      // kecepatan default (0..255)
#define MOTOR_RAMP_MS    300      // waktu dari 0 ke duty penuh
#define MOTOR_DEADTIME_MS 120     // jeda saat balik arah
#define CH_MOTOR_LEFT_ENA     4        // kanal LEDC (core 2.x)
#define CH_MOTOR_RIGHT_ENA    5

#define TELEMETRY_MS   2000

/* ============================== GLOBAL =============================== */

Adafruit_PWMServoDriver pwm(PCA_ADDR);
WebSocketsClient  backend;

float servo0Now = SERVO_HOME, servo0Target = SERVO_HOME;
float servo1Now = SERVO_HOME, servo1Target = SERVO_HOME;
float servo2Now = SERVO_HOME, servo2Target = SERVO_HOME;

int soilRaw = 0;
int soilPct = 0;

// HC-SR04: jarak objek terdekat di depan (cm).
int  distanceCm    = 0;
bool distanceValid = false;
bool obstacleNear  = false;

bool backendUp = false;
uint32_t lastTelemetry = 0;

// Motor L298N: duty -255..255 per sisi (negatif = mundur).
int      motorLeftTarget   = 0;
int      motorLeftNow      = 0;
int      motorLeftApplied  = 0;
int      motorRightTarget  = 0;
int      motorRightNow     = 0;
int      motorRightApplied = 0;
uint32_t motorLeftDeadUntil  = 0;
uint32_t motorRightDeadUntil = 0;

/* =========================== PROTOTYPES ============================= */

void readSensors();
void readUltrasonic();
int  pingUltrasonic();
void updateServos();
void applyAllServos();
void initMotor();
void updateMotor();
void setMotorTargets(int left, int right);
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
  servo0Now = servo0Target = SERVO_HOME;
  servo1Now = servo1Target = SERVO_HOME;
  servo2Now = servo2Target = SERVO_HOME;
  applyAllServos();

  // Driver motor L298N
  initMotor();

  // Sensor soil moisture
  pinMode(PIN_SOIL, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_SOIL, ADC_11db);

  // Sensor ultrasonik HC-SR04
  pinMode(PIN_ULTRASONIC_TRIG, OUTPUT);
  pinMode(PIN_ULTRASONIC_ECHO, INPUT);
  digitalWrite(PIN_ULTRASONIC_TRIG, LOW);
  Serial.println(F("[ULTRASONIK] HC-SR04 siap (TRIG=5, ECHO=18)"));

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
  readUltrasonic();
  Serial.println(F("Siap. Menunggu koneksi backend..."));
}

/* =============================== LOOP =============================== */

void loop() {
  backend.loop();
  readSensors();
  readUltrasonic();
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

/* ============================ ULTRASONIK ============================ */

// Satu ping: pulsa trigger 10 us, lalu ukur lebar HIGH pada ECHO.
// Mengembalikan jarak dalam cm, atau -1 kalau tidak ada pantulan.
int pingUltrasonic() {
  digitalWrite(PIN_ULTRASONIC_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_ULTRASONIC_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_ULTRASONIC_TRIG, LOW);

  unsigned long dur = pulseIn(PIN_ULTRASONIC_ECHO, HIGH, ULTRASONIC_TIMEOUT_US);
  if (dur == 0) return -1;  // timeout: tidak ada objek dalam jangkauan
  int cm = (int)lroundf((float)dur * 0.0343f / 2.0f);
  if (cm < 2 || cm > 400) return -1;
  return cm;
}

// Baca 3 kali lalu ambil median, supaya satu pantulan liar tidak
// langsung memicu peringatan "objek dekat".
void readUltrasonic() {
  static uint32_t last = 0;
  if (millis() - last < ULTRASONIC_INTERVAL_MS) return;
  last = millis();

  int samples[ULTRASONIC_SAMPLES];
  int n = 0;
  for (uint8_t i = 0; i < ULTRASONIC_SAMPLES; i++) {
    int d = pingUltrasonic();
    if (d > 0) samples[n++] = d;
    if (i + 1 < ULTRASONIC_SAMPLES) delay(20);
  }

  if (n == 0) {
    distanceCm = 0;
    distanceValid = false;
    obstacleNear = false;
    return;
  }

  // Urutkan naik, lalu ambil nilai tengah.
  for (int i = 1; i < n; i++) {
    int key = samples[i];
    int j = i - 1;
    while (j >= 0 && samples[j] > key) {
      samples[j + 1] = samples[j];
      j--;
    }
    samples[j + 1] = key;
  }

  distanceCm = samples[n / 2];
  distanceValid = true;
  obstacleNear = distanceCm <= OBSTACLE_CM;

  static uint32_t lastPrint = 0;
  if (millis() - lastPrint > 5000) {
    lastPrint = millis();
    Serial.printf("[ULTRASONIK] %d cm%s\n", distanceCm,
                  obstacleNear ? " (objek dekat!)" : "");
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
  setServoAngle(CH_SERVO0, servo0Now, SERVO0_INVERT, SERVO0_OFFSET);
  setServoAngle(CH_SERVO1, servo1Now, SERVO1_INVERT, SERVO1_OFFSET);
  setServoAngle(CH_SERVO2, servo2Now, SERVO2_INVERT, SERVO2_OFFSET);
}

// Gerakkan satu servo menuju targetnya (halus, maks. 2.5 derajat per 20 ms).
// Mengembalikan true kalau sudutnya berubah.
bool stepServo(float &now, float target) {
  if (fabsf(target - now) > 0.05f) {
    now += constrain(target - now, -2.5f, 2.5f);
    return true;
  }
  if (now != target) {
    now = target;
    return true;
  }
  return false;
}

void updateServos() {
  static uint32_t last = 0;
  if (millis() - last < 20) return;
  last = millis();

  bool changed = false;
  changed |= stepServo(servo0Now, servo0Target);
  changed |= stepServo(servo1Now, servo1Target);
  changed |= stepServo(servo2Now, servo2Target);

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

void applyMotorChannel(uint8_t in1, uint8_t in2, uint8_t enaPin, uint8_t channel,
                       int value, int &applied) {
  if (value == applied) return;
  applied = value;

  if (value > 0) {
    digitalWrite(in1, HIGH);
    digitalWrite(in2, LOW);
  } else if (value < 0) {
    digitalWrite(in1, LOW);
    digitalWrite(in2, HIGH);
  } else {
    digitalWrite(in1, LOW);
    digitalWrite(in2, LOW);
  }

  writeMotorPWM(enaPin, channel, (uint8_t)abs(value));
}

void applyMotorLeft(int v) {
#if MOTOR_LEFT_INVERT
  v = -v;
#endif
  applyMotorChannel(PIN_MOTOR_LEFT_IN1, PIN_MOTOR_LEFT_IN2,
                    PIN_MOTOR_LEFT_ENA, CH_MOTOR_LEFT_ENA, v,
                    motorLeftApplied);
}

void applyMotorRight(int v) {
#if MOTOR_RIGHT_INVERT
  v = -v;
#endif
  applyMotorChannel(PIN_MOTOR_RIGHT_IN1, PIN_MOTOR_RIGHT_IN2,
                    PIN_MOTOR_RIGHT_ENA, CH_MOTOR_RIGHT_ENA, v,
                    motorRightApplied);
}

void initMotor() {
  pinMode(PIN_MOTOR_LEFT_IN1, OUTPUT);
  pinMode(PIN_MOTOR_LEFT_IN2, OUTPUT);
  pinMode(PIN_MOTOR_RIGHT_IN1, OUTPUT);
  pinMode(PIN_MOTOR_RIGHT_IN2, OUTPUT);
  digitalWrite(PIN_MOTOR_LEFT_IN1, LOW);
  digitalWrite(PIN_MOTOR_LEFT_IN2, LOW);
  digitalWrite(PIN_MOTOR_RIGHT_IN1, LOW);
  digitalWrite(PIN_MOTOR_RIGHT_IN2, LOW);

#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(PIN_MOTOR_LEFT_ENA, MOTOR_PWM_FREQ, MOTOR_PWM_BITS);
  ledcAttach(PIN_MOTOR_RIGHT_ENA, MOTOR_PWM_FREQ, MOTOR_PWM_BITS);
#else
  ledcSetup(CH_MOTOR_LEFT_ENA, MOTOR_PWM_FREQ, MOTOR_PWM_BITS);
  ledcAttachPin(PIN_MOTOR_LEFT_ENA, CH_MOTOR_LEFT_ENA);
  ledcSetup(CH_MOTOR_RIGHT_ENA, MOTOR_PWM_FREQ, MOTOR_PWM_BITS);
  ledcAttachPin(PIN_MOTOR_RIGHT_ENA, CH_MOTOR_RIGHT_ENA);
#endif

  motorLeftApplied = 1;   // paksa apply pertama
  motorRightApplied = 1;
  applyMotorLeft(0);
  applyMotorRight(0);
  Serial.println(F("[MOTOR] L298N 2 motor siap (KIRI ENA=26 IN1=27 IN2=25, KANAN ENB=33 IN3=32 IN4=16)"));
}

int motorSign(int v) {
  return (v > 0) - (v < 0);
}

// Atur target kedua motor. Nilai positif = maju, negatif = mundur.
void setMotorTargets(int left, int right) {
  left = constrain(left, -255, 255);
  right = constrain(right, -255, 255);

  int nowLeftSign = motorSign(motorLeftNow);
  int newLeftSign = motorSign(left);
  if (nowLeftSign != 0 && newLeftSign != 0 && nowLeftSign != newLeftSign) {
    // Balik arah: rem dulu, beri jeda supaya H-bridge tidak shoot-through.
    motorLeftNow = 0;
    applyMotorLeft(0);
    motorLeftDeadUntil = millis() + MOTOR_DEADTIME_MS;
  }

  int nowRightSign = motorSign(motorRightNow);
  int newRightSign = motorSign(right);
  if (nowRightSign != 0 && newRightSign != 0 && nowRightSign != newRightSign) {
    motorRightNow = 0;
    applyMotorRight(0);
    motorRightDeadUntil = millis() + MOTOR_DEADTIME_MS;
  }

  motorLeftTarget = left;
  motorRightTarget = right;
}

void updateMotor() {
  static uint32_t last = 0;
  if (millis() - last < 20) return;
  last = millis();

  int step = (255 * 20) / MOTOR_RAMP_MS;
  if (step < 1) step = 1;

  if ((int32_t)(millis() - motorLeftDeadUntil) >= 0) {
    if (motorLeftNow < motorLeftTarget) {
      motorLeftNow = min(motorLeftTarget, motorLeftNow + step);
    } else if (motorLeftNow > motorLeftTarget) {
      motorLeftNow = max(motorLeftTarget, motorLeftNow - step);
    }
    applyMotorLeft(motorLeftNow);
  }

  if ((int32_t)(millis() - motorRightDeadUntil) >= 0) {
    if (motorRightNow < motorRightTarget) {
      motorRightNow = min(motorRightTarget, motorRightNow + step);
    } else if (motorRightNow > motorRightTarget) {
      motorRightNow = max(motorRightTarget, motorRightNow - step);
    }
    applyMotorRight(motorRightNow);
  }
}

void stopMotor() {
  motorLeftTarget = 0;
  motorRightTarget = 0;
  motorLeftNow = 0;
  motorRightNow = 0;
  applyMotorLeft(0);
  applyMotorRight(0);
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
  d["distance"]    = distanceValid ? distanceCm : 0;
  d["distanceValid"] = distanceValid;
  d["obstacle"]    = obstacleNear;
  d["ch0"]         = (int)lroundf(servo0Now);
  d["ch1"]         = (int)lroundf(servo1Now);
  d["ch2"]         = (int)lroundf(servo2Now);
  d["motorLeft"]      = motorLeftNow;
  d["motorRight"]     = motorRightNow;
  d["motorLeftTarget"]  = motorLeftTarget;
  d["motorRightTarget"] = motorRightTarget;
  d["motor"]       = motorLeftNow;       // kompatibilitas dashboard lama
  d["motorTarget"] = motorLeftTarget;
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
    // Tiap kanal berdiri sendiri; hanya kanal yang ada di pesan yang diubah.
    if (!doc["ch0"].isNull()) {
      servo0Target = constrain(doc["ch0"].as<float>(), 0.0f, 180.0f);
    }
    if (!doc["ch1"].isNull()) {
      servo1Target = constrain(doc["ch1"].as<float>(), 0.0f, 180.0f);
    }
    if (!doc["ch2"].isNull()) {
      servo2Target = constrain(doc["ch2"].as<float>(), 0.0f, 180.0f);
    }
    return;
  }

  // Probe tanah -> CH2.
  if (!strcmp(type, "probe")) {
    const char *dir = doc["dir"] | "";
    if (!strcmp(dir, "up"))   servo2Target = constrain(servo2Target + STEP_SERVO, 0.0f, 180.0f);
    if (!strcmp(dir, "down")) servo2Target = constrain(servo2Target - STEP_SERVO, 0.0f, 180.0f);
    return;
  }

  // Kamera kiri/kanan -> CH0 saja (CH1 hanya lewat perintah "servo" ch1).
  if (!strcmp(type, "camera")) {
    const char *dir = doc["dir"] | "";
    if (!strcmp(dir, "right")) servo0Target = constrain(servo0Target + STEP_SERVO, 0.0f, 180.0f);
    if (!strcmp(dir, "left"))  servo0Target = constrain(servo0Target - STEP_SERVO, 0.0f, 180.0f);
    return;
  }

  if (!strcmp(type, "move")) {
    // Dua motor L298N: kiri = kanal A, kanan = kanal B.
    // Belok dilakukan dengan memutar kedua roda berlawanan arah (pivot).
    const char *dir = doc["dir"] | "";
    int speed = doc["speed"] | MOTOR_SPEED;
    if (speed < 0) speed = 0;
    if (speed > 255) speed = 255;

    if (!strcmp(dir, "forward")) {
      setMotorTargets(speed, speed);
    } else if (!strcmp(dir, "backward")) {
      setMotorTargets(-speed, -speed);
    } else if (!strcmp(dir, "left")) {
      setMotorTargets(-speed, speed);
    } else if (!strcmp(dir, "right")) {
      setMotorTargets(speed, -speed);
    } else if (!strcmp(dir, "stop")) {
      setMotorTargets(0, 0);
    }
    return;
  }

  // "ai" dan "capture" ditangani ESP32-CAM (device terpisah di backend).
  if (!strcmp(type, "ai") || !strcmp(type, "capture")) return;
  // "power" (relay robot), "preview" dan "cam" juga untuk ESP32-CAM.
  if (!strcmp(type, "power") || !strcmp(type, "preview") || !strcmp(type, "cam")) return;
  if (!strcmp(type, "hello_ack") || !strcmp(type, "pong")) return;

  Serial.printf("[CMD] tipe tidak dikenal: %s\n", type);
}
