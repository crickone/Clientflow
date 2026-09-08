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
import { deserializeLayoutSpec, isSpecError } from "@/lib/design/grammar";
import { paintLayout } from "@/lib/image/paintLayout";

/**
 * `carousel_slides.template_id` is notNull, so a slide whose layout the AI
 * composed stores this sentinel there and puts the real spec in `layout_json`.
 * Nothing in TEMPLATES uses the id, so getTemplate() returns null for it and
 * the pre-existing path cannot be entered by accident.
 */
export const COMPOSED_TEMPLATE_ID = "composed";

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
  /** True when this slide's layout was composed rather than picked. */
  composed: boolean;
}

const ARCHETYPE_NAMES: Record<string, string> = {
  statement: "Statement",
  split: "Split",
  stack: "Stack",
  list: "List",
  quote: "Quote",
  stat: "Stat",
};

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
      composed: false,
    };
  }
  if (slide.templateId !== COMPOSED_TEMPLATE_ID) return null;

  const dims = slideDimensions(slide);
  // The archetype is read straight off the stored JSON rather than through the
  // grammar, so a spec that no longer validates against the tenant's system
  // still names itself instead of collapsing to "empty".
  let archetype = "";
  let hasLabel = false;
  try {
    const raw = JSON.parse(slide.layoutJson ?? "null") as {
      archetype?: unknown;
      slots?: { level?: unknown }[];
    } | null;
    if (raw && typeof raw.archetype === "string") archetype = raw.archetype;
    if (Array.isArray(raw?.slots)) {
      hasLabel = raw.slots.some((s) => s?.level === "label");
    }
  } catch {
    // A corrupt layout still describes a composed slide; the editor shows the
    // violation separately.
  }
  void system;
  return {
    id: COMPOSED_TEMPLATE_ID,
    name: archetype
      ? `Composed · ${ARCHETYPE_NAMES[archetype] ?? archetype}`
      : "Composed",
    aspectRatio: dims.aspectRatio,
    width: dims.width,
    height: dims.height,
    category: "carousels",
    usesTagline: hasLabel,
    composed: true,
  };
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
  const composed = slide.templateId === COMPOSED_TEMPLATE_ID;
  if (!template && !composed) return;
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
  // THE FORK. It lives here, inside the one function both the live preview
  // and the PNG export call, so exactly one branch runs and the same one runs
  // on both sides — which is the whole reason preview equals export. A
  // composed slide with no system, or with a spec that no longer parses, is
  // drawn as nothing rather than silently swapped for a fixed template: the
  // editor surfaces the violation instead (see lib/design/validate.ts).
  const chrome = template?.chrome;
  if (composed) {
    if (!system) return;
    const spec = deserializeLayoutSpec(slide.layoutJson, system);
    if (isSpecError(spec)) return;
    paintLayout(ctx, canvasW, canvasH, spec, system, design, bg, fontFamilies);
    if (spec.chrome) {
      paintSlideChrome(
        ctx,
        canvasW,
        canvasH,
        spec.chrome,
        canvasMeasure(ctx),
        fontFamilies,
        design,
        logo,
      );
    } else if (logo) {
      drawLogoOverlay(ctx, canvasW, canvasH, logo);
    }
    return;
  }

  template!.render(ctx, design, bg, fontFamilies);
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
    drawLogoOverlay(ctx, canvasW, canvasH, logo, template!.logoPlacement);
  }
}
