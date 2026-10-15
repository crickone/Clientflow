import fs from "node:fs";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { photoPath } from "@/lib/checkins";
import { mediaSecurityHeaders } from "@/lib/api/mediaSecurityHeaders";

export const dynamic = "force-dynamic";

/** Staff view of a member's check-in photo, from the business's own data (ambient tenant). */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const u = new URL(req.url);
  const clientId = Number(u.searchParams.get("client"));
  const full = Number.isInteger(clientId) && clientId > 0 ? photoPath(clientId, u.searchParams.get("name") ?? "") : null;
  if (!full) return NextResponse.json({ ok: false, error: "No photo." }, { status: 404 });
  const ext = full.slice(full.lastIndexOf(".") + 1);
  return new Response(fs.createReadStream(full) as unknown as BodyInit, {
    headers: {
      "Content-Type": ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg",
      "Content-Length": String(fs.statSync(full).size),
      "Cache-Control": "private, max-age=3600",
      ...mediaSecurityHeaders(),
    },
  });
}
