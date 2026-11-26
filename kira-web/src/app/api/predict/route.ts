import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_WORKFLOW_URL =
  "https://serverless.roboflow.com/evelly-khanza/workflows/leaf-detection-and-count-1795394058974";

const DEFAULT_ML_SERVICE_URL = "http://localhost:8000";
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

type NormalizedWorkflow = {
  width?: number;
  height?: number;
  count: number;
  reportedCount?: number;
  results: Detection[];
};

type MlDetection = {
  box?: number[];
  class?: string;
  confidence?: number;
  detected?: string;
  recommendation?: string;
};

type MlResponse = {
  width?: number;
  height?: number;
  results?: MlDetection[];
  error?: string;
};

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
  if (/whitefly|kutu/.test(value)) {
    return "Ada whitefly/kutu kebul. Pasang yellow sticky trap, gunakan insektisida, dan isolasi tanaman.";
  }
  if (/yellow|kuning/.test(value)) {
    return "Daun menguning. Cek nutrisi (N/Mg), pH tanah, dan pastikan drainase serta penyiraman cukup.";
  }
  if (/blight/.test(value)) {
    return "Pangkas daun sakit, aplikasikan fungisida, kurangi kelembapan.";
  }
  if (/spot|bacterial|bercak/.test(value)) {
    return "Buang daun terinfeksi, gunakan bakterisida/fungisida, sterilkan alat, dan hindari percikan air.";
  }
  if (/curl|keriting/.test(value)) {
    return "Daun keriting. Kendalikan vektor (kutu/trips), gunakan insektisida, dan isolasi tanaman.";
  }
  if (/leaf|daun/.test(value)) {
    return "Daun terdeteksi. Cek warna/bercak daun secara berkala.";
  }
  return "Lakukan inspeksi lanjut dan treatment sesuai gejala.";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isBox(value: unknown): value is Box {
  return Array.isArray(value) && value.length === 4 && value.every(isFiniteNumber);
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

function normalizeWorkflow(payload: unknown): NormalizedWorkflow {
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

async function toImageBuffer(input: WorkflowInput): Promise<Buffer> {
  if (input.type === "base64") {
    const buffer = Buffer.from(input.value, "base64");
    if (buffer.length === 0) throw new Error("Gambar kosong.");
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new Error(
        `Ukuran gambar melebihi ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.`,
      );
    }
    return buffer;
  }

  let response: Response;
  try {
    response = await fetch(input.value, {
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error("Gagal mengambil gambar dari URL.");
  }
  if (!response.ok) {
    throw new Error(`Gagal mengambil gambar dari URL (HTTP ${response.status}).`);
  }
  const type = response.headers.get("content-type") ?? "";
  if (type && !type.startsWith("image/")) {
    throw new Error("URL tersebut bukan gambar.");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error("Gambar dari URL kosong.");
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `Ukuran gambar melebihi ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.`,
    );
  }
  return buffer;
}

async function detectWithRoboflow(
  input: WorkflowInput,
  apiKey: string,
  workflowUrl: string,
): Promise<NormalizedWorkflow> {
  let response: Response;
  try {
    response = await fetch(workflowUrl, {
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
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error("Gagal menghubungi Roboflow. Periksa koneksi server.");
  }

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      (payload as { message?: string; error?: string } | null)?.message ??
      (payload as { message?: string; error?: string } | null)?.error ??
      text.slice(0, 240) ??
      "Tidak ada detail.";
    throw new Error(
      `Roboflow menolak permintaan (${response.status}): ${message}`,
    );
  }

  if (!payload) {
    throw new Error("Respons Roboflow bukan JSON yang valid.");
  }

  return normalizeWorkflow(payload);
}

async function predictWithMl(
  image: Buffer,
  boxes: Box[],
  labels: string[],
): Promise<MlResponse> {
  const base = (
    process.env.ML_SERVICE_URL?.trim() || DEFAULT_ML_SERVICE_URL
  ).replace(/\/+$/, "");

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(image)], { type: "image/jpeg" }),
    "image.jpg",
  );
  if (boxes.length > 0) {
    form.append("boxes", JSON.stringify(boxes));
    form.append("labels", JSON.stringify(labels));
  }

  let response: Response;
  try {
    response = await fetch(`${base}/predict`, {
      method: "POST",
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw new Error(
      `ML service tidak bisa dihubungi di ${base}. Jalankan kira-ml-service lalu coba lagi.`,
    );
  }

  const text = await response.text();
  let payload: MlResponse | null = null;
  try {
    payload = text ? (JSON.parse(text) as MlResponse) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      `ML service menolak permintaan (${response.status}): ${
        payload?.error ?? (text.slice(0, 240) || "Tidak ada detail.")
      }`,
    );
  }
  if (!payload || !Array.isArray(payload.results)) {
    throw new Error("Respons ML service tidak valid.");
  }
  return payload;
}

function toMlDetection(
  item: MlDetection,
  fallbackBox?: Box,
  fallbackDetected?: string,
): Detection {
  const box = isBox(item.box) ? item.box : (fallbackBox ?? [0, 0, 0, 0]);
  const detected = item.detected ?? fallbackDetected ?? "image";
  const label = item.class?.trim() || cleanLabel(detected);
  const confidence =
    typeof item.confidence === "number" && Number.isFinite(item.confidence)
      ? Math.max(0, Math.min(1, item.confidence))
      : 0;

  return {
    box: [
      Math.round(box[0]),
      Math.round(box[1]),
      Math.round(box[2]),
      Math.round(box[3]),
    ],
    class: label,
    confidence,
    detected,
    recommendation: item.recommendation ?? recommend(label),
  };
}

export async function POST(req: NextRequest) {
  let input: WorkflowInput;
  try {
    input = await readInput(req);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Input tidak valid." },
      { status: 400 },
    );
  }

  let image: Buffer;
  try {
    image = await toImageBuffer(input);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Gambar tidak valid." },
      { status: 400 },
    );
  }

  const apiKey = process.env.ROBOFLOW_API_KEY?.trim();
  const workflowUrl =
    process.env.ROBOFLOW_WORKFLOW_URL?.trim() || DEFAULT_WORKFLOW_URL;

  // Roboflow hanya untuk deteksi objek (bounding box).
  let roboflow: NormalizedWorkflow = {
    count: 0,
    results: [],
  };
  let detectionWarning: string | undefined;

  if (apiKey) {
    try {
      roboflow = await detectWithRoboflow(input, apiKey, workflowUrl);
    } catch (error) {
      detectionWarning =
        error instanceof Error ? error.message : "Deteksi Roboflow gagal.";
    }
  } else {
    detectionWarning =
      "ROBOFLOW_API_KEY belum diisi; deteksi kotak dilewati dan gambar dianalisis utuh oleh model ML.";
  }

  // Batasi jumlah crop supaya satu request tidak terlalu lama di CPU.
  const detections = roboflow.results.slice(0, 24);
  const boxes = detections.map((item) => item.box);
  const labels = detections.map((item) => item.detected);

  // Prediksi penyakit selalu dari ML service, bukan dari class Roboflow.
  let ml: MlResponse;
  try {
    ml = await predictWithMl(image, boxes, labels);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Prediksi ML gagal.",
        ...(detectionWarning ? { detectionWarning } : {}),
      },
      { status: 502 },
    );
  }

  const results = (ml.results ?? []).map((item, index) =>
    toMlDetection(item, boxes[index], labels[index]),
  );

  return NextResponse.json({
    width: ml.width ?? roboflow.width,
    height: ml.height ?? roboflow.height,
    count: results.length,
    reportedCount: roboflow.reportedCount,
    results,
    ...(detectionWarning ? { detectionWarning } : {}),
  });
}
