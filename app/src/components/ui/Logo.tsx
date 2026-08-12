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
    const markSize = Math.round(height * 1.02);
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: Math.round(height * 0.34),
          maxWidth: "100%",
          minWidth: 0,
          color: "var(--text-primary)",
        }}
      >
        {/* AdonisAgent Greek-key mark — same meander as the marketing site */}
        <svg
          width={markSize}
          height={markSize}
          viewBox="0 0 120 120"
          aria-hidden="true"
          style={{ flex: "none", display: "block" }}
        >
          <path
            d="M20 20 L100 20 L100 100 L20 100 L20 40 L80 40 L80 80 L40 80 L40 60 L60 60"
            fill="none"
            stroke="currentColor"
            strokeWidth={10}
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
        </svg>
        <span
          style={{
            display: "inline-flex",
            flexDirection: "column",
            gap: 3,
            lineHeight: 1,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-heading), sans-serif",
              textTransform: "uppercase",
              fontSize: Math.round(height * 0.72),
              letterSpacing: "0.02em",
              lineHeight: 1,
              color: "var(--text-primary)",
            }}
          >
            AdonisAgent
          </span>
          {alt && (
            <span
              style={{
                fontFamily: "var(--font-mono), ui-monospace, monospace",
                fontSize: Math.max(9, Math.round(height * 0.38)),
                letterSpacing: "0.04em",
                color: "var(--text-tertiary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              — {alt}
            </span>
          )}
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
