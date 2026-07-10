import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { getCurrentTenant } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".doc", ".docx", ".xls", ".xlsx"]);
const DATA_DIR = path.join(process.cwd(), "data");

function dir(): string {
  const tenant = getCurrentTenant();
  const d = path.join(DATA_DIR, "tenants", tenant.slug, "automations");
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

export async function POST(req: Request) {
  const denied = await guard("user");
  if (denied) return denied;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid form data." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: "A file is required." }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: "File must be under 10 MB." }, { status: 400 });
  }
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED.has(ext)) {
    return NextResponse.json({ ok: false, error: "Unsupported file type." }, { status: 400 });
  }
  const filename = `att-${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`;
  fs.writeFileSync(path.join(dir(), filename), Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ ok: true, filename, originalName: file.name });
}
