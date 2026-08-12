"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

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
          animation: aaLoaderDraw 1.9s ease-in-out infinite;
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
