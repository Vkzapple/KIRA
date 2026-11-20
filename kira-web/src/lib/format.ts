import type { RobotCommand } from "./types";

export function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "medium",
    timeZone: "Asia/Jakarta",
  }).format(new Date(iso));
}

export function formatRelative(iso: string, now: number = Date.now()): string {
  const diffSec = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat("id", { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86400), "day");
}

export function describeCommand(cmd: RobotCommand): string {
  switch (cmd.type) {
    case "move": {
      const label = {
        forward: "Maju",
        backward: "Mundur",
        left: "Belok kiri",
        right: "Belok kanan",
        stop: "Berhenti",
      }[cmd.dir];
      const speed =
        cmd.speed != null && cmd.dir !== "stop" ? ` · ${cmd.speed}/255` : "";
      return `Gerak: ${label}${speed}`;
    }
    case "probe":
      return cmd.dir === "up" ? "Probe tanah: naik" : "Probe tanah: turun";
    case "camera":
      return cmd.dir === "left" ? "Kamera: putar kiri" : "Kamera: putar kanan";
    case "servo":
      return `Servo: utama ${cmd.sync ?? "-"}°, aux ${cmd.aux ?? "-"}°`;
    case "ai":
      return cmd.armed
        ? `Vision AI: aktif${cmd.target ? ` (${cmd.target})` : ""}`
        : "Vision AI: berhenti";
    case "capture":
      return "Kamera: ambil foto + analisis AI";
  }
}
