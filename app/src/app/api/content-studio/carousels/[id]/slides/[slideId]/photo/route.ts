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
import { CANVAS } from "@/lib/ai/designPost";
import { resolveLogoPath } from "@/lib/branding";
import { PHOTO_TOKEN } from "@/lib/ai/designPost.parse";
import { AiCapError } from "@/lib/ai/usage";
import { generatePostImage } from "@/lib/ai/image/generatePostImage";
import { isImageGenConfigured } from "@/lib/ai/image/falClient";
import { getBrandImageStyle } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";
import { buildImagePrompt, defaultImageStyle } from "@/lib/ai/image/prompt";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  if (!slide.designHtml.includes(PHOTO_TOKEN)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "This slide was designed without a photograph. Ask for a different design if you want one on it.",
      },
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

  if (o.generate === true) {
    if (!isImageGenConfigured()) {
      return NextResponse.json(
        { ok: false, error: "Image generation isn't configured on this account." },
        { status: 400 },
      );
    }
    // The scene the DESIGN asked for -- stored on the slide when it was
    // written. Without it there is nothing to generate against that would be
    // any more accurate than what is already there.
    const scene = slide.imagePrompt?.trim();
    if (!scene) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This slide has no recorded scene, so there's nothing to generate from. Pick a photo from your library instead.",
        },
        { status: 400 },
      );
    }
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
    updateSlide(slide.id, { renderFilename, backgroundAssetId: photo.id });

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
