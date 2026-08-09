import { NextResponse } from "next/server";

import { requireAdmin, getCurrentMembership } from "@/lib/auth";
import {
  canManageLibraryAsset,
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
  const membership = getCurrentMembership();
  if (!membership) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }
  const id = Number(params.id);
  const asset = getLibraryAsset(id);
  // Batch 2c tenant-scoped the LIST but left this id-scoped route open to any
  // admin regardless of which tenant owns the row (flagged as a follow-up in
  // that report). "Doesn't exist" and "exists but belongs to another tenant"
  // return the identical 404 — a distinguishable 403 would let a tenant probe
  // ids to enumerate which ones belong to someone else.
  if (!asset || !canManageLibraryAsset(asset, membership.tenant.id)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

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
  const membership = getCurrentMembership();
  if (!membership) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
  }
  const id = Number(params.id);
  const asset = getLibraryAsset(id);
  if (!asset || !canManageLibraryAsset(asset, membership.tenant.id)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  await deleteLibraryAsset(id);
  return NextResponse.json({ ok: true });
}
