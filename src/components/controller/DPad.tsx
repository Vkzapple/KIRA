"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Square } from "lucide-react";
import type { MoveDir } from "@/lib/types";

interface Props {
  onMove: (dir: MoveDir) => void;
}

const KEY_MAP: Record<string, MoveDir> = {
  ArrowUp: "forward",
  w: "forward",
  ArrowDown: "backward",
  s: "backward",
  ArrowLeft: "left",
  a: "left",
  ArrowRight: "right",
  d: "right",
};

export default function DPad({ onMove }: Props) {
  const [active, setActive] = useState<MoveDir | null>(null);

  const press = (dir: MoveDir) => {
    setActive(dir);
    onMove(dir);
  };
  const release = () => {
    if (active === null) return;
    setActive(null);
    onMove("stop");
  };

  // Dukungan keyboard (panah / WASD) untuk uji di laptop
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const dir = KEY_MAP[e.key];
      if (!dir || e.repeat) return;
      e.preventDefault();
      setActive(dir);
      onMove(dir);
    };
    const up = (e: KeyboardEvent) => {
      if (!KEY_MAP[e.key]) return;
      setActive(null);
      onMove("stop");
    };
    const blur = () => {
      setActive(null);
      onMove("stop");
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [onMove]);

  const btn = (dir: MoveDir, label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active === dir}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        press(dir);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex size-20 touch-none select-none items-center justify-center rounded-2xl text-white transition-colors sm:size-24 ${
        active === dir ? "bg-forest-900" : "bg-forest-700 hover:bg-forest-600"
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div className="grid w-fit grid-cols-3 gap-3">
      <span />
      {btn("forward", "Maju", <ArrowUp className="size-8" />)}
      <span />
      {btn("left", "Belok kiri", <ArrowLeft className="size-8" />)}
      <button
        type="button"
        aria-label="Berhenti"
        onClick={() => onMove("stop")}
        className="flex size-20 select-none items-center justify-center rounded-2xl bg-sun text-forest-900 hover:brightness-95 sm:size-24"
      >
        <Square className="size-6 fill-current" />
      </button>
      {btn("right", "Belok kanan", <ArrowRight className="size-8" />)}
      <span />
      {btn("backward", "Mundur", <ArrowDown className="size-8" />)}
      <span />
    </div>
  );
}
