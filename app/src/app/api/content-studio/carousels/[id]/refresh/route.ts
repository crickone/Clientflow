import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";

import { copyOf } from "@/lib/content-studio/slideCopy";
import { getCurrentMembership } from "@/lib/auth";
import { getCarousel, updateSlide } from "@/lib/image/carousels";
import { DESIGNED_TEMPLATE_ID } from "@/lib/image/paintSlide";
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

  // A DESIGNED slide's copy lives inside design_html, not in heading/body --
  // it is created with both empty. Refreshing one sent "" and "" to the model
  // and wrote the reply into fields no renderer reads: a metered call that
  // changed nothing on screen. The per-slide Refresh button already hides for
  // designed slides; this is the toolbar's "Refresh all copy" catching up.
  // EVERY slide in the slot, designed or not. The caption belongs to the slot
  // rather than to a kind of slide, and the editor reads it off slides[0]
  // whatever that slide is.
  const allSlotSlides = carousel.slides
    .filter((s) => s.slotKey === slotKey)
    .sort((a, b) => a.slideOrder - b.slideOrder);
  const slotSlides = allSlotSlides.filter(
    (s) => s.templateId !== DESIGNED_TEMPLATE_ID,
  );
  const target = requestedIds
    ? slotSlides.filter((s) => requestedIds.includes(s.id))
    : slotSlides;

  // Caption-only path: rewrite the caption on slide[0] of the slot.
  //
  // It runs BEFORE the copy path's emptiness check, and over allSlotSlides
  // rather than slotSlides. Both were wrong for a designed set, and together
  // they made the Refresh button beside the caption do nothing at all:
  //
  //  - the check rejected the request outright. Optimal Health's sets are
  //    designed end to end, so slotSlides was empty, and the operator got
  //    "No slides to refresh in this slot." for a slot plainly full of them.
  //  - and had it run, updateSlide(slotSlides[0]) would have written the
  //    caption onto the first NON-designed slide while the editor reads it
  //    off the first slide of any kind -- so on a mixed set the new caption
  //    would have landed somewhere nobody was looking.
  //
  // The exclusion is right for the COPY path below and stays there: a designed
  // slide's heading and body columns are empty, and rewriting them is a
  // metered call that changes nothing on screen.
  if (captionOnly) {
    if (allSlotSlides.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No slides in this slot to caption." },
        { status: 400 },
      );
    }
    try {
      const result = await refreshCaptionOnly({
        // copyOf, because a designed slide keeps its words in designHtml and
        // its heading/body columns are empty. Passing those columns wrote the
        // caption from "(empty)" once per slide.
        slides: allSlotSlides.map((s) => copyOf(s, DESIGNED_TEMPLATE_ID)),
        designName: carousel.name,
        tone,
        tenantId,
      });
      updateSlide(allSlotSlides[0].id, { caption: result.caption });
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

  if (target.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No slides to refresh in this slot." },
      { status: 400 },
    );
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
