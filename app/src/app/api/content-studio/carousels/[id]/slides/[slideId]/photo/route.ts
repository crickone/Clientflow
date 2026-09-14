import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";

import { getCurrentMembership } from "@/lib/auth";
import { getCarousel, updateSlide } from "@/lib/image/carousels";
import { photoChoiceFor, photoChoices } from "@/lib/image/library";
import { saveRender } from "@/lib/image/renderStore";
import { DESIGNED_TEMPLATE_ID } from "@/lib/image/paintSlide";
import { getDesignSystem } from "@/lib/design/system";
import { loadDesignFonts } from "@/lib/design/fonts";
import {
  gradedPhotoDataUri,
  renderDesignToPng,
  stampLogo,
} from "@/lib/design/renderDesign";
import { CANVAS, redesignSlide } from "@/lib/ai/designPost";
import { resolveLogoPath } from "@/lib/branding";
import { PHOTO_TOKEN } from "@/lib/ai/designPost.parse";
import { findTextRuns } from "@/lib/design/textRuns";
import { AiCapError } from "@/lib/ai/usage";
import { generatePostImage } from "@/lib/ai/image/generatePostImage";
import { isImageGenConfigured } from "@/lib/ai/image/falClient";
import { getBrandImageStyle } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";
import { buildImagePrompt, defaultImageStyle } from "@/lib/ai/image/prompt";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * A photographic brief from the slide's own words, for a slide that never
 * recorded one. Designed slides keep their copy inside the markup rather than
 * in headingText/bodyText, so the text runs ARE the copy — the first two carry
 * the heading and its supporting line, which is as much of a brief as the
 * words can give. Deliberately no house style here: the caller wraps it.
 */
function sceneFromSlideCopy(slide: { designHtml: string | null }): string {
  const words = findTextRuns(slide.designHtml ?? "")
    .map((r) => r.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" — ");
  return words || "an atmospheric scene that fits the brand";
}

/**
 * Change the photograph on an AI-DESIGNED slide, and re-render it.
 *
 * Why a route of its own rather than the existing slides/[slideId]/image: that
 * one sets a slide's BACKGROUND, which a template slide paints underneath its
 * copy at display time. A designed slide has no background -- the photograph is
 * embedded in its markup and baked into a stored PNG -- so changing the asset
 * alone would record a new picture and show the old one. The re-render is the
 * point, and it is what this route adds.
 *
 * Two modes, one body:
 *   { assetId }   -- use a photograph already in the library
 *   { generate }  -- make one from the scene the design asked for, metered
 *
 * NOT metered in the pick case: choosing a file is not an AI call.
 *
 * Either mode needs somewhere to put the picture. A slide the designer built
 * on a flat ground has no {{PHOTO}} placeholder, so PICKING is refused there
 * (there is nothing to swap) while GENERATING redesigns the slide around the
 * new photograph -- two metered calls, and the only way that slide can gain
 * one. Hence the 120s ceiling: an image plus a design.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string; slideId: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const membership = getCurrentMembership();
  if (!membership) {
    return NextResponse.json({ ok: false, error: "No active account" }, { status: 401 });
  }
  const tenantId = membership.tenant.id;

  const carousel = getCarousel(Number(params.id));
  if (!carousel) {
    return NextResponse.json({ ok: false, error: "Design not found." }, { status: 404 });
  }
  const slide = carousel.slides.find((s) => s.id === Number(params.slideId));
  if (!slide) {
    return NextResponse.json({ ok: false, error: "Slide not found." }, { status: 404 });
  }
  if (slide.templateId !== DESIGNED_TEMPLATE_ID || !slide.designHtml) {
    return NextResponse.json(
      { ok: false, error: "That slide was not designed by Adonis." },
      { status: 400 },
    );
  }
  const system = getDesignSystem();
  if (!system) {
    return NextResponse.json(
      { ok: false, error: "This account has no design system." },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const o = (body ?? {}) as { assetId?: unknown; generate?: unknown };

  let photo: { id: number; path: string } | null = null;
  let scene = "";

  if (o.generate === true) {
    if (!isImageGenConfigured()) {
      return NextResponse.json(
        { ok: false, error: "Image generation isn't configured on this account." },
        { status: 400 },
      );
    }
    // The scene the DESIGN asked for, stored on the slide when it was written.
    // Every designed slide records one now (designPost.parse.ts), but slides
    // designed before that, and the odd slide where the model left the field
    // empty, have none — and refusing there made Generate dead on most of a
    // set. The slide's own words are a worse brief than the designer's, and a
    // far better one than nothing.
    scene = slide.imagePrompt?.trim() || sceneFromSlideCopy(slide);
    try {
      const asset = await generatePostImage(
        {
          prompt: buildImagePrompt({
            houseStyle: getBrandImageStyle() ?? defaultImageStyle(getBusinessProfile()),
            scene,
          }),
          aspectRatio: "1:1",
        },
        { tenantId, agentKey: "carousel" },
      );
      photo = { id: asset.id, path: photoChoiceFor(asset.id)?.path ?? "" };
      if (!photo.path) photo = null;
    } catch (err) {
      if (err instanceof AiCapError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: 429 });
      }
      const message = err instanceof Error ? err.message : "Couldn't generate an image.";
      console.error("[slide-photo] generate failed:", err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  } else {
    if (!slide.designHtml.includes(PHOTO_TOKEN)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This slide was designed without a photograph, so there's nowhere to put one. Use “Make a new photo” and Adonis will redesign it around the picture.",
        },
        { status: 400 },
      );
    }
    const assetId = Number(o.assetId);
    if (!Number.isFinite(assetId)) {
      return NextResponse.json({ ok: false, error: "Pick a photo." }, { status: 400 });
    }
    photo = photoChoices().find((p) => p.id === assetId) ?? null;
    if (!photo) {
      return NextResponse.json(
        { ok: false, error: "That photo isn't in your library." },
        { status: 404 },
      );
    }
  }

  if (!photo) {
    return NextResponse.json(
      { ok: false, error: "Couldn't find the photo to use." },
      { status: 500 },
    );
  }

  // A slide designed on a flat ground has no {{PHOTO}} to swap into, so the
  // new picture can only reach it through a redesign: the model rebuilds the
  // slide WITH photography available. Refusing here (which is what used to
  // happen) left "Make a new photo" dead on most of a set, since the designer
  // typically photographs one slide in five.
  if (!slide.designHtml.includes(PHOTO_TOKEN)) {
    try {
      const result = await redesignSlide(
        {
          topic: carousel.name,
          previousHtml: slide.designHtml,
          note: "Use the photograph on this slide.",
          aspectRatio: slide.aspectRatio,
          photo,
          logoPath: carousel.showLogo ? resolveLogoPath() : null,
        },
        { tenantId, agentKey: "carousel" },
      );
      if (!result) {
        return NextResponse.json(
          { ok: false, error: "This account has no design system." },
          { status: 400 },
        );
      }
      updateSlide(slide.id, {
        designHtml: result.slide.html,
        renderFilename: result.slide.renderFilename,
        backgroundAssetId: result.slide.photoAssetId ?? undefined,
        imagePrompt: result.slide.photo || scene,
      });
      const after = getCarousel(carousel.id);
      return NextResponse.json({
        ok: true,
        slide: after?.slides.find((s) => s.id === slide.id) ?? null,
      });
    } catch (err) {
      if (err instanceof AiCapError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: 429 });
      }
      const message =
        err instanceof Error ? err.message : "Couldn't redesign the slide around the photo.";
      console.error("[slide-photo] redesign-with-photo failed:", err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  const { width, height } = CANVAS[slide.aspectRatio] ?? CANVAS["1:1"];
  try {
    const uri = await gradedPhotoDataUri(photo.path, width, height, system.photo);
    const rendered = slide.designHtml.split(PHOTO_TOKEN).join(uri);
    const fonts = await loadDesignFonts(system.font, system.bodyFont, system.altFont);
    let png = await renderDesignToPng(rendered, width, height, fonts);
    const logoPath = carousel.showLogo ? resolveLogoPath() : null;
    if (logoPath) png = await stampLogo(png, logoPath, width, height);

    const renderFilename = saveRender(png);
    // designHtml is untouched: the placeholder is the source of truth, and the
    // photograph is what it resolves to. Storing the resolved markup would bake
    // a data URI into the row and make the next change impossible.
    updateSlide(slide.id, {
      renderFilename,
      backgroundAssetId: photo.id,
      // A slide that had no recorded scene gets the one this generation used,
      // so the next "make a new photo" starts from the same brief.
      ...(scene && !slide.imagePrompt ? { imagePrompt: scene } : {}),
    });

    const after = getCarousel(carousel.id);
    return NextResponse.json({
      ok: true,
      slide: after?.slides.find((s) => s.id === slide.id) ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't render the slide.";
    console.error("[slide-photo] render failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
