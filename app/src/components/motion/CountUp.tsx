"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Counts a formatted figure up to its value ("€1,240.00", "38%", "12"), and
 * ticks from the old value to the new one when it changes (a date-range
 * switch re-renders the tile with a new string). Only the first number in
 * the string moves; the prefix and suffix stay put, and the final frame is
 * the original string verbatim so formatting never drifts. Strings with no
 * number ("None yet") render as-is.
 */

const NUM = /-?\d[\d,]*(?:\.\d+)?/;
const DURATION_MS = 900;

function parse(value: string) {
  const m = value.match(NUM);
  if (!m || m.index === undefined) return null;
  const raw = m[0];
  return {
    target: parseFloat(raw.replace(/,/g, "")),
    decimals: raw.includes(".") ? raw.split(".")[1].length : 0,
    grouped: raw.includes(","),
    before: value.slice(0, m.index),
    after: value.slice(m.index + raw.length),
  };
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function CountUp({ value }: { value: string }) {
  const parsed = parse(value);
  const fmt = (n: number) =>
    parsed
      ? parsed.before +
        n.toLocaleString("en-IE", {
          minimumFractionDigits: parsed.decimals,
          maximumFractionDigits: parsed.decimals,
          useGrouping: parsed.grouped,
        }) +
        parsed.after
      : value;

  // Start from zero so the first paint after streaming in is the count, not
  // the final figure followed by a jump back to 0.
  const [text, setText] = useState(() => (parsed && parsed.target !== 0 ? fmt(0) : value));
  const shown = useRef(0);

  useEffect(() => {
    if (!parsed) {
      setText(value);
      return;
    }
    const from = shown.current;
    const to = parsed.target;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || from === to) {
      shown.current = to;
      setText(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const n = from + (to - from) * easeOut(t);
      shown.current = n;
      if (t < 1) {
        setText(fmt(n));
        raf = requestAnimationFrame(step);
      } else {
        shown.current = to;
        setText(value);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{text}</span>;
}
