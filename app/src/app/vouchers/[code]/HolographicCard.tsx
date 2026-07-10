"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  recipientName: string;
  valueLabel: string;
  code: string;
  expiryLabel: string;
}

/**
 * Tilt-on-pointer + cursor-tracked iridescent shimmer. Mouse position writes
 * CSS variables (--mx, --my, --tx, --ty) directly on the card element so
 * React doesn't re-render on every move.
 */
export function HolographicCard({
  recipientName,
  valueLabel,
  code,
  expiryLabel,
}: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const handle = (e: PointerEvent) => {
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const tx = (x - 0.5) * 12;
      const ty = (0.5 - y) * 10;
      card.style.setProperty("--mx", `${x * 100}%`);
      card.style.setProperty("--my", `${y * 100}%`);
      card.style.setProperty("--tx", `${tx}deg`);
      card.style.setProperty("--ty", `${ty}deg`);
    };
    const reset = () => {
      card.style.setProperty("--tx", `0deg`);
      card.style.setProperty("--ty", `0deg`);
      card.style.setProperty("--mx", `50%`);
      card.style.setProperty("--my", `50%`);
    };

    card.addEventListener("pointermove", handle);
    card.addEventListener("pointerleave", reset);
    return () => {
      card.removeEventListener("pointermove", handle);
      card.removeEventListener("pointerleave", reset);
    };
  }, []);

  return (
    <div
      style={{
        perspective: "1400px",
        padding: "12px",
      }}
    >
      <div
        ref={cardRef}
        className={`holo-card ${hovering ? "is-hover" : ""}`}
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
      >
        {/* Layered iridescent surface */}
        <div className="holo-base" />
        <div className="holo-foil" />
        <div className="holo-grain" />
        <div className="holo-shimmer" />
        <div className="holo-rim" />

        {/* Content */}
        <div className="holo-content">
          <div className="holo-top">
            <div className="holo-brand">Renova</div>
            <div className="holo-tag">Gift Voucher</div>
          </div>

          <div className="holo-value-wrap">
            <div className="holo-value">{valueLabel}</div>
            <div className="holo-recipient">For {recipientName}</div>
          </div>

          <div className="holo-bottom">
            <div className="holo-code">{code}</div>
            <div className="holo-expiry">Exp {expiryLabel}</div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .holo-card {
          --mx: 50%;
          --my: 50%;
          --tx: 0deg;
          --ty: 0deg;
          position: relative;
          width: min(420px, 88vw);
          aspect-ratio: 1.586;
          border-radius: 24px;
          transform: rotateY(var(--tx)) rotateX(var(--ty));
          transition: transform 0.6s cubic-bezier(0.2, 0.85, 0.3, 1);
          transform-style: preserve-3d;
          will-change: transform;
          overflow: hidden;
          isolation: isolate;
          box-shadow:
            0 40px 80px -30px rgba(60, 20, 30, 0.55),
            0 18px 32px -16px rgba(0, 0, 0, 0.35),
            inset 0 1px 0 rgba(255, 220, 200, 0.08);
          animation: float 8s ease-in-out infinite;
        }
        .holo-card.is-hover {
          animation-play-state: paused;
          transition: transform 0.12s linear;
        }

        @keyframes float {
          0%, 100% { transform: rotateY(0deg) rotateX(0deg) translateY(0); }
          50% { transform: rotateY(-2deg) rotateX(1deg) translateY(-6px); }
        }

        .holo-base {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse at 30% 20%, #4A1E2E 0%, transparent 60%),
            linear-gradient(135deg, #1F1620 0%, #2D1A26 50%, #1A1018 100%);
        }

        /* Iridescent foil — slowly drifts; intensifies near pointer */
        .holo-foil {
          position: absolute;
          inset: -20%;
          background: conic-gradient(
            from 210deg at 50% 50%,
            #FFB3D9 0deg,
            #B8A4FF 60deg,
            #8FF0E0 120deg,
            #FFE08F 180deg,
            #FFB3D9 240deg,
            #B8A4FF 300deg,
            #FFB3D9 360deg
          );
          mix-blend-mode: color-dodge;
          opacity: 0.28;
          filter: blur(8px) saturate(1.4);
          animation: drift 14s linear infinite;
        }
        .holo-card.is-hover .holo-foil {
          opacity: 0.42;
        }

        @keyframes drift {
          0% { transform: rotate(0deg) scale(1.05); }
          100% { transform: rotate(360deg) scale(1.05); }
        }

        /* Subtle grain so the foil doesn't read as digital */
        .holo-grain {
          position: absolute;
          inset: 0;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.4 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
          opacity: 0.10;
          mix-blend-mode: overlay;
          pointer-events: none;
        }

        /* Cursor-tracked highlight */
        .holo-shimmer {
          position: absolute;
          inset: 0;
          background: radial-gradient(
            circle 220px at var(--mx) var(--my),
            rgba(255, 240, 220, 0.55) 0%,
            rgba(255, 180, 220, 0.25) 25%,
            rgba(180, 220, 255, 0.15) 45%,
            transparent 70%
          );
          mix-blend-mode: overlay;
          opacity: 0.7;
          transition: opacity 0.4s ease;
          pointer-events: none;
        }
        .holo-card.is-hover .holo-shimmer {
          opacity: 1;
        }

        /* 1px iridescent rim */
        .holo-rim {
          position: absolute;
          inset: 0;
          border-radius: 24px;
          padding: 1px;
          background: linear-gradient(
            135deg,
            rgba(255, 220, 200, 0.45),
            rgba(180, 200, 255, 0.15) 30%,
            rgba(255, 180, 220, 0.35) 70%,
            rgba(255, 220, 180, 0.4)
          );
          -webkit-mask:
            linear-gradient(#fff 0 0) content-box,
            linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
        }

        .holo-content {
          position: absolute;
          inset: 0;
          padding: 26px 28px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          color: #FFE9D6;
          z-index: 2;
          transform: translateZ(40px);
        }

        .holo-top {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }
        .holo-brand {
          font-family: var(--font-heading), "Fraunces", Georgia, serif;
          font-size: 13px;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: rgba(255, 233, 214, 0.95);
          text-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
        }
        .holo-tag {
          font-size: 9px;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          color: rgba(255, 233, 214, 0.55);
          font-weight: 500;
        }

        .holo-value-wrap {
          text-align: center;
          margin-top: -4px;
        }
        .holo-value {
          font-family: "Fraunces", Georgia, serif;
          font-size: clamp(48px, 13vw, 76px);
          line-height: 1;
          font-weight: 400;
          letter-spacing: -0.02em;
          color: #FFEFD8;
          text-shadow: 0 2px 12px rgba(255, 200, 180, 0.25);
        }
        .holo-recipient {
          font-size: 10px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: rgba(255, 233, 214, 0.7);
          margin-top: 12px;
          font-weight: 500;
        }

        .holo-bottom {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          padding-top: 14px;
          border-top: 1px solid rgba(255, 233, 214, 0.18);
        }
        .holo-code {
          font-family: "JetBrains Mono", "Fira Code", monospace;
          font-size: 13px;
          letter-spacing: 0.18em;
          color: rgba(255, 233, 214, 0.92);
        }
        .holo-expiry {
          font-size: 9px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: rgba(255, 233, 214, 0.5);
        }
      `}</style>
    </div>
  );
}
