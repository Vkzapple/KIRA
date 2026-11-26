"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Camera,
  Eye,
  EyeOff,
  Lock,
  Play,
  RefreshCw,
  ScanEye,
  Square,
  Video,
  VideoOff,
} from "lucide-react";
import { useRobot } from "@/context/RobotContext";
import { API_URL, robotClient } from "@/lib/robot-client";
import {
  diagnose,
  type CamFrameInfo,
  type CamResult,
  type CamStatus,
} from "@/lib/cam";

interface LogLine {
  id: number;
  time: string;
  kind: "info" | "ai" | "warn" | "error";
  text: string;
}

const MAX_LOG = 80;
const PREVIEW_KEEPALIVE_MS = 10_000;

const timeNow = () =>
  new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });

const chip = (on: boolean | undefined, good = true) =>
  on === undefined
    ? "border-white/10 bg-white/5 text-cream/50"
    : on === good
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      : "border-white/10 bg-white/5 text-cream/50";

function Chip({
  label,
  on,
  good = true,
}: {
  label: string;
  on?: boolean;
  good?: boolean;
}) {
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-semibold ${chip(on, good)}`}
    >
      {label}
    </span>
  );
}

export default function CameraDebugPage() {
  const { status, send, telemetry } = useRobot();
  const connected = status === "connected";

  const [token, setToken] = useState<string | null>(null);
  const [streamKey, setStreamKey] = useState(0);
  const [streamError, setStreamError] = useState(false);
  const [previewOn, setPreviewOn] = useState(true);
  const [fps, setFps] = useState(2);
  const [showBoxes, setShowBoxes] = useState(true);
  const [target, setTarget] = useState("");

  const [frame, setFrame] = useState<CamFrameInfo | null>(null);
  const [result, setResult] = useState<CamResult | null>(null);
  const [camStatus, setCamStatus] = useState<CamStatus | null>(null);
  const [clientFps, setClientFps] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [log, setLog] = useState<LogLine[]>([]);

  const frameTimes = useRef<number[]>([]);
  const logId = useRef(0);
  const lastHttp = useRef<number | null>(null);

  const addLog = useCallback((kind: LogLine["kind"], text: string) => {
    setLog((prev) =>
      [{ id: ++logId.current, time: timeNow(), kind, text }, ...prev].slice(
        0,
        MAX_LOG,
      ),
    );
  }, []);

  // Token sesi untuk <img src> MJPEG
  useEffect(() => {
    if (connected) setToken(robotClient.getToken());
  }, [connected]);

  // Ambil state awal (hasil AI + status terakhir) dari backend
  const loadState = useCallback(async () => {
    const t = robotClient.getToken();
    if (!t) return;
    try {
      const res = await fetch(`${API_URL}/api/cam/state`, {
        headers: { Authorization: `Bearer ${t}` },
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        result?: CamResult;
        status?: CamStatus;
      };
      if (data.result) setResult(data.result);
      if (data.status) setCamStatus(data.status);
    } catch {
      /* diabaikan, WebSocket tetap mengisi data */
    }
  }, []);

  useEffect(() => {
    if (connected) void loadState();
  }, [connected, loadState]);

  // Semua pesan WebSocket terkait kamera
  useEffect(() => {
    if (!connected) return;
    return robotClient.onMessage((msg) => {
      switch (msg.type) {
        case "cam_frame": {
          const f = msg as unknown as CamFrameInfo;
          setFrame(f);
          const t = Date.now();
          const arr = frameTimes.current;
          arr.push(t);
          while (arr.length && t - arr[0] > 5000) arr.shift();
          setClientFps(arr.length / 5);
          break;
        }
        case "cam_result": {
          const r = msg as unknown as CamResult;
          setResult(r);
          const d = diagnose(r);
          addLog(
            r.ok ? "ai" : "error",
            `scan #${r.id}: HTTP ${r.http} · ${r.ms} ms · ${r.n} deteksi${
              r.matched ? ` · TARGET ${r.best} ${Math.round(r.conf * 100)}%` : ""
            }${r.err ? ` · ${r.err}` : ""}`,
          );
          if (d && d.level !== "ok" && lastHttp.current !== r.http) {
            addLog(d.level === "bad" ? "error" : "warn", d.text);
          }
          lastHttp.current = r.http;
          break;
        }
        case "cam_status": {
          const s = (msg as { status?: CamStatus }).status;
          if (s) setCamStatus(s);
          break;
        }
        case "cam_log":
          addLog("info", String(msg.msg ?? ""));
          break;
        case "device_status":
          addLog(
            msg.online ? "info" : "warn",
            `perangkat ${String(msg.deviceId ?? "?")} ${msg.online ? "online" : "offline"}`,
          );
          break;
        case "detection":
          addLog("ai", "deteksi tersimpan di backend");
          break;
      }
    });
  }, [connected, addLog]);

  // Preview: kirim keepalive tiap 10 dtk; firmware mematikan sendiri bila berhenti
  useEffect(() => {
    if (!connected || !previewOn) return;
    send({ type: "preview", on: true, fps });
    const id = setInterval(
      () => send({ type: "preview", on: true, fps }),
      PREVIEW_KEEPALIVE_MS,
    );
    return () => {
      clearInterval(id);
      send({ type: "preview", on: false });
    };
  }, [connected, previewOn, fps, send]);

  // Tick untuk umur frame
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const streamUrl = useMemo(() => {
    if (!API_URL || !token) return null;
    return `${API_URL}/api/cam/stream?token=${encodeURIComponent(token)}&k=${streamKey}`;
  }, [token, streamKey]);

  const frameW = frame?.w || result?.w || 640;
  const frameH = frame?.h || result?.h || 480;
  const frameAge = frame ? Math.max(0, Math.round((now - frame.ts) / 1000)) : null;
  const stale = !!result && !!frame && result.id !== frame.id;
  const diag = diagnose(result);
  const camOnline = telemetry?.camOnline;

  if (!connected) {
    return (
      <div className="relative mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-4 py-20 text-center">
        <span className="relative flex size-16 items-center justify-center rounded-2xl border border-gold/20 bg-olive-900 text-gold shadow-glow">
          <Lock className="size-7" aria-hidden="true" />
        </span>
        <h1 className="relative mt-6 font-display text-2xl font-bold text-cream">
          Hubungkan robot dulu
        </h1>
        <p className="relative mt-2 text-cream/55">
          Halaman debug kamera aktif saat robot terhubung. Kembali ke beranda
          lalu tekan Hubungkan robot.
        </p>
        <Link
          href="/"
          className="relative mt-6 rounded-full bg-gold px-5 py-2.5 text-sm font-semibold text-ink"
        >
          Ke beranda
        </Link>
      </div>
    );
  }

  const btn =
    "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-white/10";
  const btnGold =
    "inline-flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-cream">
            Debug Kamera
          </h1>
          <p className="text-sm text-cream/55">
            Tampilan realtime ESP32-CAM dan kotak deteksi Roboflow untuk
            troubleshooting.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip label={camOnline ? "CAM online" : "CAM offline"} on={camOnline} />
          <Chip
            label={camStatus?.armed ? "Auto-scan ON" : "Auto-scan OFF"}
            on={camStatus?.armed}
          />
          <Chip
            label={camStatus?.busy ? "Sedang scan" : "Idle"}
            on={camStatus?.busy}
          />
          <Chip
            label={camStatus?.preview ? "Preview ON" : "Preview OFF"}
            on={camStatus?.preview}
          />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ---------- Viewer ---------- */}
        <section className="space-y-4">
          <div
            className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-950"
            style={{ aspectRatio: `${frameW} / ${frameH}` }}
          >
            {streamUrl && !streamError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={streamKey}
                src={streamUrl}
                alt="Stream ESP32-CAM"
                className="absolute inset-0 size-full object-fill"
                onLoad={() => setStreamError(false)}
                onError={() => setStreamError(true)}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-cream/45">
                <VideoOff className="size-8" aria-hidden="true" />
                <p className="text-sm">
                  {streamError
                    ? "Stream terputus atau belum ada frame."
                    : "Menunggu token sesi…"}
                </p>
                <button
                  type="button"
                  className={btn}
                  onClick={() => {
                    setStreamError(false);
                    setStreamKey((k) => k + 1);
                  }}
                >
                  <RefreshCw className="size-4" aria-hidden="true" /> Muat ulang
                  stream
                </button>
              </div>
            )}

            {showBoxes && result && result.preds.length > 0 && (
              <svg
                viewBox={`0 0 ${result.w || frameW} ${result.h || frameH}`}
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 size-full"
                aria-label="Kotak deteksi"
              >
                {result.preds.map((p, i) => {
                  const color = p.t ? "#34d399" : "#fbbf24";
                  const fs = Math.max(11, (result.h || frameH) / 24);
                  return (
                    <g key={i} opacity={stale ? 0.45 : 1}>
                      <rect
                        x={p.x - p.w / 2}
                        y={p.y - p.h / 2}
                        width={p.w}
                        height={p.h}
                        fill="none"
                        stroke={color}
                        strokeWidth={Math.max(2, (result.w || frameW) / 220)}
                        strokeDasharray={stale ? "8 6" : undefined}
                      />
                      <text
                        x={p.x - p.w / 2 + 4}
                        y={Math.max(fs + 2, p.y - p.h / 2 - 4)}
                        fontSize={fs}
                        fontWeight={700}
                        fill={color}
                        stroke="#000"
                        strokeWidth={fs / 8}
                        paintOrder="stroke"
                      >
                        {p.c} {Math.round(p.cf * 100)}%
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}

            <div className="absolute left-3 top-3 flex flex-wrap gap-2 text-[11px] font-semibold">
              <span className="rounded-md bg-black/60 px-2 py-1 text-cream">
                {frame ? `frame #${frame.id} · ${frame.src}` : "belum ada frame"}
              </span>
              {stale && showBoxes && (
                <span className="rounded-md bg-amber-500/80 px-2 py-1 text-black">
                  kotak dari scan #{result?.id} (frame lama)
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-cream/60">
            <span>{clientFps.toFixed(1)} fps diterima</span>
            <span>·</span>
            <span>{frame ? `${(frame.size / 1024).toFixed(1)} KB` : "-"}</span>
            <span>·</span>
            <span>
              {frameW}×{frameH}
            </span>
            <span>·</span>
            <span>
              umur frame {frameAge === null ? "-" : `${frameAge} dtk`}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={previewOn ? btnGold : btn}
              onClick={() => setPreviewOn((v) => !v)}
            >
              {previewOn ? (
                <Video className="size-4" aria-hidden="true" />
              ) : (
                <VideoOff className="size-4" aria-hidden="true" />
              )}
              {previewOn ? "Preview nyala" : "Preview mati"}
            </button>
            <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream">
              fps
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="rounded bg-ink px-1 text-cream"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={btn}
              onClick={() => setShowBoxes((v) => !v)}
            >
              {showBoxes ? (
                <Eye className="size-4" aria-hidden="true" />
              ) : (
                <EyeOff className="size-4" aria-hidden="true" />
              )}
              Kotak {showBoxes ? "tampil" : "sembunyi"}
            </button>
            <button
              type="button"
              className={btnGold}
              onClick={() => {
                send({ type: "capture" });
                addLog("info", "scan AI manual diminta");
              }}
            >
              <ScanEye className="size-4" aria-hidden="true" /> Scan AI sekarang
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => {
                send({ type: "cam", cmd: "arm", target: target || undefined });
                addLog("info", "auto-scan dinyalakan");
              }}
            >
              <Play className="size-4" aria-hidden="true" /> Auto-scan
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => {
                send({ type: "cam", cmd: "stop" });
                addLog("info", "auto-scan dihentikan");
              }}
            >
              <Square className="size-4" aria-hidden="true" /> Stop
            </button>
          </div>

          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!target.trim()) return;
              send({ type: "cam", cmd: "target", target: target.trim() });
              addLog("info", `target diubah: ${target.trim()}`);
            }}
          >
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={camStatus?.target || "target class, pisahkan koma"}
              className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-cream placeholder:text-cream/30"
            />
            <button type="submit" className={btn}>
              Terapkan target
            </button>
          </form>
        </section>

        {/* ---------- Sidebar ---------- */}
        <aside className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-cream">
              <Camera className="size-4" aria-hidden="true" /> Hasil AI terakhir
            </h2>
            {result ? (
              <div className="mt-3 space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2 text-cream/70">
                  <span>
                    HTTP{" "}
                    <b className={result.http === 200 ? "text-emerald-300" : "text-red-300"}>
                      {result.http}
                    </b>
                  </span>
                  <span>
                    Waktu <b className="text-cream">{result.ms} ms</b>
                  </span>
                  <span>
                    Deteksi <b className="text-cream">{result.n}</b>
                  </span>
                  <span>
                    Cocok{" "}
                    <b className={result.matched ? "text-emerald-300" : "text-cream"}>
                      {result.matched ? "ya" : "tidak"}
                    </b>
                  </span>
                </div>
                <p className="text-xs text-cream/50">
                  Target: <span className="text-cream/80">{result.target || "-"}</span>
                </p>
                {diag && (
                  <p
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      diag.level === "ok"
                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                        : diag.level === "warn"
                          ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                          : "border-red-400/30 bg-red-400/10 text-red-200"
                    }`}
                  >
                    {diag.text}
                  </p>
                )}
                {result.preds.length > 0 && (
                  <ul className="space-y-1 text-xs">
                    {result.preds.map((p, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-2 rounded-md bg-white/5 px-2 py-1"
                      >
                        <span className={p.t ? "text-emerald-300" : "text-cream/80"}>
                          {p.c}
                        </span>
                        <span className="text-cream/60">
                          {Math.round(p.cf * 100)}% · {p.w}×{p.h}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-cream/45">
                Belum ada hasil. Tekan “Scan AI sekarang”.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-cream">
              <Activity className="size-4" aria-hidden="true" /> Kesehatan ESP32-CAM
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-cream/60">
              <dt>WiFi RSSI</dt>
              <dd className="text-cream">{camStatus?.rssi ?? result?.rssi ?? "-"} dBm</dd>
              <dt>Heap bebas</dt>
              <dd className="text-cream">
                {camStatus?.heap != null ? `${Math.round(camStatus.heap / 1024)} KB` : "-"}
              </dd>
              <dt>PSRAM bebas</dt>
              <dd className="text-cream">
                {camStatus?.psram != null ? `${Math.round(camStatus.psram / 1024)} KB` : "-"}
              </dd>
              <dt>Uptime</dt>
              <dd className="text-cream">{camStatus?.uptime ?? "-"} dtk</dd>
              <dt>IP</dt>
              <dd className="text-cream">{camStatus?.ip ?? "-"}</dd>
              <dt>Firmware</dt>
              <dd className="text-cream">{camStatus?.fw ?? "-"}</dd>
              <dt>Interval scan</dt>
              <dd className="text-cream">
                {camStatus?.interval != null ? `${camStatus.interval / 1000} dtk` : "-"}
              </dd>
            </dl>
            <p className="mt-3 text-[11px] text-cream/40">
              Preview berhenti sementara saat CAM sedang scan AI (kamera dan
              TLS memakai memori bersama).
            </p>
          </div>
        </aside>
      </div>

      {/* ---------- Log ---------- */}
      <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-cream">Log kejadian</h2>
          <button type="button" className="text-xs text-cream/50 hover:text-cream" onClick={() => setLog([])}>
            Bersihkan
          </button>
        </div>
        <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto font-mono text-xs">
          {log.length === 0 && <li className="text-cream/40">Belum ada kejadian.</li>}
          {log.map((l) => (
            <li
              key={l.id}
              className={
                l.kind === "error"
                  ? "text-red-300"
                  : l.kind === "warn"
                    ? "text-amber-300"
                    : l.kind === "ai"
                      ? "text-emerald-300"
                      : "text-cream/70"
              }
            >
              <span className="text-cream/35">{l.time}</span> {l.text}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
