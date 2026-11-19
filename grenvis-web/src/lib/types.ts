export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type MoveDir = "forward" | "backward" | "left" | "right" | "stop";
export type ProbeDir = "up" | "down";
export type CameraDir = "left" | "right";

export type RobotCommand =
  | { type: "move"; dir: MoveDir }
  | { type: "probe"; dir: ProbeDir }
  | { type: "camera"; dir: CameraDir }
  | { type: "ai"; armed: boolean; target?: string }
  | { type: "capture" };

export interface PlantSnapshot {
  id: string;
  plantName: string;
  imageUrl: string;
  /** Waktu foto diambil, format ISO 8601 */
  capturedAt: string;
}

/** Kondisi terakhir robot, dikirim ESP32 Dev tiap ~2 detik. */
export interface RobotTelemetry {
  soil: number;
  soilRaw: number;
  rain: number;
  rainRaw: number;
  rainWet: boolean;
  /** Sudut servo CH0+CH1 (bergerak bersamaan). */
  sync: number;
  /** Sudut servo CH2 (independen). */
  aux: number;
  camOnline: boolean;
  camArmed: boolean;
  camBusy: boolean;
  camTarget?: string;
  rssi: number;
  uptime: number;
  createdAt: string;
}
