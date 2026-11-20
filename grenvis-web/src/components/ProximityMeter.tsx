"use client";

import { Radar, ShieldAlert, ShieldCheck } from "lucide-react";

/** Jangkauan tampilan meter (cm). */
const RANGE_CM = 150;
/** Di atas ambang ini objek dianggap masih aman. */
const WARN_CM = 50;

type Zone = "unknown" | "safe" | "warn" | "danger";

const CHIP: Record<Zone, string> = {
  unknown: "border-white/10 bg-white/[0.04] text-cream/50",
  safe: "border-olive-300/30 bg-olive-500/15 text-olive-200",
  warn: "border-gold/40 bg-gold/10 text-gold-light",
  danger: "border-alert/40 bg-alert/10 text-red-300",
};

const BAR: Record<Zone, string> = {
  unknown: "bg-white/20",
  safe: "bg-gradient-to-r from-olive-500 to-olive-300",
  warn: "bg-gradient-to-r from-gold-dark via-gold to-gold-light",
  danger: "bg-gradient-to-r from-alert/70 to-alert",
};

const LABEL: Record<Zone, string> = {
  unknown: "Tanpa data",
  safe: "Aman",
  warn: "Dekat",
  danger: "Bahaya",
};

const CAPTION: Record<Zone, string> = {
  unknown: "Menunggu pantulan ultrasonik.",
  safe: "Jalur di depan robot terpantau jelas.",
  warn: "Ada objek di depan, kurangi kecepatan.",
  danger: "Objek sangat dekat — jangan maju.",
};

function zoneOf(known: boolean, distance: number, threshold: number): Zone {
  if (!known) return "unknown";
  if (distance <= threshold) return "danger";
  if (distance <= WARN_CM) return "warn";
  return "safe";
}

interface Props {
  /** Jarak objek di depan (cm). */
  distance?: number;
  /** false bila sensor tidak menerima pantulan. */
  valid?: boolean;
  /** Ambang "bahaya" dari firmware (default 20 cm). */
  threshold?: number;
  /** Versi ringkas untuk kartu di beranda. */
  compact?: boolean;
}

/**
 * Meter jarak HC-SR04: makin dekat objek, makin penuh dan makin merah.
 * Dipakai di beranda (ringkas) dan halaman controller (lengkap).
 */
export default function ProximityMeter({
  distance,
  valid,
  threshold = 20,
  compact = false,
}: Props) {
  const known =
    valid === true && typeof distance === "number" && distance > 0;
  const cm = known ? Math.round(distance) : 0;
  const zone = zoneOf(known, cm, threshold);
  const pct = known
    ? Math.max(4, Math.min(100, 100 - (cm / RANGE_CM) * 100))
    : 0;
  const ZoneIcon =
    zone === "danger" || zone === "warn"
      ? ShieldAlert
      : zone === "safe"
        ? ShieldCheck
        : Radar;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p
            className={`font-display font-bold leading-none text-cream ${
              compact ? "text-3xl" : "text-4xl"
            }`}
          >
            {known ? cm : "—"}
            <span className="ml-1 text-base font-semibold text-cream/50">
              cm
            </span>
          </p>
          <p className="mt-1.5 text-sm text-cream/60">{CAPTION[zone]}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${CHIP[zone]}`}
        >
          <ZoneIcon className="size-3.5" aria-hidden="true" />
          {LABEL[zone]}
        </span>
      </div>

      <div
        className={`relative w-full overflow-hidden rounded-full bg-white/10 ${
          compact ? "mt-3 h-1.5" : "mt-5 h-2.5"
        }`}
        role="meter"
        aria-label="Jarak objek di depan robot"
        aria-valuemin={0}
        aria-valuemax={RANGE_CM}
        aria-valuenow={known ? cm : undefined}
        aria-valuetext={known ? `${cm} sentimeter` : "Tidak ada data"}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${BAR[zone]}`}
          style={{ width: `${pct}%` }}
        />
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-cream/30"
          style={{ left: `${(1 - threshold / RANGE_CM) * 100}%` }}
        />
      </div>

      <div className="mt-2 flex justify-between font-mono text-[10px] text-cream/40">
        <span>0</span>
        <span>{threshold} cm</span>
        <span>100</span>
        <span>{RANGE_CM} cm</span>
      </div>
    </div>
  );
}
