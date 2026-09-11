import { NextResponse } from "next/server";
import sharp from "sharp";

import { guard } from "@/lib/api/guard";
import { composeDesignSystem, normalizeOverrides, withOverrides, type BrandPalette } from "@/lib/design/direction";
import { AVAILABLE_FAMILIES } from "@/lib/design/fonts";
import { getDirection } from "@/lib/design/directions";
import { loadDesignFonts } from "@/lib/design/fonts";
import { parseDesignSystem } from "@/lib/design/parse";
import { renderDesignToPng } from "@/lib/design/renderDesign";
import { sampleSlides } from "@/lib/design/sampleSlides";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Preview a direction with a palette: three sample slides, rendered through
 * the real renderer with the real fonts, returned as small PNGs. Not metered
 * and no model call -- this is what the operator looks at BEFORE anything is
 * saved, and it must be free to look as many times as it takes.
 */
export async function POST(req: Request) {
  const denied = await guard("admin");
  if (denied) return denied;

  let body: { directionId?: unknown; palette?: unknown; overrides?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const base = typeof body.directionId === "string" ? getDirection(body.directionId) : null;
  if (!base) return NextResponse.json({ ok: false, error: "Unknown design direction." }, { status: 400 });
  // The same clamp Apply uses, so what is previewed is exactly what would be stored.
  const direction = withOverrides(base, normalizeOverrides(body.overrides, AVAILABLE_FAMILIES));

  const palette: BrandPalette = {};
  if (body.palette && typeof body.palette === "object" && !Array.isArray(body.palette)) {
    for (const [k, v] of Object.entries(body.palette as Record<string, unknown>)) {
      const trimmed = typeof v === "string" ? v.trim() : "";
      if (HEX.test(trimmed)) palette[k] = trimmed.toLowerCase();
    }
  }

  const system = parseDesignSystem(composeDesignSystem(direction, palette));
  if (!system) return NextResponse.json({ ok: false, error: "That combination doesn't compose." }, { status: 400 });

  try {
    const fonts = await loadDesignFonts(system.font, system.bodyFont);
    const slides = await Promise.all(
      sampleSlides(system, base.id).map(async (html) => {
        const png = await renderDesignToPng(html, 1080, 1080, fonts);
        const small = await sharp(png).resize(540, 540).png().toBuffer();
        return `data:image/png;base64,${small.toString("base64")}`;
      }),
    );
    return NextResponse.json({ ok: true, slides });
  } catch (err) {
    console.error("[design-direction preview] render failed:", err);
    return NextResponse.json({ ok: false, error: "The preview couldn't be rendered." }, { status: 500 });
  }
}
