import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { getCurrentTenant } from "@/lib/db/tenant";
import { getPlan } from "@/lib/nutrition";
import { mediaSecurityHeaders } from "@/lib/api/mediaSecurityHeaders";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Download the document attached to an uploaded plan: /api/nutrition/file?plan=<id> */
export async function GET(req: Request) {
  const denied = await guard("user");
  if (denied) return denied;

  const id = Number(new URL(req.url).searchParams.get("plan"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Bad plan id." }, { status: 400 });
  }
  const plan = getPlan(id);
  if (!plan?.uploadFilename) {
    return NextResponse.json({ ok: false, error: "No document." }, { status: 404 });
  }
  const safe = path.basename(plan.uploadFilename);
  const full = path.join(process.cwd(), "data", "tenants", getCurrentTenant().slug, "nutrition", safe);
  if (!fs.existsSync(full)) {
    return NextResponse.json({ ok: false, error: "File missing." }, { status: 404 });
  }
  const ext = path.extname(full).toLowerCase();
  const stat = fs.statSync(full);
  const downloadName = plan.uploadOriginalName || `${plan.title}${ext}`;
  return new Response(fs.createReadStream(full) as unknown as BodyInit, {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Length": String(stat.size),
      "Content-Disposition": `inline; filename="${downloadName.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
      ...mediaSecurityHeaders(),
    },
  });
}
