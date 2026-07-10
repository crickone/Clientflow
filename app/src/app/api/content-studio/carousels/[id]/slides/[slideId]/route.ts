import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { deleteSlide, updateSlide } from "@/lib/image/carousels";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; slideId: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const slideId = Number(params.slideId);
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
  if (typeof body?.templateId === "string") patch.templateId = body.templateId;
  if (typeof body?.aspectRatio === "string") {
    if (["1:1", "9:16", "4:5"].includes(body.aspectRatio)) {
      patch.aspectRatio = body.aspectRatio;
    }
  }
  if (typeof body?.headingText === "string") patch.headingText = body.headingText;
  if (typeof body?.bodyText === "string") patch.bodyText = body.bodyText;
  if (typeof body?.tagline === "string" || body?.tagline === null) {
    patch.tagline =
      typeof body.tagline === "string" && body.tagline.trim()
        ? body.tagline.trim()
        : null;
  }
  if (typeof body?.caption === "string") patch.caption = body.caption;
  if (typeof body?.headingFont === "string" || body?.headingFont === null) {
    patch.headingFont = body.headingFont || null;
  }
  if (typeof body?.bodyFont === "string" || body?.bodyFont === null) {
    patch.bodyFont = body.bodyFont || null;
  }
  if (typeof body?.accentColor === "string") patch.accentColor = body.accentColor;
  if (typeof body?.backgroundColor === "string" || body?.backgroundColor === null) {
    patch.backgroundColor = body.backgroundColor || null;
  }
  if (
    body?.backgroundAssetId === null ||
    typeof body?.backgroundAssetId === "number"
  ) {
    patch.backgroundAssetId = body.backgroundAssetId;
  }
  if (body?.backgroundFit === "cover" || body?.backgroundFit === "contain") {
    patch.backgroundFit = body.backgroundFit;
  }
  if (typeof body?.backgroundOffsetX === "number") {
    patch.backgroundOffsetX = body.backgroundOffsetX;
  }
  if (typeof body?.backgroundOffsetY === "number") {
    patch.backgroundOffsetY = body.backgroundOffsetY;
  }
  if (typeof body?.backgroundZoom === "number") {
    patch.backgroundZoom = body.backgroundZoom;
  }

  updateSlide(slideId, patch as any);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; slideId: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const slideId = Number(params.slideId);
  deleteSlide(slideId);
  return NextResponse.json({ ok: true });
}
