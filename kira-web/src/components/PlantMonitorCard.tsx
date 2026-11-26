"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, ScanSearch } from "lucide-react";
import { API_URL, robotClient } from "@/lib/robot-client";
import { formatRelative, formatTimestamp } from "@/lib/format";
import type { PlantSnapshot } from "@/lib/types";
import type { PredictResult } from "@/lib/vision";

type LoadState = "loading" | "ready" | "empty" | "error";
type AnalysisState = "idle" | "analyzing" | "ready" | "error";

/** Deteksi baru dari ESP32-CAM akan dianalisis ulang otomatis. */
const POLL_INTERVAL_MS = 15_000;

export default function PlantMonitorCard() {
  const [snapshot, setSnapshot] = useState<PlantSnapshot | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [now, setNow] = useState(() => Date.now());

  const [analysis, setAnalysis] = useState<PredictResult | null>(null);
  const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const analyzedIdRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);

  const load = useCallback(async (silent = false) => {
    if (!silent) setState("loading");
    try {
      const data = await robotClient.getLatestSnapshot();
      setNow(Date.now());
      setSnapshot(data);
      setState(data ? "ready" : "empty");
    } catch {
      if (!silent) setState("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Foto baru dari ESP32-CAM via WebSocket (event `snapshot`).
  useEffect(
    () =>
      robotClient.onSnapshot((next) => {
        setNow(Date.now());
        setSnapshot(next);
        setState("ready");
      }),
    []
  );

  // Cadangan: backend menyimpan foto walau tab belum terhubung ke WebSocket.
  useEffect(() => {
    const id = setInterval(() => {
      void load(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Perbarui teks "x menit lalu" tiap 30 detik
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const analyze = useCallback(
    async (snap: PlantSnapshot, force = false) => {
      if (!API_URL) return;

      // Backend sudah menganalisis foto ini lewat ML service; pakai hasilnya
      // supaya tidak memanggil model dua kali.
      const embedded = snap.analysis;
      if (
        !force &&
        embedded &&
        Array.isArray(embedded.results) &&
        embedded.results.length > 0
      ) {
        // Batalkan hasil /api/predict yang mungkin masih berjalan.
        requestSeqRef.current += 1;
        analyzedIdRef.current = snap.id;
        setAnalysis({
          width: embedded.width,
          height: embedded.height,
          count: embedded.results.length,
          results: embedded.results,
        });
        setAnalysisState("ready");
        setAnalysisError(null);
        return;
      }

      if (!force && analyzedIdRef.current === snap.id) return;

      analyzedIdRef.current = snap.id;
      const seq = ++requestSeqRef.current;
      setAnalysisState("analyzing");
      setAnalysisError(null);
      setAnalysis(null);

      try {
        let res: Response;
        try {
          // Ambil byte foto dari backend, lalu kirim sebagai file. Cara ini
          // tetap bekerja walau storage backend hanya bisa diakses di LAN.
          const imageRes = await fetch(snap.imageUrl, { cache: "no-store" });
          if (!imageRes.ok) throw new Error(`HTTP ${imageRes.status}`);
          const blob = await imageRes.blob();
          const fd = new FormData();
          fd.append(
            "file",
            new File([blob], `snapshot-${snap.id}.jpg`, {
              type: blob.type || "image/jpeg",
            })
          );
          res = await fetch("/api/predict", { method: "POST", body: fd });
        } catch {
          // Fallback: biarkan server/Roboflow mengambil dari URL publik.
          res = await fetch("/api/predict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageUrl: snap.imageUrl }),
          });
        }

        const data = (await res.json()) as PredictResult & { error?: string };
        if (seq !== requestSeqRef.current) return;
        if (!res.ok) {
          throw new Error(data?.error ?? `Analisis gagal (${res.status}).`);
        }

        setAnalysis(data);
        setAnalysisState("ready");
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        analyzedIdRef.current = null;
        setAnalysisState("error");
        setAnalysisError(
          err instanceof Error ? err.message : "Analisis model ML gagal."
        );
      }
    },
    []
  );

  useEffect(() => {
    if (snapshot) {
      void analyze(snapshot);
      return;
    }
    analyzedIdRef.current = null;
    setAnalysis(null);
    setAnalysisState("idle");
    setAnalysisError(null);
  }, [snapshot, analyze]);

  const analysisWidth = analysis?.width ?? 0;
  const analysisHeight = analysis?.height ?? 0;
  const hasBoxes =
    analysisWidth > 0 &&
    analysisHeight > 0 &&
    (analysis?.results.length ?? 0) > 0;

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
            Dikirim ESP32-CAM saat ada anomali, dianalisis otomatis.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
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
            Foto dikirim otomatis setelah ESP32-CAM mendeteksi anomali.
          </p>
        </div>
      )}

      {snapshot && state !== "error" && state !== "empty" && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={snapshot.imageUrl}
            alt={`Foto terakhir tanaman ${snapshot.plantName}`}
            className="block w-full"
          />

          {hasBoxes && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              {analysis!.results.map((r, i) => {
                const left = (r.box[0] / analysisWidth) * 100;
                const top = (r.box[1] / analysisHeight) * 100;
                const width = ((r.box[2] - r.box[0]) / analysisWidth) * 100;
                const height = ((r.box[3] - r.box[1]) / analysisHeight) * 100;
                return (
                  <div
                    key={i}
                    className="absolute rounded-sm border-2 border-gold/90 shadow-[0_0_0_1px_rgba(14,14,16,0.6)]"
                    style={{
                      left: `${left}%`,
                      top: `${top}%`,
                      width: `${width}%`,
                      height: `${height}%`,
                    }}
                  >
                    <span className="absolute left-0 top-0 whitespace-nowrap rounded-br bg-ink/80 px-1.5 py-0.5 text-[10px] font-semibold text-gold backdrop-blur">
                      {r.class} · {(r.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {analysisState === "analyzing" && (
            <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-ink/70 px-2.5 py-1 text-[11px] font-semibold text-cream/80 backdrop-blur">
              <Loader2 className="size-3 animate-spin text-gold" aria-hidden="true" />
              Menganalisis…
            </span>
          )}

          {snapshot.class && (
            <span className="absolute right-3 top-3 max-w-[60%] truncate rounded-full border border-gold/30 bg-gold/15 px-2.5 py-1 text-[11px] font-semibold text-gold backdrop-blur">
              Pemicu: {snapshot.class}
              {typeof snapshot.confidence === "number" &&
                ` · ${(snapshot.confidence * 100).toFixed(0)}%`}
            </span>
          )}

          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-ink via-ink/60 to-transparent"
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

      <div className="border-t border-white/[0.07] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-cream/55">
            <ScanSearch className="size-3.5 text-gold" aria-hidden="true" />
            Analisis Model ML
          </span>

          {analysisState === "ready" && (
            <span className="rounded-full bg-gold/15 px-2.5 py-0.5 font-mono text-[11px] font-bold text-gold">
              {analysis?.count ?? 0} daun
            </span>
          )}

          {(analysisState === "ready" || analysisState === "error") &&
            snapshot && (
              <button
                type="button"
                onClick={() => analyze(snapshot, true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold text-cream/70 transition-colors hover:border-gold/40 hover:text-cream"
              >
                <RefreshCw className="size-3" aria-hidden="true" />
                Ulangi
              </button>
            )}
        </div>

        {!snapshot && (
          <p className="mt-2 text-sm text-cream/45">
            Menunggu foto baru dari ESP32-CAM.
          </p>
        )}

        {snapshot && analysisState === "idle" && !API_URL && (
          <p className="mt-2 text-sm text-cream/45">
            Analisis tersedia saat terhubung ke backend KIRA.
          </p>
        )}

        {snapshot && analysisState === "analyzing" && (
          <p className="mt-2 text-sm text-cream/55">
            Roboflow mendeteksi objek, model ML cabai mengklasifikasikan daun…
          </p>
        )}

        {analysisState === "error" && (
          <p className="mt-2 rounded-xl border border-alert/30 bg-alert/10 px-3 py-2 text-sm text-cream/75">
            {analysisError}
          </p>
        )}

        {analysisState === "ready" && analysis && (
          <div className="mt-3 space-y-2">
            {analysis.results.length === 0 ? (
              <p className="text-sm text-cream/50">
                Tidak ada objek yang terdeteksi pada foto ini.
              </p>
            ) : (
              <ul className="max-h-36 space-y-1.5 overflow-y-auto pr-1">
                {analysis.results.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-lg bg-olive-800/60 px-2.5 py-1.5"
                  >
                    <span className="truncate text-sm text-cream/85">
                      {r.class}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-gold">
                      {(r.confidence * 100).toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {analysis.results[0] && (
              <p className="text-xs leading-relaxed text-cream/45">
                {analysis.results[0].recommendation}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
