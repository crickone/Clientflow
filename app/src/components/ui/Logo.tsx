"use client";

import { useEffect, useRef, useState } from "react";

/**
 * App-chrome logo lockup. A business logo `src` renders as an image; with none
 * (or a broken one) it falls back to the AdonisAgent mark and wordmark.
 *
 * The fallback is the CURRENT lockup — the square-spiral mark, "Adonis" with a
 * muted "Agent" and the full stop — matching the marketing site and the
 * platform console. It was the Nebula "ADONIS AGENT" wordmark, painted as a
 * CSS mask over /adonis-logo.svg; that is the old identity and it was the last
 * place in the CRM still showing it. Every colour is a theme token, so it
 * still adapts to light and dark the way the mask did.
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
    // Sized from `height`: the mark sits slightly proud of the cap height, the
    // way it does on the site.
    const markSize = Math.round(height * 1.15);
    return (
      <span
        role="img"
        aria-label={alt ? `AdonisAgent — ${alt}` : "AdonisAgent"}
        style={{ display: "inline-flex", alignItems: "center", gap: Math.round(height * 0.45), flex: "none", maxWidth: "100%" }}
      >
        <svg aria-hidden viewBox="0 0 120 120" style={{ width: markSize, height: markSize, flexShrink: 0, color: "var(--text-primary)" }}>
          <path
            d="M20 20H100V100H20V40H80V80H40V60H60"
            fill="none"
            stroke="currentColor"
            strokeWidth={9}
            strokeLinecap="square"
          />
        </svg>
        <span
          aria-hidden
          style={{
            fontFamily: "var(--font-heading), system-ui, sans-serif",
            fontSize: height,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            lineHeight: 1,
            color: "var(--text-primary)",
            whiteSpace: "nowrap",
          }}
        >
          Adonis<span style={{ color: "var(--text-secondary)" }}>Agent</span>
          <span style={{ color: "var(--text-tertiary)" }}>.</span>
        </span>
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
