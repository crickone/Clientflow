import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { addSlide, createCarousel, listCarousels } from "@/lib/image/carousels";

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

  const set = createCarousel({ name });

  // Optional: seed with a single cover slide so the editor isn't empty
  const seedTemplate = String(body?.seedTemplateId ?? "carousel-cover");
  const seedAspect = String(body?.seedAspectRatio ?? "1:1");
  const aspectRatio = ["1:1", "9:16", "4:5"].includes(seedAspect)
    ? (seedAspect as "1:1" | "9:16" | "4:5")
    : "1:1";

  addSlide({
    carouselSetId: set.id,
    templateId: seedTemplate,
    aspectRatio,
  });

  return NextResponse.json({ ok: true, carouselId: set.id });
}
