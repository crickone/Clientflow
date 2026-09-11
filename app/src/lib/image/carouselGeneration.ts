import "server-only";

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { runWithTenant } from "@/lib/db/tenant";
import { designPost } from "@/lib/ai/designPost";
import { AiCapError } from "@/lib/ai/usage";
import { getBrandImageStyle } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";
import { resolveLogoPath } from "@/lib/branding";
import { buildImagePrompt, defaultImageStyle, fallbackScene } from "@/lib/ai/image/prompt";
import { isImageGenConfigured } from "@/lib/ai/image/falClient";
import { getTemplate, templateUsesPhoto } from "@/lib/image/templates";
import { DESIGNED_TEMPLATE_ID } from "@/lib/image/paintSlide";
import { photoChoices } from "@/lib/image/library";
import {
  addSlide,
  deleteSlot,
  getCarousel,
  setGenerationStatus,
  updateSlide,
} from "@/lib/image/carousels";
import { queueSlideImages, type SlideImageJob } from "@/lib/image/autoImages";

/**
 * Writing a carousel, DETACHED from the request that asked for it.
 *
 * Why detached at all: a generation takes a minute or more, and it used to run
 * inside the POST that started it, with the operator parked on a "Writing..."
 * screen that owned the only handle on it. Clicking anything -- Templates, the
 * back button, another design -- unmounted that screen, and the work went with
 * it. The operator's report was "it stopped the whole generation", and nothing
 * in the product disagreed: there was no record that a generation was ever
 * running, so there was nothing to come back to.
 *
 * This is the shape queueSlideImages already uses for slide backgrounds (which
 * is why the two live next to each other): capture the tenant while still in
 * the request, hand the work to a continuation that re-enters that tenant, and
 * keep the state on the row so any later page load can find it. Railway runs
 * this app as a persistent `next start` process, not serverless, so the
 * continuation genuinely survives the response.
 */
export interface CarouselGenerationInput {
  tenantId: number;
  carouselId: number;
  topic: string;
  slideCount: number;
  tone: string | null;
  slotKey: string;
  replaceExisting: boolean;
}

/**
 * Mark the design as writing and hand the run to a detached continuation.
 *
 * The status is set HERE, inside the request, rather than inside the
 * continuation: the client navigates to the editor the moment this returns, and
 * an editor that arrived before the continuation had set 'writing' would see an
 * empty design and conclude nothing was happening.
 */
export function queueCarouselGeneration(input: CarouselGenerationInput): void {
  setGenerationStatus(input.carouselId, "writing");
  void runWithTenant(input.tenantId, async () => {
    try {
      await runCarouselGeneration(input);
      setGenerationStatus(input.carouselId, null);
    } catch (err) {
      const message =
        err instanceof AiCapError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Couldn't write the slides.";
      console.error(`[carousel-generate] design ${input.carouselId} failed:`, err);
      setGenerationStatus(input.carouselId, "failed", message);
    }
  });
}

/**
 * The generation itself. Throws on failure -- the caller decides whether that
 * becomes a response or a row of state.
 */
export async function runCarouselGeneration(
  input: CarouselGenerationInput,
): Promise<void> {
  const { tenantId, carouselId, topic, slideCount, tone, slotKey, replaceExisting } =
    input;
  const carousel = getCarousel(carouselId);
  if (!carousel) throw new Error("The design was deleted while it was being written.");

  // The tenant's own library, so a design asking for a photograph gets a real
  // one, graded to the brand's numbers at render time. The whole list, not the
  // first of it: each photo slide takes the next, so a set moves through the
  // library instead of putting one picture on every slide.
  const photos = photoChoices();

  // designPost is the entry point for BOTH paths: with a tenant design system
  // the AI designs each slide as HTML and this renders it; without one it
  // delegates to generateCarouselSlides unchanged and returns designed:false.
  const result = await designPost(
    { topic, slideCount, tone, styleSlot: slotKey },
    { tenantId, agentKey: "carousel" },
    undefined,
    {
      aspectRatio: "1:1",
      photos,
      // The design carries the logo the same way a template slide does, and
      // obeys the same per-design switch.
      logoPath: carousel.showLogo ? resolveLogoPath() : null,
    },
  );

  // Inherit accent from the previous first slide in this slot (or the
  // design's first slide overall) for visual continuity.
  const slotSlides = carousel.slides.filter((s) => s.slotKey === slotKey);
  const previousAccent =
    slotSlides[0]?.accentColor ?? carousel.slides[0]?.accentColor ?? "#2c6ce0";

  if (replaceExisting) deleteSlot(carouselId, slotKey);

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
          // Recorded so the slide can be re-rendered, or re-photographed,
          // against what it actually asked for. Inert for painting -- a
          // designed slide is its stored PNG (see paintSlide).
          backgroundAssetId: slide.photoAssetId ?? undefined,
          imagePrompt: slide.photo || null,
        });
      }
    } else {
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
    }
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
    throw err;
  }

  db.update(schema.carouselSets)
    .set({ updatedAt: new Date() })
    .where(eq(schema.carouselSets.id, carouselId))
    .run();
}
