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
  | { type: "camera"; dir: CameraDir };

export interface PlantSnapshot {
  id: string;
  plantName: string;
  imageUrl: string;
  /** Waktu foto diambil, format ISO 8601 */
  capturedAt: string;
}
