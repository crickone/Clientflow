import "server-only";

import { db, schema } from "@/lib/db";
import type { CarouselSet, CarouselSlide } from "@/lib/db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";

export interface CarouselWithSlides extends CarouselSet {
  slides: CarouselSlide[];
}

export function createCarousel(input: { name: string }): CarouselSet {
  const [row] = db
    .insert(schema.carouselSets)
    .values({ name: input.name })
    .returning()
    .all();
  return row;
}

/**
 * Return a carousel set with every slide across every slot. The UI groups
 * them by slot_key client-side.
 */
export function getCarousel(id: number): CarouselWithSlides | null {
  const set = db
    .select()
    .from(schema.carouselSets)
    .where(eq(schema.carouselSets.id, id))
    .get();
  if (!set) return null;
  const slides = db
    .select()
    .from(schema.carouselSlides)
    .where(eq(schema.carouselSlides.carouselSetId, id))
    .orderBy(
      asc(schema.carouselSlides.slotKey),
      asc(schema.carouselSlides.slideOrder),
    )
    .all();
  return { ...set, slides };
}

export interface CarouselSummary extends CarouselSet {
  slideCount: number;
  firstSlide: CarouselSlide | null;
}

export function listCarousels(): CarouselSummary[] {
  const sets = db
    .select()
    .from(schema.carouselSets)
    .orderBy(desc(schema.carouselSets.updatedAt))
    .all();
  return sets.map((s) => {
    const slides = db
      .select()
      .from(schema.carouselSlides)
      .where(eq(schema.carouselSlides.carouselSetId, s.id))
      .orderBy(asc(schema.carouselSlides.slideOrder))
      .all();
    return { ...s, slideCount: slides.length, firstSlide: slides[0] ?? null };
  });
}

export function updateCarousel(id: number, patch: { name?: string }) {
  db.update(schema.carouselSets)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.carouselSets.id, id))
    .run();
}

export function deleteCarousel(id: number) {
  db.delete(schema.carouselSets)
    .where(eq(schema.carouselSets.id, id))
    .run();
}

export interface AddSlideInput {
  carouselSetId: number;
  slotKey?: string;
  templateId: string;
  aspectRatio: "1:1" | "9:16" | "4:5";
  headingText?: string;
  bodyText?: string;
  tagline?: string | null;
  caption?: string;
  headingFont?: string | null;
  bodyFont?: string | null;
  accentColor?: string;
  backgroundColor?: string | null;
  backgroundAssetId?: number | null;
  backgroundFit?: "cover" | "contain";
  backgroundOffsetX?: number;
  backgroundOffsetY?: number;
  backgroundZoom?: number;
}

export function addSlide(input: AddSlideInput): CarouselSlide {
  const slotKey = input.slotKey ?? "default";

  const max = db
    .select({
      m: sql<number>`COALESCE(MAX(${schema.carouselSlides.slideOrder}), -1)`,
    })
    .from(schema.carouselSlides)
    .where(
      and(
        eq(schema.carouselSlides.carouselSetId, input.carouselSetId),
        eq(schema.carouselSlides.slotKey, slotKey),
      ),
    )
    .get();
  const nextOrder = (max?.m ?? -1) + 1;

  const [row] = db
    .insert(schema.carouselSlides)
    .values({
      carouselSetId: input.carouselSetId,
      slotKey,
      slideOrder: nextOrder,
      templateId: input.templateId,
      aspectRatio: input.aspectRatio,
      headingText: input.headingText ?? "",
      bodyText: input.bodyText ?? "",
      tagline: input.tagline ?? null,
      caption: input.caption ?? "",
      headingFont: input.headingFont ?? null,
      bodyFont: input.bodyFont ?? null,
      accentColor: input.accentColor ?? "#2c6ce0",
      backgroundColor: input.backgroundColor ?? null,
      backgroundAssetId: input.backgroundAssetId ?? null,
      backgroundFit: input.backgroundFit ?? "cover",
      backgroundOffsetX: input.backgroundOffsetX ?? 0.5,
      backgroundOffsetY: input.backgroundOffsetY ?? 0.5,
      backgroundZoom: input.backgroundZoom ?? 1,
    })
    .returning()
    .all();

  db.update(schema.carouselSets)
    .set({ updatedAt: new Date() })
    .where(eq(schema.carouselSets.id, input.carouselSetId))
    .run();

  return row;
}

export function updateSlide(
  slideId: number,
  patch: Partial<Omit<CarouselSlide, "id" | "carouselSetId" | "createdAt">>,
) {
  const before = db
    .select()
    .from(schema.carouselSlides)
    .where(eq(schema.carouselSlides.id, slideId))
    .get();
  if (!before) return;
  db.update(schema.carouselSlides)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.carouselSlides.id, slideId))
    .run();
  db.update(schema.carouselSets)
    .set({ updatedAt: new Date() })
    .where(eq(schema.carouselSets.id, before.carouselSetId))
    .run();
}

export function deleteSlide(slideId: number) {
  const before = db
    .select()
    .from(schema.carouselSlides)
    .where(eq(schema.carouselSlides.id, slideId))
    .get();
  if (!before) return;
  db.delete(schema.carouselSlides)
    .where(eq(schema.carouselSlides.id, slideId))
    .run();
  // Compact slide_order within the slot so it stays 0..N-1
  const remaining = db
    .select()
    .from(schema.carouselSlides)
    .where(
      and(
        eq(schema.carouselSlides.carouselSetId, before.carouselSetId),
        eq(schema.carouselSlides.slotKey, before.slotKey),
      ),
    )
    .orderBy(asc(schema.carouselSlides.slideOrder))
    .all();
  remaining.forEach((s, idx) => {
    if (s.slideOrder !== idx) {
      db.update(schema.carouselSlides)
        .set({ slideOrder: idx })
        .where(eq(schema.carouselSlides.id, s.id))
        .run();
    }
  });
  db.update(schema.carouselSets)
    .set({ updatedAt: new Date() })
    .where(eq(schema.carouselSets.id, before.carouselSetId))
    .run();
}

/**
 * Delete every slide inside a single slot. Used by Generate to wipe before
 * inserting fresh slides.
 */
export function deleteSlot(carouselSetId: number, slotKey: string) {
  db.delete(schema.carouselSlides)
    .where(
      and(
        eq(schema.carouselSlides.carouselSetId, carouselSetId),
        eq(schema.carouselSlides.slotKey, slotKey),
      ),
    )
    .run();
  db.update(schema.carouselSets)
    .set({ updatedAt: new Date() })
    .where(eq(schema.carouselSets.id, carouselSetId))
    .run();
}

/**
 * Re-order slides within a slot by passing an array of slide IDs in their
 * new order.
 */
export function reorderSlides(
  carouselSetId: number,
  slideIds: number[],
) {
  slideIds.forEach((slideId, idx) => {
    db.update(schema.carouselSlides)
      .set({ slideOrder: idx, updatedAt: new Date() })
      .where(eq(schema.carouselSlides.id, slideId))
      .run();
  });
  db.update(schema.carouselSets)
    .set({ updatedAt: new Date() })
    .where(eq(schema.carouselSets.id, carouselSetId))
    .run();
}
