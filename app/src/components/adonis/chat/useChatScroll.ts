"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { distanceFromBottom, isUserScroll, pinLive, shouldShowJump, stickAfterScroll } from "./scrollModel";

/** A scroll within this long of a wheel, touch, drag or scroll key is the operator's own. */
const INTENT_MS = 1200;
/** How long the page's own smooth scroll can run; a `scrollend` event ends it sooner where supported. */
const PROGRAMMATIC_MS = 1200;
const PROGRAMMATIC_REDUCED_MS = 150;
/** A pin whose exchange never renders is dropped after this long. */
const PIN_TTL_MS = 3000;
/** Momentum after a lifted finger or a released drag keeps counting as the operator's scroll for this long. */
const INTENT_TAIL_MS = 800;
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
  const pinnedAt = useRef(0);
  const intentAt = useRef(0);
  /** While now is before this, scroll events come from a scroll the page started, not the operator. */
  const programmaticUntil = useRef(0);
  const [showJump, setShowJump] = useState(false);

  const toLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    pinRef.current = null;
    const reduced = reducedMotion();
    intentAt.current = 0;
    programmaticUntil.current = Date.now() + (reduced ? PROGRAMMATIC_REDUCED_MS : PROGRAMMATIC_MS);
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : behavior });
    setShowJump(false);
  }, []);

  const pinNext = useCallback((exchangeKey: string) => {
    pinRef.current = exchangeKey;
    pinnedAt.current = Date.now();
    stickRef.current = false;
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const userDriven = isUserScroll(Date.now(), intentAt.current, programmaticUntil.current, INTENT_MS);
    // The operator scrolling ends any pending pin: they have taken over.
    if (userDriven) pinRef.current = null;
    stickRef.current = stickAfterScroll(distanceFromBottom(el), stickRef.current, userDriven);
    setShowJump(shouldShowJump(el));
  }, []);

  // After the render that shows a just-sent question, bring it to the top.
  useLayoutEffect(() => {
    const key = pinRef.current;
    const el = scrollRef.current;
    if (!key || !el) return;
    if (!pinLive(Date.now(), pinnedAt.current, PIN_TTL_MS)) {
      pinRef.current = null;
      return;
    }
    const target = el.querySelector<HTMLElement>(`[data-exchange="${CSS.escape(key)}"]`);
    if (!target) return;
    pinRef.current = null;
    const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12;
    const reduced = reducedMotion();
    // The pin's no-follow state lasts until the operator really scrolls: a click or wheel
    // just before the send must not let this glide's own scroll events count as theirs.
    intentAt.current = 0;
    programmaticUntil.current = Date.now() + (reduced ? PROGRAMMATIC_REDUCED_MS : PROGRAMMATIC_MS);
    el.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
  });

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!active || !el || !content) return;
    const intent = (tailMs = 0) => {
      intentAt.current = Date.now() + tailMs;
      programmaticUntil.current = 0;
    };
    const wheelOrTouch = () => intent();
    let pointerDown = false;
    const pointerStart = () => {
      pointerDown = true;
      intent();
    };
    const pointerMove = () => {
      if (pointerDown) intent();
    };
    const pointerEnd = () => {
      if (!pointerDown) return;
      pointerDown = false;
      intent(INTENT_TAIL_MS);
    };
    const touchEnd = () => intent(INTENT_TAIL_MS);
    const scrollEnd = () => {
      programmaticUntil.current = 0;
    };
    const keyIntent = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      if (SCROLL_KEYS.has(e.key)) intent();
    };
    el.addEventListener("wheel", wheelOrTouch, { passive: true });
    el.addEventListener("touchmove", wheelOrTouch, { passive: true });
    el.addEventListener("touchend", touchEnd, { passive: true });
    el.addEventListener("pointerdown", pointerStart);
    el.addEventListener("scrollend", scrollEnd);
    window.addEventListener("pointermove", pointerMove);
    window.addEventListener("pointerup", pointerEnd);
    window.addEventListener("pointercancel", pointerEnd);
    window.addEventListener("keydown", keyIntent);
    const sync = () => {
      el.style.setProperty("--ax-view-h", `${el.clientHeight}px`);
      const pinned = pinRef.current !== null && pinLive(Date.now(), pinnedAt.current, PIN_TTL_MS);
      if (stickRef.current && !pinned) el.scrollTop = el.scrollHeight;
      setShowJump(shouldShowJump(el));
    };
    sync();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    ro?.observe(el);
    ro?.observe(content);
    return () => {
      ro?.disconnect();
      el.removeEventListener("wheel", wheelOrTouch);
      el.removeEventListener("touchmove", wheelOrTouch);
      el.removeEventListener("touchend", touchEnd);
      el.removeEventListener("pointerdown", pointerStart);
      el.removeEventListener("scrollend", scrollEnd);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", pointerEnd);
      window.removeEventListener("pointercancel", pointerEnd);
      window.removeEventListener("keydown", keyIntent);
    };
  }, [active]);

  return { scrollRef, contentRef, showJump, onScroll, pinNext, toLatest };
}
