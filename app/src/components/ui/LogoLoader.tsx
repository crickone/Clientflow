"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * One full draw-in→draw-out cycle of the loader animation, in ms — and the
 * single source of that duration (interpolated into the CSS below). Exported so
 * an account switch can hold the loader for a complete cycle before the hard
 * reload tears it down, instead of the mark only half-drawing.
 */
export const LOADER_CYCLE_MS = 1900;

/**
 * Hold until the loader has been visible for at least one full cycle (measured
 * from `startedAt`), then hard-reload into the switched tenant — so the branded
 * draw-in plays fully instead of being cut off mid-draw. The wait is skipped
 * under reduced motion, where the animation is disabled and there's nothing to
 * watch.
 */
export async function finishSwitchLoader(startedAt: number, to = "/dashboard"): Promise<void> {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const elapsed = Date.now() - startedAt;
  if (!reduceMotion && elapsed < LOADER_CYCLE_MS) {
    await new Promise((resolve) => setTimeout(resolve, LOADER_CYCLE_MS - elapsed));
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
          animation: aaLoaderDraw ${LOADER_CYCLE_MS}ms ease-in-out infinite;
        }
        @keyframes aaLoaderDraw {
          0%   { stroke-dashoffset: 500; }
          50%  { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -500; }
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
