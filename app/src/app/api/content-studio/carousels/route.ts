import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { addSlide, createCarousel, listCarousels } from "@/lib/image/carousels";
import {
  DEFAULT_SLOT,
  isValidSlotKey,
  templateForNewSlide,
} from "@/lib/image/slots";

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
  const seedSlot = String(body?.seedSlotKey ?? DEFAULT_SLOT);
  if (!isValidSlotKey(seedSlot)) {
    return NextResponse.json(
      { ok: false, error: "Unknown slot." },
      { status: 400 },
    );
  }

  // Optional: seed slides so the editor isn't empty. A carousel can ask for
  // the number of slides it was started with, so "I'll write it myself" gets
  // the slides the user chose rather than one.
  const seedTemplate = String(body?.seedTemplateId ?? "carousel-cover");
  const requestedCount = Number(body?.seedSlideCount ?? 1);
  const seedCount =
    Number.isFinite(requestedCount) && requestedCount >= 1
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
