import "server-only";

import fs from "node:fs";
import { and, asc, eq, inArray, lte } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getTenantDbById } from "@/lib/db/tenant";
import { getCarousel } from "@/lib/image/carousels";
import { renderFilePath } from "@/lib/image/renderStore";
import { isCarouselSlot } from "@/lib/image/slots";
import { getSocialPublisher, type SocialChannel } from "./publisher";
import { renderTokensConfigured, signRenderToken } from "./renderToken";

/**
 * Booking a Content Studio design to go out on social at a time.
 *
 * The internal half of scheduling, built before the connection exists so
 * the connection is a drop-in: rows in scheduled_posts, a ticker that looks
 * for due ones, a publisher interface (./publisher) that is null until Meta
 * approves the app. Until then a due post keeps its "scheduled" status with
 * the reason on it -- "Waiting for the Facebook connection" -- and is posted
 * by the very same code the minute a connection is stored.
 */

export type ScheduledPostStatus = "scheduled" | "posting" | "posted" | "failed" | "cancelled";

export const ALL_CHANNELS: SocialChannel[] = ["facebook", "instagram"];

export const NOT_CONNECTED_MESSAGE = "Waiting for the Facebook connection (Meta app review in progress).";

const MIN_LEAD_MS = 60_000;

export interface ScheduledPostView {
  id: number;
  carouselSetId: number;
  designName: string;
  campaignId: number | null;
  channels: SocialChannel[];
  scheduledFor: number;
  status: ScheduledPostStatus;
  error: string | null;
  postedAt: number | null;
  slideCount: number;
}

export function parseChannels(raw: string | null | undefined): SocialChannel[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return ALL_CHANNELS;
    const out = parsed.filter((c): c is SocialChannel => c === "facebook" || c === "instagram");
    return out.length ? out : ALL_CHANNELS;
  } catch {
    return ALL_CHANNELS;
  }
}

export function normalizeChannels(input: unknown): SocialChannel[] {
  const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
  const out = [...new Set(list.map((c) => String(c).trim().toLowerCase()).filter((c): c is SocialChannel => c === "facebook" || c === "instagram"))];
  return out.length ? out : ALL_CHANNELS;
}

export type ScheduleResult = { ok: true; post: ScheduledPostView } | { ok: false; error: string };

export function schedulePost(input: {
  carouselSetId: number;
  scheduledFor: Date;
  channels?: SocialChannel[];
  campaignId?: number | null;
}): ScheduleResult {
  const carousel = getCarousel(input.carouselSetId);
  if (!carousel) return { ok: false, error: "No design with that id." };
  if (!Number.isFinite(input.scheduledFor.getTime())) return { ok: false, error: "That is not a valid date and time." };
  if (input.scheduledFor.getTime() < Date.now() + MIN_LEAD_MS) return { ok: false, error: "Pick a time in the future." };
  if (carousel.generationStatus === "writing") return { ok: false, error: "This design is still being written. Schedule it once it is ready." };
  if (carousel.slides.length === 0) return { ok: false, error: "This design has no slides yet." };

  const row = db
    .insert(schema.scheduledPosts)
    .values({
      carouselSetId: input.carouselSetId,
      campaignId: input.campaignId ?? null,
      channels: JSON.stringify(input.channels?.length ? input.channels : ALL_CHANNELS),
      scheduledFor: input.scheduledFor,
    })
    .returning()
    .get();
  return { ok: true, post: toView(row, carousel.name, carousel.slides.length) };
}

export function cancelScheduledPost(id: number): { ok: true } | { ok: false; error: string } {
  const row = db.select().from(schema.scheduledPosts).where(eq(schema.scheduledPosts.id, id)).get();
  if (!row) return { ok: false, error: "No scheduled post with that id." };
  if (row.status !== "scheduled") return { ok: false, error: `This post is "${row.status}" and cannot be cancelled.` };
  db.update(schema.scheduledPosts).set({ status: "cancelled" }).where(eq(schema.scheduledPosts.id, id)).run();
  return { ok: true };
}

export function listScheduledPosts(opts: { includeDone?: boolean } = {}): ScheduledPostView[] {
  const rows = db
    .select()
    .from(schema.scheduledPosts)
    .where(opts.includeDone ? undefined : inArray(schema.scheduledPosts.status, ["scheduled", "posting"]))
    .orderBy(asc(schema.scheduledPosts.scheduledFor))
    .all();
  if (rows.length === 0) return [];
  const sets = db
    .select({ id: schema.carouselSets.id, name: schema.carouselSets.name })
    .from(schema.carouselSets)
    .where(inArray(schema.carouselSets.id, [...new Set(rows.map((r) => r.carouselSetId))]))
    .all();
  const nameById = new Map(sets.map((s) => [s.id, s.name]));
  const counts = new Map<number, number>();
  for (const s of db
    .select({ setId: schema.carouselSlides.carouselSetId })
    .from(schema.carouselSlides)
    .where(inArray(schema.carouselSlides.carouselSetId, [...nameById.keys()]))
    .all()) {
    counts.set(s.setId, (counts.get(s.setId) ?? 0) + 1);
  }
  return rows.map((r) => toView(r, nameById.get(r.carouselSetId) ?? `Design #${r.carouselSetId}`, counts.get(r.carouselSetId) ?? 0));
}

function toView(row: schema.ScheduledPost, designName: string, slideCount: number): ScheduledPostView {
  return {
    id: row.id,
    carouselSetId: row.carouselSetId,
    designName,
    campaignId: row.campaignId,
    channels: parseChannels(row.channels),
    scheduledFor: row.scheduledFor.getTime(),
    status: row.status,
    error: row.error,
    postedAt: row.postedAt ? row.postedAt.getTime() : null,
    slideCount,
  };
}

/** The slides that would be posted, in order: the carousel slot if there is one, with a render on disk. */
function postableRenders(carouselId: number): { filenames: string[]; caption: string } {
  const carousel = getCarousel(carouselId);
  if (!carousel) return { filenames: [], caption: "" };
  const inCarousel = carousel.slides.filter((s) => isCarouselSlot(s.slotKey));
  const slides = (inCarousel.length ? inCarousel : carousel.slides).slice().sort((a, b) => a.slideOrder - b.slideOrder);
  const filenames = slides
    .map((s) => s.renderFilename)
    .filter((f): f is string => !!f && fs.existsSync(renderFilePath(f)));
  return { filenames, caption: slides[0]?.caption ?? "" };
}

const PER_TICK = 5;

/**
 * Post every due row for one tenant. Runs inside runWithTenant(tenantId).
 * Without a publisher nothing is attempted and the reason is written on the
 * row (once, not every minute) so the Schedule page can say so.
 */
export async function dispatchDueScheduledPosts(tenantId: number, baseUrl: string, now: number = Date.now()): Promise<number> {
  const tdb = getTenantDbById(tenantId);
  const due = tdb
    .select()
    .from(schema.scheduledPosts)
    .where(and(eq(schema.scheduledPosts.status, "scheduled"), lte(schema.scheduledPosts.scheduledFor, new Date(now))))
    .orderBy(asc(schema.scheduledPosts.scheduledFor))
    .limit(PER_TICK)
    .all();
  if (due.length === 0) return 0;

  const publisher = getSocialPublisher(tenantId);
  if (!publisher) {
    for (const row of due) {
      if (row.error !== NOT_CONNECTED_MESSAGE) {
        tdb.update(schema.scheduledPosts)
          .set({ error: NOT_CONNECTED_MESSAGE, lastAttemptAt: new Date(now) })
          .where(eq(schema.scheduledPosts.id, row.id))
          .run();
      }
    }
    return 0;
  }

  let posted = 0;
  for (const row of due) {
    tdb.update(schema.scheduledPosts)
      .set({ status: "posting", lastAttemptAt: new Date(now), error: null })
      .where(eq(schema.scheduledPosts.id, row.id))
      .run();

    const { filenames, caption } = postableRenders(row.carouselSetId);
    if (filenames.length === 0) {
      tdb.update(schema.scheduledPosts)
        .set({ status: "failed", error: "This design has no rendered slides to post (open it in Content Studio and generate it)." })
        .where(eq(schema.scheduledPosts.id, row.id))
        .run();
      continue;
    }
    if (!renderTokensConfigured()) {
      tdb.update(schema.scheduledPosts)
        .set({ status: "failed", error: "Posting is not configured on the server (SOCIAL_TOKEN_SECRET or EMAIL_TOKEN_SECRET missing)." })
        .where(eq(schema.scheduledPosts.id, row.id))
        .run();
      continue;
    }
    const imageUrls = filenames.map((f) => `${baseUrl}/api/social/render/${encodeURIComponent(signRenderToken({ tenantId, filename: f })!)}`);

    let result;
    try {
      result = await publisher.publish({ channels: parseChannels(row.channels), caption, imageUrls });
    } catch (err) {
      result = { ok: false as const, error: err instanceof Error ? err.message : "Posting failed." };
    }

    if (result.ok) {
      tdb.update(schema.scheduledPosts)
        .set({ status: "posted", postedAt: new Date(), externalRefs: JSON.stringify(result.refs), error: result.warning ?? null })
        .where(eq(schema.scheduledPosts.id, row.id))
        .run();
      posted++;
    } else {
      tdb.update(schema.scheduledPosts)
        .set({ status: "failed", error: result.error })
        .where(eq(schema.scheduledPosts.id, row.id))
        .run();
    }
  }
  return posted;
}
