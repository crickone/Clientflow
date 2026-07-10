import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; assetId: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const projectId = Number(params.id);
  const assetId = Number(params.assetId);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};

  if (body?.rotation !== undefined) {
    const r = Number(body.rotation);
    if (![0, 90, 180, 270].includes(r)) {
      return NextResponse.json(
        { ok: false, error: "Rotation must be 0, 90, 180, or 270." },
        { status: 400 },
      );
    }
    patch.rotation = r;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { ok: false, error: "No supported fields to update." },
      { status: 400 },
    );
  }

  const result = db
    .update(schema.videoAssets)
    .set(patch)
    .where(
      and(
        eq(schema.videoAssets.id, assetId),
        eq(schema.videoAssets.projectId, projectId),
      ),
    )
    .returning()
    .all();

  if (result.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Asset not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, asset: result[0] });
}
