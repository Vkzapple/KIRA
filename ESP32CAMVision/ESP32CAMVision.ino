/* =====================================================================
   ESP32-CAM (AI Thinker)  —  Node Vision + Roboflow

   Fungsi:
     1. Inisialisasi kamera OV2640 (AI Thinker)
     2. Ambil frame -> kirim ke Roboflow Hosted Inference (HTTPS)
     3. Simpan & unggah capture HANYA jika kelas target terdeteksi
     4. WebSocket client ke backend KIRA sebagai device:
          ws://<server>:8080/ws/device?token=<DEVICE_TOKEN>
        - terima perintah: ai (arm/stop/target), capture, cam (legacy)
        - kirim ai_status + detection
     5. Upload foto ke backend (POST /api/snapshots) supaya tersimpan
        di Supabase Storage dan tampil di website
     6. Tidak ada dashboard/server HTTP di ESP32-CAM. Semua kontrol dan
        tampilan ada di website KIRA lewat backend.

   Library:
     - ArduinoJson 7.x
     - WebSockets (Markus Sattler / Links2004)

   Board: "AI Thinker ESP32-CAM"
     - PSRAM: Enabled
     - Partition: Huge APP (3MB No OTA/1MB SPIFFS)
     - Upload: GPIO0 -> GND saat flashing, lalu lepas & reset
   ===================================================================== */

#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <math.h>
#include <ctype.h>

/* ============================ KONFIGURASI ============================ */

#define WIFI_SSID "GANTI_SSID"
#define WIFI_PASS "GANTI_PASSWORD"

// ---- Backend KIRA ----
// Isi IP/host laptop atau server tempat `kira-server` berjalan.
#define BACKEND_HOST  "192.168.1.10"
#define BACKEND_PORT  8080
#define DEVICE_TOKEN  "change-me-device-token"   // harus sama dengan .env backend
#define DEVICE_ID     "kira-01-cam"
#define DEVICE_NAME   "KIRA CAM"
#define FIRMWARE_VER  "1.0.0"

// ---- Roboflow ----
#define ROBOFLOW_API_KEY  "ISI_API_KEY_ROBOFLOW"
#define ROBOFLOW_MODEL    "nama-model-anda"   // contoh: "trash-detector"
#define ROBOFLOW_VERSION  "1"
#define ROBOFLOW_CONF     "40"                // confidence threshold (0-100)
#define ROBOFLOW_TIMEOUT  12000               // ms

// ---- Perilaku ----
#define TARGET_DEFAULT      "person"   // pisah koma: "person,bottle"
#define AUTO_ARM_ON_BOOT    false      // true = langsung scan otomatis
#define SCAN_INTERVAL_MS    8000       // jeda antar scan otomatis
#define SCAN_COOLDOWN_MS    1500       // jeda setelah satu scan selesai
#define UPLOAD_TIMEOUT_MS   15000

// ---- Pin AI Thinker ----
#define PIN_FLASH 4
#define PIN_LED   33

/* ========================== PIN KAMERA ============================== */

#define PWDN_GPIO_NUM    32
#define RESET_GPIO_NUM   -1
#define XCLK_GPIO_NUM     0
#define SIOD_GPIO_NUM    26
#define SIOC_GPIO_NUM    27
#define Y9_GPIO_NUM      35
#define Y8_GPIO_NUM      34
#define Y7_GPIO_NUM      39
#define Y6_GPIO_NUM      36
#define Y5_GPIO_NUM      21
#define Y4_GPIO_NUM      19
#define Y3_GPIO_NUM      18
#define Y2_GPIO_NUM       5
#define VSYNC_GPIO_NUM   25
#define HREF_GPIO_NUM    23
#define PCLK_GPIO_NUM    22

/* ============================== GLOBAL ============================== */

WebSocketsClient backend;

SemaphoreHandle_t wsMtx    = nullptr;
SemaphoreHandle_t trigSem  = nullptr;
portMUX_TYPE      stateMux = portMUX_INITIALIZER_UNLOCKED;

volatile bool     armed   = AUTO_ARM_ON_BOOT;
volatile bool     busy    = false;
volatile bool     wsUp    = false;
volatile bool     needStatus = false;
volatile bool     camReady = false;
volatile uint32_t lastScan = 0;
volatile uint32_t scanInterval = SCAN_INTERVAL_MS;

char targetList[96] = TARGET_DEFAULT;

String wsPath = "";

/* =========================== PROTOTYPES ============================= */

bool cameraInit();
void scanTask(void *param);
void runOneScan();
bool roboflowDetect(camera_fb_t *fb, String &bestClass, float &bestConf,
                    int &nPred, bool &matched);
bool matchesTarget(const String &cls);
void setTargetList(const char *s);
void flashPulse();
void requestScan();
void sendStatus();
bool uploadSnapshot(camera_fb_t *fb, const String &cls, float conf, String &imageUrl);
String buildAiStatus();
void handleBackendMessage(const String &msg);
void handleCamCommand(JsonDocument &doc);
void startBackend();

/* ============================== SETUP =============================== */

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println(F("== ESP32-CAM Vision =="));

  pinMode(PIN_FLASH, OUTPUT);
  digitalWrite(PIN_FLASH, LOW);
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH);   // LED merah AI Thinker active-low

  wsMtx   = xSemaphoreCreateMutex();
  trigSem = xSemaphoreCreateCounting(1, 0);
  if (!cameraInit()) {
    Serial.println(F("[CAM] init GAGAL, cek koneksi kamera / PSRAM"));
  } else {
    camReady = true;
    Serial.println(F("[CAM] siap"));
  }

  WiFi.mode(WIFI_STA);
  WiFi.setHostname("esp32-cam");
  WiFi.setSleep(false);
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
    Serial.println(F("WiFi gagal, auto reconnect aktif"));
  }

  // Backend WebSocket (satu-satunya jalur kontrol & status)
  startBackend();

  xTaskCreatePinnedToCore(scanTask, "vision", 16384, nullptr, 1, nullptr, 0);

  lastScan = millis() - SCAN_INTERVAL_MS;   // scan cepat setelah boot
  Serial.println(F("Siap. Menunggu koneksi backend..."));
}

/* =============================== LOOP =============================== */

void loop() {
  if (xSemaphoreTake(wsMtx, pdMS_TO_TICKS(100)) == pdTRUE) {
    backend.loop();
    xSemaphoreGive(wsMtx);
  }

  if (needStatus) {
    needStatus = false;
    sendStatus();
  }

  // Scan otomatis saat armed
  if (armed && !busy && millis() - lastScan >= scanInterval) {
    requestScan();
  }

  // LED status: blink cepat = armed, lambat = idle
  static uint32_t lastBlink = 0;
  static bool ledState = false;
  uint32_t period = armed ? 500 : 1500;
  if (millis() - lastBlink >= period) {
    lastBlink = millis();
    ledState = !ledState;
    digitalWrite(PIN_LED, ledState ? LOW : HIGH);
  }

  static uint32_t lastWifi = 0;
  if (WiFi.status() != WL_CONNECTED && millis() - lastWifi > 5000) {
    lastWifi = millis();
    WiFi.reconnect();
  }

  delay(2);
}

/* ============================== KAMERA ============================== */

bool cameraInit() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer   = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM;
  c.pin_d1 = Y3_GPIO_NUM;
  c.pin_d2 = Y4_GPIO_NUM;
  c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM;
  c.pin_d5 = Y7_GPIO_NUM;
  c.pin_d6 = Y8_GPIO_NUM;
  c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM;
  c.pin_pclk = PCLK_GPIO_NUM;
  c.pin_vsync = VSYNC_GPIO_NUM;
  c.pin_href = HREF_GPIO_NUM;
  c.pin_sscb_sda = SIOD_GPIO_NUM;
  c.pin_sscb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM;
  c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.grab_mode = CAMERA_GRAB_LATEST;

  if (psramFound()) {
    c.frame_size  = FRAMESIZE_VGA;      // 640x480, cukup untuk deteksi
    c.jpeg_quality = 12;
    c.fb_count    = 2;
    c.fb_location = CAMERA_FB_IN_PSRAM;
    Serial.printf("[CAM] PSRAM %u KB\n", (unsigned)(ESP.getFreePsram() / 1024));
  } else {
    c.frame_size  = FRAMESIZE_QVGA;     // 320x240
    c.jpeg_quality = 14;
    c.fb_count    = 1;
    c.fb_location = CAMERA_FB_IN_DRAM;
    Serial.println(F("[CAM] tanpa PSRAM, resolusi diturunkan"));
  }

  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) {
    Serial.printf("[CAM] esp_camera_init 0x%x\n", err);
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_brightness(s, 0);
    s->set_contrast(s, 0);
    s->set_saturation(s, 0);
    s->set_whitebal(s, 1);
    s->set_gain_ctrl(s, 1);
    s->set_exposure_ctrl(s, 1);
  }
  return true;
}

/* ============================ ROBOFLOW ============================== */

bool roboflowDetect(camera_fb_t *fb, String &bestClass, float &bestConf,
                    int &nPred, bool &matched) {
  matched = false;
  nPred = 0;
  bestConf = 0;
  bestClass = "";

  WiFiClientSecure client;
  client.setInsecure();   // catatan: tanpa verifikasi sertifikat

  HTTPClient httpc;
  httpc.setConnectTimeout(ROBOFLOW_TIMEOUT);
  httpc.setTimeout(ROBOFLOW_TIMEOUT);
  httpc.setReuse(false);

  String url = "https://detect.roboflow.com/";
  url += ROBOFLOW_MODEL;
  url += "/";
  url += ROBOFLOW_VERSION;
  url += "?api_key=";
  url += ROBOFLOW_API_KEY;
  url += "&confidence=";
  url += ROBOFLOW_CONF;
  url += "&overlap=30";

  if (!httpc.begin(client, url)) {
    Serial.println(F("[AI] begin gagal"));
    return false;
  }
  httpc.addHeader("Content-Type", "application/x-www-form-urlencoded");

  uint32_t t = millis();
  int code = httpc.POST(fb->buf, fb->len);
  uint32_t dt = millis() - t;
  bool ok = false;

  // Baca body sekali. getString() menangani chunked/content-length.
  String body = httpc.getString();

  if (code == 200) {
    // Filter supaya heap tidak dipakai untuk field yang tidak perlu
    JsonDocument filter;
    filter["predictions"][0]["class"] = true;
    filter["predictions"][0]["confidence"] = true;

    JsonDocument doc;
    DeserializationError err =
        deserializeJson(doc, body, DeserializationOption::Filter(filter));

    if (err) {
      Serial.printf("[AI] JSON error: %s\n", err.c_str());
    } else {
      ok = true;
      for (JsonObject p : doc["predictions"].as<JsonArray>()) {
        const char *c = p["class"] | "";
        float cf = p["confidence"] | 0.0f;
        nPred++;
        if (matchesTarget(String(c)) && cf > bestConf) {
          bestConf = cf;
          bestClass = c;
          matched = true;
        }
      }
    }
  } else {
    if (body.length() > 200) body = body.substring(0, 200);
    Serial.printf("[AI] HTTP %d (%ums): %s\n", code, (unsigned)dt, body.c_str());
  }

  httpc.end();
  Serial.printf("[AI] %ums, %d pred, match=%d\n", (unsigned)dt, nPred, matched);
  return ok;
}

/* ============================ TARGET ================================ */

void setTargetList(const char *s) {
  char tmp[sizeof(targetList)];
  strlcpy(tmp, s, sizeof(tmp));

  // lowercase + rapikan
  for (char *p = tmp; *p; ++p) *p = (char)tolower((unsigned char)*p);

  char clean[sizeof(targetList)];
  size_t j = 0;
  for (size_t i = 0; tmp[i] && j < sizeof(clean) - 1; i++) {
    char ch = tmp[i];
    if (ch == ' ' && (j == 0 || clean[j - 1] == ',')) continue;
    clean[j++] = ch;
  }
  clean[j] = '\0';

  portENTER_CRITICAL(&stateMux);
  strlcpy(targetList, clean, sizeof(targetList));
  portEXIT_CRITICAL(&stateMux);
}

bool matchesTarget(const String &cls) {
  char list[sizeof(targetList)];
  portENTER_CRITICAL(&stateMux);
  strlcpy(list, targetList, sizeof(list));
  portEXIT_CRITICAL(&stateMux);

  String c = cls;
  c.toLowerCase();
  c.trim();

  char *save = nullptr;
  for (char *tok = strtok_r(list, ",", &save); tok; tok = strtok_r(nullptr, ",", &save)) {
    String item(tok);
    item.trim();
    if (item.length() && item == c) return true;
  }
  return false;
}

/* ============================== SCAN ================================ */

void scanTask(void *param) {
  (void)param;
  for (;;) {
    if (xSemaphoreTake(trigSem, portMAX_DELAY) == pdTRUE) {
      busy = true;
      runOneScan();
      busy = false;
      vTaskDelay(pdMS_TO_TICKS(SCAN_COOLDOWN_MS));
    }
  }
}

void requestScan() {
  if (trigSem) xSemaphoreGive(trigSem);   // counting semaphore max 1
}

void runOneScan() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[SCAN] WiFi belum tersambung"));
    return;
  }
  if (!camReady) return;

  lastScan = millis();

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println(F("[SCAN] capture gagal"));
    sendStatus();
    return;
  }

  String cls;
  float conf = 0;
  int nPred = 0;
  bool matched = false;
  bool ok = roboflowDetect(fb, cls, conf, nPred, matched);

  if (ok && matched) {
    flashPulse();

    // Unggah ke backend -> tersimpan di Supabase Storage / folder data.
    String imageUrl = "";
    if (uploadSnapshot(fb, cls, conf, imageUrl)) {
      Serial.printf("[UP] URL %s\n", imageUrl.c_str());
    }

    JsonDocument d;
    d["type"] = "detection";
    d["class"] = cls;
    d["confidence"] = conf;
    d["count"] = nPred;
    d["ip"] = WiFi.localIP().toString();
    if (imageUrl.length()) d["imageUrl"] = imageUrl;
    d["ts"] = millis();

    String out;
    serializeJson(d, out);
    if (xSemaphoreTake(wsMtx, pdMS_TO_TICKS(1000)) == pdTRUE) {
      if (wsUp) backend.sendTXT(out);
      xSemaphoreGive(wsMtx);
    }
    Serial.printf("[DETECT] %s %.2f\n", cls.c_str(), conf);
  }

  esp_camera_fb_return(fb);
  sendStatus();
}

/* ============================ SNAPSHOT ============================== */

bool uploadSnapshot(camera_fb_t *fb, const String &cls, float conf, String &imageUrl) {
  if (!fb || fb->len == 0) return false;

  WiFiClient client;
  HTTPClient httpc;
  httpc.setConnectTimeout(UPLOAD_TIMEOUT_MS);
  httpc.setTimeout(UPLOAD_TIMEOUT_MS);
  httpc.setReuse(false);

  String url = "http://";
  url += BACKEND_HOST;
  url += ":";
  url += String(BACKEND_PORT);
  url += "/api/snapshots?device_id=";
  url += DEVICE_ID;
  url += "&class=";
  url += cls;
  url += "&confidence=";
  url += String(conf, 3);

  if (!httpc.begin(client, url)) {
    Serial.println(F("[UP] begin gagal"));
    return false;
  }
  httpc.addHeader("Content-Type", "image/jpeg");
  httpc.addHeader("X-Device-Token", DEVICE_TOKEN);

  int code = httpc.POST(fb->buf, fb->len);
  String body = httpc.getString();
  httpc.end();

  if (code != 201 && code != 200) {
    if (body.length() > 200) body = body.substring(0, 200);
    Serial.printf("[UP] HTTP %d: %s\n", code, body.c_str());
    return false;
  }

  JsonDocument filter;
  filter["snapshot"]["imageUrl"] = true;

  JsonDocument doc;
  if (deserializeJson(doc, body, DeserializationOption::Filter(filter))) {
    Serial.println(F("[UP] JSON respons tidak valid"));
    return false;
  }

  imageUrl = String((const char *)(doc["snapshot"]["imageUrl"] | ""));
  Serial.printf("[UP] %u bytes -> %s\n", (unsigned)fb->len, imageUrl.c_str());
  return imageUrl.length() > 0;
}

void flashPulse() {
  digitalWrite(PIN_FLASH, HIGH);
  vTaskDelay(pdMS_TO_TICKS(60));
  digitalWrite(PIN_FLASH, LOW);
}

/* ============================== STATUS ============================== */

String buildAiStatus() {
  char tgt[sizeof(targetList)];
  portENTER_CRITICAL(&stateMux);
  strlcpy(tgt, targetList, sizeof(tgt));
  portEXIT_CRITICAL(&stateMux);

  JsonDocument d;
  d["type"]  = "ai_status";
  d["armed"] = (bool)armed;
  d["busy"]  = (bool)busy;
  d["target"] = tgt;
  String s;
  serializeJson(d, s);
  return s;
}

void sendStatus() {
  if (!wsUp) return;
  String out = buildAiStatus();
  if (xSemaphoreTake(wsMtx, pdMS_TO_TICKS(500)) == pdTRUE) {
    if (wsUp) backend.sendTXT(out);
    xSemaphoreGive(wsMtx);
  }
}

/* ============================ BACKEND WS =========================== */

void startBackend() {
  wsPath = "/ws/device?token=";
  wsPath += DEVICE_TOKEN;

  backend.setReconnectInterval(3000);
  backend.enableHeartbeat(15000, 3000, 2);
  backend.onEvent([](WStype_t type, uint8_t *payload, size_t len) {
    if (type == WStype_CONNECTED) {
      wsUp = true;
      Serial.printf("[WS] backend terhubung ke %s:%u\n", BACKEND_HOST, BACKEND_PORT);

      JsonDocument h;
      h["type"]     = "hello";
      h["deviceId"] = DEVICE_ID;
      h["name"]     = DEVICE_NAME;
      h["kind"]     = "esp32cam";
      h["firmware"] = FIRMWARE_VER;
      h["ip"]       = WiFi.localIP().toString();
      String s;
      serializeJson(h, s);
      backend.sendTXT(s);

      needStatus = true;
    } else if (type == WStype_DISCONNECTED) {
      wsUp = false;
      Serial.println(F("[WS] backend terputus, mencoba ulang..."));
    } else if (type == WStype_TEXT) {
      handleBackendMessage(String((char *)payload, len));
    }
  });

  backend.begin(BACKEND_HOST, BACKEND_PORT, wsPath.c_str());
}

void handleBackendMessage(const String &msg) {
  JsonDocument doc;
  if (deserializeJson(doc, msg)) return;

  const char *type = doc["type"] | "";
  Serial.printf("[WS] %s\n", msg.c_str());

  if (!strcmp(type, "ai")) {
    if (!doc["armed"].isNull()) armed = doc["armed"].as<bool>();
    const char *tgt = doc["target"] | "";
    if (strlen(tgt)) setTargetList(tgt);
    if (armed && millis() - lastScan > 1000) requestScan();
    needStatus = true;
    return;
  }

  if (!strcmp(type, "capture")) {
    requestScan();
    needStatus = true;
    return;
  }

  if (!strcmp(type, "cam")) {
    handleCamCommand(doc);
    return;
  }
}

void handleCamCommand(JsonDocument &doc) {
  const char *cmd = doc["cmd"] | "";
  const char *tgt = doc["target"] | "";

  if (strlen(tgt)) setTargetList(tgt);

  if (!strcmp(cmd, "arm")) {
    armed = true;
    if (millis() - lastScan > 1000) requestScan();   // scan segera
  } else if (!strcmp(cmd, "stop") || !strcmp(cmd, "disarm")) {
    armed = false;
  } else if (!strcmp(cmd, "trigger")) {
    requestScan();
  } else if (!strcmp(cmd, "interval")) {
    uint32_t ms = doc["ms"] | (uint32_t)scanInterval;
    if (ms < 2000) ms = 2000;
    if (ms > 600000) ms = 600000;
    scanInterval = ms;
  } else if (!strcmp(cmd, "target")) {
    // target sudah diterapkan di atas
  }

  needStatus = true;
  Serial.printf("[CMD] %s target=%s armed=%d\n", cmd, targetList, (int)armed);
}
