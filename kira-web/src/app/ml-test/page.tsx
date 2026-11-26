"use client";

import { useEffect, useRef, useState } from "react";
import type { PredictResult } from "@/lib/vision";

export default function MLTestPage() {
  const [result, setResult] = useState<PredictResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!preview || !result) return;

    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);

      const scaleX = img.naturalWidth / (result.width || img.naturalWidth);
      const scaleY = img.naturalHeight / (result.height || img.naturalHeight);

      for (const r of result.results) {
        const x1 = r.box[0] * scaleX;
        const y1 = r.box[1] * scaleY;
        const x2 = r.box[2] * scaleX;
        const y2 = r.box[3] * scaleY;
        const boxWidth = x2 - x1;
        const boxHeight = y2 - y1;

        ctx.strokeStyle = "#d4a373";
        ctx.lineWidth = 4;
        ctx.strokeRect(x1, y1, boxWidth, boxHeight);

        const len = 18;
        ctx.strokeStyle = "#f5ebe0";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x1, y1 + len); ctx.lineTo(x1, y1); ctx.lineTo(x1 + len, y1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2 - len, y1); ctx.lineTo(x2, y1); ctx.lineTo(x2, y1 + len); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x1, y2 - len); ctx.lineTo(x1, y2); ctx.lineTo(x1 + len, y2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2 - len, y2); ctx.lineTo(x2, y2); ctx.lineTo(x2, y2 - len); ctx.stroke();

        const label = `${r.class} ${(r.confidence * 100).toFixed(1)}%`;
        ctx.font = "bold 16px sans-serif";
        const textWidth = ctx.measureText(label).width;
        const labelTop = Math.max(0, y1 - 26);
        ctx.fillStyle = "rgba(14, 14, 16, 0.72)";
        ctx.fillRect(x1, labelTop, textWidth + 12, 26);
        ctx.fillStyle = "#d4a373";
        ctx.fillText(label, x1 + 6, labelTop + 18);
      }
    };
    img.src = preview;

    return () => {
      img.onload = null;
    };
  }, [preview, result]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const form = e.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
    const imageUrl = (form.elements.namedItem("imageUrl") as HTMLInputElement).value.trim();

    if (!file && !imageUrl) {
      setError("Pilih file gambar atau tempel URL gambar terlebih dahulu.");
      return;
    }

    setLoading(true);
    try {
      let res: Response;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        res = await fetch("/api/predict", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/predict", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `Permintaan gagal (${res.status}).`);
      }

      setResult(data);
      if (file) {
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const src = URL.createObjectURL(file);
        objectUrlRef.current = src;
        setPreview(src);
      } else {
        setPreview(imageUrl);
      }
    } catch (err) {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setResult(null);
      setPreview(null);
      setError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-grid-fade bg-grid opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-10">
        <section className="grid items-center gap-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-olive-300/20 bg-olive-800/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-olive-200">
              <span className="size-1.5 rounded-full bg-gold" aria-hidden="true" />
              AI Vision
            </span>
            <h1 className="mt-6 text-balance font-display text-4xl font-bold leading-[1.04] text-cream sm:text-5xl">
              Deteksi & <span className="text-gold">hitung</span> daun.
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-cream/60">
              Upload foto daun cabai atau tempel URL gambar. Roboflow hanya mendeteksi
              kotak daun, lalu model ML cabai menentukan penyakit dan rekomendasinya.
            </p>

            <div className="mt-8 rounded-3xl border border-white/10 bg-olive-900/50 p-6 shadow-panel">
              <form onSubmit={onSubmit} className="space-y-4">
                <label className="block">
                  <span className="text-xs uppercase tracking-[0.12em] text-cream/55">Pilih gambar daun</span>
                  <input
                    type="file"
                    name="file"
                    accept="image/*"
                    className="mt-2 block w-full text-sm text-cream/80 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-gold file:text-ink hover:file:bg-gold-light"
                  />
                </label>

                <div className="flex items-center gap-3 text-xs uppercase tracking-[0.12em] text-cream/40">
                  <span className="h-px flex-1 bg-white/10" />
                  atau
                  <span className="h-px flex-1 bg-white/10" />
                </div>

                <label className="block">
                  <span className="text-xs uppercase tracking-[0.12em] text-cream/55">URL gambar</span>
                  <input
                    type="url"
                    name="imageUrl"
                    placeholder="https://contoh.com/daun.jpg"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-ink/40 px-4 py-2.5 text-sm text-cream placeholder:text-cream/30 focus:border-gold focus:outline-none"
                  />
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold px-6 py-3 text-sm font-bold text-ink transition-colors hover:bg-gold-light disabled:opacity-50"
                >
                  {loading ? "Menganalisis..." : "Analisis Gambar"}
                </button>
              </form>

              {error && (
                <div className="mt-5 rounded-xl border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-cream/80">
                  {error}
                </div>
              )}

              {result && (
                <div className="mt-6 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-display text-lg font-bold text-cream">Hasil Deteksi</h2>
                    <span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-gold">
                      {result.count} daun
                    </span>
                  </div>

                  {result.results.length === 0 ? (
                    <p className="rounded-xl bg-olive-800/60 px-3 py-3 text-sm text-cream/60">
                      Tidak ada objek yang terdeteksi. Coba foto yang lebih jelas atau dekatkan
                      daun ke kamera.
                    </p>
                  ) : (
                    <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                      {result.results.map((r, i) => (
                        <li key={i} className="rounded-xl bg-olive-800/60 px-3 py-2">
                          <div className="flex justify-between gap-3">
                            <span className="text-cream">
                              {i + 1}. {r.class}
                            </span>
                            <span className="font-mono text-gold">{(r.confidence * 100).toFixed(1)}%</span>
                          </div>
                          <p className="text-xs text-cream/60 mt-1">{r.recommendation}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-olive-900/50 p-6 shadow-panel flex min-h-[320px] items-center justify-center">
            {preview ? (
              <canvas ref={canvasRef} className="max-w-full rounded-2xl" />
            ) : (
              <div className="flex flex-col items-center gap-3 text-center text-sm text-cream/40">
                <span className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-xl">
                  🌿
                </span>
                <p>Pratinjau hasil deteksi akan muncul di sini.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
