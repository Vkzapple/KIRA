"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Move, Square } from "lucide-react";
import type { MoveDir } from "@/lib/types";

interface Props {
  onMove: (dir: MoveDir, speed?: number) => void;
  /** Dua motor L298N: sumbu X untuk belok kiri/kanan (pivot). */
  turnEnabled?: boolean;
  maxSpeed?: number;
}

const DEADZONE = 0.12;
const MIN_SEND_MS = 100;
const KNOB_TRAVEL = 84; // piksel, mengikuti ukuran pad 224px dan knob 56px

/**
 * Tuas analog 2 sumbu yang mengunci posisi terakhir (latch).
 * Sumbu Y mengatur maju/mundur dan kecepatan (0..maxSpeed), sumbu X
 * dipakai untuk belok kalau turnEnabled.
 *
 * Setelah tuas dilepas, posisinya tidak kembali ke tengah: motor tetap
 * berjalan pada arah dan kecepatan terakhir sampai tombol Berhenti ditekan.
 */
export default function AnalogStick({
  onMove,
  turnEnabled = true,
  maxSpeed = 255,
}: Props) {
  const padRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const lastSent = useRef(0);
  const lastDir = useRef<MoveDir | null>(null);
  const lastSpeed = useRef(0);
  const posRef = useRef({ x: 0, y: 0 });

  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const updatePosition = useCallback((x: number, y: number) => {
    posRef.current = { x, y };
    setPosition({ x, y });
  }, []);

  const emit = useCallback(
    (x: number, y: number, force = false) => {
      const magnitude = Math.hypot(x, y);
      let dir: MoveDir = "stop";
      let speed = 0;

      if (magnitude >= DEADZONE) {
        if (turnEnabled && Math.abs(x) > Math.abs(y)) {
          dir = x < 0 ? "left" : "right";
          speed = Math.round(Math.min(1, Math.abs(x)) * maxSpeed);
        } else {
          dir = y < 0 ? "forward" : "backward";
          speed = Math.round(Math.min(1, Math.abs(y)) * maxSpeed);
        }
      }

      const now = performance.now();
      const changed =
        dir !== lastDir.current || Math.abs(speed - lastSpeed.current) >= 8;
      const due = now - lastSent.current >= MIN_SEND_MS;

      if (!force) {
        if (dir === "stop" && lastDir.current === "stop") return;
        if (!changed && !due) return;
      }

      lastSent.current = now;
      lastDir.current = dir;
      lastSpeed.current = speed;
      onMove(dir, speed);
    },
    [maxSpeed, onMove, turnEnabled]
  );

  const updateFromEvent = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const pad = padRef.current;
      if (!pad) return;

      const rect = pad.getBoundingClientRect();
      const radius = rect.width / 2;
      let x = (e.clientX - (rect.left + radius)) / radius;
      let y = (e.clientY - (rect.top + radius)) / radius;

      const magnitude = Math.hypot(x, y);
      if (magnitude > 1) {
        x /= magnitude;
        y /= magnitude;
      }

      updatePosition(x, y);
      emit(x, y);
    },
    [emit, updatePosition]
  );

  // Lepas tuas: posisi TETAP di tempat terakhir. Kirim ulang posisi akhir
  // secara paksa supaya perubahan kecil yang tadi di-throttle tetap sampai.
  const release = useCallback(() => {
    draggingRef.current = false;
    setDragging(false);
    emit(posRef.current.x, posRef.current.y, true);
  }, [emit]);

  const stop = useCallback(() => {
    draggingRef.current = false;
    setDragging(false);
    updatePosition(0, 0);
    emit(0, 0, true);
  }, [emit, updatePosition]);

  // Dukungan keyboard: panah/WASD menggeser tuas dan ikut terkunci.
  // Escape atau spasi menghentikan motor.
  useEffect(() => {
    const keyDir = (key: string): MoveDir | null => {
      switch (key) {
        case "ArrowUp":
        case "w":
        case "W":
          return "forward";
        case "ArrowDown":
        case "s":
        case "S":
          return "backward";
        case "ArrowLeft":
        case "a":
        case "A":
          return turnEnabled ? "left" : null;
        case "ArrowRight":
        case "d":
        case "D":
          return turnEnabled ? "right" : null;
        default:
          return null;
      }
    };

    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " ") {
        e.preventDefault();
        stop();
        return;
      }
      const dir = keyDir(e.key);
      if (!dir || e.repeat) return;
      e.preventDefault();
      // Tombol arah = tuas penuh ke arah itu (kecepatan maksimum).
      const x = dir === "left" ? -1 : dir === "right" ? 1 : 0;
      const y = dir === "forward" ? -1 : dir === "backward" ? 1 : 0;
      updatePosition(x, y);
      emit(x, y, true);
    };

    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [emit, stop, turnEnabled, updatePosition]);

  // Jangan tinggalkan motor berputar kalau komponen dilepas.
  useEffect(() => () => emit(0, 0, true), [emit]);

  const magnitude = Math.min(1, Math.hypot(position.x, position.y));
  const speedPct = Math.round(magnitude * 100);
  const moving = magnitude >= DEADZONE;
  const direction = !moving
    ? "Netral"
    : turnEnabled && Math.abs(position.x) > Math.abs(position.y)
      ? position.x < 0
        ? "Belok kiri"
        : "Belok kanan"
      : position.y < 0
        ? "Maju"
        : "Mundur";

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        ref={padRef}
        role="application"
        aria-label="Tuas analog gerak robot"
        className={`relative size-56 touch-none select-none rounded-full border border-white/10 bg-gradient-to-b from-olive-800 to-ink shadow-[inset_0_2px_28px_rgba(0,0,0,0.65)] transition-shadow ${
          dragging ? "ring-4 ring-gold/25" : ""
        }`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          setDragging(true);
          updateFromEvent(e);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) updateFromEvent(e);
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <span className="pointer-events-none absolute left-1/2 top-6 bottom-6 w-px -translate-x-1/2 bg-cream/10" />
        <span className="pointer-events-none absolute left-6 right-6 top-1/2 h-px -translate-y-1/2 bg-cream/10" />
        <span className="pointer-events-none absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cream/25" />
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-gold-light to-gold text-ink shadow-[0_10px_30px_-6px_rgba(205,129,23,0.7)] transition-transform duration-75"
          style={{
            transform: `translate(calc(-50% + ${position.x * KNOB_TRAVEL}px), calc(-50% + ${position.y * KNOB_TRAVEL}px))`,
          }}
        >
          <Move className="size-6" aria-hidden="true" />
        </span>
      </div>

      <div className="text-center">
        <p className="flex items-center justify-center gap-2 text-sm font-semibold text-cream">
          {moving && (
            <span className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-gold-light">
              Terkunci
            </span>
          )}
          {direction}
          <span className="font-mono text-gold">· {speedPct}%</span>
        </p>
        <p className="mt-1.5 max-w-56 text-xs leading-relaxed text-cream/60">
          Tuas mengunci di posisi terakhir: motor terus berjalan sampai Anda
          menekan Berhenti. Semakin jauh dari tengah, semakin cepat.
        </p>
        {!turnEnabled && (
          <p className="mt-1 max-w-56 text-xs text-cream/50">
            Belok nonaktif.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={stop}
        disabled={!moving}
        className="flex items-center gap-2 rounded-full bg-alert px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-alert/90 disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-cream/50"
      >
        <Square className="size-4" aria-hidden="true" />
        Berhenti
      </button>
    </div>
  );
}
