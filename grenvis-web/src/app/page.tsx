"use client";

import { useState } from "react";
import Link from "next/link";
import { Gamepad2, Plug, Unplug } from "lucide-react";
import { useRobot } from "@/context/RobotContext";
import ConnectionBadge from "@/components/ConnectionBadge";
import ConnectModal from "@/components/ConnectModal";
import PlantMonitorCard from "@/components/PlantMonitorCard";
import SensorCard from "@/components/SensorCard";

export default function HomePage() {
  const { status, disconnect } = useRobot();
  const [modalOpen, setModalOpen] = useState(false);
  const connected = status === "connected";
  const connecting = status === "connecting";

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:py-12">
      <section className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-4xl font-bold leading-tight text-forest-900 sm:text-5xl">
            Tanaman sekolah, dipantau dari satu layar
          </h1>
          <p className="mt-4 max-w-md text-lg text-forest-800/80">
            Lihat foto terakhir yang diambil robot GRENVIS. Hubungkan robot
            untuk mengendalikannya langsung dari sini.
          </p>
        </div>

        <div className="rounded-2xl border border-forest-900/10 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-forest-900">
              Koneksi robot
            </h2>
            <ConnectionBadge />
          </div>

          <p className="mt-3 text-sm text-stone-600">
            {connected
              ? "Robot siap dikendalikan. Buka controller untuk menggerakkan robot, probe tanah, dan kamera."
              : "Controller baru bisa dipakai setelah robot terhubung. Siapkan password robot."}
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            {connected ? (
              <>
                <Link
                  href="/controller"
                  className="flex items-center gap-2 rounded-full bg-forest-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-forest-800"
                >
                  <Gamepad2 className="size-4" aria-hidden="true" />
                  Buka controller
                </Link>
                <button
                  type="button"
                  onClick={disconnect}
                  className="flex items-center gap-2 rounded-full border border-stone-300 px-5 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
                >
                  <Unplug className="size-4" aria-hidden="true" />
                  Putuskan koneksi
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                disabled={connecting}
                className="flex items-center gap-2 rounded-full bg-forest-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-forest-800 disabled:opacity-50"
              >
                <Plug className="size-4" aria-hidden="true" />
                {connecting ? "Menghubungkan..." : "Hubungkan robot"}
              </button>
            )}
          </div>
        </div>

        <SensorCard />
      </section>

      <PlantMonitorCard />

      <ConnectModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
