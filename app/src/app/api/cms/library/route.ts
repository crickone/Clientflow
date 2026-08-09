import { NextResponse } from "next/server";

import { requireAdmin, getCurrentMembership } from "@/lib/auth";
import {
  addLibraryAsset,
  listLibraryAssets,
  libraryUrl,
  type LibraryAsset,
} from "@/lib/cms/library";
import { generateAltText } from "@/lib/ai/altText";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ALLOWED = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "image/gif",
]);

const toJson = (a: LibraryAsset) => ({
  id: a.id,
  url: libraryUrl(a.id),
  originalName: a.originalName,
  alt: a.alt,
  mimeType: a.mimeType,
  width: a.width,
  height: a.height,
});

/**
 * Shared media library — list the caller's tenant's assets (usable across all
 * of that tenant's sites), plus any legacy pre-tenant-scoping row. See
 * listLibraryAssets() (Batch 2c, improvement-plan-2026-08.md Theme B2).
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }
  const membership = getCurrentMembership();
  if (!membership) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }
  return NextResponse.json({
    ok: true,
    assets: listLibraryAssets(membership.tenant.id).map(toJson),
  });
}

/** Upload one or more images; alt text is auto-generated from the image. */
export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }
  const membership = getCurrentMembership();
  if (!membership) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }
  const tenantId = membership.tenant.id;

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
  const autoAlt = form.get("autoAlt") !== "0";

  const created: ReturnType<typeof toJson>[] = [];
  for (const file of files) {
    const mime = (file.type || "").toLowerCase();
    if (mime && !ALLOWED.has(mime)) {
      return NextResponse.json(
        { ok: false, error: `Unsupported file type: ${file.type}` },
        { status: 400 },
      );
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const alt = autoAlt
      ? await generateAltText(bytes, mime, file.name || undefined)
      : null;
    const asset = await addLibraryAsset({
      originalName: file.name || "upload",
      mimeType: mime || "application/octet-stream",
      bytes,
      alt,
      tenantId,
    });
    created.push(toJson(asset));
  }

  return NextResponse.json({ ok: true, assets: created });
}
