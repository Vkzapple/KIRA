# GRENVIS Web (Frontend)

Frontend untuk robot **GRENVIS** (Green Vision Intelligent System): memantau kesehatan tanaman dan mengendalikan robot.

Stack: Next.js 14 (App Router) + TypeScript + Tailwind CSS.
Status: **FE saja**, robot dan data masih berupa mock. BE (Gotchi), DB (Supabase), dan konektor WebSocket dikerjakan belakangan.

## Menjalankan

```bash
npm install
npm run dev
```

Buka http://localhost:3000. Password mock: `grenvis123` (bisa diubah di `.env.local`).

## Fitur

- **Beranda**: status koneksi, tombol Hubungkan robot (popup password), foto terakhir robot beserta timestamp.
- **Controller** (terkunci sampai robot terhubung): tombol 4 arah robot, servo probe tanah (angkat/turunkan), servo kamera (kiri/kanan), riwayat perintah.

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
│  └─ controller/
│     ├─ DPad.tsx
│     └─ ServoControl.tsx
├─ context/RobotContext.tsx   # state koneksi global
└─ lib/
   ├─ types.ts                # tipe perintah, snapshot, status
   ├─ robot-client.ts         # interface RobotClient + mock
   └─ format.ts               # format waktu, deskripsi perintah
```

## Cara menyambung ke BE nanti

1. Buat `websocketRobotClient` di `src/lib/robot-client.ts` yang mengimplementasikan interface `RobotClient` (`connect`, `disconnect`, `send`, `onClose`, `getLatestSnapshot`).
2. Ganti baris terakhir: `export const robotClient: RobotClient = websocketRobotClient;`
3. `getLatestSnapshot` nantinya mengambil data dari Supabase (foto terakhir + timestamp).

Komponen UI tidak perlu diubah.

## Perintah yang dikirim ke robot

```ts
{ type: "move", dir: "forward" | "backward" | "left" | "right" | "stop" }
{ type: "probe", dir: "up" | "down" }
{ type: "camera", dir: "left" | "right" }
```

Tombol arah mengirim arah saat ditekan dan `stop` saat dilepas.

## Git

```bash
git init
git add .
git commit -m "chore: initial commit"
git branch -M main
git remote add origin https://github.com/USERNAME/grenvis-web.git
git push -u origin main
```
