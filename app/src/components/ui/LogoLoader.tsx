"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Duration of the mark's single draw-in, in ms — the single source of that
 * timing, interpolated into the CSS below. The account switch holds the loader
 * for one full draw (the mark drawing itself in, then holding — it does NOT
 * loop) before the hard reload, so the animation always plays through once.
 */
export const LOADER_DRAW_MS = 1300;

/**
 * Hold until the mark has drawn itself in once (measured from `startedAt`, so a
 * slow switch adds no extra wait), THEN hard-reload into the switched tenant.
 * The switch (chooseAccount) runs during the draw and the loader stays up —
 * fully drawn and holding — through the reload, so the whole transition happens
 * under the cover: no mid-draw cut, and no flash of the old account. The wait is
 * skipped under reduced motion (the animation is disabled — nothing to play).
 */
export async function finishSwitchLoader(startedAt: number, to = "/dashboard"): Promise<void> {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const elapsed = Date.now() - startedAt;
  if (!reduceMotion && elapsed < LOADER_DRAW_MS) {
    await new Promise((resolve) => setTimeout(resolve, LOADER_DRAW_MS - elapsed));
  }
  window.location.assign(to);
}

/**
 * Full-screen branded loader — the AdonisAgent Greek-key mark drawing itself in
 * a loop. Shown over an account switch while the session repoints and the page
 * hard-reloads into the chosen tenant's chrome. Portalled to <body> so the fixed
 * overlay covers the whole viewport even inside a transformed ancestor (e.g. the
 * sliding sidebar).
 */
export function LogoLoader({ label = "Switching account" }: { label?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const overlay = (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        background: "var(--bg)",
      }}
    >
      <svg width={68} height={68} viewBox="0 0 120 120" aria-hidden="true">
        <path
          className="aa-loader-draw"
          d="M20 20 L100 20 L100 100 L20 100 L20 40 L80 40 L80 80 L40 80 L40 60 L60 60"
          fill="none"
          stroke="var(--text-primary)"
          strokeWidth={9}
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      </svg>
      <span
        style={{
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          fontSize: 11,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        {label}…
      </span>
      <style>{`
        .aa-loader-draw {
          stroke-dasharray: 500;
          stroke-dashoffset: 500;
          animation: aaLoaderDraw ${LOADER_DRAW_MS}ms ease-in-out forwards;
        }
        @keyframes aaLoaderDraw {
          from { stroke-dashoffset: 500; }
          to   { stroke-dashoffset: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .aa-loader-draw { animation: none; stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );

  if (!mounted) return null;
  return createPortal(overlay, document.body);
}
