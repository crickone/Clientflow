import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";

import { getCurrentMembership } from "@/lib/auth";
import { MODELS } from "@/lib/ai/client";
import { isImageGenConfigured } from "@/lib/ai/image/falClient";
import { isImageEditConfigured } from "@/lib/ai/image/openaiImageClient";
import { meteredCreateFailSoft } from "@/lib/ai/metered";
import { getCarousel } from "@/lib/image/carousels";
import { DESIGNED_TEMPLATE_ID } from "@/lib/image/paintSlide";
import { usesPhoto } from "@/lib/design/photoSlots";
import { parsePhotoAssetIds } from "@/lib/image/photoAssetIds";
import {
  guessIntent,
  intentPrompt,
  parseIntent,
  type IntentContext,
} from "@/lib/content-studio/slideIntent";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * WHICH of the three things the redesign dialog can do a typed sentence means.
 *
 * Its own endpoint rather than a step inside the three it chooses between,
 * because the CLIENT has to know the answer: a photograph is made in two
 * requests on purpose (make it, then decide what to do with it), and the
 * dialog reports which step it is on while that runs. A server that picked
 * the route and then did the work itself would have to collapse that back
 * into one silent request.
 *
 * Cheap and fast on purpose: Haiku, one word out, a few hundred tokens in.
 * It is FAIL-SOFT -- an unreachable model, an over-cap tenant or a nonsense
 * answer all fall back to guessIntent's reading of the words, because a
 * router that can block is worse than the three buttons it replaced.
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const o = (body ?? {}) as { note?: unknown; slot?: unknown };
  const note = typeof o.note === "string" ? o.note.trim() : "";
  const slot =
    typeof o.slot === "number" && Number.isInteger(o.slot) && o.slot >= 1 ? o.slot : 1;

  // Nothing typed is not a routing question: a blank note has always meant
  // "give me a different take on this slide", and asking a model about an
  // empty string would be a call that can only agree.
  if (!note) {
    return NextResponse.json({ ok: true, intent: "design" });
  }

  const designed = slide.templateId === DESIGNED_TEMPLATE_ID && !!slide.designHtml;
  const ctx: IntentContext = {
    hasPhotoSlot: designed && usesPhoto(slide.designHtml ?? ""),
    hasPhotoInSlot:
      designed &&
      parsePhotoAssetIds(slide.photoAssetIds, slide.backgroundAssetId)[slot - 1] != null,
    canGenerate: isImageGenConfigured(),
    canEdit: isImageEditConfigured(),
  };

  // A slide that is not an Adonis design has no photo slots and no redesign
  // path worth routing -- the photo route refuses it outright -- so the only
  // honest answer is the one that will be refused with a real message.
  if (!designed) {
    return NextResponse.json({ ok: true, intent: "design" });
  }

  const intent = await meteredCreateFailSoft(
    { tenantId, agentKey: "carousel" },
    () => ({
      model: MODELS.haiku,
      max_tokens: 8,
      messages: [{ role: "user" as const, content: intentPrompt(note, ctx) }],
    }),
    (text) => parseIntent(text, ctx),
    guessIntent(note, ctx),
    "slide-interpret",
  );

  return NextResponse.json({ ok: true, intent });
}
