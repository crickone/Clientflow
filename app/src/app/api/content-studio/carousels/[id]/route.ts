import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import {
  deleteCarousel,
  getCarousel,
  reorderSlides,
  updateCarousel,
} from "@/lib/image/carousels";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const id = Number(params.id);
  const carousel = getCarousel(id);
  if (!carousel) {
    return NextResponse.json(
      { ok: false, error: "Not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, carousel });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const id = Number(params.id);
  const carousel = getCarousel(id);
  if (!carousel) {
    return NextResponse.json(
      { ok: false, error: "Not found." },
      { status: 404 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  // Reorder action
  if (Array.isArray(body?.slideOrder)) {
    const slideIds = body.slideOrder
      .map((n: unknown) => Number(n))
      .filter((n: number) => Number.isFinite(n));
    reorderSlides(id, slideIds);
  }

  if (typeof body?.name === "string" && body.name.trim()) {
    updateCarousel(id, { name: body.name.trim() });
  }

  return NextResponse.json({ ok: true, carousel: getCarousel(id) });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const id = Number(params.id);
  const carousel = getCarousel(id);
  if (!carousel) {
    return NextResponse.json(
      { ok: false, error: "Not found." },
      { status: 404 },
    );
  }
  deleteCarousel(id);
  return NextResponse.json({ ok: true });
}
