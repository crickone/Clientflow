import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";

import { redesignSlide } from "@/lib/ai/designPost";
import { AiCapError } from "@/lib/ai/usage";
import { getCurrentMembership } from "@/lib/auth";
import { getCarousel, updateSlide } from "@/lib/image/carousels";
import { photoChoiceFor, photoChoices } from "@/lib/image/library";
import { serialisePhotoAssetIds } from "@/lib/image/photoAssetIds";
import { serialisePhotoScenes } from "@/lib/image/photoScenes";
import { resolveLogoPath } from "@/lib/branding";
import { DESIGNED_TEMPLATE_ID } from "@/lib/image/paintSlide";

export const dynamic = "force-dynamic";

/** Operator copy going into markup the model reads. Angle brackets would make
 *  it look like structure; the renderer never sees this string. */
function escapeText(text: string | null | undefined): string {
  return (text ?? "").replace(/[<>]/g, " ").trim();
}
export const maxDuration = 120;

/**
 * Redesign one slide: the whole editing model for a designed slide.
 *
 * There are no inspector controls to offer -- the AI decided where the heading
 * goes, so there is no fixed slot for a control to address. An operator
 * accepts what they see, regenerates it, or nudges it with a sentence.
 */
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

  const carousel = getCarousel(Number(params.id));
  if (!carousel) {
    return NextResponse.json({ ok: false, error: "Design not found." }, { status: 404 });
  }

  let body: { slideId?: unknown; note?: unknown; photoAssetId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const slideId = Number(body?.slideId);
  const slide = carousel.slides.find((s) => s.id === slideId);
  if (!slide) {
    return NextResponse.json({ ok: false, error: "Slide not found." }, { status: 404 });
  }
  const wasDesigned = slide.templateId === DESIGNED_TEMPLATE_ID && !!slide.designHtml;

  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 400) : "";
  // The photograph the redesign may use: one the caller just made (the
  // two-step "make a new photo" path) or, failing that, the one this slide
  // already had -- so a plain redesign keeps its picture rather than
  // silently reverting to the library's first.
  // photoChoiceFor falls back to the library's FIRST photo when the id it is
  // given doesn't resolve -- it has no notion of "the other candidate" -- so
  // a shape-valid but nonexistent id (deleted asset, typo, stale client
  // state) has to be caught here, or it would silently redesign around an
  // arbitrary library photograph instead of the slide's own.
  const requestedPhotoId = Number(body?.photoAssetId);
  const requestedPhotoExists =
    Number.isFinite(requestedPhotoId) &&
    requestedPhotoId > 0 &&
    photoChoices().some((p) => p.id === requestedPhotoId);
  // photoChoiceFor(null) is not "this slide has none" -- it is the library's
  // FIRST photo, its documented answer for "any photograph" when no id is
  // asked for. A slide with no recorded photograph (background_asset_id
  // cleared, e.g. by a flat redesign) must ask for NONE, not "any": passing
  // its null straight through would have the very next plain redesign of that
  // slide handed an arbitrary library picture, which is exactly what the
  // pre-check above exists to stop for a stale id. Resolve only when there is
  // a real id to resolve.
  const targetPhotoId = requestedPhotoExists ? requestedPhotoId : slide.backgroundAssetId;
  const photo = targetPhotoId != null ? photoChoiceFor(targetPhotoId) : null;

  /**
   * What the model is shown as "the design so far".
   *
   * A slide Adonis designed has its own markup. A FIXED-template slide has
   * none -- it is slots and a painter -- so this stands one up from its copy:
   * structure and words, and deliberately no colours, since the palette the
   * model should use is already in its system prompt and a hex here would
   * invite it to copy the wrong one. That is what lets "this slide, as a
   * Ledger" work on a template slide, which is where an operator reached for
   * it and found nothing.
   */
  const previousHtml =
    slide.designHtml ??
    `<div style="display:flex;flex-direction:column;justify-content:center;width:1080px;height:1080px;padding:76px">` +
      `<span style="font-size:84px;width:928px">${escapeText(slide.headingText)}</span>` +
      `<span style="font-size:28px;width:928px">${escapeText(slide.bodyText)}</span>` +
      `</div>`;

  let result;
  try {
    result = await redesignSlide(
      {
        // The design's name is the topic it was generated from.
        topic: carousel.name,
        previousHtml,
        note: note || null,
        aspectRatio: slide.aspectRatio,
        photo,
        // A second slot needs a second picture. Without the library a redesign
        // was told only one photograph existed, and the prompt then forbade
        // {{PHOTO:2}} -- so "make this a split screen" could not be answered.
        photoLibrary: photoChoices(),
        logoPath: carousel.showLogo ? resolveLogoPath() : null,
      },
      { tenantId, agentKey: "carousel" },
    );
  } catch (err) {
    if (err instanceof AiCapError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 429 });
    }
    const message = err instanceof Error ? err.message : "Redesign failed.";
    console.error("[carousel-redesign] error:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  if (!result) {
    return NextResponse.json(
      { ok: false, error: "This account has no design system, so slides cannot be redesigned." },
      { status: 400 },
    );
  }

  // A redesign can come back with markup and a null render -- the model wrote
  // something satori refuses, or a library photo went missing under it -- and
  // renderOne returns that as a violation rather than throwing. Writing the
  // null onto the row would REPLACE the slide's existing good render with
  // nothing, and the operator would see it silently fall back to the template
  // painter instead of an error. The slide keeps what it had.
  if (!result.slide.renderFilename) {
    return NextResponse.json(
      {
        ok: false,
        error:
          result.slide.violations[result.slide.violations.length - 1] ??
          "Couldn't render the redesigned slide.",
      },
      { status: 500 },
    );
  }

  updateSlide(slide.id, {
    // A template slide that has just been designed BECOMES a designed slide --
    // its painter and its slots no longer describe what is on screen.
    templateId: DESIGNED_TEMPLATE_ID,
    designHtml: result.slide.html,
    renderFilename: result.slide.renderFilename,
    // Explicit null, never `undefined`: drizzle reads undefined as "leave the
    // column", so a redesign that came back using only {{PHOTO:2}} stored the
    // list [null, id] beside a STALE background_asset_id. The renderers read
    // the list and looked right while every direct reader of the column --
    // applyTemplate, the delete path's "is this photo on the slide" check,
    // slideToBlob -- acted on a photograph the slide no longer has.
    // photoAssetId IS photoAssetIds[0] (see designPost.ts).
    backgroundAssetId: result.slide.photoAssetId ?? null,
    // Slot 2's id has nowhere else to live -- background_asset_id is slot 1's
    // column alone -- and the text editor resolves a slide's photographs from
    // exactly this list. Without it a redesigned comparison lost its second
    // photograph the next time anything re-rendered from the row. Null for a
    // one-photograph slide, which also clears a stale list left by the markup
    // this redesign just replaced.
    photoAssetIds: serialisePhotoAssetIds(result.slide.photoAssetIds),
    imagePrompt: result.slide.photo || null,
    // Written every time for the same reason the list of ids is: a redesign
    // replaces the markup wholesale, so a stale second scene left behind would
    // brief slot 2's next generation against a slide that no longer exists.
    // Null for a one-scene redesign, which is also how that stale list clears.
    photoScenes: serialisePhotoScenes(result.slide.photoScenes),
  });
  // The superseded render is deliberately NOT deleted. The editor offers a
  // one-step undo, and undo restoring a row that points at a file we just
  // removed would be worse than the disk it costs -- a render is around 60KB
  // and the filename is a content hash, so identical output dedupes. A sweep
  // for renders no row references belongs with the other housekeeping jobs,
  // not in the request path.

  return NextResponse.json({
    ok: true,
    carousel: getCarousel(carousel.id),
    usage: result.usage,
    design: { violations: result.slide.violations },
  });
}
