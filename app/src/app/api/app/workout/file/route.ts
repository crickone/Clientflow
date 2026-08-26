import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { getCurrentClient } from "@/lib/clientAuth";
import { assignedWorkoutProgramDetail } from "@/lib/clientApp";
import { getCurrentTenant } from "@/lib/db/tenant";
import { mediaSecurityHeaders } from "@/lib/api/mediaSecurityHeaders";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/**
 * Client-app counterpart of /api/workout/file — same file, gated by the
 * signed-in CLIENT's own session + program ownership instead of a staff
 * login. assignedWorkoutProgramDetail() re-does the ownership join (program
 * must be assigned to THIS client), so a client can't download another
 * client's or an unassigned program's document by guessing an id:
 * /api/app/workout/file?program=<id>
 */
export async function GET(req: Request) {
  const client = getCurrentClient();
  if (!client) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const id = Number(new URL(req.url).searchParams.get("program"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Bad program id." }, { status: 400 });
  }
  const program = assignedWorkoutProgramDetail(client.clientId, id);
  if (!program?.uploadFilename) {
    return NextResponse.json({ ok: false, error: "No document." }, { status: 404 });
  }
  const safe = path.basename(program.uploadFilename);
  const full = path.join(process.cwd(), "data", "tenants", getCurrentTenant().slug, "workout", safe);
  if (!fs.existsSync(full)) {
    return NextResponse.json({ ok: false, error: "File missing." }, { status: 404 });
  }
  const ext = path.extname(full).toLowerCase();
  const stat = fs.statSync(full);
  const downloadName = program.uploadOriginalName || `${program.title}${ext}`;
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
