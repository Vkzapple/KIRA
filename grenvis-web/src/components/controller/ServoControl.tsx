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
      className="flex flex-1 touch-none select-none items-center justify-center gap-2 rounded-2xl bg-forest-700 px-4 py-4 font-semibold text-white hover:bg-forest-600 active:bg-forest-900"
    >
      {icon}
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
    <section className="rounded-2xl border border-forest-900/10 bg-white p-5">
      <h3 className="font-display text-lg font-bold text-forest-900">{title}</h3>
      <p className="mt-0.5 text-sm text-stone-600">{hint}</p>
      <div className="mt-4 flex gap-3">
        <StepButton {...a} />
        <StepButton {...b} />
      </div>
    </section>
  );
}
