"use client";

import { useRobot } from "@/context/RobotContext";
import type { ConnectionStatus } from "@/lib/types";

const STYLES: Record<
  ConnectionStatus,
  { label: string; dot: string; wrap: string }
> = {
  disconnected: {
    label: "Robot terputus",
    dot: "bg-cream/40",
    wrap: "border-white/10 bg-white/[0.04] text-cream/60",
  },
  connecting: {
    label: "Menghubungkan...",
    dot: "animate-pulse bg-gold",
    wrap: "border-gold/30 bg-gold/10 text-gold-light",
  },
  connected: {
    label: "Robot terhubung",
    dot: "bg-olive-300 shadow-[0_0_10px_rgba(176,190,102,0.8)]",
    wrap: "border-olive-300/30 bg-olive-500/15 text-olive-200",
  },
  error: {
    label: "Gagal terhubung",
    dot: "bg-alert",
    wrap: "border-alert/30 bg-alert/10 text-red-300",
  },
};

export default function ConnectionBadge() {
  const { status } = useRobot();
  const s = STYLES[status];

  return (
    <span
      role="status"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold sm:text-sm ${s.wrap}`}
    >
      <span className={`size-2.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}
