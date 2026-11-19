"use client";

import { useRobot } from "@/context/RobotContext";
import type { ConnectionStatus } from "@/lib/types";

const STYLES: Record<
  ConnectionStatus,
  { label: string; dot: string; wrap: string }
> = {
  disconnected: {
    label: "Robot terputus",
    dot: "bg-stone-400",
    wrap: "bg-stone-100 text-stone-700",
  },
  connecting: {
    label: "Menghubungkan...",
    dot: "bg-sun animate-pulse",
    wrap: "bg-amber-50 text-amber-800",
  },
  connected: {
    label: "Robot terhubung",
    dot: "bg-forest-500",
    wrap: "bg-forest-50 text-forest-800",
  },
  error: {
    label: "Gagal terhubung",
    dot: "bg-alert",
    wrap: "bg-red-50 text-red-800",
  },
};

export default function ConnectionBadge() {
  const { status } = useRobot();
  const s = STYLES[status];

  return (
    <span
      role="status"
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${s.wrap}`}
    >
      <span className={`size-2.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}
