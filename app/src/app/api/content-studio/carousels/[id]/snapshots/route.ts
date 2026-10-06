import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { getCarousel, updateSlide } from "@/lib/image/carousels";
import { DESIGNED_TEMPLATE_ID } from "@/lib/image/paintSlide";
import { saveRender } from "@/lib/image/renderStore";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/**
 * Save the editor's pictures of a design's TEMPLATE slides, so the publisher
 * has an image to post (template slides are painted in the browser and have
 * no server render). Multipart: repeated `slideId` + `file` (PNG) pairs, in
 * the same order. Designed slides are skipped: they post their own render.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const denied = await guard("user");
  if (denied) return denied;
  const carousel = getCarousel(Number(params.id));
  if (!carousel) return NextResponse.json({ ok: false, error: "Design not found." }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid upload." }, { status: 400 });
  }
  const ids = form.getAll("slideId").map((v) => Number(v));
  const files = form.getAll("file").filter((v): v is File => v instanceof File);
  if (ids.length === 0 || ids.length !== files.length) {
    return NextResponse.json({ ok: false, error: "Each picture needs its slide." }, { status: 400 });
  }

  let saved = 0;
  for (let i = 0; i < ids.length; i++) {
    const slide = carousel.slides.find((s) => s.id === ids[i]);
    if (!slide || slide.templateId === DESIGNED_TEMPLATE_ID) continue;
    const file = files[i];
    if (file.size === 0 || file.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "A slide picture was empty or too large." }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (!buf.subarray(0, 4).equals(PNG)) {
      return NextResponse.json({ ok: false, error: "Slide pictures must be PNG." }, { status: 400 });
    }
    updateSlide(slide.id, { snapshotFilename: saveRender(buf) });
    saved++;
  }
  return NextResponse.json({ ok: true, saved });
}
