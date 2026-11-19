"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Lock,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import { useRobot } from "@/context/RobotContext";
import DPad from "@/components/controller/DPad";
import ServoControl from "@/components/controller/ServoControl";
import { describeCommand } from "@/lib/format";
import type { MoveDir, RobotCommand } from "@/lib/types";

interface LogEntry {
  id: number;
  text: string;
  time: string;
}

export default function ControllerPage() {
  const { status, send } = useRobot();
  const [log, setLog] = useState<LogEntry[]>([]);
  const connected = status === "connected";

  const dispatch = useCallback(
    (cmd: RobotCommand) => {
      send(cmd);
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
    (dir: MoveDir) => dispatch({ type: "move", dir }),
    [dispatch]
  );

  // Pastikan robot berhenti saat meninggalkan halaman controller
  useEffect(() => {
    return () => send({ type: "move", dir: "stop" });
  }, [send]);

  if (!connected) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-forest-100 text-forest-800">
          <Lock className="size-6" aria-hidden="true" />
        </span>
        <h1 className="mt-5 font-display text-2xl font-bold text-forest-900">
          Hubungkan robot dulu
        </h1>
        <p className="mt-2 text-stone-600">
          Controller hanya aktif saat robot terhubung. Kembali ke beranda lalu
          tekan Hubungkan robot.
        </p>
        <Link
          href="/"
          className="mt-6 rounded-full bg-forest-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-forest-800"
        >
          Ke beranda
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-display text-3xl font-bold text-forest-900">
        Controller robot
      </h1>
      <p className="mt-1 text-stone-600">
        Tahan tombol arah untuk menjalankan robot. Lepas untuk berhenti.
        Di laptop bisa pakai tombol panah atau WASD.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        <section className="flex flex-col items-center gap-4 rounded-2xl border border-forest-900/10 bg-white p-6">
          <h2 className="self-start font-display text-lg font-bold text-forest-900">
            Gerak robot
          </h2>
          <DPad onMove={onMove} />
        </section>

        <div className="flex flex-col gap-6">
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
              icon: <ArrowDownToLine className="size-5" aria-hidden="true" />,
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

          <section className="rounded-2xl border border-forest-900/10 bg-white p-5">
            <h3 className="font-display text-lg font-bold text-forest-900">
              Perintah terakhir
            </h3>
            {log.length === 0 ? (
              <p className="mt-2 text-sm text-stone-600">
                Belum ada perintah. Tekan salah satu tombol di atas.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-stone-100 text-sm">
                {log.map((entry) => (
                  <li key={entry.id} className="flex justify-between gap-4 py-1.5">
                    <span className="text-forest-900">{entry.text}</span>
                    <span className="text-stone-500">{entry.time}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
