"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";

interface StepButtonProps {
  label: string;
  icon: ReactNode;
  onStep: () => void;
}

/** Klik = satu langkah. Tahan = langkah berulang. */
function StepButton({ label, icon, onStep }: StepButtonProps) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const start = () => {
    stop();
    onStep();
    timer.current = setInterval(onStep, 180);
  };

  useEffect(() => stop, [stop]);

  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      className="flex flex-1 touch-none select-none items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-white/5 bg-olive-800 px-3 py-4 text-sm font-semibold text-cream transition-colors hover:border-gold/40 hover:bg-olive-700 active:bg-olive-900"
    >
      <span className="text-gold">{icon}</span>
      {label}
    </button>
  );
}

interface Props {
  title: string;
  hint: string;
  a: { label: string; icon: ReactNode; onStep: () => void };
  b: { label: string; icon: ReactNode; onStep: () => void };
}

export default function ServoControl({ title, hint, a, b }: Props) {
  return (
    <section className="rounded-3xl border border-white/10 bg-olive-900/50 p-5 shadow-panel">
      <h3 className="font-display text-lg font-bold text-cream">{title}</h3>
      <p className="mt-0.5 text-sm text-cream/60">{hint}</p>
      <div className="mt-4 flex gap-3">
        <StepButton {...a} />
        <StepButton {...b} />
      </div>
    </section>
  );
}
