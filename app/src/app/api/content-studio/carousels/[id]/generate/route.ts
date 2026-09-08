import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
  addSlide,
  deleteSlot,
  getCarousel,
  updateSlide,
} from "@/lib/image/carousels";
import { generateCarouselSlides } from "@/lib/ai/generateCarousel";
import { designPost } from "@/lib/ai/designPost";
import { DESIGNED_TEMPLATE_ID } from "@/lib/image/paintSlide";
import { libraryFilePath, listLibraryAssets } from "@/lib/image/library";
import { getTemplate, templateUsesPhoto } from "@/lib/image/templates";
import { AiCapError } from "@/lib/ai/usage";
import { isImageGenConfigured, IMAGE_COST_CENTS } from "@/lib/ai/image/falClient";
import { buildImagePrompt, defaultImageStyle, fallbackScene } from "@/lib/ai/image/prompt";
import { getBrandImageStyle } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";
import { queueSlideImages, type SlideImageJob } from "@/lib/image/autoImages";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// generateCarouselSlides self-meters (assertUnderCap + recordUsage inside, via
// meteredCreate) under the agentKey this route passes it. "carousel" groups
// this initial Generate call with the refresh route's spend — both are the one
// Content Studio carousel feature — and stays distinct from the Marketing
// agent's draft_carousel tool ("marketing"). AiCapError surfaces as a 429 below.

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const membership = getCurrentMembership();
  if (!membership) {
    return NextResponse.json({ ok: false, error: "No active account" }, { status: 401 });
  }
  const tenantId = membership.tenant.id;
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

  // designPost is the entry point for BOTH paths: with a tenant design system
  // the AI designs each slide as HTML and this renders it; without one it
  // delegates to generateCarouselSlides unchanged and returns designed:false.
  // That is why this route has one call rather than a branch — a tenant with
  // no system takes exactly the code path it took before.
  //
  // The photo source is the tenant's own library, so a design asking for a
  // photograph gets a real one, graded to the brand's numbers at render time.
  const firstPhoto = listLibraryAssets().find(
    (a: { kind?: string | null }) => a.kind !== "video",
  );
  let result;
  try {
    result = await designPost(
      {
        topic,
        slideCount,
        tone,
        styleSlot: slotKey,
      },
      { tenantId, agentKey: "carousel" },
      undefined,
      {
        aspectRatio: "1:1",
        photoSource: firstPhoto ? libraryFilePath(firstPhoto.filename) : null,
      },
    );
  } catch (err) {
    // AiCapError (tenant over its monthly AI spend cap) surfaces as a clean
    // 429, not a 500 — matches the assistant chat route's cap handling.
    if (err instanceof AiCapError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 429 });
    }
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

  const imageGen = isImageGenConfigured();
  const houseStyle = imageGen
    ? (getBrandImageStyle() ?? defaultImageStyle(getBusinessProfile()))
    : null;
  const jobs: SlideImageJob[] = [];

  try {
    if (result.designed) {
      // A designed slide stores its markup and its render. There is no
      // imagePrompt and no queueSlideImages: the photograph is embedded in the
      // markup at render time, so the AI-background queue plays no part.
      for (let i = 0; i < result.slides.length; i++) {
        const slide = result.slides[i];
        addSlide({
          carouselSetId: carouselId,
          slotKey,
          templateId: DESIGNED_TEMPLATE_ID,
          aspectRatio: "1:1",
          // A designed slide has no slots; its copy lives inside the markup.
          headingText: "",
          bodyText: "",
          caption: i === 0 ? result.caption : "",
          designHtml: slide.html,
          renderFilename: slide.renderFilename,
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
        images: { queued: 0, estCents: 0 },
        design: {
          designed: true,
          repaired: result.repaired,
          slideViolations: result.slides.map((s) => s.violations),
        },
      });
    }

    for (let i = 0; i < result.slides.length; i++) {
      const slide = result.slides[i];
      // Only spend on a background the template can actually show — several
      // (quote, CTA, checklist, myth, stat, save) never paint one, and an
      // image generated for those is metered money buying nothing.
      const template = getTemplate(slide.template);
      // *asterisk* highlight markup only means something to templates that
      // parse it — anywhere else it would render literally.
      const heading = template?.headingHighlight
        ? slide.heading
        : slide.heading.replace(/\*/g, "");
      const wantsImage = houseStyle && template && templateUsesPhoto(template);
      const prompt = wantsImage
        ? buildImagePrompt({
            houseStyle,
            scene:
              slide.image?.trim() ||
              fallbackScene({ heading: slide.heading, body: slide.body }),
          })
        : null;
      const row = addSlide({
        carouselSetId: carouselId,
        slotKey,
        templateId: slide.template,
        aspectRatio: "1:1",
        headingText: heading,
        bodyText: slide.body,
        // Some templates read the tagline as content (the stat, the tip
        // label) — carry it when the generator wrote one.
        tagline: slide.tagline ?? null,
        // Caption belongs to the carousel as a whole — store it on slide[0]
        caption: i === 0 ? result.caption : "",
        accentColor: previousAccent,
        imagePrompt: prompt,
        imageStatus: prompt ? "generating" : null,
      });
      if (prompt) jobs.push({ slideId: row.id, prompt, aspectRatio: "1:1" });
    }

    if (jobs.length > 0) queueSlideImages(tenantId, jobs);
  } catch (err) {
    // A mid-loop failure must not strand earlier-inserted slides at
    // 'generating' — that state is only ever cleared by the queue, which
    // won't fire now. Mark them failed (best-effort) so the designer shows
    // a Retry instead of an eternal spinner.
    for (const job of jobs) {
      try {
        updateSlide(job.slideId, {
          imageStatus: "failed",
          imageError: "Slide creation failed part-way — regenerate the carousel.",
        });
      } catch {
        // best effort
      }
    }
    const message = err instanceof Error ? err.message : "Couldn't create the slides.";
    console.error("[carousel-generate] slide insert failed part-way:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  db.update(schema.carouselSets)
    .set({ updatedAt: new Date() })
    .where(eq(schema.carouselSets.id, carouselId))
    .run();

  return NextResponse.json({
    ok: true,
    carousel: getCarousel(carouselId),
    usage: result.usage,
    images: { queued: jobs.length, estCents: jobs.length * IMAGE_COST_CENTS },
  });
}
