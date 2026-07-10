import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth";
import {
  deleteLibraryAsset,
  getLibraryAsset,
  updateLibraryAlt,
} from "@/lib/cms/library";
import { getObject } from "@/lib/cms/storage";
import { generateAltText as genAlt } from "@/lib/ai/altText";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Update an asset's alt text, or regenerate it from the image.
 * Body: { alt: string } to set manually, or { regenerate: true } for AI.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }
  const id = Number(params.id);
  const asset = getLibraryAsset(id);
  if (!asset) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    alt?: string;
    regenerate?: boolean;
  };

  if (body.regenerate) {
    const bytes = await getObject(asset.storageKey);
    const alt = bytes
      ? await genAlt(bytes, asset.mimeType, asset.originalName)
      : null;
    if (alt) updateLibraryAlt(id, alt);
    return NextResponse.json({ ok: true, alt: alt ?? asset.alt });
  }

  if (typeof body.alt === "string") {
    updateLibraryAlt(id, body.alt);
    return NextResponse.json({ ok: true, alt: body.alt });
  }

  return NextResponse.json({ ok: false, error: "Nothing to update" }, { status: 400 });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }
  await deleteLibraryAsset(Number(params.id));
  return NextResponse.json({ ok: true });
}
