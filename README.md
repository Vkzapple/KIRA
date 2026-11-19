# GRENVIS — Web + Backend + ESP32 Dev + ESP32-CAM

Sistem pemantauan tanaman dan kendali robot:

- **Website** (Next.js + TypeScript) untuk melihat foto/sensor dan mengirim perintah.
- **Backend** (Go + chi) sebagai satu-satunya WebSocket hub, penyimpan riwayat, dan jembatan ke Supabase.
- **ESP32 Dev** menggerakkan 3 servo lewat PCA9685, 2 motor lewat modul driver **L298N**, membaca soil moisture, mengirim telemetry.
- **ESP32-CAM** memindai objek via Roboflow dan hanya menyimpan foto saat target terdeteksi.

```
                    ┌──────────────────────────────┐
                    │  Website (Next.js :3000)     │
                    │  • login password            │
                    │  • controller + Vision AI    │
                    │  • foto & sensor             │
                    └──────────────┬───────────────┘
                          REST + WebSocket
                    ┌──────────────▼───────────────┐
                    │  grenvis-server (Go :8080)   │
                    │  • /ws/dashboard             │
                    │  • /ws/device                │
                    │  • simpan telemetry/foto     │
                    └───────┬──────────────┬───────┘
             ws://…/ws/device        ws://…/ws/device
                    ┌───────▼──────┐   ┌────▼─────────┐
                    │ ESP32 Dev    │   │ ESP32-CAM    │
                    │ servo+sensor │   │ kamera+AI    │
                    └──────────────┘   └──────────────┘
                              │
                    ┌─────────▼─────────┐
                    │ Supabase          │
                    │ Postgres+Storage  │
                    └───────────────────┘
```

Kedua ESP32 terhubung sendiri-sendiri ke backend. Perintah dari browser disiarkan ke semua device; masing-masing memproses tipe yang relevan (`move/probe/camera/servo` oleh Dev, `ai/capture` oleh CAM).

---

## 1. Struktur repo

```
grenvis-web/                    -> frontend Next.js
grenvis-server/                 -> backend Go + chi
  cmd/server/main.go            -> entrypoint
  internal/httpapi/             -> REST + auth
  internal/ws/hub.go            -> hub WebSocket
  internal/store/               -> local (dev) / Supabase
  supabase/schema.sql           -> skema database + bucket
ESP32DevController/…​.ino        -> firmware ESP32 Dev
ESP32CAMVision/…​.ino            -> firmware ESP32-CAM
README.md
```

---

## 2. Menjalankan backend

Butuh **Go 1.23+** (repo diuji dengan Go 1.27).

```bash
cd grenvis-server
copy .env.example .env      # Windows; Linux/macOS: cp .env.example .env
go mod tidy
go run ./cmd/server
```

`go run` otomatis membaca `.env`. Tanpa Supabase, backend memakai mode **local**: metadata di memori, foto di `./data/snapshots`, disajikan di `/media/...`.

Isi `.env` minimal:

```dotenv
ADDR=:8080
CORS_ORIGINS=http://localhost:3000
ROBOT_PASSWORD=grenvis123
DEVICE_TOKEN=change-me-device-token
PUBLIC_BASE_URL=http://localhost:8080
```

Uji cepat:

```bash
curl http://localhost:8080/api/health
# {"ok":true,"store":"local","time":"..."}
```

### Endpoint

| Method | Path | Akses | Fungsi |
|---|---|---|---|
| GET | `/api/health` | publik | status server + mode store |
| POST | `/api/auth/login` | publik | `{password}` → token sesi |
| POST | `/api/auth/logout` | sesi | hapus token |
| GET | `/api/state` | sesi | ringkasan device + telemetry + snapshot |
| GET | `/api/telemetry/latest` | publik | sampel sensor terakhir |
| GET | `/api/telemetry?limit=` | sesi | riwayat sensor |
| GET | `/api/snapshots/latest` | publik | foto terakhir |
| GET | `/api/snapshots?limit=` | publik | daftar foto |
| POST | `/api/snapshots` | device | upload JPEG/PNG (raw atau multipart) |
| POST | `/api/detections` | device | catat deteksi tanpa foto |
| GET | `/ws/dashboard?token=` | sesi | WebSocket browser |
| GET | `/ws/device?token=` | device | WebSocket ESP32 |
| GET | `/media/*` | publik | foto mode lokal |

Device mengirim token lewat header `X-Device-Token` (HTTP) atau query `?token=` (WebSocket, karena ESP32 tidak bisa set header dengan mudah).

---

## 3. Supabase

1. Buat project di <https://supabase.com>.
2. Buka **SQL Editor**, tempel isi `grenvis-server/supabase/schema.sql`, jalankan.
   Skrip ini membuat tabel `devices`, `telemetry`, `snapshots`, `detections`, mengaktifkan RLS, dan membuat bucket Storage publik `grenvis-snapshots`.

   > Kalau log backend menampilkan `PGRST205 Could not find the table 'public.telemetry'`,
   > berarti skrip ini belum dijalankan di project Supabase yang dipakai `.env`.
   > Skrip aman dijalankan ulang; bagian migrasi akan menambahkan kolom baru
   > seperti `motor_left` dan `motor_right` untuk telemetry 2 motor.
3. Buka **Project Settings → API**, salin:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (jangan pernah dipakai di frontend)
4. Isi `.env`:

```dotenv
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_BUCKET=grenvis-snapshots
PUBLIC_BASE_URL=https://api.domain-anda.com
```

`PUBLIC_BASE_URL` tidak dipakai untuk foto Supabase (backend memakai URL publik Storage), tetapi tetap dipakai pada mode lokal.

Restart backend; `/api/health` akan menampilkan `"store":"supabase"`.

---

## 4. Menjalankan frontend

```bash
cd grenvis-web
npm install
npm run dev
```

`.env.local`:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_MOCK_PASSWORD=grenvis123   # hanya untuk mode mock
```

Buka <http://localhost:3000>, klik **Hubungkan robot**, masukkan `ROBOT_PASSWORD`.

- Backend/robot harus memakai host yang bisa dijangkau browser. Kalau diuji dari HP, ganti `localhost` dengan IP laptop dan sesuaikan `CORS_ORIGINS`.
- Kalau `NEXT_PUBLIC_API_URL` dikosongkan, UI kembali ke mode mock (berguna saat mendesain tampilan tanpa backend).

---

## 5. Library Arduino

Arduino IDE → **Tools → Manage Libraries**:

| Library | Versi | Dipakai |
|---|---|---|
| **Adafruit PWM Servo Driver Library** | 2.4.0+ | PCA9685 |
| **Adafruit BusIO** | terbaru | dependency otomatis |
| **ArduinoJson** | **7.x** | parsing JSON |
| **WebSockets** (Markus Sattler / Links2004) | 2.4.1+ | client WS ke backend |

Board package: **esp32 by Espressif** (2.0.14+ atau 3.x). `esp32-camera` sudah termasuk.

> Kode memakai `JsonDocument` (ArduinoJson 7). ArduinoJson 6 akan gagal compile.

---

## 6. Wiring ESP32 Dev

### PCA9685 + servo

| PCA9685 | ESP32 Dev | Catatan |
|---|---|---|
| VCC (logic) | 3V3 | logic level aman untuk ESP32 |
| GND | GND | **GND harus nyambung ke power servo juga** |
| SDA | GPIO 21 | |
| SCL | GPIO 22 | |
| V+ | +5V adaptor | **jangan** dari 3V3 ESP32 |
| CH0 | Servo 1 | ikut grup sinkron |
| CH1 | Servo 2 | ikut grup sinkron (arah sama) |
| CH2 | Servo 3 | independen |
| OE | — | biarkan (active-low, internal pull-down) |

- Pakai adaptor 5V minimal 2–3 A kalau 3 servo SG90 bergerak bersamaan.
- Semua GND (ESP32, PCA9685, adaptor servo) **harus disatukan**.
- Kalau servo CH1 bergerak kebalik karena posisi mekanik:

```cpp
#define SYNC_B_INVERT  true     // balik arah servo CH1
#define SYNC_B_OFFSET  0        // geser sudut (derajat), misal 5
```

### Modul L298N = driver 2 motor DC

> **L298N adalah modul H-bridge 2 kanal.**
> Kanal A (ENA/IN1/IN2) → motor kiri, kanal B (ENB/IN3/IN4) → motor kanan.
> Node ini tidak memakai sensor hujan.

| L298N | ESP32 Dev / supply | Catatan |
|---|---|---|
| ENA | **GPIO 26** | PWM kecepatan motor kiri, 20 kHz |
| IN1 | **GPIO 27** | arah motor kiri |
| IN2 | **GPIO 25** | arah motor kiri |
| ENB | **GPIO 33** | PWM kecepatan motor kanan, 20 kHz |
| IN3 | **GPIO 32** | arah motor kanan |
| IN4 | **GPIO 16** | arah motor kanan |
| GND | GND | **GND harus sama dengan supply motor** |
| +12V | supply motor | 7–12V; **jangan** dari ESP32 |
| OUT1 / OUT2 | motor kiri | kanal A |
| OUT3 / OUT4 | motor kanan | kanal B |
| 5V | — | hanya untuk logic; **jangan** dipakai memberi daya ESP32 |

- **Lepas jumper ENA dan ENB** di modul L298N supaya PWM dari ESP32 benar-benar mengatur kecepatan. Kalau jumper dibiarkan, motor akan selalu berputar penuh.
- Jumper 5V onboard L298N: biarkan terpasang kalau supply motor 7–12V. Kalau supply >12V, lepas jumper dan beri 5V eksternal ke pin 5V.
- Logic L298N umumnya terbaca dari 3.3V ESP32 (ambang HIGH ±2.3V). Kalau arah motor tidak stabil, tambahkan level shifter 3.3V→5V.
- `move forward` → kedua motor maju. `move backward` → kedua motor mundur. `move stop` → ENA/ENB 0 dan semua IN LOW (coast).
- `move left` → motor kiri mundur + motor kanan maju (pivot kiri). `move right` → motor kiri maju + motor kanan mundur (pivot kanan). Belok sekarang aktif di tuas web.
- Firmware punya ramp 300 ms dan jeda 120 ms saat balik arah **per motor**, serta otomatis stop kalau WiFi/backend putus.
- Penyesuaian kecepatan: `#define MOTOR_SPEED 180` (0–255) dan `#define MOTOR_RAMP_MS 300`.
- Kalau satu sisi berputar kebalik, set `MOTOR_LEFT_INVERT` / `MOTOR_RIGHT_INVERT` menjadi `1`, atau tukar kabel `OUT` sisi tersebut.
- L298N punya drop tegangan ±1.5–2V, jadi motor 12V akan menerima tegangan lebih rendah. Dua motor butuh supply lebih besar (minimal 2 A, sesuaikan dengan motor).

### Sensor

| Modul | Pin modul | ESP32 Dev |
|---|---|---|
| Soil moisture | VCC | 3V3 |
| | GND | GND |
| | AO | **GPIO 34** (ADC1) |

- GPIO 34 hanya input, tanpa pull-up — memang untuk ADC.
- Gunakan **ADC1** (32–39) karena ADC2 tidak bisa dipakai saat WiFi aktif.
- Tidak ada sensor hujan pada node ini. Modul L298N dipakai sebagai driver 2 motor DC.

---

## 7. Konfigurasi firmware

### ESP32 Dev (`ESP32DevController.ino`)

```cpp
#define WIFI_SSID "GANTI_SSID"
#define WIFI_PASS "GANTI_PASSWORD"

#define BACKEND_HOST  "192.168.1.10"   // IP laptop/server backend
#define BACKEND_PORT  8080
#define DEVICE_TOKEN  "change-me-device-token"
#define DEVICE_ID     "grenvis-01-dev"
```

Kalibrasi sensor (lihat Serial Monitor, print tiap 5 detik):

```cpp
#define SOIL_DRY_RAW 2600   // nilai saat sensor di udara
#define SOIL_WET_RAW 1100   // nilai saat sensor di air
```

Cara kalibrasi:
1. Upload, buka Serial Monitor **115200**.
2. Lihat baris `[SENSOR] soil raw=...`.
3. Catat nilai kering dan basah, masukkan ke 2 define di atas.

Board: **ESP32 Dev Module**. **Tidak ada dashboard/web server lokal di ESP32**; semua kontrol dan tampilan ada di website GRENVIS melalui backend.

### ESP32-CAM (`ESP32CAMVision.ino`)

```cpp
#define WIFI_SSID "GANTI_SSID"
#define WIFI_PASS "GANTI_PASSWORD"

#define BACKEND_HOST  "192.168.1.10"
#define BACKEND_PORT  8080
#define DEVICE_TOKEN  "change-me-device-token"
#define DEVICE_ID     "grenvis-01-cam"
```

Roboflow:

```cpp
#define ROBOFLOW_API_KEY "xxxxxxxxxxxxxxxx"
#define ROBOFLOW_MODEL   "nama-model"     // model ID, bukan nama project
#define ROBOFLOW_VERSION "1"
#define ROBOFLOW_CONF    "40"             // threshold 0-100
#define TARGET_DEFAULT   "person"         // boleh "person,bottle"
```

Perilaku scan:

```cpp
#define AUTO_ARM_ON_BOOT false   // true = langsung scan otomatis
#define SCAN_INTERVAL_MS 8000    // tiap 8 detik saat armed
```

### Setting Arduino IDE untuk ESP32-CAM

| Setting | Nilai |
|---|---|
| Board | **AI Thinker ESP32-CAM** |
| PSRAM | **Enabled** |
| Partition Scheme | **Huge APP (3MB No OTA/1MB SPIFFS)** |
| Upload Speed | 115200 (kalau gagal, turunkan) |
| Port | port USB-TTL |

Cara flash:
1. Hubungkan **GPIO0 → GND**.
2. Tekan **RST**, lepas, lalu lepas GPIO0 dari GND.
3. Klik Upload.
4. Setelah selesai, tekan **RST** sekali lagi.
5. Buka Serial Monitor 115200 untuk melihat IP kamera.

> ESP32-CAM butuh arus cukup. Kalau reboot terus saat WiFi/TLS, pakai adaptor 5V 1A.

---

## 8. Setup Roboflow (Hosted Inference)

1. Daftar di <https://roboflow.com>, buat **Project → Object Detection**.
2. Upload & anotasi gambar, lalu **Train**.
3. Buka **Deploy → Hosted Infer**.
4. Salin **Model ID**, **Version**, dan **API Key**.
5. Pastikan nama class (mis. `person`, `bottle`) sama dengan isi target.

Format request firmware (raw JPEG, bukan base64):

```
POST https://detect.roboflow.com/<MODEL>/<VERSION>?api_key=<KEY>&confidence=40&overlap=30
Content-Type: application/x-www-form-urlencoded
<binary JPEG>
```

Firmware memakai `WiFiClientSecure::setInsecure()`. Untuk produksi, ganti dengan `setCACert()`.

---

## 9. Alur pemakaian

1. Jalankan backend dan frontend.
2. Nyalakan ESP32 Dev → Serial menampilkan `[WS] backend terhubung`.
3. Nyalakan ESP32-CAM → konek ke backend yang sama.
4. Buka website → **Hubungkan robot** → masukkan password.
5. Beranda menampilkan foto terakhir + kondisi kebun (soil moisture, status driver motor L298N, status kamera).
6. Buka **Controller**:
   - tuas analog untuk maju/mundur dan belok kiri/kanan (pivot) dengan kecepatan proporsional (semakin jauh digeser, semakin cepat). Posisi tuas terkunci: motor terus berjalan sampai tombol **Berhenti** ditekan,
   - slider servo PCA9685 untuk kalibrasi (servo sinkron CH0+CH1 dan servo terpisah CH2),
   - probe tanah naik/turun,
   - servo kamera kiri/kanan,
   - **Vision AI**: isi target, klik **Mulai pantau**, atau **Foto + AI sekarang** untuk satu kali scan.
7. Saat Roboflow menemukan target:
   - ESP32-CAM menyimpan JPEG, mengunggah ke backend (`POST /api/snapshots`),
   - backend menyimpan metadata (Supabase) dan menyiarkan event `snapshot`,
   - foto terbaru langsung muncul di beranda setelah refresh.
8. Data sensor dikirim tiap 2 detik dan disimpan maksimal tiap 5 detik.

---

## 10. Protokol WebSocket

### Dashboard (browser) → server

```json
{"type":"move","dir":"forward","speed":180,"id":"...","ts":123}
{"type":"probe","dir":"down"}
{"type":"camera","dir":"left"}
{"type":"servo","sync":120,"aux":45}
{"type":"ai","armed":true,"target":"person"}
{"type":"capture"}
```

Server membalas `{"type":"ack","id":"...","forwarded":true}` atau `{"type":"error","message":"..."}`.

### Server → dashboard

```json
{"type":"ready","deviceOnline":true,"deviceId":"grenvis-01-dev","telemetry":{...}}
{"type":"device_status","deviceId":"grenvis-01-cam","online":true}
{"type":"telemetry","telemetry":{...},"deviceOnline":true}
{"type":"snapshot","snapshot":{"id":"...","imageUrl":"https://...","capturedAt":"..."}}
{"type":"detection","detection":{"class":"person","confidence":0.87,"imageUrl":"..."}}
```

### Device → server

```json
{"type":"hello","deviceId":"grenvis-01-dev","kind":"esp32dev","firmware":"1.3.0","ip":"192.168.1.50"}
{"type":"telemetry","soil":48,"soilRaw":1980,"sync":90,"aux":90,
 "motor":180,"motorTarget":180,"motorLeft":180,"motorRight":180,
 "motorLeftTarget":180,"motorRightTarget":180,"rssi":-55,"uptime":300}
{"type":"ai_status","armed":true,"busy":false,"target":"person"}
{"type":"detection","class":"person","confidence":0.87,"count":2,"imageUrl":"https://.../foto.jpg"}
```

Status kamera (`camOnline`, `camArmed`, `camBusy`, `camTarget`) hanya ditulis oleh pesan `ai_status` dari CAM. Telemetry dari Dev tidak menimpanya. Kalau CAM putus, backend menandai `camOnline=false` dan menyiarkannya.

---

## 11. Troubleshooting

| Gejala | Penyebab / solusi |
|---|---|
| Website: "Server aktif, tapi robot belum terhubung" | ESP32 belum konek, `BACKEND_HOST` salah, atau token beda |
| `[WS] backend terputus` berulang | Backend tidak jalan / firewall memblokir port 8080 / salah IP |
| `ws device upgrade gagal ... request origin not allowed` | Versi backend lama. Build/restart backend terbaru; endpoint device sekarang tidak memakai pengecekan Origin browser |
| `/api/telemetry/latest` 502 + log `PGRST205` | Tabel Supabase belum dibuat. Jalankan `grenvis-server/supabase/schema.sql` di SQL Editor |
| Login selalu 401 | `ROBOT_PASSWORD` di `.env` backend berbeda |
| Upload foto 401 | `DEVICE_TOKEN` firmware ≠ `.env` backend |
| Foto tidak muncul | Cek `PUBLIC_BASE_URL` (mode lokal) atau bucket Storage (Supabase) |
| Servo tidak gerak | V+ PCA9685 belum diberi 5V, GND tidak disatukan, atau alamat I2C bukan 0x40 |
| Motor tidak berputar | `ENA`/`ENB` belum mendapat PWM, `IN1`–`IN4` tidak berubah, supply motor (+12V) belum diberi daya, GND logic vs motor belum disatukan, atau jumper ENA/ENB masih terpasang |
| Satu motor berputar kebalik | Set `MOTOR_LEFT_INVERT` / `MOTOR_RIGHT_INVERT` ke `1`, atau tukar kabel `OUT` sisi tersebut |
| Robot berputar saat maju | Salah satu motor terbalik; cek `MOTOR_LEFT_INVERT` / `MOTOR_RIGHT_INVERT` atau tukar kabel `OUT` |
| Belok tidak berfungsi | Pastikan `ENB`/`IN3`/`IN4` terhubung dan jumper `ENB` sudah dilepas |
| Servo bergetar / reset | Adaptor kurang arus; tambahkan kapasitor 470–1000 µF di V+ |
| Sensor soil selalu 0/100 | Kalibrasi `SOIL_DRY_RAW`/`SOIL_WET_RAW` belum sesuai |
| `HTTP -1` di log Roboflow | WiFi lemah / heap habis / API key salah. Pastikan PSRAM Enabled |
| `HTTP 401/403` Roboflow | API key salah atau model/version salah |
| Selalu "0 pred" | Nama class target tidak sama dengan class model, atau confidence terlalu tinggi |
| ESP32-CAM reboot saat inferensi | Daya kurang; pakai 5V 1A dan kabel pendek |
| Compile error `JsonDocument` | ArduinoJson masih versi 6 → upgrade ke 7.x |
| Kamera gagal init `0x105` | Koneksi kamera longgar / board bukan AI Thinker |
| CORS error di browser | Tambahkan origin frontend ke `CORS_ORIGINS` |

---

## 12. Catatan biaya & keamanan

- Setiap scan = 1 request inferensi Roboflow. Interval 8 detik ≈ 450 request/jam saat armed. Gunakan **Hentikan** kalau tidak dipakai.
- `service_role` Supabase hanya ada di backend. Jangan pernah menaruhnya di frontend.
- Token sesi disimpan di memori server (satu instance). Kalau backend di-scale, ganti dengan JWT/Redis.
- WebSocket device memakai token statis; untuk produksi pakai TLS (`wss://`) di belakang reverse proxy dan tetap jaga `DEVICE_TOKEN`.
- Firmware saat ini memakai `ws://`/`http://` polos karena diuji di LAN. Jangan expose port backend langsung ke internet tanpa TLS.
- `setInsecure()` mempermudah setup Roboflow tetapi tidak memverifikasi sertifikat. Untuk produksi, pasang root CA.
- Roboflow menerima gambar mentah; jangan arahkan kamera ke area privat tanpa izin.
