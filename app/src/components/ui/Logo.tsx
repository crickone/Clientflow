"use client";

import { useEffect, useRef, useState } from "react";

import { ADONIS_LOGO_ASPECT, ADONIS_LOGO_PATH, ADONIS_LOGO_VIEWBOX } from "./adonisLogoPath";

/** The branding route: only its logos have a one-colour shape (`&shape=1`). */
const BRANDING_ROUTE = "/api/branding/logo";

function shapeSrcFor(src: string): string {
  return `${src}${src.includes("?") ? "&" : "?"}shape=1`;
}

/**
 * App-chrome logo lockup. A business logo `src` renders as an image; with none
 * (or a broken one) it falls back to the AdonisAgent mark and wordmark.
 *
 * `oneColour` paints the business logo in a single colour (the theme's text
 * colour by default), so it reads on light and dark alike and follows the
 * light/dark toggle instantly. It uses the logo's shape (`?shape=1`, made
 * server-side) as a CSS mask over currentColor. An invisible <img> of the
 * same shape gives the box its natural width. With no shape (404) it shows
 * the original logo.
 *
 * The fallback is the ADONIS wordmark (brand/logo), drawn in the theme's
 * text colour so it adapts to light and dark and any tenant palette.
 *
 * `alt` carries the business name, used as the img alt and folded into the
 * fallback's aria-label. It is not shown as a visible sub-line: the business
 * name already sits in the chrome's account switcher.
 *
 * Plain <img> (not next/image) so the onError swap works and arbitrary dynamic
 * sources load; the app sets images.unoptimized. The useEffect re-check covers
 * the case where the image errors BEFORE React hydrates (onError alone misses
 * those — a known React <img> pitfall).
 */
export function Logo({
  src,
  alt,
  height = 24,
  oneColour = false,
  colour = "var(--text-primary)",
  onShapeMissing,
}: {
  src: string | null;
  alt: string;
  height?: number;
  oneColour?: boolean;
  colour?: string;
  onShapeMissing?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [shapeFailed, setShapeFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  const shapeRef = useRef<HTMLImageElement>(null);

  const wantsShape = oneColour && !!src && src.startsWith(BRANDING_ROUTE) && !shapeFailed;

  useEffect(() => {
    setShapeFailed(false);
  }, [src]);

  useEffect(() => {
    // Already finished loading and broke before the handler attached.
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
    const shape = shapeRef.current;
    if (shape && shape.complete && shape.naturalWidth === 0) missShape();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, wantsShape]);

  function missShape() {
    setShapeFailed(true);
    onShapeMissing?.();
  }

  if (!src || failed) {
    // The ADONIS wordmark, at the cap height the old lockup used.
    const h = Math.round(height * 0.82);
    return (
      <span role="img" aria-label={alt ? `Adonis — ${alt}` : "Adonis"} style={{ display: "inline-flex", alignItems: "center", flex: "none", maxWidth: "100%" }}>
        <svg aria-hidden viewBox={ADONIS_LOGO_VIEWBOX} style={{ height: h, width: Math.round(h * ADONIS_LOGO_ASPECT), color: "var(--text-primary)", display: "block" }}>
          <path d={ADONIS_LOGO_PATH} fill="currentColor" />
        </svg>
      </span>
    );
  }

  if (wantsShape) {
    const shapeSrc = shapeSrcFor(src);
    const mask = `url("${shapeSrc}")`;
    return (
      <span
        role="img"
        aria-label={alt}
        style={{
          display: "inline-block",
          flex: "none",
          maxWidth: "100%",
          lineHeight: 0,
          color: colour,
          backgroundColor: "currentColor",
          WebkitMaskImage: mask,
          maskImage: mask,
          // contain, not stretch: a wide logo squeezed by a narrow parent
          // shrinks in proportion instead of distorting or overflowing.
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskPosition: "left center",
          maskPosition: "left center",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- sizes the box; the mask above paints it */}
        <img ref={shapeRef} src={shapeSrc} alt="" aria-hidden onError={missShape} style={{ height, width: "auto", maxWidth: "100%", objectFit: "contain", display: "block", opacity: 0 }} />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      style={{ height, width: "auto", opacity: 0.92, display: "block" }}
    />
  );
}
