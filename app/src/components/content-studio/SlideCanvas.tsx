"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CarouselSlide, ImageLibraryAsset } from "@/lib/db/schema";
import {
  DESIGNED_TEMPLATE_ID,
  libraryFileUrl,
  paintSlide,
  slideDimensions,
  type BrandLabels,
} from "@/lib/image/paintSlide";
import { renderFileUrl } from "@/lib/image/renderStore.client";
import { SlideTextEditor } from "./SlideTextEditor";
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
/**
 * A designed slide's stored PNG.
 *
 * Two states this used to get wrong, both seen in production. A slide whose
 * render FAILED has no filename, and the old `renderFilename!` handed the
 * browser a URL for nothing -- a black square with a broken-image glyph and no
 * account of itself. And a render request that fails in flight (the app
 * restarting under the operator is the one that happens) left that same black
 * square permanently, even though the file was there all along.
 *
 * So: say so when there is nothing to show, and retry twice when there should
 * have been. The retry carries a changing query so the browser re-requests
 * rather than serving its own cached failure.
 */
function RenderImage({
  filename,
  aspect,
}: {
  filename: string | null;
  aspect: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [dead, setDead] = useState(false);
  const box = {
    width: "100%",
    height: "auto",
    aspectRatio: aspect.replace(":", " / "),
    borderRadius: "var(--radius)",
    boxShadow: "var(--shadow-1)",
    background: "#0a0a0a",
    display: "block",
  } as const;

  useEffect(() => {
    setAttempt(0);
    setDead(false);
  }, [filename]);

  if (!filename || dead) {
    return (
      <div
        style={{
          ...box,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          textAlign: "center",
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--text-tertiary)",
          border: "1px solid var(--hairline)",
        }}
      >
        {filename
          ? "This slide's picture didn't load. Reload the page; if it stays, ask for a different design."
          : "This slide didn't render. Ask for a different design for it."}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={attempt === 0 ? renderFileUrl(filename) : `${renderFileUrl(filename)}?r=${attempt}`}
      alt=""
      onError={() => {
        if (attempt < 2) {
          // A restarting container answers nothing for a second or two.
          setTimeout(() => setAttempt((a) => a + 1), 900);
        } else {
          setDead(true);
        }
      }}
      style={box}
    />
  );
}

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
  textEdit = null,
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
  /**
   * Makes the text on an AI-designed slide clickable and editable in place.
   * Only the main editor passes it: a filmstrip thumbnail or a gallery tile is
   * too small to aim at a word in, and each one would fetch a hit map of its
   * own for no reason.
   */
  textEdit?: { carouselId: number; onEdited: (renderFilename: string) => void } | null;
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

  // An AI-designed slide is not painted here. Its PNG was rendered server-side
  // and stored, and that same file is what the operator exports -- so showing
  // it is not a preview OF the export, it IS the export. Painting it a second
  // way on a canvas is the one thing that could make the two disagree.
  const designed =
    slide.templateId === DESIGNED_TEMPLATE_ID && !!slide.renderFilename;

  useEffect(() => {
    if (designed) return;
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
  }, [designed, slide, slideIdx, total, fontsReady, fontFamilies, tick, brand, logo, system]);

  const aspect = slideDimensions(slide).aspectRatio;

  if (designed) {
    if (textEdit) {
      return (
        <SlideTextEditor
          carouselId={textEdit.carouselId}
          slideId={slide.id}
          renderFilename={slide.renderFilename!}
          aspectRatio={aspect}
          onEdited={textEdit.onEdited}
        />
      );
    }
    return <RenderImage filename={slide.renderFilename} aspect={aspect} />;
  }

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
