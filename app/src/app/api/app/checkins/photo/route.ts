import fs from "node:fs";
import { NextResponse } from "next/server";

import { getCurrentClient } from "@/lib/clientAuth";
import { photoPath, saveCheckinPhoto } from "@/lib/checkins";
import { mediaSecurityHeaders } from "@/lib/api/mediaSecurityHeaders";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const MAX_BYTES = 6 * 1024 * 1024;
const EXT: Record<string, "jpg" | "png" | "webp"> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * A member adds a photo to their check-in. Stored straight away and the file
 * name comes back; the check-in itself names it when they send. An API route
 * rather than a server action because of the body size.
 */
export async function POST(req: Request) {
  const client = getCurrentClient();
  if (!client) return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
  const rl = rateLimit(`checkin-photo:${client.tenantId}:${client.clientId}`, 30, 60 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "That's a lot of photos for one hour. Try again a little later." }, { status: 429 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't read that photo." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "No photo attached." }, { status: 400 });
  const ext = EXT[file.type];
  if (!ext) return NextResponse.json({ ok: false, error: "Use a JPEG, PNG or WebP photo." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "That photo is too large." }, { status: 413 });
  const name = saveCheckinPhoto(client.clientId, Buffer.from(await file.arrayBuffer()), ext);
  return NextResponse.json({ ok: true, name });
}

/** One of the signed-in member's own check-in photos. */
export async function GET(req: Request) {
  const client = getCurrentClient();
  if (!client) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const full = photoPath(client.clientId, new URL(req.url).searchParams.get("name") ?? "");
  if (!full) return NextResponse.json({ ok: false, error: "No photo." }, { status: 404 });
  return streamPhoto(full);
}

function streamPhoto(full: string) {
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
