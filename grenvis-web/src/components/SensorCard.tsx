"use client";

import { useEffect, useState } from "react";
import { Cog, Radio, Sprout, Wifi } from "lucide-react";
import { API_URL } from "@/lib/robot-client";
import type { RobotTelemetry } from "@/lib/types";

const POLL_MS = 5000;

function Bar({ value, tone }: { value: number; tone: string }) {
  const safe = Math.max(0, Math.min(100, value));
  return (
    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${tone}`}
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}

/** Kartu ringkas kondisi sensor: kelembapan tanah, driver motor HW-039, dan status kamera. */
export default function SensorCard() {
  const [data, setData] = useState<RobotTelemetry | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!API_URL) return;
    let alive = true;

    const load = async () => {
      try {
        const res = await fetch(`${API_URL}/api/telemetry/latest`, {
          cache: "no-store",
        });
        if (!alive) return;
        if (res.status === 204) {
          setData(null);
          setOffline(true);
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        setData((await res.json()) as RobotTelemetry);
        setOffline(false);
      } catch {
        if (alive) setOffline(true);
      }
    };

    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!API_URL) return null;

  const soil = data?.soil ?? 0;
  const motor = data?.motor ?? 0;
  const motorTarget = data?.motorTarget ?? 0;
  const motorDuty = Math.min(255, Math.abs(motor));
  const motorText = !data
    ? "—"
    : motor > 0
      ? `Maju ${motor}`
      : motor < 0
        ? `Mundur ${Math.abs(motor)}`
        : "Berhenti";

  return (
    <section
      aria-labelledby="sensor-title"
      className="rounded-3xl border border-white/10 bg-olive-900/50 p-6 shadow-panel"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2
            id="sensor-title"
            className="font-display text-lg font-bold text-cream"
          >
            Kondisi kebun
          </h2>
          <p className="mt-0.5 text-sm text-cream/50">
            Pembacaan terakhir dari node ESP32.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
            data
              ? "border-olive-300/30 bg-olive-500/15 text-olive-200"
              : "border-white/10 bg-white/[0.04] text-cream/50"
          }`}
        >
          <Radio
            className={`size-3.5 ${data ? "" : "opacity-40"}`}
            aria-hidden="true"
          />
          {data ? "Live" : offline ? "Menunggu robot" : "Memuat..."}
        </span>
      </div>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/5 bg-ink/40 p-4">
          <dt className="flex items-center gap-1.5 text-sm text-cream/50">
            <Sprout className="size-4 text-olive-300" aria-hidden="true" />
            Kelembapan tanah
          </dt>
          <dd className="mt-1 font-display text-3xl font-bold text-cream">
            {data ? `${Math.round(soil)}%` : "—"}
          </dd>
          <Bar value={soil} tone="bg-gradient-to-r from-gold-dark via-gold to-gold-light" />
          <p className="mt-2 text-xs text-cream/50">
            {data ? `ADC ${data.soilRaw}` : "Menunggu data sensor"}
          </p>
        </div>

        <div className="rounded-2xl border border-white/5 bg-ink/40 p-4">
          <dt className="flex items-center gap-1.5 text-sm text-cream/50">
            <Cog className="size-4 text-olive-300" aria-hidden="true" />
            Driver motor HW-039
          </dt>
          <dd className="mt-1 font-display text-3xl font-bold text-cream">
            {motorText}
          </dd>
          <Bar
            value={(motorDuty / 255) * 100}
            tone={
              motor < 0
                ? "bg-gradient-to-r from-alert/70 to-alert"
                : "bg-gradient-to-r from-olive-500 to-olive-300"
            }
          />
          <p className="mt-2 text-xs text-cream/50">
            BTS7960 &middot; PWM {data ? `${motorDuty}/255` : "—"}
          </p>
        </div>
      </dl>

      <div className="mt-5 grid grid-cols-2 gap-4 border-t border-white/[0.07] pt-4 text-center text-xs text-cream/55 sm:grid-cols-4">
        <div>
          <div className="font-mono text-sm font-semibold text-cream">
            {data ? `${data.sync}°` : "—"}
          </div>
          Servo utama
        </div>
        <div>
          <div className="font-mono text-sm font-semibold text-cream">
            {data ? `${data.aux}°` : "—"}
          </div>
          Servo aux
        </div>
        <div>
          <div className="font-mono text-sm font-semibold text-cream">
            {data ? `${motorTarget > 0 ? "+" : ""}${motorTarget}` : "—"}
          </div>
          Target motor
        </div>
        <div>
          <div className="flex items-center justify-center gap-1 font-semibold text-cream">
            <Wifi className="size-3" aria-hidden="true" />
            {data ? (data.camOnline ? "Kamera siap" : "Kamera off") : "—"}
          </div>
          {data?.camArmed && data.camTarget
            ? `Target: ${data.camTarget}`
            : "Status kamera"}
        </div>
      </div>
    </section>
  );
}
