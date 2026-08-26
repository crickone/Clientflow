"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BookOpenText, Check, GitCompare, MapPin, Radar, Sparkles, Star } from "lucide-react";

import type { RescanResult } from "@/app/marketing/research/actions";
import { DUR, EASE, revealVariants, staggerContainer } from "@/lib/motion";

/**
 * The animated "what's happening right now" panel shown while a scan is in
 * flight — Market Research presentation upgrade #1 (the operator's "more
 * detail in the scanning animation, with nice text animation" ask). Pure
 * presentation: the real pipeline is ONE opaque server-action call
 * (`rescanNowAction`, marketing/research/actions.ts) that this component
 * never sees inside of, so the 6 steps below are a CLIENT-SIDE TIMED
 * SIMULATION, not a live progress stream — there is no websocket/polling
 * here and this file must never grow one. Wording mirrors the action's real
 * stages (debounce → refreshTenant's re-discovery + per-competitor
 * snapshot+diff → the AI themes/landscape pre-warm) so what's shown is
 * honest, just not literally driven by server progress events.
 *
 * Mechanism:
 *  1. `active` (ResearchView's `rescanning` transition) flipping true arms
 *     the sequence at step 0 and auto-advances one step at a time on a
 *     per-step timer (see `stepDurationMs`), HOLDING on the last step
 *     (never auto-advances past it) — it sits there, pulsing, for as long
 *     as the real call takes.
 *  2. `result` arriving (the awaited action's return value — the parent
 *     sets this BEFORE it calls `router.refresh()`) is the real completion
 *     signal: a success snaps every step to complete and shows a brief
 *     "Scan complete" beat; a failure/skip freezes wherever the simulated
 *     steps had gotten to rather than faking a false "all done" — the
 *     existing toast (ResearchView) already explains what happened.
 *  3. This panel only calls `onFinished` once BOTH the beat has played AND
 *     `active` has gone false. `active` only goes false once
 *     `router.refresh()` itself resolves and commits fresh props (it's
 *     called from inside the same transition), so waiting on both means
 *     the parent never swaps this panel out onto a stale, pre-scan
 *     dashboard for even one frame.
 *
 * Reduced motion: `useReducedMotion()` (reflecting the app-wide
 * `MotionConfig reducedMotion="user"` in components/motion/MotionRoot.tsx)
 * is checked explicitly at every animated site below — rather than leaning
 * on MotionConfig alone — and turns off the staggered reveal, the
 * active-step pulse ring, and the shimmer sweep. What's left is the brief's
 * own fallback, "a simple static list + spinner": plain rows (still
 * updating live — that's data, not motion), an instantly-set progress bar,
 * and one small `.spin` badge on whichever step is active — the same spin
 * keyframe Button.tsx's loading state uses, which this codebase already
 * exempts from its reduced-motion freeze (see globals.css).
 */

interface ScanStepDef {
  key: string;
  label: string;
  detail: string;
  icon: typeof MapPin;
}

const SCAN_STEPS: ScanStepDef[] = [
  { key: "locate", label: "Pinpointing your location", detail: "Geocoding your business address", icon: MapPin },
  { key: "discover", label: "Scanning for gyms within 20km", detail: "Querying Google Places nearby search", icon: Radar },
  { key: "ratings", label: "Pulling ratings & reviews", detail: "Fetching live details for every competitor found", icon: Star },
  { key: "diff", label: "Spotting what's changed", detail: "Diffing against last week's snapshot", icon: GitCompare },
  { key: "themes", label: "Reading the reviews", detail: "AI is finding recurring themes", icon: BookOpenText },
  { key: "landscape", label: "Summarising the landscape", detail: "AI is writing your competitive overview", icon: Sparkles },
];
const LAST_STEP = SCAN_STEPS.length - 1;

/** Minimum time the success beat stays up once the real work is done. */
const DONE_BEAT_MS = 1000;
/** A failure/skip has nothing worth savouring — close quickly (the toast carries the message). */
const QUIET_EXIT_MS = 350;

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

/**
 * Per-step simulated hold time, in ms, before auto-advancing. Steps 2 and 4
 * (0-indexed: "ratings", "themes") are the two stages that genuinely loop
 * over every tracked competitor server-side (see rescanNowAction's own doc
 * comment — refreshTenant's per-competitor snapshot, then the per-competitor
 * competitorThemes pre-warm loop), so they scale gently with `trackedCount`;
 * everything else is a single call and stays fixed. The last step is never
 * scheduled here — it holds until `result` arrives.
 */
function stepDurationMs(index: number, trackedCount: number): number {
  const n = trackedCount > 0 ? trackedCount : 10; // first scan: nothing tracked yet, assume a typical batch
  switch (index) {
    case 0:
      return 750;
    case 1:
      return 1100;
    case 2:
      return clamp(900 + n * 150, 1400, 4200);
    case 3:
      return 700;
    case 4:
      return clamp(850 + n * 60, 1150, 2600);
    default:
      return 0;
  }
}

type StepStatus = "pending" | "active" | "complete";

const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};

export interface ScanningProgressProps {
  /** Mirrors ResearchView's `rescanning` (useTransition's isPending) — true
   *  from the moment "Rescan now" is clicked until `router.refresh()` has
   *  resolved and committed fresh props. */
  active: boolean;
  /** Set by the parent the instant the awaited action call itself settles
   *  (before it calls router.refresh()) — null while still running. */
  result: RescanResult | null;
  /** Fired exactly once per scan (see the module doc's point 3) — the
   *  parent's cue to swap this panel back out for the real dashboard. */
  onFinished: () => void;
  /** How many competitors are already tracked going into this scan — paces
   *  the simulation only (see stepDurationMs); never a live server count. */
  trackedCount: number;
}

export function ScanningProgress({ active, result, onFinished, trackedCount }: ScanningProgressProps) {
  const reduceMotion = !!useReducedMotion();
  const [stepIndex, setStepIndex] = useState(0);
  const [settled, setSettled] = useState(false);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  // A fresh scan starting (re-)arms the whole sequence.
  useEffect(() => {
    if (active) {
      setStepIndex(0);
      setSettled(false);
    }
  }, [active]);

  // Auto-advance one step at a time; never schedules past the last step —
  // that one holds until `result` (below) says the real work is done.
  useEffect(() => {
    if (!active || settled || stepIndex >= LAST_STEP) return;
    const ms = stepDurationMs(stepIndex, trackedCount);
    const t = setTimeout(() => setStepIndex((i) => Math.min(i + 1, LAST_STEP)), ms);
    return () => clearTimeout(t);
  }, [active, settled, stepIndex, trackedCount]);

  // The action settling is the real completion signal. Success snaps every
  // step to "complete"; a failure/skip freezes in place — never a fake
  // all-green checklist for a scan that didn't actually finish.
  useEffect(() => {
    if (!result) return;
    if (result.ok && !result.skipped) setStepIndex(LAST_STEP);
    setSettled(true);
  }, [result]);

  // Hand back to the parent once the beat has played AND fresh props have
  // actually landed — `active` only goes false after router.refresh()
  // resolves, so waiting on both means no flash of stale, pre-scan content.
  useEffect(() => {
    if (!settled || active) return;
    const succeeded = !!result?.ok && !result.skipped;
    const ms = !succeeded || reduceMotion ? QUIET_EXIT_MS : DONE_BEAT_MS;
    const t = setTimeout(() => onFinishedRef.current(), ms);
    return () => clearTimeout(t);
  }, [settled, active, result, reduceMotion]);

  const succeeded = settled && !!result?.ok && !result.skipped;
  const refreshed = result?.refreshed ?? 0;
  const summaryLabel = `${refreshed} competitor${refreshed === 1 ? "" : "s"} refreshed`;
  const liveText = succeeded ? `Scan complete — ${summaryLabel}` : SCAN_STEPS[Math.min(stepIndex, LAST_STEP)].label;

  // Deliberately keyed on `succeeded`, not `settled`: a failure/skip must
  // never visually claim 100% — the bar stays wherever the frozen step list
  // itself stopped (see the result effect above).
  const completedCount = succeeded ? SCAN_STEPS.length : stepIndex;
  const progressPct = Math.round((completedCount / SCAN_STEPS.length) * 100);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "44px 28px",
        background: "var(--surface-1)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow-1)",
        minHeight: 400,
      }}
    >
      {/* One persistent, off-screen live region — screen readers announce
          each new value without the visual swap below needing to carry
          aria-live itself (which would fight the exit/enter transitions). */}
      <span role="status" aria-live="polite" style={VISUALLY_HIDDEN}>
        {liveText}
      </span>

      <div style={{ width: "100%", maxWidth: 440 }}>
        <AnimatePresence mode="wait" initial={false}>
          {succeeded ? (
            <motion.div
              key="done"
              initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: reduceMotion ? 0 : DUR.base, ease: [...EASE] }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center" }}
            >
              <div
                aria-hidden
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  background: "rgba(74, 222, 128, 0.12)",
                  border: "1px solid rgba(74, 222, 128, 0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#4ade80",
                }}
              >
                <Check size={24} strokeWidth={2.5} />
              </div>
              <div
                style={{
                  fontFamily: "var(--font-heading), sans-serif",
                  fontSize: 21,
                  textTransform: "uppercase",
                  color: "var(--text-primary)",
                }}
              >
                Scan complete
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono), ui-monospace, monospace",
                  fontSize: 12.5,
                  color: "var(--text-tertiary)",
                }}
              >
                {summaryLabel}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="steps"
              initial={false}
              exit={reduceMotion ? undefined : { opacity: 0, transition: { duration: DUR.fast, ease: [...EASE] } }}
              style={{ display: "flex", flexDirection: "column", gap: 26 }}
            >
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontFamily: "var(--font-mono), ui-monospace, monospace",
                    fontSize: 10.5,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--accent-ink)",
                  }}
                >
                  Live scan
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-heading), sans-serif",
                    fontSize: 21,
                    textTransform: "uppercase",
                    color: "var(--text-primary)",
                    marginTop: 6,
                  }}
                >
                  Scanning your market
                </div>
              </div>

              <div
                aria-hidden
                style={{ height: 3, borderRadius: 2, background: "var(--surface-3)", overflow: "hidden" }}
              >
                <motion.div
                  style={{ height: "100%", borderRadius: 2, background: "var(--accent)" }}
                  animate={{ width: `${progressPct}%` }}
                  transition={{ duration: reduceMotion ? 0 : DUR.slow, ease: [...EASE] }}
                />
              </div>

              <motion.ul
                variants={reduceMotion ? undefined : staggerContainer(0.08)}
                initial={reduceMotion ? false : "hidden"}
                animate={reduceMotion ? undefined : "visible"}
                style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", textAlign: "left" }}
              >
                {SCAN_STEPS.map((step, i) => {
                  const status: StepStatus = i < stepIndex ? "complete" : i === stepIndex ? "active" : "pending";
                  const Icon = step.icon;
                  const isLastRow = i === LAST_STEP;
                  const circleTone =
                    status === "complete"
                      ? { background: "rgba(74, 222, 128, 0.12)", border: "1px solid rgba(74, 222, 128, 0.4)", color: "#4ade80" }
                      : status === "active"
                        ? { background: "var(--accent-soft)", border: "1px solid var(--accent)", color: "var(--accent)" }
                        : { background: "var(--surface-2)", border: "1px solid var(--hairline)", color: "var(--text-tertiary)" };

                  return (
                    <motion.li key={step.key} variants={reduceMotion ? undefined : revealVariants} style={{ display: "flex", gap: 14 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                        <div style={{ position: "relative", width: 30, height: 30, flexShrink: 0 }}>
                          {status === "active" && !reduceMotion && (
                            <motion.span
                              aria-hidden
                              style={{ position: "absolute", inset: -5, borderRadius: "50%", border: "1px solid var(--accent)" }}
                              animate={{ scale: [1, 1.35], opacity: [0.55, 0] }}
                              transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                            />
                          )}
                          <div
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: "50%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              transition: "background 0.25s var(--ease), border-color 0.25s var(--ease), color 0.25s var(--ease)",
                              ...circleTone,
                            }}
                          >
                            {status === "complete" ? (
                              <Check size={15} strokeWidth={2.5} />
                            ) : (
                              <Icon size={14} strokeWidth={1.9} className={status === "active" && reduceMotion ? "spin" : undefined} />
                            )}
                          </div>
                        </div>
                        {!isLastRow && (
                          <div
                            aria-hidden
                            style={{
                              flex: 1,
                              width: 2,
                              minHeight: 22,
                              margin: "3px 0",
                              borderRadius: 1,
                              background: status === "complete" ? "rgba(74, 222, 128, 0.4)" : "var(--hairline)",
                              transition: "background 0.3s var(--ease)",
                            }}
                          />
                        )}
                      </div>
                      <div style={{ paddingBottom: isLastRow ? 0 : 20, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13.5,
                            fontWeight: status === "pending" ? 400 : 500,
                            color:
                              status === "pending"
                                ? "var(--text-tertiary)"
                                : status === "active"
                                  ? "var(--text-primary)"
                                  : "var(--text-secondary)",
                            transition: "color 0.25s var(--ease)",
                          }}
                        >
                          {step.label}
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 2 }}>{step.detail}</div>
                        {status === "active" && !reduceMotion && (
                          <span className="ai-shimmer" aria-hidden style={{ display: "block", width: 72, marginTop: 7 }} />
                        )}
                      </div>
                    </motion.li>
                  );
                })}
              </motion.ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
