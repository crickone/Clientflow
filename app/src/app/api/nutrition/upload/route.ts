import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { getCurrentTenant } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED = new Set([".pdf", ".xls", ".xlsx", ".doc", ".docx"]);
const DATA_DIR = path.join(process.cwd(), "data");

function nutritionDir(): string {
  const tenant = getCurrentTenant();
  const dir = path.join(DATA_DIR, "tenants", tenant.slug, "nutrition");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Store an uploaded plan document (PDF/Excel/Word). Returns the stored filename. */
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
    return NextResponse.json(
      { ok: false, error: "Only PDF, Excel, or Word files can be uploaded." },
      { status: 400 },
    );
  }

  const dir = nutritionDir();
  const filename = `plan-${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(path.join(dir, filename), buf);

  return NextResponse.json({ ok: true, filename, originalName: file.name });
}
