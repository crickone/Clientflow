import "server-only";

import { and, asc, desc, eq, isNotNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { runWithTenant } from "@/lib/db/tenant";
import { adCreatives, carouselSets, type AdCreative, type CarouselSlide } from "@/lib/db/schema";
import { designPost, redesignSlide } from "@/lib/ai/designPost";
import { writeAdCopy } from "@/lib/ai/writeAdCopy";
import { AiCapError } from "@/lib/ai/usage";
import { getBrandImageStyle } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";
import { resolveLogoPath } from "@/lib/branding";
import { buildImagePrompt, defaultImageStyle } from "@/lib/ai/image/prompt";
import { isImageGenConfigured } from "@/lib/ai/image/falClient";
import { generatePostImage } from "@/lib/ai/image/generatePostImage";
import { libraryFilePath, photoChoices } from "@/lib/image/library";
import { getDesignSystem } from "@/lib/design/system";
import { DESIGNED_TEMPLATE_ID } from "@/lib/image/paintSlide";
import { addSlide, createCarousel, deleteCarousel } from "@/lib/image/carousels";
import { serialisePhotoAssetIds } from "@/lib/image/photoAssetIds";
import { serialisePhotoScenes } from "@/lib/image/photoScenes";
import { canvasFor } from "@/lib/design/renderDesignedSlide";
import { AD_SIZES, AD_SIZE_LABEL, coerceCopy, parseBrief, parseStoredCopy, type AdBrief, type AdCopy, type AdSize } from "./adCopy";

/**
 * Ads made in Content Studio.
 *
 * An IMAGE ad is three versions (different angles, each with its own ad copy),
 * each designed in three sizes: 4:5 for the feed, 1:1 square, 9:16 for
 * Stories and Reels. Each version is stored as an ordinary design
 * (carousel_sets row, ad_creative_id set) whose slides are the three sizes,
 * feed first -- so the Ads manager's picture picker, which already takes a
 * design, works unchanged. Ad versions are kept out of the normal Content
 * Studio lists (listCarousels) and shown once, as the ad.
 *
 * Generation runs detached, like a post's: the state lives on the ad row so
 * an operator can leave and come back.
 */

const CTA_WORDS: Record<string, string> = {
  LEARN_MORE: "Learn more",
  BOOK_NOW: "Book now",
  SIGN_UP: "Sign up",
  CONTACT_US: "Contact us",
  GET_OFFER: "Get offer",
  SHOP_NOW: "Shop now",
  MESSAGE_PAGE: "Send message",
  APPLY_NOW: "Apply now",
  SUBSCRIBE: "Subscribe",
};
export const ctaWords = (cta: string) => CTA_WORDS[cta] ?? "Learn more";

export interface AdVersion {
  designId: number;
  variant: number;
  copy: AdCopy | null;
  /** Rendered image per size, when it exists. */
  images: Partial<Record<AdSize, { slideId: number; renderFilename: string | null }>>;
}

export interface AdCreativeView {
  id: number;
  name: string;
  kind: "image" | "video";
  brief: AdBrief;
  status: "writing" | "failed" | null;
  stage: string | null;
  error: string | null;
  videoProjectId: number | null;
  updatedAt: number;
  versions: AdVersion[];
  /** Video ads: the ad text versions, and the rendered file URL per size. */
  videoCopies: AdCopy[];
  videoUrls: Partial<Record<"9:16" | "1:1", string>>;
}

const STALE_MS = 20 * 60 * 1000;

function honestStatus(r: AdCreative): AdCreativeView["status"] {
  if (r.status === "writing" && r.startedAt && Date.now() - r.startedAt.getTime() > STALE_MS) return "failed";
  return (r.status as AdCreativeView["status"]) ?? null;
}

function versionsOf(adId: number, goal: AdBrief["goal"]): AdVersion[] {
  const sets = db.select().from(carouselSets).where(eq(carouselSets.adCreativeId, adId)).orderBy(asc(carouselSets.adVariant)).all();
  return sets.map((set) => {
    const slides = db
      .select()
      .from(schema.carouselSlides)
      .where(eq(schema.carouselSlides.carouselSetId, set.id))
      .orderBy(asc(schema.carouselSlides.slideOrder))
      .all();
    const images: AdVersion["images"] = {};
    for (const s of slides as CarouselSlide[]) {
      const size = s.aspectRatio as AdSize;
      if ((AD_SIZES as readonly string[]).includes(size) && !images[size]) images[size] = { slideId: s.id, renderFilename: s.renderFilename };
    }
    return { designId: set.id, variant: set.adVariant ?? 0, copy: parseStoredCopy(set.adCopy, goal), images };
  });
}

function toView(r: AdCreative): AdCreativeView {
  const brief = parseBrief(safeJson(r.brief));
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    brief,
    status: honestStatus(r),
    stage: r.stage,
    error: honestStatus(r) === "failed" ? r.error ?? "The run stopped before it finished. Try again." : null,
    videoProjectId: r.videoProjectId,
    updatedAt: r.updatedAt.getTime(),
    versions: r.kind === "image" ? versionsOf(r.id, brief.goal) : [],
    videoCopies: (Array.isArray(safeJson(r.copy)) ? (safeJson(r.copy) as unknown[]) : [])
      .map((c) => coerceCopy(c, brief.goal))
      .filter((c): c is AdCopy => c !== null),
    videoUrls: Object.fromEntries(
      Object.entries((safeJson(r.videoOutputs) ?? {}) as Record<string, string>)
        .filter(([, f]) => typeof f === "string" && /^ad-(9x16|1x1)-\d+\.mp4$/.test(f))
        .map(([size, f]) => [size, `/api/content-studio/projects/${r.videoProjectId}/output?file=${encodeURIComponent(f)}`]),
    ) as AdCreativeView["videoUrls"],
  };
}

const safeJson = (s: string | null) => {
  try {
    return JSON.parse(s ?? "{}");
  } catch {
    return {};
  }
};

export function getAdCreative(id: number): AdCreativeView | null {
  const r = db.select().from(adCreatives).where(eq(adCreatives.id, id)).get();
  return r ? toView(r) : null;
}

export function listAdCreatives(): AdCreativeView[] {
  return db.select().from(adCreatives).orderBy(desc(adCreatives.updatedAt)).all().map(toView);
}

export function createAdCreative(input: { name: string; kind: "image" | "video"; brief: AdBrief; videoProjectId?: number | null }): AdCreative {
  return db
    .insert(adCreatives)
    .values({ name: input.name.slice(0, 200) || "Untitled ad", kind: input.kind, brief: JSON.stringify(input.brief), videoProjectId: input.videoProjectId ?? null })
    .returning()
    .get();
}

export function deleteAdCreative(id: number): void {
  const sets = db.select({ id: carouselSets.id }).from(carouselSets).where(eq(carouselSets.adCreativeId, id)).all();
  for (const s of sets) deleteCarousel(s.id);
  db.delete(adCreatives).where(eq(adCreatives.id, id)).run();
}

export function renameAdCreative(id: number, name: string): void {
  db.update(adCreatives).set({ name: name.slice(0, 200), updatedAt: new Date() }).where(eq(adCreatives.id, id)).run();
}

/** Video ads keep their text versions on the ad row. */
export function saveVideoCopy(adId: number, index: number, copy: AdCopy): void {
  const r = db.select({ copy: adCreatives.copy }).from(adCreatives).where(eq(adCreatives.id, adId)).get();
  const list = Array.isArray(safeJson(r?.copy ?? null)) ? (safeJson(r!.copy) as unknown[]) : [];
  if (index < 0 || index >= list.length) return;
  list[index] = copy;
  db.update(adCreatives).set({ copy: JSON.stringify(list), updatedAt: new Date() }).where(eq(adCreatives.id, adId)).run();
}

export function saveVersionCopy(designId: number, copy: AdCopy): void {
  db.update(carouselSets).set({ adCopy: JSON.stringify(copy), updatedAt: new Date() }).where(and(eq(carouselSets.id, designId), isNotNull(carouselSets.adCreativeId))).run();
}

function setState(id: number, patch: Partial<Pick<AdCreative, "status" | "stage" | "error" | "startedAt">>) {
  db.update(adCreatives).set({ ...patch, updatedAt: new Date() }).where(eq(adCreatives.id, id)).run();
}

// ─── Generation ──────────────────────────────────────────────────────────────

/** Mark the ad as being written and run it detached. Returns at once. */
export function queueImageAd(tenantId: number, adId: number): void {
  setState(adId, { status: "writing", stage: "Writing the ad copy", error: null, startedAt: new Date() });
  void runWithTenant(tenantId, async () => {
    try {
      await runImageAd(tenantId, adId);
      setState(adId, { status: null, stage: null, error: null });
    } catch (err) {
      console.error(`[ads] image ad ${adId} failed:`, err);
      setState(adId, {
        status: "failed",
        stage: null,
        error: err instanceof AiCapError ? err.message : err instanceof Error ? err.message : "The ad could not be made.",
      });
    }
  });
}

async function runImageAd(tenantId: number, adId: number): Promise<void> {
  const row = db.select().from(adCreatives).where(eq(adCreatives.id, adId)).get();
  if (!row) return;
  if (!getDesignSystem()) {
    throw new Error("Image ads are designed in your brand's style. Pick a design style first, in Settings > Design direction.");
  }
  const brief = parseBrief(safeJson(row.brief));
  const meter = { tenantId, agentKey: "ads" };

  // 1. The words: three versions, three angles.
  const copies = await writeAdCopy(tenantId, brief);

  // 2. The feed versions, designed together so they differ from each other.
  setState(adId, { stage: "Designing the feed versions" });
  const imageGen = isImageGenConfigured();
  const houseStyle = imageGen ? (getBrandImageStyle() ?? defaultImageStyle(getBusinessProfile())) : null;
  const makePhoto =
    imageGen && houseStyle
      ? async (scene: string) => {
          try {
            const asset = await generatePostImage(
              { prompt: buildImagePrompt({ houseStyle, scene: scene || brief.offer }), aspectRatio: "1:1" },
              meter,
            );
            return { id: asset.id, path: libraryFilePath(asset.filename) };
          } catch (err) {
            if (err instanceof AiCapError) throw err;
            return null;
          }
        }
      : undefined;
  const logoPath = resolveLogoPath();
  const result = await designPost(
    { topic: brief.offer, slideCount: copies.length, tone: null },
    meter,
    undefined,
    {
      aspectRatio: "4:5",
      photos: photoChoices(),
      makePhoto,
      logoPath,
      onProgress: (stage) => setState(adId, { stage: `Feed versions: ${stage.toLowerCase()}` }),
      ad: { versions: copies.map((c) => ({ hook: c.hook, support: c.support, button: ctaWords(c.cta), angle: c.angle })) },
    },
  );
  if (!result.designed) throw new Error("Image ads need your brand's design style. Pick one in Settings > Design direction.");

  // Replace any earlier versions of this ad (a "try again").
  for (const s of db.select({ id: carouselSets.id }).from(carouselSets).where(eq(carouselSets.adCreativeId, adId)).all()) deleteCarousel(s.id);

  // 3. Each version: save the feed design, then adapt it to the other sizes.
  const library = photoChoices();
  for (let i = 0; i < Math.min(copies.length, result.slides.length); i++) {
    const copy = copies[i];
    const feed = result.slides[i];
    const set = createCarousel({ name: `${row.name} · Version ${i + 1}` });
    db.update(carouselSets).set({ adCreativeId: adId, adVariant: i + 1, adCopy: JSON.stringify(copy) }).where(eq(carouselSets.id, set.id)).run();
    addSlide({
      carouselSetId: set.id,
      templateId: DESIGNED_TEMPLATE_ID,
      aspectRatio: "4:5",
      headingText: "",
      bodyText: "",
      caption: copy.primaryText,
      designHtml: feed.html,
      renderFilename: feed.renderFilename,
      backgroundAssetId: feed.photoAssetId ?? undefined,
      photoAssetIds: serialisePhotoAssetIds(feed.photoAssetIds),
      imagePrompt: feed.photo || null,
      photoScenes: serialisePhotoScenes(feed.photoScenes),
    });

    const photo = feed.photoAssetId != null ? (library.find((p) => p.id === feed.photoAssetId) ?? null) : null;
    for (const size of AD_SIZES.filter((s) => s !== "4:5")) {
      setState(adId, { stage: `Version ${i + 1}: sizing for ${AD_SIZE_LABEL[size]}` });
      const { width, height } = canvasFor(size);
      const adapted = await redesignSlide(
        {
          topic: brief.offer,
          previousHtml: feed.html,
          note: `Adapt THIS ad to a ${width}x${height} canvas (${AD_SIZE_LABEL[size]}). Keep exactly the same words, the same photograph, colours and type; recompose only for the new shape. Keep the hook dominant and the button near the bottom${size === "9:16" ? ", and keep the top and bottom 250px clear of text (Stories and Reels cover them)" : ""}.`,
          aspectRatio: size,
          photo,
          photoLibrary: library,
          logoPath,
        },
        meter,
      );
      if (!adapted) continue;
      addSlide({
        carouselSetId: set.id,
        templateId: DESIGNED_TEMPLATE_ID,
        aspectRatio: size,
        headingText: "",
        bodyText: "",
        caption: "",
        designHtml: adapted.slide.html,
        renderFilename: adapted.slide.renderFilename,
        backgroundAssetId: adapted.slide.photoAssetId ?? undefined,
        photoAssetIds: serialisePhotoAssetIds(adapted.slide.photoAssetIds),
        imagePrompt: adapted.slide.photo || null,
        photoScenes: serialisePhotoScenes(adapted.slide.photoScenes),
      });
    }
  }
}

/** Redesign one size of one version (the editor's "Try another design"). */
export async function redesignAdImage(tenantId: number, adId: number, slideId: number, note: string | null): Promise<void> {
  const ad = getAdCreative(adId);
  const slide = db.select().from(schema.carouselSlides).where(eq(schema.carouselSlides.id, slideId)).get();
  if (!ad || !slide?.designHtml) throw new Error("That image is no longer here.");
  const library = photoChoices();
  const photo = slide.backgroundAssetId != null ? (library.find((p) => p.id === slide.backgroundAssetId) ?? null) : null;
  const out = await redesignSlide(
    {
      topic: ad.brief.offer,
      previousHtml: slide.designHtml,
      note: note?.trim() || "Design this ad again, differently: same words, a different composition.",
      aspectRatio: slide.aspectRatio as AdSize,
      photo,
      photoLibrary: library,
      logoPath: resolveLogoPath(),
    },
    { tenantId, agentKey: "ads" },
  );
  if (!out) throw new Error("Could not redesign this image.");
  db.update(schema.carouselSlides)
    .set({
      designHtml: out.slide.html,
      renderFilename: out.slide.renderFilename,
      backgroundAssetId: out.slide.photoAssetId ?? null,
      photoAssetIds: serialisePhotoAssetIds(out.slide.photoAssetIds),
      updatedAt: new Date(),
    })
    .where(eq(schema.carouselSlides.id, slideId))
    .run();
  db.update(adCreatives).set({ updatedAt: new Date() }).where(eq(adCreatives.id, adId)).run();
}
