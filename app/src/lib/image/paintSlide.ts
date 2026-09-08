import type { CarouselSlide } from "@/lib/db/schema";
import {
  canvasMeasure,
  drawLogoOverlay,
  getTemplate,
  paintSlideChrome,
  type DesignState,
} from "@/lib/image/templates";
import type { DesignSystem } from "@/lib/design/parse";
import type { TemplateCategory } from "@/lib/image/templates";

/**
 * A slide the AI DESIGNED as HTML. Its markup is in `design_html` and the PNG
 * rendered from it in `render_filename`; nothing in TEMPLATES uses this id, so
 * getTemplate() returns null for it and no template path can be entered by
 * accident. Unlike a template slide there is nothing to paint on a canvas --
 * the stored render is the slide.
 */
export const DESIGNED_TEMPLATE_ID = "designed";

export type BrandLabels = {
  businessName?: string;
  website?: string;
  location?: string;
  phone?: string;
};

/**
 * A slide's natural pixel size. A template slide takes its template's; a
 * composed slide has no template to ask, so its own aspectRatio answers —
 * which is why the design system's numbers scale off the real width rather
 * than assuming 1080.
 *
 * Both the preview and the export size their canvas through this, for the
 * same reason they both paint through paintSlide.
 */
export function slideDimensions(slide: CarouselSlide): {
  width: number;
  height: number;
  aspectRatio: "1:1" | "9:16" | "4:5";
} {
  const template = getTemplate(slide.templateId);
  if (template) {
    return {
      width: template.width,
      height: template.height,
      aspectRatio: template.aspectRatio,
    };
  }
  const aspect = slide.aspectRatio ?? "1:1";
  const height =
    aspect === "9:16" ? 1920 : aspect === "4:5" ? 1350 : 1080;
  return { width: 1080, height, aspectRatio: aspect };
}

/**
 * What the EDITOR needs to know about a slide to lay its controls out: the
 * things a Template carries, answered for a composed slide too.
 *
 * The editor used to ask `getTemplate(slide.templateId)` and treat null as
 * "this slot is empty". That is right for an unknown template id and wrong for
 * a composed slide, whose id is the sentinel on purpose — five real slides
 * read back as "NOTHING IN THIS DESIGN YET". Everything the inspector shows
 * now comes from here instead, so both kinds of slide answer the same
 * questions.
 */
export interface SlideSurface {
  id: string;
  name: string;
  aspectRatio: "1:1" | "9:16" | "4:5";
  width: number;
  height: number;
  category: TemplateCategory;
  usesTagline: boolean;
  taglineHint?: string;
  /** True when the AI designed this slide as HTML rather than the operator
   *  picking a template. A designed slide has no slots, so the editor offers
   *  regenerate rather than field-by-field controls. */
  designed: boolean;
}

/**
 * Describe a slide for the editor. Returns null only when there is genuinely
 * nothing to show — no template AND not a composed slide — which is the
 * original "empty slot" meaning.
 *
 * `system` is optional: without one a composed slide can still be described
 * from its own row (its aspect ratio, its stored archetype), because the
 * editor has to be able to say what a slide IS even when it cannot draw it.
 */
export function slideSurface(
  slide: CarouselSlide,
  system?: DesignSystem | null,
): SlideSurface | null {
  const template = getTemplate(slide.templateId);
  if (template) {
    return {
      id: template.id,
      name: template.name,
      aspectRatio: template.aspectRatio,
      width: template.width,
      height: template.height,
      category: template.category,
      usesTagline: !!template.usesTagline,
      taglineHint: template.taglineHint,
      designed: false,
    };
  }
  if (slide.templateId === DESIGNED_TEMPLATE_ID) {
    const dims = slideDimensions(slide);
    return {
      id: DESIGNED_TEMPLATE_ID,
      name: "AI design",
      aspectRatio: dims.aspectRatio,
      width: dims.width,
      height: dims.height,
      category: "carousels",
      // A designed slide has no slots, so no tagline field to offer.
      usesTagline: false,
      designed: true,
    };
  }
  // Anything else is genuinely nothing to show, which is what null has always
  // meant here: an unknown template id.
  void system;
  return null;
}

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
  /**
   * The tenant's design system, for AI-composed slides. Optional and
   * defaulting to null so every existing caller is unchanged and a tenant
   * without a system behaves exactly as before: a composed slide simply has
   * no layout to draw, which is the same nothing an unknown template id has
   * always produced.
   */
  system: DesignSystem | null = null,
): void {
  const template = getTemplate(slide.templateId);
  // A DESIGNED slide is not painted here at all: it was rendered to a PNG
  // server-side and that file is what both the editor and the export use. Only
  // the fixed templates reach a canvas.
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
    // Rows written before the column existed read back as null, not the
    // default, so coalesce here rather than trusting the value.
    headingScale: slide.headingScale ?? 1,
    businessName: brand?.businessName,
    website: brand?.website,
    location: brand?.location,
    phone: brand?.phone,
  };
  const chrome = template.chrome;
  template.render(ctx, design, bg, fontFamilies);
  if (chrome) {
    paintSlideChrome(
      ctx,
      canvasW,
      canvasH,
      chrome,
      canvasMeasure(ctx),
      fontFamilies,
      design,
      logo,
    );
  } else if (logo) {
    drawLogoOverlay(ctx, canvasW, canvasH, logo, template.logoPlacement);
  }
}
