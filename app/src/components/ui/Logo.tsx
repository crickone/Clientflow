"use client";

import { useEffect, useRef, useState } from "react";

/**
 * App-chrome logo lockup. When `src` is null (the current default) it renders the
 * AdonisAgent Nebula wordmark with the business name beneath it under a dash — the
 * product mark co-branded with the tenant. When a business logo src is given it
 * renders that image, falling back to the lockup if the image fails to load.
 * `alt` carries the business name (used both as img alt and as the lockup sub-line).
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
    // AdonisAgent designed wordmark ("ADONIS AGENT"), rendered as a
    // currentColor CSS mask so it adapts to ANY tenant theme (light or dark) —
    // /adonis-logo.svg is the wordmark on a cropped viewBox. The business name
    // rides in aria-label rather than a visible sub-line: it's already shown in
    // the chrome's business switcher, and a designed wordmark reads cleaner solo.
    const wmWidth = Math.round(height * 2.326); // matches the 1500:645 cropped viewBox aspect
    return (
      <span
        role="img"
        aria-label={alt ? `AdonisAgent — ${alt}` : "AdonisAgent"}
        style={{
          display: "inline-block",
          flex: "none",
          height,
          width: wmWidth,
          maxWidth: "100%",
          color: "var(--text-primary)",
          backgroundColor: "currentColor",
          WebkitMaskImage: "url(/adonis-logo.svg)",
          maskImage: "url(/adonis-logo.svg)",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskPosition: "left center",
          maskPosition: "left center",
        }}
      />
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
