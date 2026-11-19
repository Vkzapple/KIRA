import type { PlantSnapshot, RobotCommand } from "./types";

/**
 * Kontrak antara UI dan robot.
 * Sekarang diisi versi mock. Nanti cukup buat `websocketRobotClient`
 * yang mengimplementasikan interface ini, lalu ganti export `robotClient`.
 */
export interface RobotClient {
  connect(password: string): Promise<void>;
  disconnect(): void;
  send(cmd: RobotCommand): void;
  /** Dipanggil saat koneksi terputus dari sisi robot/jaringan */
  onClose(cb: () => void): void;
  getLatestSnapshot(): Promise<PlantSnapshot | null>;
}

const MOCK_PASSWORD = process.env.NEXT_PUBLIC_MOCK_PASSWORD ?? "grenvis123";
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

export const robotClient: RobotClient = mockRobotClient;
