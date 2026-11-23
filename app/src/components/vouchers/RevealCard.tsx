"use client";

import { useEffect, useRef } from "react";

import type { Colourway } from "@/lib/vouchers/model";

/**
 * The gift voucher card: a foil card in the business's own colours that
 * catches the light as the pointer moves or the phone tilts. Used by the
 * store's live preview, the recipient's gift page, the thank-you view and
 * the staff voucher page, so the voucher looks the same everywhere.
 *
 * Generalised from the old single-business HolographicCard. Every colour comes
 * from the colourway (lib/vouchers/model colourways); the type is the page's
 * own (inherit), so on a client site it is set in the site's typeface.
 *
 * Motion: pointer and device tilt write CSS variables on the card element,
 * one write per animation frame, so React never re-renders on a move. With
 * prefers-reduced-motion nothing is listened to and the card stays flat.
 * iPhone Safari only reports tilt after a tap grants permission, so the
 * first tap on the card asks.
 */
export interface RevealCardProps {
  colourway: Colourway;
  businessName: string;
  /** "€50", or the treatment's name. */
  title: string;
  /** The recipient's name. */
  forName: string;
  code: string;
  /** "Valid until 23 November 2031". */
  expiryLabel: string;
}

type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

export function RevealCard({ colourway: c, businessName, title, forName, code, expiryLabel }: RevealCardProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const card = ref.current;
    if (!card || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const set = (x: number, y: number, live: boolean) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const cx = Math.min(1, Math.max(0, x));
        const cy = Math.min(1, Math.max(0, y));
        card.style.setProperty("--rc-x", cx.toFixed(3));
        card.style.setProperty("--rc-y", cy.toFixed(3));
        card.style.setProperty("--rc-ry", `${((cx - 0.5) * 14).toFixed(2)}deg`);
        card.style.setProperty("--rc-rx", `${((0.5 - cy) * 12).toFixed(2)}deg`);
        card.classList.toggle("is-live", live);
      });
    };
    const onMove = (e: PointerEvent) => {
      const r = card.getBoundingClientRect();
      set((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, true);
    };
    const onLeave = () => set(0.5, 0.5, false);
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      // Held upright-ish in the hand, beta sits near 45 degrees.
      set(0.5 + e.gamma / 60, 0.5 + (e.beta - 45) / 60, true);
    };
    let asked = false;
    const askForTilt = () => {
      if (asked) return;
      asked = true;
      const D = (window as unknown as { DeviceOrientationEvent?: OrientationPermission }).DeviceOrientationEvent;
      if (D?.requestPermission) {
        D.requestPermission()
          .then((r) => {
            if (r === "granted") window.addEventListener("deviceorientation", onTilt);
          })
          .catch(() => undefined);
      }
    };

    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", onLeave);
    card.addEventListener("pointerdown", askForTilt);
    const D = (window as unknown as { DeviceOrientationEvent?: OrientationPermission }).DeviceOrientationEvent;
    if (D && !D.requestPermission) window.addEventListener("deviceorientation", onTilt);
    return () => {
      cancelAnimationFrame(frame);
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
      card.removeEventListener("pointerdown", askForTilt);
      window.removeEventListener("deviceorientation", onTilt);
    };
  }, []);

  const vars = {
    "--rc-base": c.base,
    "--rc-base2": c.base2,
    "--rc-f1": c.foil[0],
    "--rc-f2": c.foil[1],
    "--rc-f3": c.foil[2],
    "--rc-ink": c.ink,
  } as React.CSSProperties;

  return (
    <div className="rc-wrap">
      <style dangerouslySetInnerHTML={{ __html: RC_CSS }} />
      <div ref={ref} className="rc" style={vars} role="img" aria-label={`${businessName} gift voucher: ${title} for ${forName}. Code ${code}. ${expiryLabel}.`}>
        <div className="rc__foil" aria-hidden />
        <div className="rc__sheen" aria-hidden />
        <div className="rc__body" aria-hidden>
          <div className="rc__top">
            <span className="rc__brand">{businessName}</span>
            <span className="rc__tag">Gift voucher</span>
          </div>
          <div>
            <div className={`rc__title${title.length > 10 ? " rc__title--long" : ""}`}>{title}</div>
            <div className="rc__for">For {forName}</div>
          </div>
          <div className="rc__bottom">
            <span className="rc__code">{code}</span>
            <span className="rc__exp">{expiryLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const RC_CSS = `
.rc-wrap{perspective:1200px;display:flex;justify-content:center;width:100%}
.rc{--rc-x:.5;--rc-y:.5;--rc-rx:0deg;--rc-ry:0deg;position:relative;width:min(420px,100%);aspect-ratio:1.586;border-radius:22px;overflow:hidden;isolation:isolate;color:var(--rc-ink);background:linear-gradient(135deg,var(--rc-base) 0%,var(--rc-base2) 100%);transform:rotateX(var(--rc-rx)) rotateY(var(--rc-ry));transition:transform .5s cubic-bezier(.2,.85,.3,1);box-shadow:0 30px 60px -28px rgba(0,0,0,.55),0 12px 24px -14px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.14);font-family:inherit}
.rc.is-live{transition:transform .08s linear}
.rc__foil{position:absolute;inset:-30%;background:conic-gradient(from 200deg at calc(var(--rc-x) * 100%) calc(var(--rc-y) * 100%),var(--rc-f1),var(--rc-f2),var(--rc-f3),var(--rc-f1));mix-blend-mode:soft-light;opacity:.6;filter:blur(6px) saturate(1.2);pointer-events:none}
.rc__sheen{position:absolute;inset:0;background:radial-gradient(circle at calc(var(--rc-x) * 100%) calc(var(--rc-y) * 100%),rgba(255,255,255,.42),rgba(255,255,255,0) 46%);mix-blend-mode:overlay;pointer-events:none}
.rc__body{position:relative;z-index:1;height:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;padding:clamp(16px,5vw,28px)}
.rc__top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:11px;letter-spacing:.22em;text-transform:uppercase}
.rc__brand{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rc__tag{opacity:.75;white-space:nowrap}
.rc__title{text-align:center;font-size:clamp(34px,11vw,64px);line-height:1.05;font-weight:600;letter-spacing:-.01em;overflow-wrap:anywhere}
.rc__title--long{font-size:clamp(22px,6.5vw,38px)}
.rc__for{text-align:center;margin-top:10px;font-size:11px;letter-spacing:.2em;text-transform:uppercase;opacity:.85}
.rc__bottom{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;padding-top:12px;border-top:1px solid var(--rc-f2)}
.rc__code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;letter-spacing:.14em;white-space:nowrap;flex-shrink:0}
@media(max-width:420px){.rc__code{font-size:12px;letter-spacing:.08em}}
.rc__exp{font-size:10px;letter-spacing:.14em;text-transform:uppercase;opacity:.8;text-align:right}
@media (prefers-reduced-motion:reduce){.rc{transform:none!important;transition:none}.rc__foil{opacity:.45}}
@media print{.rc{box-shadow:none;transform:none!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;
