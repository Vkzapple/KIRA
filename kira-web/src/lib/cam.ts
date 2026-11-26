export interface CamPred {
  /** class */
  c: string;
  /** confidence 0-1 */
  cf: number;
  /** pusat kotak (piksel frame) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** true bila class termasuk target */
  t?: boolean;
}

export interface CamResult {
  id: number;
  ok: boolean;
  /** kode HTTP Roboflow (negatif = error lokal/HTTPClient) */
  http: number;
  ms: number;
  w: number;
  h: number;
  matched: boolean;
  best: string;
  conf: number;
  n: number;
  target: string;
  heap?: number;
  psram?: number;
  rssi?: number;
  err?: string;
  preds: CamPred[];
  serverTs?: number;
}

export interface CamStatus {
  armed?: boolean;
  busy?: boolean;
  preview?: boolean;
  target?: string;
  rssi?: number;
  heap?: number;
  psram?: number;
  uptime?: number;
  ip?: string;
  fw?: string;
  interval?: number;
  /** Relay controller menyala (perintah daya robot aktif). */
  power?: boolean;
  /** Relay L298N sudah menyala (menyusul beberapa detik setelah controller). */
  motorPower?: boolean;
}

export interface CamFrameInfo {
  seq: number;
  id: number;
  size: number;
  w: number;
  h: number;
  src: string;
  ts: number;
}

/** Tebakan penyebab masalah dari hasil AI terakhir. */
export function diagnose(r: CamResult | null): { level: "ok" | "warn" | "bad"; text: string } | null {
  if (!r) return null;
  if (r.http === 400) {
    return { level: "bad", text: "Roboflow 400: body gambar bukan base64 / rusak. Pastikan firmware versi 1.1.0+ sudah di-flash." };
  }
  if (r.http === 401 || r.http === 403) {
    return { level: "bad", text: "Roboflow menolak API key/model (401/403). Periksa ROBOFLOW_API_KEY, ROBOFLOW_MODEL, ROBOFLOW_VERSION." };
  }
  if (r.http === 404) {
    return { level: "bad", text: "Model/versi Roboflow tidak ditemukan (404). Cek ROBOFLOW_MODEL dan ROBOFLOW_VERSION." };
  }
  if (r.http < 0) {
    return { level: "bad", text: `Gagal menghubungi Roboflow (${r.err || "kode " + r.http}). Cek WiFi/RSSI, heap bebas, dan daya 5V ESP32-CAM.` };
  }
  if (!r.ok) {
    return { level: "bad", text: `Roboflow membalas HTTP ${r.http}${r.err ? `: ${r.err}` : ""}.` };
  }
  if (r.n === 0) {
    return { level: "warn", text: "Model tidak melihat objek. Coba dekatkan/terangi objek, atau turunkan ROBOFLOW_CONF." };
  }
  if (!r.matched) {
    const found = r.preds.map((p) => p.c).join(", ");
    return { level: "warn", text: `Ada ${r.n} deteksi tapi tidak ada yang cocok dengan target (${r.target}). Class terdeteksi: ${found || "-"}.` };
  }
  return { level: "ok", text: `Target terdeteksi: ${r.best} (${Math.round(r.conf * 100)}%).` };
}
