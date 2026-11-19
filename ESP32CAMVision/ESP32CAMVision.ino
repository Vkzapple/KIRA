/* =====================================================================
   ESP32-CAM (AI Thinker)  —  Node Vision + Roboflow

   Fungsi:
     1. Inisialisasi kamera OV2640 (AI Thinker)
     2. Ambil frame -> kirim ke Roboflow Hosted Inference (HTTPS)
     3. Simpan & unggah capture HANYA jika kelas target terdeteksi
     4. WebSocket client ke backend GRENVIS sebagai device:
          ws://<server>:8080/ws/device?token=<DEVICE_TOKEN>
        - terima perintah: ai (arm/stop/target), capture, cam (legacy)
        - kirim ai_status + detection
     5. Upload foto ke backend (POST /api/snapshots) supaya tersimpan
        di Supabase Storage dan tampil di website
     6. HTTP server lokal: /last.jpg, /stream, /status, /trigger

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
#include <WebServer.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <esp_heap_caps.h>
#include <math.h>
#include <ctype.h>

/* ============================ KONFIGURASI ============================ */

#define WIFI_SSID "GANTI_SSID"
#define WIFI_PASS "GANTI_PASSWORD"

// ---- Backend GRENVIS ----
// Isi IP/host laptop atau server tempat `grenvis-server` berjalan.
#define BACKEND_HOST  "192.168.1.10"
#define BACKEND_PORT  8080
#define DEVICE_TOKEN  "change-me-device-token"   // harus sama dengan .env backend
#define DEVICE_ID     "grenvis-01-cam"
#define DEVICE_NAME   "GRENVIS CAM"
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
#define SNAP_MAX_BYTES      (120 * 1024)
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

WebServer       http(80);
WebSocketsClient backend;

SemaphoreHandle_t snapMtx  = nullptr;
SemaphoreHandle_t wsMtx    = nullptr;
SemaphoreHandle_t trigSem  = nullptr;
portMUX_TYPE      stateMux = portMUX_INITIALIZER_UNLOCKED;

uint8_t *snapBuf = nullptr;
size_t    snapLen = 0;

volatile bool     armed   = AUTO_ARM_ON_BOOT;
volatile bool     busy    = false;
volatile bool     wsUp    = false;
volatile bool     needStatus = false;
volatile bool     camReady = false;
volatile uint32_t lastScan = 0;
volatile uint32_t scanInterval = SCAN_INTERVAL_MS;
volatile uint32_t lastDetMs = 0;
volatile float    lastConf = 0;

char targetList[96] = TARGET_DEFAULT;
char lastClass[32]  = "";
char lastDetUrl[128] = "";

String wsPath = "";

// Dideklarasikan di bawah, dipakai lebih dulu di setup()
extern const char CAM_HTML[] PROGMEM;

/* =========================== PROTOTYPES ============================= */

bool cameraInit();
void scanTask(void *param);
void runOneScan();
bool roboflowDetect(camera_fb_t *fb, String &bestClass, float &bestConf,
                    int &nPred, bool &matched);
bool matchesTarget(const String &cls);
void setTargetList(const char *s);
void storeSnapshot(camera_fb_t *fb);
void flashPulse();
void requestScan();
void sendStatus();
bool uploadSnapshot(camera_fb_t *fb, const String &cls, float conf, String &imageUrl);
String buildStatus();
String buildAiStatus();
void handleBackendMessage(const String &msg);
void handleCamCommand(JsonDocument &doc);
void startBackend();
void handleLastJpg();
void handleStream();

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

  snapMtx = xSemaphoreCreateMutex();
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

  if (MDNS.begin("esp32-cam")) MDNS.addService("http", "tcp", 80);

  // HTTP endpoints lokal
  http.on("/", HTTP_GET, []() {
    http.send(200, "text/html", CAM_HTML);
  });
  http.on("/status", HTTP_GET, []() {
    http.send(200, "application/json", buildStatus());
  });
  http.on("/last.jpg", HTTP_GET, handleLastJpg);
  http.on("/stream", HTTP_GET, handleStream);
  http.on("/trigger", HTTP_GET, []() {
    requestScan();
    http.send(200, "text/plain", "queued");
  });
  http.onNotFound([]() { http.send(404, "text/plain", "not found"); });
  http.begin();

  // Backend WebSocket
  startBackend();

  xTaskCreatePinnedToCore(scanTask, "vision", 16384, nullptr, 1, nullptr, 0);

  lastScan = millis() - SCAN_INTERVAL_MS;   // scan cepat setelah boot
  Serial.println(F("Siap. Endpoint: /last.jpg /stream /status /trigger"));
}

/* =============================== LOOP =============================== */

void loop() {
  http.handleClient();

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
    storeSnapshot(fb);
    flashPulse();

    portENTER_CRITICAL(&stateMux);
    strlcpy(lastClass, cls.c_str(), sizeof(lastClass));
    portEXIT_CRITICAL(&stateMux);

    lastConf = conf;
    lastDetMs = millis();

    // Unggah ke backend -> tersimpan di Supabase Storage / folder data.
    String imageUrl = "";
    if (uploadSnapshot(fb, cls, conf, imageUrl)) {
      portENTER_CRITICAL(&stateMux);
      strlcpy(lastDetUrl, imageUrl.c_str(), sizeof(lastDetUrl));
      portEXIT_CRITICAL(&stateMux);
    }
    if (!imageUrl.length()) {
      imageUrl = "http://" + WiFi.localIP().toString() + "/last.jpg";
    }

    JsonDocument d;
    d["type"] = "detection";
    d["class"] = cls;
    d["confidence"] = conf;
    d["count"] = nPred;
    d["ip"] = WiFi.localIP().toString();
    d["url"] = imageUrl;
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

void storeSnapshot(camera_fb_t *fb) {
  if (!fb || fb->len == 0 || fb->len > SNAP_MAX_BYTES) return;
  if (xSemaphoreTake(snapMtx, pdMS_TO_TICKS(500)) != pdTRUE) return;

  if (!snapBuf) {
    snapBuf = (uint8_t *)heap_caps_malloc(SNAP_MAX_BYTES, MALLOC_CAP_SPIRAM);
    if (!snapBuf) snapBuf = (uint8_t *)malloc(SNAP_MAX_BYTES);
  }
  if (snapBuf) {
    memcpy(snapBuf, fb->buf, fb->len);
    snapLen = fb->len;
  }
  xSemaphoreGive(snapMtx);
}

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

String buildStatus() {
  char cls[sizeof(lastClass)];
  portENTER_CRITICAL(&stateMux);
  strlcpy(cls, lastClass, sizeof(cls));
  portEXIT_CRITICAL(&stateMux);

  char tgt[sizeof(targetList)];
  portENTER_CRITICAL(&stateMux);
  strlcpy(tgt, targetList, sizeof(tgt));
  portEXIT_CRITICAL(&stateMux);

  char url[sizeof(lastDetUrl)];
  portENTER_CRITICAL(&stateMux);
  strlcpy(url, lastDetUrl, sizeof(url));
  portEXIT_CRITICAL(&stateMux);

  JsonDocument d;
  d["type"] = "camStatus";
  d["ip"] = WiFi.localIP().toString();
  d["rssi"] = WiFi.RSSI();
  d["armed"] = (bool)armed;
  d["busy"] = (bool)busy;
  d["target"] = tgt;
  d["interval"] = (uint32_t)scanInterval;
  d["lastClass"] = cls;
  d["lastConf"] = (float)lastConf;
  d["lastDetMs"] = (uint32_t)lastDetMs;
  d["lastUrl"] = url;
  d["snapBytes"] = (uint32_t)snapLen;
  d["heap"] = ESP.getFreeHeap();
  d["psram"] = psramFound() ? ESP.getFreePsram() : 0;
  d["uptime"] = (uint32_t)(millis() / 1000);
  d["ws"] = (bool)wsUp;
  d["backend"] = BACKEND_HOST;
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

/* ============================ HTTP KAMERA =========================== */

void handleLastJpg() {
  if (!snapBuf || snapLen == 0) {
    http.send(404, "text/plain", "belum ada capture");
    return;
  }
  if (xSemaphoreTake(snapMtx, pdMS_TO_TICKS(1000)) != pdTRUE) {
    http.send(503, "text/plain", "busy");
    return;
  }

  size_t n = snapLen;
  auto &client = http.client();
  client.print(F("HTTP/1.1 200 OK\r\n"));
  client.print(F("Content-Type: image/jpeg\r\n"));
  client.print(F("Content-Length: "));
  client.print((unsigned)n);
  client.print(F("\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"));
  client.write(snapBuf, n);
  client.flush();
  client.stop();

  xSemaphoreGive(snapMtx);
}

void handleStream() {
  auto &client = http.client();
  client.print(F("HTTP/1.1 200 OK\r\n"));
  client.print(F("Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"));
  client.print(F("Cache-Control: no-store\r\nConnection: close\r\n\r\n"));

  while (client.connected()) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      delay(30);
      continue;
    }
    client.printf("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
                  (unsigned)fb->len);
    client.write(fb->buf, fb->len);
    client.print("\r\n");
    esp_camera_fb_return(fb);

    // Tetap layani WebSocket supaya koneksi ke backend tidak timeout
    if (xSemaphoreTake(wsMtx, pdMS_TO_TICKS(10)) == pdTRUE) {
      backend.loop();
      xSemaphoreGive(wsMtx);
    }

    delay(60);   // ~15 fps max
  }
  client.stop();
}

/* ============================ HALAMAN =============================== */

const char CAM_HTML[] PROGMEM = R"rawliteral(
<!DOCTYPE html><html lang="id"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESP32-CAM</title>
<style>
body{margin:0;font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e8eaed;padding:16px}
h1{font-size:18px;margin:0 0 12px}
.card{background:#171a21;border:1px solid #242a35;border-radius:14px;padding:14px;max-width:640px}
img{width:100%;border-radius:10px;background:#000;margin-top:10px}
pre{font-size:12px;color:#8b93a7;white-space:pre-wrap;word-break:break-word}
a{color:#4f8cff}
</style></head><body>
<h1>ESP32-CAM &middot; Roboflow</h1>
<div class="card">
<div><a href="/trigger">Trigger scan</a> &middot; <a href="/status">Status JSON</a> &middot; <a href="/stream">MJPEG stream</a></div>
<img id="s" src="/last.jpg" alt="capture" onerror="this.style.opacity=.2">
<pre id="st">memuat...</pre>
</div>
<script>
async function tick(){
  try{const r=await fetch('/status');const j=await r.json();
    document.getElementById('st').textContent=
      `IP ${j.ip} | RSSI ${j.rssi} | armed ${j.armed} | target ${j.target}\n`+
      `deteksi terakhir: ${j.lastClass||'-'} ${(j.lastConf*100||0).toFixed(0)}% | capture ${j.snapBytes} B\n`+
      `backend ${j.backend} (${j.ws?'online':'offline'}) | heap ${j.heap} | psram ${j.psram}`;
    if(j.lastDetMs){const im=document.getElementById('s');im.style.opacity=1;im.src='/last.jpg?t='+Date.now();}
  }catch(e){}
}
tick();setInterval(tick,3000);
</script></body></html>
)rawliteral";
