import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { addSlide, createCarousel, listCarousels } from "@/lib/image/carousels";
import {
  DEFAULT_SLOT,
  isValidSlotKey,
  templateForNewSlide,
} from "@/lib/image/slots";
import { getTemplate } from "@/lib/image/templates";

export const dynamic = "force-dynamic";

export async function GET() {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const carousels = listCarousels();
  return NextResponse.json({ ok: true, carousels });
}

export async function POST(req: Request) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const name = String(body?.name ?? "").trim();
  if (!name) {
    return NextResponse.json(
      { ok: false, error: "Name is required." },
      { status: 400 },
    );
  }

  // Which slot the seed slides go into. This is NOT the same thing as the
  // template: seeding a "carousel-content" TEMPLATE into the "default" SLOT
  // puts the slide where the editor's Carousels tab can't see it, so the
  // caller has to say the slot outright.
  // A slot key must name a real carousel template (or be the single-image
  // slot), because the first slide is created WITH that key as its template.
  // Any other "carousel-*" string would pass the prefix test and then leave a
  // slide no template can render — an editor stuck on "Nothing here yet" with
  // a real row behind it.
  const seedSlot = String(body?.seedSlotKey ?? DEFAULT_SLOT);
  const seedSlotOk =
    seedSlot === DEFAULT_SLOT ||
    (isValidSlotKey(seedSlot) && getTemplate(seedSlot)?.category === "carousels");
  if (!seedSlotOk) {
    return NextResponse.json(
      { ok: false, error: "Unknown slot." },
      { status: 400 },
    );
  }

  // Optional: seed slides so the editor isn't empty. A carousel can ask for
  // the number of slides it was started with, so "I'll write it myself" gets
  // the slides the user chose rather than one.
  const requestedTemplate = String(body?.seedTemplateId ?? "carousel-cover");
  if (!getTemplate(requestedTemplate)) {
    return NextResponse.json(
      { ok: false, error: "Unknown template." },
      { status: 400 },
    );
  }
  const seedTemplate = requestedTemplate;

  // Only a carousel is a series; a single image is one slide by definition.
  const requestedCount = Number(body?.seedSlideCount ?? 1);
  const seedCount =
    seedSlot === DEFAULT_SLOT
      ? 1
      : Number.isFinite(requestedCount) && requestedCount >= 1
        ? Math.min(Math.floor(requestedCount), 10)
        : 1;
  const seedAspect = String(body?.seedAspectRatio ?? "1:1");
  const aspectRatio = ["1:1", "9:16", "4:5"].includes(seedAspect)
    ? (seedAspect as "1:1" | "9:16" | "4:5")
    : "1:1";

  const set = createCarousel({ name });

  for (let i = 0; i < seedCount; i++) {
    addSlide({
      carouselSetId: set.id,
      slotKey: seedSlot,
      // Same rule the editor's "Add slide" uses, so a seeded carousel is
      // indistinguishable from one built by hand.
      templateId: templateForNewSlide(seedSlot, i, seedTemplate),
      aspectRatio,
    });
  }

  return NextResponse.json({ ok: true, carouselId: set.id });
}
