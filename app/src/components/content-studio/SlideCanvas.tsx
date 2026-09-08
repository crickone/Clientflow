"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CarouselSlide, ImageLibraryAsset } from "@/lib/db/schema";
import {
  libraryFileUrl,
  paintSlide,
  slideDimensions,
  type BrandLabels,
} from "@/lib/image/paintSlide";
import type { DesignSystem } from "@/lib/design/parse";
import {
  DEFAULT_BODY_FONT_ID,
  DEFAULT_HEADING_FONT_ID,
  FONT_OPTIONS,
  resolveCanvasFont,
} from "@/lib/image/fonts";

/**
 * Pre-load every registered Content Studio font so canvas renders use them
 * immediately instead of falling back to system fonts on first paint.
 */
export function useCanvasFonts(): boolean {
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    (async () => {
      try {
        const families = FONT_OPTIONS.map((opt) => {
          const resolved = getComputedStyle(document.documentElement)
            .getPropertyValue(opt.cssVar)
            .trim();
          return resolved || opt.fallback;
        });
        await Promise.all(
          families.flatMap((family) => [
            document.fonts.load(`700 96px ${family}`),
            document.fonts.load(`400 32px ${family}`),
          ]),
        );
      } catch {}
      setFontsReady(true);
    })();
  }, []);

  return fontsReady;
}

/**
 * Tenant logo overlay — loaded once client-side (same-origin, so the export
 * canvas stays untainted).
 */
export function useLogoImage(
  logoUrl: string | null | undefined,
): HTMLImageElement | null {
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!logoUrl) {
      setLogoImg(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous"; // same-origin /api/branding/logo — keeps export canvases untainted
    img.src = logoUrl;
    img.onload = () => setLogoImg(img);
    img.onerror = () => setLogoImg(null);
  }, [logoUrl]);
  return logoImg;
}

/**
 * Self-contained canvas that loads its own background image and re-renders
 * whenever the slide / library / fonts change. Used both for the big single
 * preview and for each thumbnail in the carousel grid.
 */
export function SlideCanvas({
  slide,
  slideIdx,
  total,
  library,
  fontsReady,
  defaultHeadingFontId = DEFAULT_HEADING_FONT_ID,
  defaultBodyFontId = DEFAULT_BODY_FONT_ID,
  brand,
  logo = null,
  system = null,
}: {
  slide: CarouselSlide;
  slideIdx: number;
  total: number;
  library: ImageLibraryAsset[];
  fontsReady: boolean;
  defaultHeadingFontId?: string;
  defaultBodyFontId?: string;
  brand?: BrandLabels;
  logo?: HTMLImageElement | null;
  /** The tenant's design system, needed to draw an AI-composed slide. Null
   *  for a tenant that has none, which is every tenant until one is authored
   *  — and template slides never look at it. */
  system?: DesignSystem | null;
}) {
  const fontFamilies = useMemo(
    () => ({
      heading: resolveCanvasFont(slide.headingFont, defaultHeadingFontId),
      body: resolveCanvasFont(slide.bodyFont, defaultBodyFontId),
    }),
    [slide.headingFont, slide.bodyFont, defaultHeadingFontId, defaultBodyFontId],
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgRef = useRef<HTMLImageElement | null>(null);
  const tokenRef = useRef(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (slide.backgroundAssetId == null) {
      bgRef.current = null;
      setTick((t) => t + 1);
      return;
    }
    const asset = library.find((a) => a.id === slide.backgroundAssetId);
    if (!asset) {
      bgRef.current = null;
      setTick((t) => t + 1);
      return;
    }
    const token = ++tokenRef.current;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = libraryFileUrl(asset.filename);
    img.onload = () => {
      if (token === tokenRef.current) {
        bgRef.current = img;
        setTick((t) => t + 1);
      }
    };
    img.onerror = () => {
      if (token === tokenRef.current) {
        bgRef.current = null;
        setTick((t) => t + 1);
      }
    };
  }, [slide.backgroundAssetId, library]);

  useEffect(() => {
    if (!fontsReady) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Sized through slideDimensions, not getTemplate, so a composed slide
    // (which has no template) still gets a canvas of its own aspect ratio.
    const dims = slideDimensions(slide);
    canvas.width = dims.width;
    canvas.height = dims.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintSlide(
      ctx,
      canvas.width,
      canvas.height,
      slide,
      slideIdx,
      total,
      brand,
      fontFamilies,
      bgRef.current,
      logo,
      system,
    );
  }, [slide, slideIdx, total, fontsReady, fontFamilies, tick, brand, logo, system]);

  const aspect = slideDimensions(slide).aspectRatio;

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "auto",
        aspectRatio: aspect.replace(":", " / "),
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow-1)",
        background: "#0a0a0a",
        display: "block",
      }}
    />
  );
}
