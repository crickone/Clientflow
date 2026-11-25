"use client";

import "./chat.css";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";

import { EASE } from "@/lib/motion";
import type { LivePhase } from "@/lib/agents/liveEvents";
import { formatDuration, stepRows, stepsSummary, type StepRow } from "./exchanges";

/** How long the finished steps stay up before folding to one line, so the last tick is seen. */
const FOLD_AFTER_MS = 900;

function useElapsed(startedAt: number | null, live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [live]);
  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}

function Rows({ rows }: { rows: StepRow[] }) {
  return (
    <ol className="ax-step-list">
      {rows.map((r) => (
        <li key={r.key} className="ax-step" data-state={r.state}>
          <span className="ax-dot" aria-hidden>
            {r.state === "done" && <Check size={10} strokeWidth={3.5} />}
          </span>
          {r.label}
        </li>
      ))}
    </ol>
  );
}

export type StepsPanelProps = {
  tools: string[];
  live: boolean;
  phase: LivePhase | null;
  startedAt: number | null;
  durationMs: number | null;
  variant: "answer" | "full";
};

/**
 * What Adonis is doing, so waiting is never a blank pause: "Thinking" with a
 * timer before the first tool or word, then each tool as a plain label with a
 * spinner and then a tick. Folds to "Done in 6.2s, 4 steps" when the answer
 * is complete.
 */
export function StepsPanel({ tools, live, phase, startedAt, durationMs, variant }: StepsPanelProps) {
  const reduced = useReducedMotion() ?? false;
  const rows = stepRows(tools, live, phase);
  const elapsed = useElapsed(startedAt, live);
  const summary = stepsSummary(durationMs, tools.length);
  const thinking = live && tools.length === 0 && phase !== "writing";
  const [holding, setHolding] = useState(false);
  const [prevLive, setPrevLive] = useState(live);
  const reducedRef = useRef(reduced);

  // Decide "the run just ended" during render, so the folded line never mounts for a
  // frame before the ticked box. Only hold when there are steps to show; an answer
  // that used no tools has nothing to tick and goes straight to its line.
  if (prevLive !== live) {
    setPrevLive(live);
    setHolding(prevLive && !live && tools.length > 0);
  }

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  // Depends on `holding` only: a reduced-motion change mid-hold must not cancel the timer.
  useEffect(() => {
    if (!holding) return;
    const t = setTimeout(() => setHolding(false), reducedRef.current ? 0 : FOLD_AFTER_MS);
    return () => clearTimeout(t);
  }, [holding]);

  const header = (
    <div className="ax-steps-h">
      <span className={thinking ? "ax-thinking" : undefined}>{live ? (thinking ? "Thinking" : "Working on it") : summary}</span>
      {live && <span className="ax-timer">{formatDuration(elapsed)}</span>}
    </div>
  );

  if (variant === "full") {
    return (
      <div className="ax-steps">
        {header}
        {rows.length > 0 ? <Rows rows={rows} /> : !live && <p className="ax-steps-none">Adonis answered without looking anything up.</p>}
      </div>
    );
  }

  const showBox = live ? !(tools.length === 0 && phase === "writing") : holding;
  const showLine = !live && !holding && (tools.length > 0 || durationMs !== null);
  const transition = { duration: reduced ? 0 : 0.3, ease: EASE };

  return (
    <AnimatePresence initial={false} mode="wait">
      {showBox ? (
        <motion.div
          key="box"
          className="ax-steps"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
          transition={transition}
        >
          {header}
          {rows.length > 0 && <Rows rows={rows} />}
        </motion.div>
      ) : showLine ? (
        <motion.div key="line" className="ax-done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={transition}>
          <span className="ax-dot" aria-hidden>
            <Check size={9} strokeWidth={3.5} />
          </span>
          {summary}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
