"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { useRobot } from "@/context/RobotContext";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ConnectModal({ open, onClose }: Props) {
  const { connect, status, error, resetError } = useRobot();
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const connecting = status === "connecting";

  useEffect(() => {
    if (open) {
      resetError();
      setPassword("");
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || connecting) return;
    const ok = await connect(password);
    if (ok) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        className="w-full max-w-sm rounded-3xl border border-white/10 bg-olive-900 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="connect-title"
              className="font-display text-xl font-bold text-cream"
            >
              Hubungkan robot
            </h2>
            <p className="mt-1 text-sm text-cream/50">
              Masukkan password robot KIRA untuk mulai mengendalikannya.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-full p-1.5 text-cream/50 transition-colors hover:bg-white/5 hover:text-cream"
          >
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={submit} className="mt-5">
          <label
            htmlFor="robot-password"
            className="text-sm font-medium text-cream/70"
          >
            Password robot
          </label>
          <input
            ref={inputRef}
            id="robot-password"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "connect-error" : undefined}
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-ink/60 px-3 py-2.5 text-cream outline-none transition-colors placeholder:text-cream/30 focus:border-gold/60"
          />
          {error && (
            <p id="connect-error" className="mt-2 text-sm text-alert">
              {error}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-2 text-sm font-semibold text-cream/60 transition-colors hover:bg-white/5 hover:text-cream"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={!password || connecting}
              className="rounded-full bg-gold px-5 py-2 text-sm font-bold text-ink transition-colors hover:bg-gold-light disabled:opacity-40"
            >
              {connecting ? "Menghubungkan..." : "Hubungkan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
