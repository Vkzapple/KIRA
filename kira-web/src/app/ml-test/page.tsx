"use client";
import { useState, useRef } from "react";

export default function MLTestPage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
    if (!file) return;
    setLoading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/predict", { method: "POST", body: fd });
    const data = await res.json();
    setResult(data);
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      for (const r of data.results) {
        const [x1,y1,x2,y2] = r.box;
        ctx.strokeStyle = "#d4a373";
        ctx.lineWidth = 4;
        ctx.strokeRect(x1,y1,x2-x1,y2-y1);
        const len = 18;
        ctx.strokeStyle = "#f5ebe0";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x1,y1+len); ctx.lineTo(x1,y1); ctx.lineTo(x1+len,y1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2-len,y1); ctx.lineTo(x2,y1); ctx.lineTo(x2,y1+len); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x1,y2-len); ctx.lineTo(x1,y2); ctx.lineTo(x1+len,y2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2-len,y2); ctx.lineTo(x2,y2); ctx.lineTo(x2,y2-len); ctx.stroke();
        ctx.fillStyle = "#d4a373";
        ctx.font = "bold 16px sans-serif";
        ctx.fillText(`${r.class} ${(r.confidence*100).toFixed(1)}%`, x1+6, y1+22);
      }
    };
    img.src = URL.createObjectURL(file);
    setLoading(false);
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
              Deteksi & <span className="text-gold">diagnosis</span> daun.
            </h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-cream/60">
              Upload foto daun tomat/cabe. KIRA menandai area daun, memprediksi kondisi, dan memberi rekomendasi treatment.
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
                <button
                  type="submit"
                  disabled={loading}
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold px-6 py-3 text-sm font-bold text-ink transition-colors hover:bg-gold-light disabled:opacity-50"
                >
                  {loading ? "Menganalisis..." : "Analisis Gambar"}
                </button>
              </form>

              {result && (
                <div className="mt-6 space-y-3">
                  <h2 className="font-display text-lg font-bold text-cream">Hasil Deteksi</h2>
                  <ul className="space-y-2">
                    {result.results.map((r: any, i: number) => (
                      <li key={i} className="rounded-xl bg-olive-800/60 px-3 py-2">
                        <div className="flex justify-between">
                          <span className="text-cream">{r.class}</span>
                          <span className="font-mono text-gold">{(r.confidence * 100).toFixed(1)}%</span>
                        </div>
                        <p className="text-xs text-cream/60 mt-1">{r.recommendation}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-olive-900/50 p-6 shadow-panel flex items-center justify-center">
            <canvas ref={canvasRef} className="max-w-full rounded-2xl" />
          </div>
        </section>
      </div>
    </main>
  );
}