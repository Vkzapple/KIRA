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
      className="fixed inset-0 z-50 flex items-center justify-center bg-forest-900/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="connect-title" className="font-display text-xl font-bold text-forest-900">
              Hubungkan robot
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Masukkan password robot GRENVIS untuk mulai mengendalikannya.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-full p-1.5 text-stone-500 hover:bg-stone-100"
          >
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={submit} className="mt-5">
          <label htmlFor="robot-password" className="text-sm font-medium text-forest-900">
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
            className="mt-1.5 w-full rounded-xl border border-stone-300 px-3 py-2.5 outline-none focus:border-forest-600"
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
              className="rounded-full px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={!password || connecting}
              className="rounded-full bg-forest-700 px-5 py-2 text-sm font-semibold text-white hover:bg-forest-800 disabled:opacity-50"
            >
              {connecting ? "Menghubungkan..." : "Hubungkan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
