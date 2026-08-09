import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { mediaSecurityHeaders } from "@/lib/api/mediaSecurityHeaders";

import {
  brandingDir,
  ensureBrandingDir,
  isAllowedLogoExt,
  LOGO_BASENAME,
  resolveLogoPath,
} from "@/lib/branding";
import {
  deleteKey,
  getBrandingLogoFilename,
  setKey,
} from "@/lib/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/** Streams the current logo for preview in the settings page + img tags. */
export async function GET() {
  const filePath = resolveLogoPath();
  if (!filePath) {
    return NextResponse.json(
      { ok: false, error: "No logo uploaded." },
      { status: 404 },
    );
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";
  const stat = fs.statSync(filePath);
  const stream = fs.createReadStream(filePath);
  return new Response(stream as unknown as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Cache-Control": "no-store",
      ...mediaSecurityHeaders(),
    },
  });
}

/**
 * Replaces the current logo. PNG/JPG/WEBP only. Stored as logo.<ext> inside
 * data/branding/. Any previous logo file with a different extension is
 * cleaned up so we never have stale fallbacks lying around.
 */
export async function POST(req: Request) {
  const __auth = await guard("admin");
  if (__auth) return __auth;
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid form data.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { ok: false, error: "Logo file is required." },
      { status: 400 },
    );
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json(
      { ok: false, error: "Logo must be under 5 MB." },
      { status: 400 },
    );
  }

  const ext = path.extname(file.name).toLowerCase();
  if (!isAllowedLogoExt(ext)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Logo must be a PNG, JPG, or WEBP image.",
      },
      { status: 400 },
    );
  }

  const dir = ensureBrandingDir();
  // Clear any prior logo file (different extension) so we don't leave stragglers.
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith(LOGO_BASENAME + ".")) {
      try {
        fs.unlinkSync(path.join(dir, entry));
      } catch {
        // best effort
      }
    }
  }

  const filename = `${LOGO_BASENAME}${ext}`;
  const dest = path.join(dir, filename);
  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(dest, buf);
  setKey("branding_logo_filename", filename);

  // Invalidate the cached intro/outro cards so they re-render with the new
  // logo on the next project render.
  invalidateCachedCards();

  return NextResponse.json({ ok: true, filename });
}

export async function DELETE() {
  const __auth = await guard("admin");
  if (__auth) return __auth;
  const filename = getBrandingLogoFilename();
  if (filename) {
    const full = path.join(brandingDir(), filename);
    try {
      if (fs.existsSync(full)) fs.unlinkSync(full);
    } catch {
      // best effort
    }
    deleteKey("branding_logo_filename");
  }
  invalidateCachedCards();
  return NextResponse.json({ ok: true });
}

function invalidateCachedCards() {
  const cardsRoot = path.join(process.cwd(), "data", "cards");
  if (!fs.existsSync(cardsRoot)) return;
  for (const ratio of fs.readdirSync(cardsRoot)) {
    const sub = path.join(cardsRoot, ratio);
    if (!fs.statSync(sub).isDirectory()) continue;
    for (const file of fs.readdirSync(sub)) {
      try {
        fs.unlinkSync(path.join(sub, file));
      } catch {
        // best effort
      }
    }
  }
}
