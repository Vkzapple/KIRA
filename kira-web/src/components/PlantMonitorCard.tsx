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
      className="overflow-hidden rounded-3xl border border-white/10 bg-olive-900 shadow-panel"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4">
        <div>
          <h2
            id="monitor-title"
            className="font-display text-lg font-bold text-cream"
          >
            Foto terakhir
          </h2>
          <p className="text-sm text-cream/60">
            Diambil kamera robot saat patroli kebun.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={state === "loading"}
          aria-label="Perbarui foto"
          className="group flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-cream/70 transition-colors hover:border-gold/40 hover:text-cream disabled:opacity-40"
        >
          <RefreshCw
            className={`size-4 text-gold ${state === "loading" ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">Perbarui</span>
        </button>
      </div>

      {state === "loading" && !snapshot && (
        <div
          className="aspect-[4/3] animate-pulse bg-olive-800"
          aria-busy="true"
        />
      )}

      {state === "error" && (
        <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 bg-ink/60 px-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-alert/10 text-alert">
            <Camera className="size-6" aria-hidden="true" />
          </span>
          <p className="font-semibold text-cream">Foto terakhir gagal dimuat.</p>
          <p className="text-sm text-cream/50">
            Periksa koneksi internet, lalu tekan Perbarui.
          </p>
        </div>
      )}

      {state === "empty" && (
        <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 bg-ink/40 px-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-olive-800 text-olive-300">
            <Camera className="size-6" aria-hidden="true" />
          </span>
          <p className="font-semibold text-cream">Belum ada foto dari robot.</p>
          <p className="text-sm text-cream/50">
            Foto akan muncul setelah robot selesai patroli pertama.
          </p>
        </div>
      )}

      {snapshot && state !== "error" && state !== "empty" && (
        <div className="relative aspect-[4/3]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={snapshot.imageUrl}
            alt={`Foto terakhir tanaman ${snapshot.plantName}`}
            className="absolute inset-0 size-full object-cover"
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink via-ink/60 to-transparent"
          />
          <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-5">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-gold">
                Tanaman
              </p>
              <p className="font-display text-xl font-bold text-cream">
                {snapshot.plantName}
              </p>
              <p className="mt-0.5 text-xs text-cream/50">
                {formatRelative(snapshot.capturedAt, now)}
              </p>
            </div>
            <time
              dateTime={snapshot.capturedAt}
              className="rounded-full border border-white/10 bg-ink/60 px-3 py-1 font-mono text-[11px] text-cream/60 backdrop-blur"
            >
              {formatTimestamp(snapshot.capturedAt)}
            </time>
          </div>
        </div>
      )}
    </section>
  );
}
