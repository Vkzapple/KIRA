export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type MoveDir = "forward" | "backward" | "left" | "right" | "stop";
export type ProbeDir = "up" | "down";
export type CameraDir = "left" | "right";

export type RobotCommand =
  | { type: "move"; dir: MoveDir; speed?: number }
  | { type: "probe"; dir: ProbeDir }
  | { type: "camera"; dir: CameraDir }
  | { type: "servo"; sync?: number; aux?: number }
  | { type: "ai"; armed: boolean; target?: string }
  | { type: "capture" };

export interface PlantSnapshot {
  id: string;
  plantName: string;
  imageUrl: string;
  /** Waktu foto diambil, format ISO 8601 */
  capturedAt: string;
  /** Class pemicu dari Roboflow di ESP32-CAM (mis. Tomato___Late_blight). */
  class?: string;
  /** Confidence pemicu (0-1). */
  confidence?: number;
}

/** Kondisi terakhir robot, dikirim ESP32 Dev tiap ~2 detik. */
export interface RobotTelemetry {
  soil: number;
  soilRaw: number;
  /** Jarak objek di depan dari HC-SR04 (cm). 0 bila tidak ada pantulan. */
  distance?: number;
  /** false bila sensor ultrasonik tidak menerima pantulan. */
  distanceValid?: boolean;
  /** true bila objek lebih dekat dari ambang firmware (default 20 cm). */
  obstacle?: boolean;
  /** Sudut servo CH0+CH1 (bergerak bersamaan). */
  sync: number;
  /** Sudut servo CH2 (independen). */
  aux: number;
  /** Duty motor L298N kiri: positif maju, negatif mundur, 0 berhenti. */
  motor?: number;
  /** Target duty yang sedang dituju motor kiri. */
  motorTarget?: number;
  /** Duty motor L298N kiri (kanal A). */
  motorLeft?: number;
  /** Duty motor L298N kanan (kanal B). */
  motorRight?: number;
  /** Target duty motor kiri. */
  motorLeftTarget?: number;
  /** Target duty motor kanan. */
  motorRightTarget?: number;
  camOnline: boolean;
  camArmed: boolean;
  camBusy: boolean;
  camTarget?: string;
  rssi: number;
  uptime: number;
  createdAt: string;
}
