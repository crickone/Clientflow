import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/auth";
import { getCarousel, updateSlide } from "@/lib/image/carousels";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getBrandImageStyle } from "@/lib/settings";
import { AiCapError } from "@/lib/ai/usage";
import { generatePostImage } from "@/lib/ai/image/generatePostImage";
import { isImageGenConfigured } from "@/lib/ai/image/falClient";
import { IMAGE_COST_CENTS } from "@/lib/ai/image/falClient";
import {
  buildImagePrompt,
  defaultImageStyle,
  fallbackScene,
  type ImageAspect,
} from "@/lib/ai/image/prompt";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Synchronous single-slide background generation — the designer's Generate /
 * Regenerate / edited-prompt path (the initial auto flow is the detached
 * queue in lib/image/autoImages). Body `{ prompt? }`: a non-empty prompt is
 * used VERBATIM (the textarea edits the full stored prompt — re-wrapping it
 * through buildImagePrompt would double-wrap); otherwise the slide's stored
 * image_prompt; otherwise a fresh house-style prompt from the slide copy.
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

  if (!isImageGenConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Image generation isn't configured." },
      { status: 400 },
    );
  }

  const carouselId = Number(params.id);
  const slideId = Number(params.slideId);
  const carousel = getCarousel(carouselId);
  const slide = carousel?.slides.find((s) => s.id === slideId);
  if (!carousel || !slide) {
    return NextResponse.json({ ok: false, error: "Slide not found." }, { status: 404 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — means "reuse the stored prompt"
  }
  const override =
    typeof body?.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : null;
  const prompt =
    override ??
    slide.imagePrompt ??
    buildImagePrompt({
      houseStyle: getBrandImageStyle() ?? defaultImageStyle(getBusinessProfile()),
      scene: fallbackScene({ heading: slide.headingText, body: slide.bodyText }),
    });

  try {
    const asset = await generatePostImage(
      { prompt, aspectRatio: slide.aspectRatio as ImageAspect },
      { tenantId, agentKey: "carousel" },
    );
    updateSlide(slideId, {
      backgroundAssetId: asset.id,
      imagePrompt: prompt,
      imageStatus: "ready",
      imageError: null,
    });
    const fresh = getCarousel(carouselId)?.slides.find((s) => s.id === slideId) ?? null;
    return NextResponse.json({ ok: true, slide: fresh, asset, costCents: IMAGE_COST_CENTS });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Image generation failed.";
    try {
      updateSlide(slideId, { imageStatus: "failed", imageError: message });
    } catch {
      // Best effort — a failed status write must not mask the real error or
      // strand the JSON error response (mirrors the generate route's cleanup).
    }
    if (err instanceof AiCapError) {
      return NextResponse.json({ ok: false, error: message }, { status: 429 });
    }
    console.error("[slide-image] generation failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
