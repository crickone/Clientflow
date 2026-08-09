import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/auth";
import { getCarousel, updateSlide } from "@/lib/image/carousels";
import {
  refreshCaptionOnly,
  refreshSlidesContent,
} from "@/lib/ai/refreshSlides";
import { AiCapError } from "@/lib/ai/usage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
      { ok: false, error: "Design not found." },
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

  const slotKey = String(body?.slotKey ?? "default");
  const requestedIds: number[] | null = Array.isArray(body?.slideIds)
    ? body.slideIds.map((n: unknown) => Number(n)).filter(Number.isFinite)
    : null;
  const tone = body?.tone ? String(body.tone).trim() : null;
  const captionOnly = body?.captionOnly === true;

  const slotSlides = carousel.slides
    .filter((s) => s.slotKey === slotKey)
    .sort((a, b) => a.slideOrder - b.slideOrder);
  const target = requestedIds
    ? slotSlides.filter((s) => requestedIds.includes(s.id))
    : slotSlides;

  if (target.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No slides to refresh in this slot." },
      { status: 400 },
    );
  }

  // Caption-only path: just rewrite the caption on slide[0] of the slot.
  if (captionOnly) {
    try {
      const result = await refreshCaptionOnly({
        slides: slotSlides.map((s) => ({
          template: s.templateId,
          heading: s.headingText,
          body: s.bodyText,
        })),
        designName: carousel.name,
        tone,
        tenantId,
      });
      updateSlide(slotSlides[0].id, { caption: result.caption });
      return NextResponse.json({
        ok: true,
        carousel: getCarousel(carouselId),
        usage: result.usage,
      });
    } catch (err) {
      // AiCapError (tenant over its monthly AI spend cap) surfaces as a clean
      // 429, not a 500 — matches the assistant chat route's cap handling.
      if (err instanceof AiCapError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: 429 });
      }
      const message =
        err instanceof Error ? err.message : "Caption refresh failed.";
      console.error("[carousel-refresh-caption] error:", err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  let result;
  try {
    result = await refreshSlidesContent({
      slides: target.map((s) => ({
        template: s.templateId,
        heading: s.headingText,
        body: s.bodyText,
      })),
      designName: carousel.name,
      tone,
      tenantId,
    });
  } catch (err) {
    if (err instanceof AiCapError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 429 });
    }
    const message =
      err instanceof Error ? err.message : "Refresh failed.";
    console.error("[carousel-refresh] error:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  // Refresh the caption only when the WHOLE slot is being refreshed (target
  // matches every slide in the slot in order). Per-slide refresh leaves the
  // existing caption alone.
  const isFullSlotRefresh =
    target.length === slotSlides.length &&
    target.every((s, idx) => s.id === slotSlides[idx]?.id);

  for (let i = 0; i < target.length; i++) {
    const slide = target[i];
    const next = result.slides[i];
    const patch: { headingText: string; bodyText: string; caption?: string } = {
      headingText: next.heading,
      bodyText: next.body,
    };
    // Caption lives on slide[0] of the slot. Only update it on a full refresh.
    if (isFullSlotRefresh && slide.id === slotSlides[0].id && result.caption) {
      patch.caption = result.caption;
    }
    updateSlide(slide.id, patch);
  }

  return NextResponse.json({
    ok: true,
    carousel: getCarousel(carouselId),
    usage: result.usage,
  });
}
