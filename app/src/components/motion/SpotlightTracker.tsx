"use client";

import { useEffect } from "react";

/**
 * Feeds the cursor position to whichever card is under the pointer, as
 * --mx/--my in the card's own coordinates, and fades its --spot-o in. The
 * glow itself is pure CSS (.ui-card in globals.css). One delegated listener
 * for the whole app, throttled to one write per frame; skipped entirely on
 * touch, where there is no cursor to follow.
 */
const SELECTOR = ".ui-card, .spotlight";

export function SpotlightTracker() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let current: HTMLElement | null = null;
    let last: PointerEvent | null = null;
    let frame = 0;

    const apply = () => {
      frame = 0;
      if (!last) return;
      const target = last.target instanceof Element ? last.target : null;
      const el = (target?.closest(SELECTOR) as HTMLElement | null) ?? null;
      if (el !== current) {
        current?.style.setProperty("--spot-o", "0");
        current = el;
        el?.style.setProperty("--spot-o", "1");
      }
      if (el) {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${last.clientX - r.left}px`);
        el.style.setProperty("--my", `${last.clientY - r.top}px`);
      }
    };
    const onMove = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      current?.style.setProperty("--spot-o", "0");
      current = null;
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);
  return null;
}
