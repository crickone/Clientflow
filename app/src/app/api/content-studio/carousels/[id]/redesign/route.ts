import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";

import { redesignSlide } from "@/lib/ai/designPost";
import { AiCapError } from "@/lib/ai/usage";
import { getCurrentMembership } from "@/lib/auth";
import { getCarousel, updateSlide } from "@/lib/image/carousels";
import { libraryFilePath, listLibraryAssets } from "@/lib/image/library";
import { DESIGNED_TEMPLATE_ID } from "@/lib/image/paintSlide";

export const dynamic = "force-dynamic";
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

  let body: { slideId?: unknown; note?: unknown };
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
  if (slide.templateId !== DESIGNED_TEMPLATE_ID || !slide.designHtml) {
    return NextResponse.json(
      { ok: false, error: "That slide was not designed by Adonis, so there is nothing to redesign." },
      { status: 400 },
    );
  }

  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 400) : "";
  const firstPhoto = listLibraryAssets().find(
    (a: { kind?: string | null }) => a.kind !== "video",
  );

  let result;
  try {
    result = await redesignSlide(
      {
        // The design's name is the topic it was generated from.
        topic: carousel.name,
        previousHtml: slide.designHtml,
        note: note || null,
        aspectRatio: slide.aspectRatio,
        photoSource: firstPhoto ? libraryFilePath(firstPhoto.filename) : null,
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

  updateSlide(slide.id, {
    designHtml: result.slide.html,
    renderFilename: result.slide.renderFilename,
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
