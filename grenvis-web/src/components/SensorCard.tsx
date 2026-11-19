"use client";

import { useEffect, useState } from "react";
import { Cog, Radio, Sprout, Wifi } from "lucide-react";
import { API_URL } from "@/lib/robot-client";
import type { RobotTelemetry } from "@/lib/types";

const POLL_MS = 5000;

function Bar({ value, tone }: { value: number; tone: string }) {
  const safe = Math.max(0, Math.min(100, value));
  return (
    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-stone-200">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${safe}%` }} />
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
      className="rounded-2xl border border-forest-900/10 bg-white p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="sensor-title" className="font-display text-lg font-bold text-forest-900">
          Kondisi kebun
        </h2>
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium ${
            data ? "text-forest-700" : "text-stone-500"
          }`}
        >
          <Radio className={`size-3.5 ${data ? "" : "opacity-40"}`} aria-hidden="true" />
          {data ? "Live" : offline ? "Menunggu robot" : "Memuat..."}
        </span>
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="flex items-center gap-1.5 text-sm text-stone-600">
            <Sprout className="size-4 text-forest-600" aria-hidden="true" />
            Kelembapan tanah
          </dt>
          <dd className="mt-1 font-display text-2xl font-bold text-forest-900">
            {data ? `${Math.round(soil)}%` : "—"}
          </dd>
          <Bar value={soil} tone="bg-forest-600" />
        </div>

        <div>
          <dt className="flex items-center gap-1.5 text-sm text-stone-600">
            <Cog className="size-4 text-forest-600" aria-hidden="true" />
            Driver motor HW-039
          </dt>
          <dd className="mt-1 font-display text-2xl font-bold text-forest-900">
            {motorText}
          </dd>
          <Bar
            value={(motorDuty / 255) * 100}
            tone={motor < 0 ? "bg-amber-500" : "bg-forest-600"}
          />
          <p className="mt-1 text-xs text-stone-500">
            BTS7960 &middot; PWM {data ? `${motorDuty}/255` : "—"}
          </p>
        </div>
      </dl>

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-stone-200 pt-3 text-center text-xs text-stone-600 sm:grid-cols-4">
        <div>
          <div className="font-semibold text-forest-900">{data ? `${data.sync}°` : "—"}</div>
          Servo utama
        </div>
        <div>
          <div className="font-semibold text-forest-900">{data ? `${data.aux}°` : "—"}</div>
          Servo aux
        </div>
        <div>
          <div className="font-semibold text-forest-900">
            {data ? `${motorTarget > 0 ? "+" : ""}${motorTarget}` : "—"}
          </div>
          Target motor
        </div>
        <div>
          <div className="flex items-center justify-center gap-1 font-semibold text-forest-900">
            <Wifi className="size-3" aria-hidden="true" />
            {data ? (data.camOnline ? "Kamera siap" : "Kamera off") : "—"}
          </div>
          {data?.camArmed && data.camTarget ? `Target: ${data.camTarget}` : "Status kamera"}
        </div>
      </div>
    </section>
  );
}
