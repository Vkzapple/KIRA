"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, RefreshCw } from "lucide-react";
import { robotClient } from "@/lib/robot-client";
import { formatRelative, formatTimestamp } from "@/lib/format";
import type { PlantSnapshot } from "@/lib/types";

type LoadState = "loading" | "ready" | "empty" | "error";

export default function PlantMonitorCard() {
  const [snapshot, setSnapshot] = useState<PlantSnapshot | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setState("loading");
    try {
      const data = await robotClient.getLatestSnapshot();
      setSnapshot(data);
      setState(data ? "ready" : "empty");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Perbarui teks "x menit lalu" tiap 30 detik
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section
      aria-labelledby="monitor-title"
      className="overflow-hidden rounded-2xl border border-forest-900/10 bg-white"
    >
      <div className="flex items-center justify-between gap-3 border-b border-forest-900/10 px-5 py-4">
        <div>
          <h2 id="monitor-title" className="font-display text-xl font-bold text-forest-900">
            Foto terakhir dari robot
          </h2>
          <p className="text-sm text-stone-600">
            Diambil kamera robot saat patroli kebun.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={state === "loading"}
          className="flex items-center gap-2 rounded-full border border-forest-700 px-4 py-2 text-sm font-medium text-forest-800 hover:bg-forest-50 disabled:opacity-50"
        >
          <RefreshCw
            className={`size-4 ${state === "loading" ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Perbarui
        </button>
      </div>

      {state === "loading" && !snapshot && (
        <div className="aspect-[4/3] animate-pulse bg-forest-100" aria-busy="true" />
      )}

      {state === "error" && (
        <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 bg-red-50 px-6 text-center">
          <p className="font-medium text-alert">Foto terakhir gagal dimuat.</p>
          <p className="text-sm text-stone-600">Periksa koneksi internet, lalu tekan Perbarui.</p>
        </div>
      )}

      {state === "empty" && (
        <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 bg-forest-50 px-6 text-center">
          <Camera className="size-8 text-forest-600" aria-hidden="true" />
          <p className="font-medium text-forest-900">Belum ada foto dari robot.</p>
          <p className="text-sm text-stone-600">Foto akan muncul setelah robot selesai patroli pertama.</p>
        </div>
      )}

      {snapshot && state !== "error" && state !== "empty" && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={snapshot.imageUrl}
            alt={`Foto terakhir tanaman ${snapshot.plantName}`}
            className="aspect-[4/3] w-full object-cover"
          />
          <dl className="grid gap-4 px-5 py-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-stone-500">Tanaman</dt>
              <dd className="font-semibold text-forest-900">{snapshot.plantName}</dd>
            </div>
            <div>
              <dt className="text-sm text-stone-500">Waktu pengambilan</dt>
              <dd className="font-semibold text-forest-900">
                <time dateTime={snapshot.capturedAt}>
                  {formatTimestamp(snapshot.capturedAt)}
                </time>
                <span className="block text-sm font-normal text-stone-600">
                  {formatRelative(snapshot.capturedAt, now)}
                </span>
              </dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
