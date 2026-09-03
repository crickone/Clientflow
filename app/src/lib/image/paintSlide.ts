import type { CarouselSlide } from "@/lib/db/schema";
import {
  canvasMeasure,
  drawLogoOverlay,
  getTemplate,
  paintSlideChrome,
  type DesignState,
} from "@/lib/image/templates";

export type BrandLabels = {
  businessName?: string;
  website?: string;
  location?: string;
  phone?: string;
};

export function libraryFileUrl(filename: string) {
  return `/api/content-studio/image-library/file/${encodeURIComponent(filename)}`;
}

export function padNumber(n: number, width: number) {
  return String(n).padStart(width, "0");
}

export function autoTagline(idx: number, total: number) {
  if (total <= 1) return null;
  const w = Math.max(2, String(total).length);
  return `${padNumber(idx + 1, w)} / ${padNumber(total, w)}`;
}

/**
 * Shared paint tail: builds the DesignState from `slide` + `brand`, resolves
 * the template, renders it, then draws the tenant logo on top — the exact
 * sequence run by both SlideCanvas's live-preview effect and
 * renderSlideToBlob's PNG export (the two only ever drift when someone edits
 * one and forgets the other — see f7be3e6). Background image LOADING is
 * deliberately NOT shared: the preview loads it in a cancellable effect
 * (bgRef, aborted mid-load via a token) while the export does a one-shot
 * `await` — so callers resolve `bg` their own way and hand it in already
 * settled (an HTMLImageElement, or null).
 *
 * The logo step forks on `template.chrome`: the 6 carousel templates declare
 * one (see ChromeIntent, in templates.ts) and get their brand credit/
 * indicator/swipe hint plus a MEASURED logo corner from paintSlideChrome, in
 * one pass. Every other template has no `chrome` and keeps the old direct
 * drawLogoOverlay(..., template.logoPlacement) call, unchanged. Exactly one
 * of the two branches ever runs, so no template can get the logo drawn
 * twice.
 */
export function paintSlide(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  slide: CarouselSlide,
  slideIdx: number,
  total: number,
  brand: BrandLabels | undefined,
  fontFamilies: { heading: string; body: string },
  bg: HTMLImageElement | null,
  logo: HTMLImageElement | null,
): void {
  const template = getTemplate(slide.templateId);
  if (!template) return;
  const design: DesignState = {
    headingText: slide.headingText,
    bodyText: slide.bodyText,
    tagline: slide.tagline?.trim() || autoTagline(slideIdx, total),
    accentColor: slide.accentColor,
    backgroundColor: slide.backgroundColor,
    backgroundFit: slide.backgroundFit,
    backgroundOffsetX: slide.backgroundOffsetX,
    backgroundOffsetY: slide.backgroundOffsetY,
    backgroundZoom: slide.backgroundZoom,
    businessName: brand?.businessName,
    website: brand?.website,
    location: brand?.location,
    phone: brand?.phone,
  };
  template.render(ctx, design, bg, fontFamilies);
  if (template.chrome) {
    paintSlideChrome(
      ctx,
      canvasW,
      canvasH,
      template.chrome,
      canvasMeasure(ctx),
      fontFamilies,
      design,
      logo,
    );
  } else if (logo) {
    drawLogoOverlay(ctx, canvasW, canvasH, logo, template.logoPlacement);
  }
}
