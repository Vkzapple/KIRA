"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Camera,
  Cpu,
  Gamepad2,
  Plug,
  Sprout,
  Unplug,
} from "lucide-react";
import { useRobot } from "@/context/RobotContext";
import ConnectModal from "@/components/ConnectModal";
import PlantMonitorCard from "@/components/PlantMonitorCard";
import SensorCard from "@/components/SensorCard";

const STEPS = [
  {
    icon: Cpu,
    title: "Nyalakan robot",
    body: "ESP32 Dev dan ESP32-CAM otomatis terhubung ke backend GRENVIS.",
  },
  {
    icon: Plug,
    title: "Hubungkan browser",
    body: "Masukkan password robot sekali, sesi aman tersimpan selama 12 jam.",
  },
  {
    icon: Gamepad2,
    title: "Pantau & kendalikan",
    body: "Lihat foto, kelembapan tanah, lalu gerakkan robot lewat tuas analog.",
  },
];

export default function HomePage() {
  const { status, disconnect } = useRobot();
  const [modalOpen, setModalOpen] = useState(false);
  const connected = status === "connected";
  const connecting = status === "connecting";

  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[620px] bg-grid-fade bg-grid opacity-40 [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 -top-40 size-[520px] rounded-full bg-gold/10 blur-[130px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-40 top-48 size-[420px] rounded-full bg-olive-500/20 blur-[130px]"
      />

      <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-10 lg:pt-16">
        <section className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-olive-300/20 bg-olive-800/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-olive-200">
              <span className="size-1.5 rounded-full bg-gold" aria-hidden="true" />
              Sekolah Adiwiyata
            </span>

            <h1 className="mt-6 text-balance font-display text-4xl font-bold leading-[1.04] text-cream sm:text-5xl lg:text-6xl">
              Tanaman sekolah,{" "}
              <span className="text-gold">dipantau</span> dari satu layar.
            </h1>

            <p className="mt-5 max-w-lg text-lg leading-relaxed text-cream/60">
              Lihat foto terakhir dari robot GRENVIS, cek kelembapan tanah, lalu
              kendalikan robotnya langsung dari browser.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              {connected ? (
                <>
                  <Link
                    href="/controller"
                    className="group inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 text-sm font-bold text-ink transition-colors hover:bg-gold-light"
                  >
                    <Gamepad2 className="size-4" aria-hidden="true" />
                    Buka controller
                    <ArrowRight
                      className="size-4 transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </Link>
                  <button
                    type="button"
                    onClick={disconnect}
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-semibold text-cream/80 transition-colors hover:border-white/30 hover:text-cream"
                  >
                    <Unplug className="size-4" aria-hidden="true" />
                    Putuskan koneksi
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    disabled={connecting}
                    className="group inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 text-sm font-bold text-ink transition-colors hover:bg-gold-light disabled:opacity-50"
                  >
                    <Plug className="size-4" aria-hidden="true" />
                    {connecting ? "Menghubungkan..." : "Hubungkan robot"}
                    <ArrowRight
                      className="size-4 transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </button>
                  <span className="text-sm text-cream/60">
                    Controller terbuka setelah robot terhubung.
                  </span>
                </>
              )}
            </div>

            <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-white/10 pt-6">
              <div>
                <dt className="flex items-center gap-1.5 text-xs uppercase tracking-[0.12em] text-cream/55">
                  <Sprout className="size-3.5 text-olive-300" aria-hidden="true" />
                  Sensor
                </dt>
                <dd className="mt-1.5 font-display text-base font-semibold text-cream">
                  Tanah & servo
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1.5 text-xs uppercase tracking-[0.12em] text-cream/55">
                  <Camera className="size-3.5 text-olive-300" aria-hidden="true" />
                  Kamera
                </dt>
                <dd className="mt-1.5 font-display text-base font-semibold text-cream">
                  Vision AI
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-1.5 text-xs uppercase tracking-[0.12em] text-cream/55">
                  <Cpu className="size-3.5 text-olive-300" aria-hidden="true" />
                  Motor
                </dt>
                <dd className="mt-1.5 font-display text-base font-semibold text-cream">
                  BTS7960
                </dd>
              </div>
            </dl>
          </div>

          <PlantMonitorCard />
        </section>

        <section className="mt-16 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <SensorCard />

          <div className="rounded-3xl border border-white/10 bg-olive-900/50 p-6 shadow-panel">
            <h2 className="font-display text-lg font-bold text-cream">
              Cara kerja
            </h2>
            <p className="mt-1 text-sm text-cream/50">
              Tiga langkah dari robot menyala sampai siap dikendalikan.
            </p>

            <ol className="mt-5 space-y-4">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="flex gap-3">
                  <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-olive-800 text-gold">
                    <Icon className="size-4" aria-hidden="true" />
                    <span className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-ink font-mono text-[10px] font-bold text-gold ring-1 ring-gold/40">
                      {i + 1}
                    </span>
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-cream">{title}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-cream/50">
                      {body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>

      <ConnectModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
