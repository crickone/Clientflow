import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";

import { getCurrentMembership } from "@/lib/auth";
import { getCarousel, updateSlide } from "@/lib/image/carousels";
import { photoChoiceFor, photoChoices } from "@/lib/image/library";
import { DESIGNED_TEMPLATE_ID } from "@/lib/image/paintSlide";
import { getDesignSystem } from "@/lib/design/system";
import { renderDesignedSlide } from "@/lib/design/renderDesignedSlide";
import { redesignSlide } from "@/lib/ai/designPost";
import { resolveLogoPath } from "@/lib/branding";
import { photoSlotsUsed, usesPhoto } from "@/lib/design/photoSlots";
import { parsePhotoAssetIds, serialisePhotoAssetIds } from "@/lib/image/photoAssetIds";
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
 * Three shapes of body, not two -- the dialog (ImageDesigner.tsx) used to
 * drive this route's one-shot generate mode, but now runs "make a new
 * photo" as two requests of its own so it can name which one is in flight:
 *
 *   { assetId }                     -- swap in a photo already in the
 *                                       library, and re-render. Not an AI
 *                                       call, so not metered.
 *   { generate, onlyGenerate: true } -- the dialog's step 1: make a photo
 *                                       from the scene the design asked for,
 *                                       save it to the library, and hand it
 *                                       straight back. Metered; touches
 *                                       nothing else on the slide. The
 *                                       dialog does step 2 itself: another
 *                                       call here with { assetId } when the
 *                                       slide has a {{PHOTO}} slot, or a
 *                                       call to .../redesign with
 *                                       { photoAssetId } when it does not.
 *   { generate }  (no onlyGenerate)  -- the older one-shot mode: generate,
 *                                       then either swap the result in or
 *                                       redesign the slide around it, all in
 *                                       this one request -- up to two
 *                                       metered calls. Still supported for
 *                                       any caller besides the dialog, but
 *                                       no longer exercised by the app's own
 *                                       client. This is why the route still
 *                                       carries the 120s ceiling below: an
 *                                       image plus a design, in one request.
 *
 * Every shape also takes an optional `slot` -- which of the slide's photo
 * slots the picture is for, 1-based. Absent means slot 1, so every caller
 * written before two-photograph slides keeps working.
 *
 * A slide the designer built on a flat ground has no {{PHOTO}} placeholder,
 * so PICKING is refused there (there is nothing to swap) while GENERATING
 * (the one-shot mode above) redesigns the slide around the new photograph
 * instead.
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
  const o = (body ?? {}) as {
    assetId?: unknown;
    generate?: unknown;
    onlyGenerate?: unknown;
    /** Which photo slot to act on, 1-based. Absent means slot 1. */
    slot?: unknown;
  };

  // Resolved here, above every branch, because all three body shapes can end
  // with a photograph on this slide and each of them has to target the same
  // slot. Absent means slot 1, so every caller written before two-photograph
  // slides keeps working unchanged. A slot the markup does not use is refused
  // rather than stored: a photograph nothing renders is exactly how the
  // columns and the pixels drift apart. A slide with NO slots at all is not
  // refused -- it falls through to the redesign branch below, which gives it
  // one.
  const slots = photoSlotsUsed(slide.designHtml);
  const requestedSlot = Number(o.slot);
  const slot = Number.isFinite(requestedSlot) && requestedSlot >= 1 ? requestedSlot : 1;
  if (slots.length > 0 && !slots.includes(slot)) {
    return NextResponse.json(
      { ok: false, error: `This slide has no photo slot ${slot}.` },
      { status: 400 },
    );
  }

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

      // The client's two-step path: make the photograph, put it in the
      // library, hand it back, and touch nothing else. The client then
      // decides -- swap it in, or redesign around it -- and can say which
      // step it is on while it does, which one long request never could.
      if (o.onlyGenerate === true) {
        return NextResponse.json({ ok: true, asset });
      }
    } catch (err) {
      if (err instanceof AiCapError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: 429 });
      }
      const message = err instanceof Error ? err.message : "Couldn't generate an image.";
      console.error("[slide-photo] generate failed:", err);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  } else {
    if (!usesPhoto(slide.designHtml)) {
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
  if (!usesPhoto(slide.designHtml)) {
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
      // A redesign can come back with markup and no render -- the model wrote
      // something satori refuses, or the render otherwise failed -- and
      // renderFilename is null rather than the redesign throwing. Writing that
      // null onto the row would REPLACE the slide's existing good render with
      // nothing, and the operator would see it silently fall back to the
      // template painter instead of an error. The slide keeps what it had.
      if (!result.slide.renderFilename) {
        return NextResponse.json(
          {
            ok: false,
            error:
              result.slide.violations[result.slide.violations.length - 1] ??
              "Couldn't render the slide with that photograph.",
          },
          { status: 500 },
        );
      }
      updateSlide(slide.id, {
        designHtml: result.slide.html,
        renderFilename: result.slide.renderFilename,
        backgroundAssetId: result.slide.photoAssetId ?? undefined,
        // The redesign is free to come back with TWO photographs -- the model
        // is taught {{PHOTO:2}} and a comparison is the obvious thing to reach
        // for -- and slot 2's id has nowhere but this column to live. Writing
        // only background_asset_id rendered both pictures and remembered one:
        // the next text edit read the list as a single entry and dropped slot 2
        // for good. Null for a one-photograph result, which also clears a stale
        // list left by the markup this redesign just replaced.
        photoAssetIds: serialisePhotoAssetIds(result.slide.photoAssetIds),
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

  // The slide's WHOLE cast of photographs, with one part recast. A swap that
  // knew only about the picture it was changing re-rendered a two-photograph
  // slide with the other slot empty, and wrote that render onto the row.
  //
  // The list is padded to reach the slot when the slide has never had one
  // there (a second slot in the markup that no photograph has filled yet), so
  // slot 1 keeps index 0 whatever order the operator works in.
  const nextIds = parsePhotoAssetIds(slide.photoAssetIds, slide.backgroundAssetId);
  while (nextIds.length < slot) nextIds.push(null);
  nextIds[slot - 1] = photo.id;
  // A slot whose id is missing from the library (deleted under the slide)
  // resolves to null and loses its <img>, rather than photoChoiceFor's
  // "any photograph" answer dropping an unrelated picture into it.
  const photos = nextIds.map((id) => (id == null ? null : photoChoiceFor(id)));

  try {
    // The whole recipe -- grade, substitute, render, stamp, measure, store --
    // behind one call. The overflow it measures has nowhere to go in this
    // route's response shape yet; it is computed all the same, because the
    // alternative is a render path that cannot tell a clipped slide from a
    // clean one.
    const { filename: renderFilename } = await renderDesignedSlide({
      html: slide.designHtml,
      aspectRatio: slide.aspectRatio,
      photos,
      logoPath: carousel.showLogo ? resolveLogoPath() : null,
      system,
    });
    // designHtml is untouched: the placeholder is the source of truth, and the
    // photograph is what it resolves to. Storing the resolved markup would bake
    // a data URI into the row and make the next change impossible.
    updateSlide(slide.id, {
      renderFilename,
      // Both columns in one call, so they cannot disagree. background_asset_id
      // is slot 1's home and photo_asset_ids is the rest; writing only the
      // former left a stale [a,b] in the list, and the text-edit route prefers
      // the list -- so the operator's swap was silently reverted the next time
      // they changed a word.
      backgroundAssetId: nextIds[0] ?? null,
      photoAssetIds: serialisePhotoAssetIds(nextIds),
      // scene is only ever set on the one-shot { generate } path above; a
      // plain { assetId } swap -- what the dialog's own step 2 now sends --
      // reaches here with scene still "", so this is a no-op for it and
      // imagePrompt is left as the slide already had it.
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
