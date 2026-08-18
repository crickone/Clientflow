import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { deleteLibraryAsset, getLibraryAsset } from "@/lib/image/library";

export const dynamic = "force-dynamic";

/** Fetch one asset row — used by the designer's poller to hydrate newly-generated backgrounds into its local library state. */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const asset = getLibraryAsset(Number(params.id));
  if (!asset) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, asset });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const id = Number(params.id);
  const asset = getLibraryAsset(id);
  if (!asset) {
    return NextResponse.json(
      { ok: false, error: "Not found." },
      { status: 404 },
    );
  }
  deleteLibraryAsset(id);
  return NextResponse.json({ ok: true });
}
