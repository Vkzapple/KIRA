import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_WORKFLOW_URL =
  "https://serverless.roboflow.com/evelly-khanza/workflows/leaf-detection-and-count-1795394058974";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type Box = [number, number, number, number];

type Detection = {
  box: Box;
  class: string;
  confidence: number;
  detected: string;
  recommendation: string;
};

type WorkflowInput = { type: "base64" | "url"; value: string };

function cleanLabel(raw: string): string {
  const label = raw
    .replace(/^(tomato|chili|cabai|tomat)_/i, "")
    .replace(/_{2,}/g, " ")
    .replace(/_/g, " ")
    .trim();

  if (/healthy|sehat/i.test(label)) return "Sehat";
  if (!label) return "Objek";

  return label.replace(/\b\w/g, (c) => c.toUpperCase());
}

function recommend(label: string): string {
  const value = label.toLowerCase();

  if (/healthy|sehat/.test(value)) {
    return "Tanaman sehat. Lanjutkan perawatan rutin dan monitoring.";
  }
  if (/blight/.test(value)) {
    return "Pangkas daun sakit, aplikasikan fungisida, kurangi kelembapan.";
  }
  if (/spot|bacterial|bercak/.test(value)) {
    return "Buang daun terinfeksi, gunakan bakterisida, sterilkan alat.";
  }
  if (/curl|keriting/.test(value)) {
    return "Kendalikan vektor (kutu), gunakan insektisida, isolasi tanaman.";
  }
  if (/leaf|daun/.test(value)) {
    return "Daun terdeteksi. Cek warna/bercak daun secara berkala.";
  }
  return "Lakukan inspeksi lanjut dan treatment sesuai gejala.";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toPrediction(node: Record<string, unknown>): Detection | null {
  if (typeof node.class !== "string" || !isFiniteNumber(node.confidence)) {
    return null;
  }

  let box: Box | null = null;

  if (
    isFiniteNumber(node.x) &&
    isFiniteNumber(node.y) &&
    isFiniteNumber(node.width) &&
    isFiniteNumber(node.height)
  ) {
    const left = node.x - node.width / 2;
    const top = node.y - node.height / 2;
    box = [left, top, left + node.width, top + node.height];
  } else if (Array.isArray(node.points)) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const point of node.points as Array<Record<string, unknown>>) {
      if (isFiniteNumber(point?.x) && isFiniteNumber(point?.y)) {
        xs.push(point.x);
        ys.push(point.y);
      }
    }
    if (xs.length > 0 && ys.length > 0) {
      box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
  }

  if (!box) return null;

  const detected = node.class;
  const label = cleanLabel(detected);
  const confidence = node.confidence > 1 ? node.confidence / 100 : node.confidence;

  return {
    box: [
      Math.round(box[0]),
      Math.round(box[1]),
      Math.round(box[2]),
      Math.round(box[3]),
    ],
    class: label,
    confidence: Math.max(0, Math.min(1, confidence)),
    detected,
    recommendation: recommend(label),
  };
}

function walk(
  node: unknown,
  visit: (obj: Record<string, unknown>) => void,
): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (!node || typeof node !== "object") return;

  const obj = node as Record<string, unknown>;
  visit(obj);
  for (const value of Object.values(obj)) walk(value, visit);
}

function normalizeWorkflow(payload: unknown) {
  const detections: Detection[] = [];
  const seen = new Set<string>();
  let width: number | undefined;
  let height: number | undefined;
  let reportedCount: number | undefined;

  walk(payload, (node) => {
    const prediction = toPrediction(node);
    if (prediction) {
      const key =
        typeof node.detection_id === "string"
          ? node.detection_id
          : `${prediction.detected}:${prediction.box.join(",")}`;
      if (!seen.has(key)) {
        seen.add(key);
        detections.push(prediction);
      }
    }

    const image = node.image;
    if (
      !width &&
      !height &&
      image &&
      typeof image === "object" &&
      isFiniteNumber((image as Record<string, unknown>).width) &&
      isFiniteNumber((image as Record<string, unknown>).height)
    ) {
      const meta = image as Record<string, number>;
      width = meta.width;
      height = meta.height;
    }

    for (const [key, value] of Object.entries(node)) {
      if (
        reportedCount == null &&
        isFiniteNumber(value) &&
        Number.isFinite(value) &&
        /^count([_-]|$)/i.test(key)
      ) {
        reportedCount = value;
      }
    }
  });

  detections.sort((a, b) => b.confidence - a.confidence);

  return {
    width,
    height,
    count: detections.length > 0 ? detections.length : (reportedCount ?? 0),
    reportedCount,
    results: detections,
  };
}

async function readInput(req: NextRequest): Promise<WorkflowInput> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await req.json()) as {
      image?: string;
      imageUrl?: string;
    };

    const url = body.imageUrl?.trim();
    if (url) return { type: "url", value: url };

    const raw = body.image?.trim();
    if (raw) {
      const base64 = raw.replace(/^data:[^;]+;base64,/, "");
      return { type: "base64", value: base64 };
    }

    throw new Error("Kirim `image` (base64) atau `imageUrl` di body JSON.");
  }

  const form = await req.formData();
  const url = form.get("imageUrl");
  if (typeof url === "string" && url.trim()) {
    return { type: "url", value: url.trim() };
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new Error("File gambar tidak ditemukan.");
  }
  if (file.size === 0) {
    throw new Error("File gambar kosong.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Ukuran gambar melebihi ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.`,
    );
  }
  if (file.type && !file.type.startsWith("image/")) {
    throw new Error("File harus berupa gambar.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  return { type: "base64", value: bytes.toString("base64") };
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ROBOFLOW_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "ROBOFLOW_API_KEY belum diisi di environment kira-web (.env.local).",
      },
      { status: 500 },
    );
  }

  const workflowUrl =
    process.env.ROBOFLOW_WORKFLOW_URL?.trim() || DEFAULT_WORKFLOW_URL;

  let input: WorkflowInput;
  try {
    input = await readInput(req);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Input tidak valid." },
      { status: 400 },
    );
  }

  let roboflowResponse: Response;
  try {
    roboflowResponse = await fetch(workflowUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        inputs: {
          image: input,
        },
      }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "Gagal menghubungi Roboflow. Periksa koneksi server." },
      { status: 502 },
    );
  }

  const text = await roboflowResponse.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!roboflowResponse.ok) {
    const message =
      (payload as { message?: string; error?: string } | null)?.message ??
      (payload as { message?: string; error?: string } | null)?.error ??
      text.slice(0, 240) ??
      "Tidak ada detail.";
    return NextResponse.json(
      {
        error: `Roboflow menolak permintaan (${roboflowResponse.status}): ${message}`,
      },
      { status: 502 },
    );
  }

  if (!payload) {
    return NextResponse.json(
      { error: "Respons Roboflow bukan JSON yang valid." },
      { status: 502 },
    );
  }

  return NextResponse.json(normalizeWorkflow(payload));
}
