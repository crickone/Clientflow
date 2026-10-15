import fs from "node:fs";
import { NextResponse } from "next/server";

import { getCurrentClient } from "@/lib/clientAuth";
import { AiCapError } from "@/lib/ai/usage";
import { readMeal } from "@/lib/ai/readMeal";
import { getMeal, logMeal, photoPath, savePhoto } from "@/lib/meals";
import { mediaSecurityHeaders } from "@/lib/api/mediaSecurityHeaders";
import { rateLimit } from "@/lib/rateLimit";
import { loggedAtFor } from "@/lib/mealsModel";
import { dateKey } from "@/lib/trainingProgress";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 6 * 1024 * 1024;
const MIME: Record<string, { mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp" }> = {
  "image/jpeg": { mime: "image/jpeg", ext: "jpg" },
  "image/png": { mime: "image/png", ext: "png" },
  "image/webp": { mime: "image/webp", ext: "webp" },
};

/**
 * A client snaps a meal or a food label: the photo is read by the AI, the
 * meal is logged against today, and the logged row comes back for the app to
 * show. Goes through an API route rather than a server action because of the
 * body size (a downscaled photo is still a few hundred KB).
 */
export async function POST(req: Request) {
  const client = getCurrentClient();
  if (!client) return NextResponse.json({ ok: false, error: "Please sign in again." }, { status: 401 });
  const rl = rateLimit(`meal-photo:${client.tenantId}:${client.clientId}`, 40, 60 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "That's a lot of photos for one hour. Try again a little later." }, { status: 429 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Couldn't read that photo." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "No photo attached." }, { status: 400 });
  const type = MIME[file.type];
  if (!type) return NextResponse.json({ ok: false, error: "Use a JPEG, PNG or WebP photo." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "That photo is too large." }, { status: 413 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const note = typeof form.get("note") === "string" ? String(form.get("note")) : "";
  const servings = Number(form.get("servings") ?? 1);

  let reading;
  try {
    reading = await readMeal({ tenantId: client.tenantId, bytes, mime: type.mime, note });
  } catch (err) {
    if (err instanceof AiCapError) {
      return NextResponse.json({ ok: false, error: "Photo reading is paused on this account for now. You can still add the meal by hand." }, { status: 429 });
    }
    console.error("[meals] read failed", err);
    return NextResponse.json({ ok: false, error: "Couldn't read that photo. Try again, or add the meal by hand." }, { status: 502 });
  }
  if (!reading) {
    return NextResponse.json({ ok: false, error: "That doesn't look like food or a food label. Try a clearer photo, or add the meal by hand." }, { status: 422 });
  }

  const photo = savePhoto(client.clientId, bytes, type.ext);
  const now = Date.now();
  const day = typeof form.get("day") === "string" ? String(form.get("day")) : null;
  const meal = logMeal(client.clientId, { reading, servings: Number.isFinite(servings) ? servings : 1, photo, loggedAt: loggedAtFor(day, now, dateKey(now)) });
  return NextResponse.json({ ok: true, meal });
}

/** One of the signed-in client's own meal photos. */
export async function GET(req: Request) {
  const client = getCurrentClient();
  if (!client) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get("meal"));
  const meal = Number.isInteger(id) && id > 0 ? getMeal(client.clientId, id) : null;
  const full = meal?.photo ? photoPath(client.clientId, meal.photo) : null;
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
