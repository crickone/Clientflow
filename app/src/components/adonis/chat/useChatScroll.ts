"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { distanceFromBottom, shouldShowJump, stickAfterScroll } from "./scrollModel";

/** A scroll within this long of a wheel, touch, drag or scroll key is the operator's own. */
const INTENT_MS = 1200;
const SCROLL_KEYS = new Set(["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End", " "]);

export type ChatScroll = {
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  showJump: boolean;
  onScroll: () => void;
  /** After the next render, bring the exchange with this key to the top of the view, and stop following the bottom. */
  pinNext: (exchangeKey: string) => void;
  toLatest: (behavior?: ScrollBehavior) => void;
};

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The thread's scrolling. On send, the new question glides to the top and
 * the answer grows beneath it (the last exchange has a min-height of one view,
 * set from `--ax-view-h`, so there is always room to put it there). The view
 * follows growth only while the operator has scrolled to the bottom; it never
 * pulls them down while they read further up. "Jump to latest" appears when
 * there is new content below.
 */
export function useChatScroll(active: boolean): ChatScroll {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const pinRef = useRef<string | null>(null);
  const intentAt = useRef(0);
  const [showJump, setShowJump] = useState(false);

  const toLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? "auto" : behavior });
    setShowJump(false);
  }, []);

  const pinNext = useCallback((exchangeKey: string) => {
    pinRef.current = exchangeKey;
    stickRef.current = false;
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = stickAfterScroll(distanceFromBottom(el), stickRef.current, Date.now() - intentAt.current < INTENT_MS);
    setShowJump(shouldShowJump(el));
  }, []);

  // After the render that shows a just-sent question, bring it to the top.
  useLayoutEffect(() => {
    const key = pinRef.current;
    const el = scrollRef.current;
    if (!key || !el) return;
    const target = el.querySelector<HTMLElement>(`[data-exchange="${CSS.escape(key)}"]`);
    if (!target) return;
    pinRef.current = null;
    const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12;
    el.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? "auto" : "smooth" });
  });

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!active || !el || !content) return;
    const intent = () => {
      intentAt.current = Date.now();
    };
    const keyIntent = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      if (SCROLL_KEYS.has(e.key)) intent();
    };
    el.addEventListener("wheel", intent, { passive: true });
    el.addEventListener("touchmove", intent, { passive: true });
    el.addEventListener("pointerdown", intent);
    window.addEventListener("keydown", keyIntent);
    const sync = () => {
      el.style.setProperty("--ax-view-h", `${el.clientHeight}px`);
      if (stickRef.current && !pinRef.current) el.scrollTop = el.scrollHeight;
      setShowJump(shouldShowJump(el));
    };
    sync();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    ro?.observe(el);
    ro?.observe(content);
    return () => {
      ro?.disconnect();
      el.removeEventListener("wheel", intent);
      el.removeEventListener("touchmove", intent);
      el.removeEventListener("pointerdown", intent);
      window.removeEventListener("keydown", keyIntent);
    };
  }, [active]);

  return { scrollRef, contentRef, showJump, onScroll, pinNext, toLatest };
}
