"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { ADONIS_LOGO_ASPECT, ADONIS_LOGO_PATH, ADONIS_LOGO_VIEWBOX } from "./adonisLogoPath";

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
 * Full-screen branded loader — the ADONIS wordmark revealing itself once,
 * left to right. Shown over an account switch while the session repoints and the page
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
      <svg className="aa-loader-draw" viewBox={ADONIS_LOGO_VIEWBOX} aria-hidden="true" style={{ height: 34, width: Math.round(34 * ADONIS_LOGO_ASPECT), color: "var(--text-primary)" }}>
        <path d={ADONIS_LOGO_PATH} fill="currentColor" />
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
          clip-path: inset(0 100% 0 0);
          animation: aaLoaderDraw ${LOADER_DRAW_MS}ms ease-in-out forwards;
        }
        @keyframes aaLoaderDraw {
          from { clip-path: inset(0 100% 0 0); }
          to   { clip-path: inset(0 0 0 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .aa-loader-draw { animation: none; clip-path: none; }
        }
      `}</style>
    </div>
  );

  if (!mounted) return null;
  return createPortal(overlay, document.body);
}
