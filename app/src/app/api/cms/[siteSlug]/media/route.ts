import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { addMediaAsset, listMedia } from "@/lib/cms/media";
import { processImageUpload } from "@/lib/image/processUpload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "image/gif",
]);

export async function GET(
  _req: Request,
  { params }: { params: { siteSlug: string } },
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }
  const site = await getSiteBySlug(params.siteSlug);
  if (!site) return NextResponse.json({ ok: false, error: "Unknown site" }, { status: 404 });
  return NextResponse.json({ ok: true, assets: listMedia(site.id) });
}

export async function POST(
  req: Request,
  { params }: { params: { siteSlug: string } },
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }
  const site = await getSiteBySlug(params.siteSlug);
  if (!site) return NextResponse.json({ ok: false, error: "Unknown site" }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid form data.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  const files = form
    .getAll("file")
    .filter((v): v is File => v instanceof File && v.size > 0);
  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: "No files supplied." }, { status: 400 });
  }

  const created = [];
  for (const file of files) {
    const mime = (file.type || "").toLowerCase();
    if (mime && !ALLOWED.has(mime)) {
      return NextResponse.json(
        { ok: false, error: `Unsupported file type: ${file.type}` },
        { status: 400 },
      );
    }
    const rawBytes = Buffer.from(await file.arrayBuffer());
    // Batch 5c: downscale + re-encode raster uploads; SVG/GIF/unknown mimes
    // pass through unchanged. Failure-safe — falls back to rawBytes if sharp
    // can't decode them.
    const { buffer: bytes, width, height } = await processImageUpload(
      rawBytes,
      mime || "application/octet-stream",
    );
    created.push(
      addMediaAsset({
        siteId: site.id,
        originalName: file.name || "upload",
        mimeType: mime || "application/octet-stream",
        bytes,
        width,
        height,
        alt: null,
      }),
    );
  }

  return NextResponse.json({ ok: true, assets: created });
}
