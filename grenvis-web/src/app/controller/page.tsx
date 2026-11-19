"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpToLine,
  Camera,
  Lock,
  RotateCcw,
  RotateCw,
  ScanEye,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import { useRobot } from "@/context/RobotContext";
import AnalogStick from "@/components/controller/AnalogStick";
import ServoControl from "@/components/controller/ServoControl";
import { describeCommand } from "@/lib/format";
import type { MoveDir, RobotCommand } from "@/lib/types";

interface LogEntry {
  id: number;
  text: string;
  time: string;
}

const rangeStyle = (value: number): CSSProperties =>
  ({ "--range-progress": `${(value / 180) * 100}%` }) as CSSProperties;

export default function ControllerPage() {
  const { status, send } = useRobot();
  const [log, setLog] = useState<LogEntry[]>([]);
  const [target, setTarget] = useState("person");
  const [aiArmed, setAiArmed] = useState(false);
  const [syncAngle, setSyncAngle] = useState(90);
  const [auxAngle, setAuxAngle] = useState(90);
  const lastMoveDir = useRef<MoveDir | null>(null);
  const lastMoveLogAt = useRef(0);
  const connected = status === "connected";

  const dispatch = useCallback(
    (cmd: RobotCommand, log = true) => {
      send(cmd);
      if (!log) return;
      const time = new Date().toLocaleTimeString("id-ID", {
        timeZone: "Asia/Jakarta",
      });
      setLog((prev) =>
        [{ id: Date.now() + Math.random(), text: describeCommand(cmd), time }, ...prev].slice(0, 8)
      );
    },
    [send]
  );

  const onMove = useCallback(
    (dir: MoveDir, speed?: number) => {
      const now = Date.now();
      const shouldLog =
        dir === "stop" ||
        dir !== lastMoveDir.current ||
        now - lastMoveLogAt.current > 1500;
      lastMoveDir.current = dir;
      if (shouldLog) lastMoveLogAt.current = now;
      dispatch({ type: "move", dir, speed }, shouldLog);
    },
    [dispatch]
  );

  // Pastikan robot berhenti saat meninggalkan halaman controller
  useEffect(() => {
    return () => send({ type: "move", dir: "stop" });
  }, [send]);

  if (!connected) {
    return (
      <div className="relative mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 py-20 text-center">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold/10 blur-[100px]"
        />
        <span className="relative flex size-16 items-center justify-center rounded-2xl border border-gold/20 bg-olive-900 text-gold shadow-glow">
          <Lock className="size-7" aria-hidden="true" />
        </span>
        <h1 className="relative mt-6 font-display text-2xl font-bold text-cream">
          Hubungkan robot dulu
        </h1>
        <p className="relative mt-2 text-cream/55">
          Controller hanya aktif saat robot terhubung. Kembali ke beranda lalu
          tekan Hubungkan robot.
        </p>
        <Link
          href="/"
          className="relative mt-6 rounded-full bg-gold px-6 py-2.5 text-sm font-bold text-ink transition-colors hover:bg-gold-light"
        >
          Ke beranda
        </Link>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-40 top-0 size-[420px] rounded-full bg-olive-500/20 blur-[130px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 top-40 size-[380px] rounded-full bg-gold/10 blur-[130px]"
      />

      <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-10">
        <header>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
              Kontrol langsung
            </p>
            <span className="inline-flex items-center gap-2 rounded-full border border-olive-300/30 bg-olive-500/15 px-2.5 py-1 text-[11px] font-semibold text-olive-200">
              <Activity className="size-3.5" aria-hidden="true" />
              Siap dikendalikan
            </span>
          </div>
          <h1 className="mt-2 font-display text-3xl font-bold text-cream sm:text-4xl">
            Controller robot
          </h1>
          <p className="mt-2 max-w-2xl text-cream/55">
            Geser tuas ke arah maju atau mundur. Tuas mengunci di posisi
            terakhir, jadi motor terus berjalan sampai tombol Berhenti ditekan.
            Di laptop bisa pakai panah/WASD, Escape untuk berhenti.
          </p>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <section className="flex h-fit flex-col items-center gap-4 rounded-3xl border border-white/10 bg-olive-900/50 p-6 shadow-panel lg:sticky lg:top-24">
            <div className="flex w-full items-center justify-between gap-3">
              <h2 className="font-display text-lg font-bold text-cream">
                Gerak robot
              </h2>
              <span className="rounded-full border border-white/10 bg-ink/50 px-2.5 py-1 font-mono text-[10px] font-semibold text-cream/50">
                L298N · 2 motor
              </span>
            </div>
            <AnalogStick onMove={onMove} />
            <p className="text-center text-xs leading-relaxed text-cream/50">
              Dua motor L298N: maju/mundur dan belok kiri/kanan (pivot).
              Kecepatan mengikuti seberapa jauh tuas digeser.
            </p>
          </section>

          <div className="flex flex-col gap-6">
            <section className="rounded-3xl border border-white/10 bg-olive-900/50 p-5 shadow-panel">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 font-display text-lg font-bold text-cream">
                    <SlidersHorizontal
                      className="size-5 text-gold"
                      aria-hidden="true"
                    />
                    Kalibrasi servo
                  </h3>
                  <p className="mt-1 text-sm text-cream/60">
                    Servo sinkron CH0+CH1 dan servo terpisah CH2 lewat PCA9685.
                    Kalibrasi dilakukan dari web, bukan dari halaman ESP32.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="servo-sync"
                    className="flex items-baseline justify-between text-sm font-medium text-cream/75"
                  >
                    Servo sinkron (CH0 + CH1)
                    <span className="font-mono text-gold">{syncAngle}°</span>
                  </label>
                  <input
                    id="servo-sync"
                    type="range"
                    min={0}
                    max={180}
                    step={1}
                    value={syncAngle}
                    onChange={(e) => setSyncAngle(Number(e.target.value))}
                    onPointerUp={(e) =>
                      dispatch({
                        type: "servo",
                        sync: Number(e.currentTarget.value),
                      })
                    }
                    onKeyUp={(e) =>
                      dispatch({
                        type: "servo",
                        sync: Number(e.currentTarget.value),
                      })
                    }
                    style={rangeStyle(syncAngle)}
                    className="mt-3 w-full cursor-pointer"
                  />
                </div>

                <div>
                  <label
                    htmlFor="servo-aux"
                    className="flex items-baseline justify-between text-sm font-medium text-cream/75"
                  >
                    Servo terpisah (CH2)
                    <span className="font-mono text-gold">{auxAngle}°</span>
                  </label>
                  <input
                    id="servo-aux"
                    type="range"
                    min={0}
                    max={180}
                    step={1}
                    value={auxAngle}
                    onChange={(e) => setAuxAngle(Number(e.target.value))}
                    onPointerUp={(e) =>
                      dispatch({
                        type: "servo",
                        aux: Number(e.currentTarget.value),
                      })
                    }
                    onKeyUp={(e) =>
                      dispatch({
                        type: "servo",
                        aux: Number(e.currentTarget.value),
                      })
                    }
                    style={rangeStyle(auxAngle)}
                    className="mt-3 w-full cursor-pointer"
                  />
                </div>
              </div>
            </section>

            <div className="grid gap-6 sm:grid-cols-2">
              <ServoControl
                title="Servo probe tanah"
                hint="Turunkan probe ke media tanam, angkat kembali setelah selesai."
                a={{
                  label: "Angkat",
                  icon: <ArrowUpToLine className="size-5" aria-hidden="true" />,
                  onStep: () => dispatch({ type: "probe", dir: "up" }),
                }}
                b={{
                  label: "Turunkan",
                  icon: (
                    <ArrowDownToLine className="size-5" aria-hidden="true" />
                  ),
                  onStep: () => dispatch({ type: "probe", dir: "down" }),
                }}
              />

              <ServoControl
                title="Servo kamera"
                hint="Putar kamera ke kiri atau kanan untuk mengarahkan pandangan."
                a={{
                  label: "Putar kiri",
                  icon: <RotateCcw className="size-5" aria-hidden="true" />,
                  onStep: () => dispatch({ type: "camera", dir: "left" }),
                }}
                b={{
                  label: "Putar kanan",
                  icon: <RotateCw className="size-5" aria-hidden="true" />,
                  onStep: () => dispatch({ type: "camera", dir: "right" }),
                }}
              />
            </div>

            <section className="rounded-3xl border border-white/10 bg-olive-900/50 p-5 shadow-panel">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 font-display text-lg font-bold text-cream">
                  <ScanEye className="size-5 text-gold" aria-hidden="true" />
                  Vision AI (Roboflow)
                </h3>
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    aiArmed
                      ? "border-olive-300/30 bg-olive-500/15 text-olive-200"
                      : "border-white/10 bg-white/[0.04] text-cream/50"
                  }`}
                >
                  {aiArmed ? "Memantau" : "Nonaktif"}
                </span>
              </div>
              <p className="mt-2 text-sm text-cream/60">
                ESP32-CAM memindai objek secara berkala dan hanya menyimpan foto
                saat objek target terdeteksi.
              </p>

              <label
                htmlFor="ai-target"
                className="mt-4 block text-sm font-medium text-cream/75"
              >
                Objek target
              </label>
              <input
                id="ai-target"
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="person, bottle"
                className="mt-1.5 w-full max-w-sm rounded-xl border border-white/10 bg-ink/60 px-3 py-2 text-sm text-cream outline-none transition-colors placeholder:text-cream/30 focus:border-gold/60"
              />

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    dispatch({ type: "ai", armed: true, target });
                    setAiArmed(true);
                  }}
                  className="flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-sm font-bold text-ink transition-colors hover:bg-gold-light"
                >
                  <ScanEye className="size-4" aria-hidden="true" />
                  Mulai pantau
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dispatch({ type: "ai", armed: false, target });
                    setAiArmed(false);
                  }}
                  className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-cream/70 transition-colors hover:border-white/30 hover:text-cream"
                >
                  <Square className="size-4" aria-hidden="true" />
                  Hentikan
                </button>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "capture" })}
                  className="flex items-center gap-2 rounded-full border border-gold/40 px-4 py-2 text-sm font-semibold text-gold-light transition-colors hover:bg-gold/10"
                >
                  <Camera className="size-4" aria-hidden="true" />
                  Foto + AI sekarang
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-olive-900/50 p-5 shadow-panel">
              <h3 className="font-display text-lg font-bold text-cream">
                Perintah terakhir
              </h3>
              {log.length === 0 ? (
                <p className="mt-2 text-sm text-cream/60">
                  Belum ada perintah. Gerakkan tuas atau tekan tombol di atas.
                </p>
              ) : (
                <ol className="mt-3 divide-y divide-white/[0.07] text-sm">
                  {log.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between gap-4 py-2"
                    >
                      <span className="flex items-center gap-2 text-cream/80">
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-gold"
                          aria-hidden="true"
                        />
                        {entry.text}
                      </span>
                      <span className="font-mono text-xs text-cream/50">
                        {entry.time}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
