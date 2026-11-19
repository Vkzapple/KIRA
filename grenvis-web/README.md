# GRENVIS Web (Frontend)

Frontend untuk robot **GRENVIS** (Green Vision Intelligent System): memantau kesehatan tanaman dan mengendalikan robot.

Stack: Next.js 14 (App Router) + TypeScript + Tailwind CSS.
Backend: Go + chi + WebSocket (`../grenvis-server`), database: Supabase.

## Menjalankan

```bash
npm install
npm run dev
```

Buka http://localhost:3000.

`.env.local`:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_MOCK_PASSWORD=grenvis123
```

- `NEXT_PUBLIC_API_URL` harus sama dengan alamat `grenvis-server`.
- Kalau variabel itu dikosongkan, UI otomatis memakai **mode mock** (tanpa backend), password `NEXT_PUBLIC_MOCK_PASSWORD`.

Password untuk masuk ke robot diatur di backend (`ROBOT_PASSWORD`, default `grenvis123`).

## Fitur

- **Beranda**: status koneksi, tombol Hubungkan robot (popup password), foto terakhir robot, dan kartu kondisi kebun (soil moisture, driver 2 motor L298N, status kamera) yang diperbarui tiap 5 detik.
- **Controller** (terkunci sampai robot terhubung): tuas analog untuk maju/mundur dan belok kiri/kanan (pivot) dengan kecepatan proporsional yang posisinya terkunci (motor terus berjalan sampai tombol **Berhenti** ditekan; 2 motor L298N), kalibrasi servo PCA9685 (servo sinkron CH0+CH1 dan servo terpisah CH2), servo probe tanah (angkat/turunkan), servo kamera (kiri/kanan), kontrol **Vision AI** (target + mulai/hentikan + foto & analisis sekarang), riwayat perintah.

## Struktur

```
src/
├─ app/
│  ├─ layout.tsx              # font, Navbar, RobotProvider
│  ├─ page.tsx                # Beranda
│  └─ controller/page.tsx     # Controller (guard koneksi)
├─ components/
│  ├─ Navbar.tsx
│  ├─ ConnectionBadge.tsx
│  ├─ ConnectModal.tsx
│  ├─ PlantMonitorCard.tsx
│  ├─ SensorCard.tsx
│  └─ controller/
│     ├─ AnalogStick.tsx
│     └─ ServoControl.tsx
├─ context/RobotContext.tsx   # state koneksi global
└─ lib/
   ├─ types.ts                # tipe perintah, snapshot, telemetry
   ├─ robot-client.ts         # websocketRobotClient + fallback mock
   └─ format.ts               # format waktu, deskripsi perintah
```

## Alur koneksi

1. `connect(password)` → `POST /api/auth/login` → token sesi.
2. Buka `ws://<backend>/ws/dashboard?token=...`.
3. Server mengirim `ready` + status robot. Kalau robot offline, UI menampilkan pesan untuk menyalakan ESP32.
4. `send(cmd)` mengirim JSON ke server; server meneruskan ke semua device (ESP32 Dev & CAM memilih perintah yang relevan).
5. Kalau robot/kamera putus, server mengirim `device_status` dan UI kembali ke status terputus.

Foto terakhir diambil dari endpoint publik `GET /api/snapshots/latest`, jadi kartu di beranda tetap tampil walau belum login.

## Perintah yang dikirim ke robot

```ts
{ type: "move", dir: "forward" | "backward" | "left" | "right" | "stop", speed?: number }
{ type: "probe", dir: "up" | "down" }
{ type: "camera", dir: "left" | "right" }
{ type: "servo", sync?: number, aux?: number }
{ type: "ai", armed: boolean, target?: string }
{ type: "capture" }
```

Tuas analog mengirim arah dan `speed` (0–255) sesuai posisinya: semakin jauh dari tengah, semakin cepat. Posisi terakhir dikunci, jadi motor tetap berjalan setelah tuas dilepas; UI hanya mengirim `stop` saat tombol **Berhenti** ditekan, saat halaman ditinggalkan, atau saat koneksi putus. `ai` dan `capture` ditangani ESP32-CAM; sisanya oleh ESP32 Dev.

## Catatan

- Foto disajikan dari backend (`/media/...`) pada mode lokal, atau dari Supabase Storage pada mode Supabase. Keduanya URL absolut, jadi `<img>` biasa sudah cukup.
- Sesi disimpan di `sessionStorage`; menutup tab berarti harus memasukkan password lagi.
