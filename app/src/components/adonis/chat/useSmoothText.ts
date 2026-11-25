"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

import { advance, commonPrefix, FINISH_LAG_MS, MAX_LAG_MS, type RevealState } from "./smoothText";

/**
 * Reveal `target` at an even pace while it streams (./smoothText), driven by
 * requestAnimationFrame. Text already there when the component mounts shows
 * at once (a reload, an old answer); only words that arrive afterwards are
 * paced. When streaming stops, what is left drains quickly instead of
 * jumping. If the text is rewritten (the final save can differ from the
 * streamed words), the reveal restarts from the part both share. Off under
 * prefers-reduced-motion. `animating` tells the renderer to fade new words in.
 */
export function useSmoothText(target: string, streaming: boolean): { text: string; animating: boolean } {
  const reduced = useReducedMotion() ?? false;
  const [shown, setShown] = useState(target.length);
  const stateRef = useRef<RevealState>({ shown: target.length, carry: 0 });
  const targetRef = useRef(target);
  const streamingRef = useRef(streaming);
  const everStreamed = useRef(streaming);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  if (streaming) everStreamed.current = true;
  const pace = !reduced && everStreamed.current;

  useEffect(() => {
    const prevShown = targetRef.current.slice(0, stateRef.current.shown);
    targetRef.current = target;
    streamingRef.current = streaming;
    if (!target.startsWith(prevShown)) stateRef.current = { shown: commonPrefix(prevShown, target), carry: 0 };
    if (!pace) {
      stateRef.current = { shown: target.length, carry: 0 };
      setShown(target.length);
      return;
    }
    setShown(stateRef.current.shown);
    if (rafRef.current || stateRef.current.shown >= target.length) return;
    lastRef.current = performance.now();
    const tick = (now: number) => {
      const next = advance(targetRef.current, stateRef.current, now - lastRef.current, {
        lagMs: streamingRef.current ? MAX_LAG_MS : FINISH_LAG_MS,
        holdTail: streamingRef.current,
      });
      lastRef.current = now;
      stateRef.current = next;
      setShown(next.shown);
      rafRef.current = next.shown < targetRef.current.length ? requestAnimationFrame(tick) : 0;
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [target, streaming, pace]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    },
    [],
  );

  const visible = Math.min(shown, target.length);
  return { text: target.slice(0, visible), animating: pace && (streaming || visible < target.length) };
}
