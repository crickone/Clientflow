import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/auth";
import { getCarousel } from "@/lib/image/carousels";
import { queueCarouselGeneration } from "@/lib/image/carouselGeneration";
import { AiCapError, assertAiAllowed } from "@/lib/ai/usage";

export const dynamic = "force-dynamic";

/**
 * Start writing a carousel. Returns as soon as the run is QUEUED, not when it
 * finishes.
 *
 * The work used to happen inside this request, which tied a minute-long AI run
 * to one browser tab sitting on a "Writing..." screen: navigating away took the
 * generation with it, and left nothing behind to come back to. It now runs in a
 * detached tenant-bound continuation (see lib/image/carouselGeneration) with its
 * state on the design row, so the client can navigate straight into the editor
 * and watch the slides arrive.
 *
 * `maxDuration` is therefore gone: nothing long-running happens in this handler
 * any more.
 *
 * The generation self-meters under the "carousel" agentKey, which groups this
 * with the refresh route's spend — both are the one Content Studio carousel
 * feature — and stays distinct from the Marketing agent's draft_carousel tool.
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
  const carouselId = Number(params.id);
  const carousel = getCarousel(carouselId);
  if (!carousel) {
    return NextResponse.json(
      { ok: false, error: "Carousel not found." },
      { status: 404 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const topic = String(body?.topic ?? "").trim();
  const slideCount = Number(body?.slideCount);
  const tone = body?.tone ? String(body.tone).trim() : null;
  const slotKey = String(body?.slotKey ?? "default");
  const replaceExisting = body?.replaceExisting !== false; // default true

  if (!topic) {
    return NextResponse.json(
      { ok: false, error: "Topic is required." },
      { status: 400 },
    );
  }
  if (!Number.isFinite(slideCount) || slideCount < 2 || slideCount > 10) {
    return NextResponse.json(
      { ok: false, error: "Slide count must be between 2 and 10." },
      { status: 400 },
    );
  }

  // Two runs on one design would race for the same slot. The second is refused
  // rather than queued: the operator meant to generate once.
  if (carousel.generationStatus === "writing") {
    return NextResponse.json(
      { ok: false, error: "This design is already being written." },
      { status: 409 },
    );
  }

  // Checked HERE, in the request, so a tenant over its allowance gets a clean
  // 429 on the button it pressed. Inside the continuation the same error would
  // only reach them a beat later, written onto a design they had already been
  // sent to. The generation re-checks on its own metered calls regardless.
  try {
    assertAiAllowed(tenantId);
  } catch (err) {
    if (err instanceof AiCapError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 429 });
    }
    throw err;
  }

  queueCarouselGeneration({
    tenantId,
    carouselId,
    topic,
    slideCount,
    tone,
    slotKey,
    replaceExisting,
  });

  return NextResponse.json({
    ok: true,
    status: "writing",
    carousel: getCarousel(carouselId),
  });
}
