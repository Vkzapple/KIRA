import type { PlantSnapshot, RobotCommand, RobotTelemetry } from "./types";

/**
 * Kontrak antara UI dan robot.
 * Implementasi nyata: `websocketRobotClient` (backend Go + WebSocket).
 * Fallback development tanpa backend: `mockRobotClient`.
 */
export interface RobotClient {
  connect(password: string): Promise<void>;
  disconnect(): void;
  send(cmd: RobotCommand): void;
  /** Dipanggil saat koneksi terputus dari sisi robot/jaringan */
  onClose(cb: () => void): void;
  /** Telemetry live dari robot; mengembalikan fungsi untuk berhenti berlangganan. */
  onTelemetry(cb: (t: RobotTelemetry) => void): () => void;
  /** Foto baru dari ESP32-CAM (dikirim saat ada deteksi/anomali). */
  onSnapshot(cb: (s: PlantSnapshot) => void): () => void;
  getLatestSnapshot(): Promise<PlantSnapshot | null>;
}

const MOCK_PASSWORD = process.env.NEXT_PUBLIC_MOCK_PASSWORD ?? "kira123";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockRobotClient: RobotClient = {
  async connect(password) {
    await wait(800);
    if (password !== MOCK_PASSWORD) {
      throw new Error("Password robot salah. Periksa lagi lalu coba ulang.");
    }
  },
  disconnect() {},
  onClose() {},
  onTelemetry() {
    return () => {};
  },
  onSnapshot() {
    return () => {};
  },
  send(cmd) {
    console.debug("[mock robot] perintah dikirim:", cmd);
  },
  async getLatestSnapshot() {
    await wait(400);
    return {
      id: "mock-1",
      plantName: "Hibiscus (A1)",
      imageUrl: "/placeholder-plant.svg",
      capturedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    };
  },
};

/** URL backend, mis. http://localhost:8080 (kosong = mode mock). */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
const TOKEN_KEY = "kira.session";

function tokenStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* mode privat: abaikan */
  }
}

function wsURL(path: string, token: string): string {
  const base = API_URL.replace(/^http/i, "ws");
  return `${base}${path}?token=${encodeURIComponent(token)}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* body bukan JSON */
  }
  return fallback;
}

type SnapshotPayload = {
  id?: string;
  plantName?: string;
  imageUrl?: string;
  capturedAt?: string;
  class?: string;
  confidence?: number;
};

function toPlantSnapshot(data: SnapshotPayload): PlantSnapshot | null {
  if (!data.id || !data.imageUrl) return null;
  return {
    id: data.id,
    plantName: data.plantName || "Tanaman KIRA",
    imageUrl: data.imageUrl,
    capturedAt: data.capturedAt || new Date().toISOString(),
    class: data.class,
    confidence:
      typeof data.confidence === "number" ? data.confidence : undefined,
  };
}

class WebSocketRobotClient implements RobotClient {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private closeHandlers = new Set<() => void>();
  private telemetryHandlers = new Set<(t: RobotTelemetry) => void>();
  private snapshotHandlers = new Set<(s: PlantSnapshot) => void>();
  private manualClose = false;

  async connect(password: string): Promise<void> {
    this.disconnect();

    let res: Response;
    try {
      res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
    } catch {
      throw new Error(
        "Tidak bisa menghubungi server KIRA. Pastikan backend sudah jalan."
      );
    }

    if (res.status === 401) {
      throw new Error("Password robot salah. Periksa lagi lalu coba ulang.");
    }
    if (!res.ok) {
      throw new Error(await readError(res, "Gagal masuk ke server KIRA."));
    }

    const { token } = (await res.json()) as { token?: string };
    if (!token) throw new Error("Server tidak mengirim token sesi.");
    this.token = token;
    setToken(token);

    await this.openSocket(token);
  }

  private openSocket(token: string): Promise<void> {
    this.manualClose = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          this.closeSocket();
          this.token = null;
          setToken(null);
          reject(err);
        } else {
          resolve();
        }
      };

      const ws = new WebSocket(wsURL("/ws/dashboard", token));
      this.ws = ws;

      const timer = setTimeout(() => {
        finish(new Error("Server KIRA tidak merespons. Coba lagi."));
      }, 8000);

      ws.addEventListener("message", (event) => {
        if (this.ws !== ws) return;
        let msg: {
          type?: string;
          deviceOnline?: boolean;
          message?: string;
          telemetry?: RobotTelemetry;
          snapshot?: SnapshotPayload;
        };
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (
          msg.telemetry &&
          (msg.type === "telemetry" || msg.type === "ready")
        ) {
          this.notifyTelemetry(msg.telemetry);
        }

        if (msg.type === "snapshot" && msg.snapshot) {
          const snap = toPlantSnapshot(msg.snapshot);
          if (snap) this.notifySnapshot(snap);
        }

        if (msg.type === "ready" && !settled) {
          if (msg.deviceOnline === false) {
            finish(
              new Error(
                "Server aktif, tapi robot belum terhubung. Nyalakan ESP32 lalu coba lagi."
              )
            );
            return;
          }
          finish();
          return;
        }

        if (msg.type === "error" && msg.message) {
          console.warn("[kira] server:", msg.message);
        }

        if (msg.type === "device_status" && msg.deviceOnline === false) {
          this.manualClose = false;
          this.closeSocket();
          this.notifyClose();
        }
      });

      ws.addEventListener("error", () => {
        if (this.ws !== ws) return;
        finish(
          new Error(
            "Koneksi WebSocket gagal. Periksa URL backend dan jaringan."
          )
        );
      });

      ws.addEventListener("close", () => {
        if (this.ws !== ws) return;
        if (!settled) {
          finish(
            new Error(
              "Koneksi WebSocket ditolak server. Periksa NEXT_PUBLIC_API_URL."
            )
          );
          return;
        }
        if (!this.manualClose) this.notifyClose();
      });
    });
  }

  disconnect() {
    this.manualClose = true;
    const token = this.token;
    this.closeSocket();
    this.token = null;
    setToken(null);
    if (token) {
      // Cabut sesi di server; kegagalan tidak menghalangi pemutusan lokal.
      void fetch(`${API_URL}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
  }

  private closeSocket() {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onclose = null;
    try {
      ws.close();
    } catch {
      /* sudah tertutup */
    }
  }

  private notifyClose() {
    this.closeHandlers.forEach((cb) => {
      try {
        cb();
      } catch {
        /* handler error tidak boleh memutus loop */
      }
    });
  }

  onClose(cb: () => void) {
    this.closeHandlers.add(cb);
  }

  onTelemetry(cb: (t: RobotTelemetry) => void) {
    this.telemetryHandlers.add(cb);
    return () => {
      this.telemetryHandlers.delete(cb);
    };
  }

  private notifyTelemetry(t: RobotTelemetry) {
    this.telemetryHandlers.forEach((cb) => {
      try {
        cb(t);
      } catch {
        /* handler error tidak boleh memutus loop */
      }
    });
  }

  onSnapshot(cb: (s: PlantSnapshot) => void) {
    this.snapshotHandlers.add(cb);
    return () => {
      this.snapshotHandlers.delete(cb);
    };
  }

  private notifySnapshot(s: PlantSnapshot) {
    this.snapshotHandlers.forEach((cb) => {
      try {
        cb(s);
      } catch {
        /* handler error tidak boleh memutus loop */
      }
    });
  }

  send(cmd: RobotCommand) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const payload = {
      ...cmd,
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `cmd-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ts: Date.now(),
    };
    ws.send(JSON.stringify(payload));
  }

  async getLatestSnapshot(): Promise<PlantSnapshot | null> {
    const token = this.token ?? tokenStorage();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_URL}/api/snapshots/latest`, {
      headers,
      cache: "no-store",
    });
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(await readError(res, "Gagal memuat foto."));

    const data = (await res.json()) as SnapshotPayload;
    return toPlantSnapshot(data);
  }
}

export const websocketRobotClient: RobotClient = new WebSocketRobotClient();

/** Tanpa NEXT_PUBLIC_API_URL, UI memakai mock supaya bisa dikembangkan offline. */
export const robotClient: RobotClient = API_URL
  ? websocketRobotClient
  : mockRobotClient;
