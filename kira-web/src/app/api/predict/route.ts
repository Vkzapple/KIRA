import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File;
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("http://localhost:8000/analyze", { method: "POST", body: fd });
  const data = await res.json();
  return NextResponse.json(data);
}