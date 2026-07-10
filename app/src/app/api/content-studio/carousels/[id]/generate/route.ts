import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
  addSlide,
  deleteSlot,
  getCarousel,
} from "@/lib/image/carousels";
import { generateCarouselSlides } from "@/lib/ai/generateCarousel";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const carouselId = Number(params.id);
  const carousel = getCarousel(carouselId);
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
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const topic = String(body?.topic ?? "").trim();
  const slideCount = Number(body?.slideCount);
  const tone = body?.tone ? String(body.tone).trim() : null;
  const slotKey = String(body?.slotKey ?? "default");
  const replaceExisting = body?.replaceExisting !== false; // default true

  if (!topic) {
    return NextResponse.json(
      { ok: false, error: "Topic is required." },
      { status: 400 },
    );
  }
  if (!Number.isFinite(slideCount) || slideCount < 2 || slideCount > 10) {
    return NextResponse.json(
      { ok: false, error: "Slide count must be between 2 and 10." },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await generateCarouselSlides({
      topic,
      slideCount,
      tone,
      styleSlot: slotKey,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Carousel generation failed.";
    console.error("[carousel-generate] error:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  // Inherit accent from the previous first slide in this slot (or the
  // design's first slide overall) for visual continuity.
  const slotSlides = carousel.slides.filter((s) => s.slotKey === slotKey);
  const previousAccent =
    slotSlides[0]?.accentColor ?? carousel.slides[0]?.accentColor ?? "#2c6ce0";

  if (replaceExisting) {
    deleteSlot(carouselId, slotKey);
  }

  for (let i = 0; i < result.slides.length; i++) {
    const slide = result.slides[i];
    addSlide({
      carouselSetId: carouselId,
      slotKey,
      templateId: slide.template,
      aspectRatio: "1:1",
      headingText: slide.heading,
      bodyText: slide.body,
      // Caption belongs to the carousel as a whole — store it on slide[0]
      caption: i === 0 ? result.caption : "",
      accentColor: previousAccent,
    });
  }

  db.update(schema.carouselSets)
    .set({ updatedAt: new Date() })
    .where(eq(schema.carouselSets.id, carouselId))
    .run();

  return NextResponse.json({
    ok: true,
    carousel: getCarousel(carouselId),
    usage: result.usage,
  });
}
