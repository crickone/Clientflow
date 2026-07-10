import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { addSlide, getCarousel } from "@/lib/image/carousels";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const carouselSetId = Number(params.id);
  const carousel = getCarousel(carouselSetId);
  if (!carousel) {
    return NextResponse.json(
      { ok: false, error: "Carousel not found." },
      { status: 404 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const templateId = String(body?.templateId ?? "carousel-content");
  const aspectRatio = String(body?.aspectRatio ?? "1:1");
  const slotKey = String(body?.slotKey ?? "default");
  if (!["1:1", "9:16", "4:5"].includes(aspectRatio)) {
    return NextResponse.json(
      { ok: false, error: "Invalid aspect ratio." },
      { status: 400 },
    );
  }

  // Inherit accent + fit from the last slide in the same slot.
  const slotSlides = carousel.slides.filter((s) => s.slotKey === slotKey);
  const lastSlide = slotSlides[slotSlides.length - 1];

  const slide = addSlide({
    carouselSetId,
    slotKey,
    templateId,
    aspectRatio: aspectRatio as "1:1" | "9:16" | "4:5",
    accentColor: lastSlide?.accentColor,
    backgroundFit: lastSlide?.backgroundFit,
  });

  return NextResponse.json({ ok: true, slide });
}
