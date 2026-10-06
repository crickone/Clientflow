"use client";

import { useEffect, useRef, useState } from "react";

import { ADONIS_LOGO_ASPECT, ADONIS_LOGO_PATH, ADONIS_LOGO_VIEWBOX } from "./adonisLogoPath";

/**
 * App-chrome logo lockup. A business logo `src` renders as an image; with none
 * (or a broken one) it falls back to the AdonisAgent mark and wordmark.
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
}: {
  src: string | null;
  alt: string;
  height?: number;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = ref.current;
    // Already finished loading and broke before the handler attached.
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);

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
