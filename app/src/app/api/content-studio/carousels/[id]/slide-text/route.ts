import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { getCarousel, updateSlide } from "@/lib/image/carousels";
import { DESIGNED_TEMPLATE_ID } from "@/lib/image/paintSlide";
import { buildHitMapHtml, pickBand } from "@/lib/design/hitMap";
import { findTextRuns, runAt, replaceRunText } from "@/lib/design/textRuns";
import { loadDesignFonts } from "@/lib/design/fonts";
import { gradedPhotoDataUri, renderDesignToPng, stampLogo } from "@/lib/design/renderDesign";
import { getDesignSystem } from "@/lib/design/system";
import { CANVAS } from "@/lib/ai/designPost";
import { saveRender } from "@/lib/image/renderStore";
import { photoChoiceFor } from "@/lib/image/library";
import { resolveLogoPath } from "@/lib/branding";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Click-to-edit text on a designed slide.
 *
 * GET returns the slide's editable text runs plus a HIT MAP — the same design
 * rendered with each text element filled with a colour that encodes its index.
 * The client resolves a click to a run by reading one pixel, so the click
 * regions are the ones satori actually laid out rather than boxes we
 * recomputed and hoped matched.
 *
 * POST applies one edit: splice the text into the markup, re-render, store.
 *
 * Deliberately NOT metered and NOT an AI call. Editing a word is string work
 * and a render; charging a model call for it would make the obvious way to fix
 * a typo the expensive one.
 */

function slideOf(carouselId: number, slideId: number) {
  const carousel = getCarousel(carouselId);
  if (!carousel) return { error: "Design not found.", status: 404 } as const;
  const slide = carousel.slides.find((s) => s.id === slideId);
  if (!slide) return { error: "Slide not found.", status: 404 } as const;
  if (slide.templateId !== DESIGNED_TEMPLATE_ID || !slide.designHtml) {
    return { error: "That slide was not designed by Adonis, so its text isn't editable here.", status: 400 } as const;
  }
  return { carousel, slide } as const;
}

/**
 * The photo and logo the REAL render used — the hit map has to be laid out
 * identically, and an edited slide has to come back with the same picture it
 * had. THIS SLIDE's photograph, not the library's first: they were the same
 * thing until a set stopped putting one picture on every slide.
 */
function renderInputs(showLogo: boolean, backgroundAssetId: number | null) {
  return {
    photo: photoChoiceFor(backgroundAssetId),
    logoPath: showLogo ? resolveLogoPath() : null,
  };
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const __auth = await guard("user");
  if (__auth) return __auth;

  const slideId = Number(new URL(req.url).searchParams.get("slideId"));
  const found = slideOf(Number(params.id), slideId);
  if ("error" in found) {
    return NextResponse.json({ ok: false, error: found.error }, { status: found.status });
  }
  const html = found.slide.designHtml!;

  const band = pickBand(html);
  const { html: hitHtml, runs } = buildHitMapHtml(html, band);
  if (runs.length === 0) {
    return NextResponse.json({ ok: true, runs: [], band, hitMap: null });
  }

  try {
    const fonts = await loadDesignFonts(getDesignSystem()?.font, getDesignSystem()?.bodyFont, getDesignSystem()?.altFont);
    const { width, height } = CANVAS[found.slide.aspectRatio] ?? CANVAS["1:1"];

    // No logo stamp on the hit map: the logo is painted OVER the design after
    // rendering, so stamping it here would punch an opaque hole through a
    // click region for no reason.
    const png = await renderDesignToPng(hitHtml, width, height, fonts);
    return NextResponse.json({
      ok: true,
      band,
      runs: runs.map((r) => ({ index: r.index, text: r.text })),
      hitMap: `data:image/png;base64,${png.toString("base64")}`,
      width,
      height,
    });
  } catch (err) {
    // A hit map that won't render just means no click-to-edit for this slide.
    // The operator still has regenerate and nudge.
    console.error("[slide-text] hit map render failed:", err);
    return NextResponse.json({ ok: true, runs: [], band, hitMap: null });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const __auth = await guard("user");
  if (__auth) return __auth;

  let body: { slideId?: unknown; index?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const found = slideOf(Number(params.id), Number(body?.slideId));
  if ("error" in found) {
    return NextResponse.json({ ok: false, error: found.error }, { status: found.status });
  }
  const { carousel, slide } = found;

  const index = Number(body?.index);
  const text = typeof body?.text === "string" ? body.text : null;
  if (!Number.isInteger(index) || index < 0 || text === null) {
    return NextResponse.json({ ok: false, error: "Nothing to change." }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ ok: false, error: "That's too much text for one element." }, { status: 400 });
  }

  // Re-scan the CURRENT markup rather than trusting an index the client held
  // on to: the slide may have been regenerated since, in which case that index
  // now points at different words.
  const html = slide.designHtml!;
  const run = runAt(html, index);
  if (!run) {
    return NextResponse.json(
      { ok: false, error: "This slide changed since you opened it — reopen it and try again." },
      { status: 409 },
    );
  }

  const nextHtml = replaceRunText(html, run, text);
  const system = getDesignSystem();
  if (!system) {
    return NextResponse.json({ ok: false, error: "This account has no design system." }, { status: 400 });
  }

  const { width, height } = CANVAS[slide.aspectRatio] ?? CANVAS["1:1"];

  const { photo, logoPath } = renderInputs(carousel.showLogo, slide.backgroundAssetId);

  let rendered = nextHtml;
  try {
    if (rendered.includes("{{PHOTO}}")) {
      if (photo) {
        const uri = await gradedPhotoDataUri(photo.path, width, height, system.photo);
        rendered = rendered.split("{{PHOTO}}").join(uri);
      } else {
        rendered = rendered.replace(/<img[^>]*\{\{PHOTO\}\}[^>]*>/gi, "");
      }
    }
    const fonts = await loadDesignFonts(system.font, system.bodyFont, system.altFont);
    let png = await renderDesignToPng(rendered, width, height, fonts);
    if (logoPath) png = await stampLogo(png, logoPath, width, height);

    const renderFilename = saveRender(png);
    updateSlide(slide.id, { designHtml: nextHtml, renderFilename });

    return NextResponse.json({
      ok: true,
      renderFilename,
      runs: findTextRuns(nextHtml).map((r) => ({ index: r.index, text: r.text })),
    });
  } catch (err) {
    // The edit is NOT saved if it can't be rendered — leaving the markup
    // changed but the picture stale is the one outcome that would confuse
    // someone badly.
    const message = err instanceof Error ? err.message : "Couldn't render that change.";
    console.error("[slide-text] render failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
