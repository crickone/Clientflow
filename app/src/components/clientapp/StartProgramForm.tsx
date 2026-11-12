// app/src/components/clientapp/StartProgramForm.tsx
"use client";

import { useEffect, useReducer, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { PkCard, PkSection, StepBar, StickyBar } from "@/components/clientapp/programs/kit";
import { startProgramAction } from "@/app/app/programs/actions";
import { firstSets, firstWeek, shortDate, trainingDates, weightsMoveBetweenSessions, type PlanExtra } from "@/lib/programs/outline";
import { STEP_TITLE, initialStart, maxEntries, maxesKg, reduceStart, rowMaxKg, startSteps, stepBlocker, stepForError, type StartLift } from "@/lib/programs/startFlow";
import type { ProgramTemplate, WeightUnit } from "@/lib/programs/types";
import { STEP_OPTIONS, formatWeight, kgToUnit, stepFromKey, trainingMax, type StepKey } from "@/lib/programs/units";
import { WEEKDAY_SHORT } from "@/lib/trainingProgress";

/**
 * Starting a program, one question per screen: weights, maxes (when the
 * program takes any), days, then a review with the whole first week at the
 * member's real weights. Back keeps everything; the server checks it all on
 * Start, and an error shows on the screen it belongs to.
 */
export function StartProgramForm({
  programKey,
  programName,
  template,
  extra,
  lifts,
  initialUnit,
  initialStep,
  defaultWeekdays,
  today,
  backHref,
}: {
  programKey: string;
  programName: string;
  /** The program as it will start, for the previews. */
  template: ProgramTemplate;
  /** What the app will plan from (logged lifts and last weights), plain data, so the preview matches session 1. */
  extra: PlanExtra;
  lifts: StartLift[];
  initialUnit: WeightUnit;
  initialStep: StepKey;
  defaultWeekdays: number[];
  today: string;
  /** Where Back goes from the first screen. */
  backHref: string;
}) {
  const router = useRouter();
  const steps = startSteps(lifts.length > 0);
  const [s, rawDispatch] = useReducer(
    (state: ReturnType<typeof initialStart>, a: Parameters<typeof reduceStart>[1]) => reduceStart(state, a, steps.length),
    { lifts, unit: initialUnit, step: initialStep, weekdays: defaultWeekdays, today },
    (input) => initialStart(input, (kg) => String(kgToUnit(kg, input.unit))),
  );
  const [error, setError] = useState<{ at: number; text: string } | null>(null);
  const [pending, start] = useTransition();
  const submitting = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const step = steps[s.at];
  const stepKg = stepFromKey(s.step);
  const fmt = (kg: number) => formatWeight(kg, s.unit);
  const maxes = maxesKg(s, lifts);

  // Editing a field clears the message on the step it is on.
  function dispatch(a: Parameters<typeof reduceStart>[1]) {
    if (a.type !== "next" && a.type !== "back" && a.type !== "go") setError(null);
    rawDispatch(a);
  }

  // Each new step starts at its heading, for screen readers and the keyboard.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [s.at]);

  function next() {
    const blocked = stepBlocker(s, lifts, step);
    if (blocked) {
      setError({ at: s.at, text: blocked });
      return;
    }
    setError(null);
    go(s.at + 1);
  }

  function go(next: number) {
    dispatch({ type: "go", at: next });
    window.scrollTo({ top: 0 });
  }

  function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    start(async () => {
      const res = await startProgramAction({ key: programKey, unit: s.unit, step: s.step, startDate: s.startDate, weekdays: s.days, maxes: maxEntries(s, lifts) });
      if (!res.ok) {
        submitting.current = false;
        const at = stepForError(res.error, steps);
        setError({ at, text: res.error });
        go(at);
        return;
      }
      toast.success("Program started");
      router.push("/app/programs/mine");
      router.refresh();
    });
  }

  const kgSteps = STEP_OPTIONS.filter((o) => o.unit === s.unit);
  const dates = trainingDates(s.startDate, s.days, template.weeks[0]?.days.length ?? 0);

  return (
    <div className="pk">
      <div className="pk-head">
        <span className="pk-small">
          Start {programName}, step {s.at + 1} of {steps.length}
        </span>
        <StepBar at={s.at} of={steps.length} label={`Step ${s.at + 1} of ${steps.length}: ${STEP_TITLE[step]}`} />
      </div>

      {error && error.at === s.at && (
        <div className="pk-error" role="alert">
          {error.text}
        </div>
      )}

      {step === "weights" && (
        <>
          <h1 className="pk-question" ref={headingRef} tabIndex={-1}>How do you want your weights?</h1>
          <PkSection label="Weights in">
            <div className="pk-seg" role="group" aria-label="Weights in">
              {(["kg", "lb"] as const).map((u) => (
                <button key={u} type="button" aria-pressed={s.unit === u} onClick={() => dispatch({ type: "unit", unit: u })}>
                  {u === "kg" ? "Kilograms" : "Pounds"}
                </button>
              ))}
            </div>
          </PkSection>
          <PkSection label="Smallest jump">
            <div className="pk-seg" role="group" aria-label="Smallest jump">
              {kgSteps.map((o) => (
                <button key={o.key} type="button" aria-pressed={s.step === o.key} onClick={() => dispatch({ type: "step", step: o.key })}>
                  {o.label}
                </button>
              ))}
            </div>
            <span className="pk-small">Every weight rounds to this jump.</span>
          </PkSection>
        </>
      )}

      {step === "maxes" && (
        <>
          <h1 className="pk-question" ref={headingRef} tabIndex={-1}>{lifts.length === 1 ? `What's your ${lifts[0].label.toLowerCase()} max?` : "What are your maxes?"}</h1>
          <span className="pk-muted">Every weight in the program is worked out from {lifts.length === 1 ? "this" : "these"}.</span>
          {lifts.map((l, i) => {
            const r = s.rows[i];
            const est = rowMaxKg(r, l, s.unit);
            const preview = est !== null ? firstSets(template, l.lift, est, stepKg, s.unit, extra) : null;
            return (
              <PkCard key={l.lift}>
                <h2 className="pk-card-title">{l.label}</h2>
                {l.keptKg ? <span className="pk-small">Filled in from your last program.</span> : null}
                <div className="pk-seg" role="group" aria-label={`How to set your ${l.label.toLowerCase()} max`}>
                  <button type="button" aria-pressed={r.mode === "one_rm"} onClick={() => dispatch({ type: "row", index: i, patch: { mode: "one_rm" } })}>
                    1-rep max
                  </button>
                  <button type="button" aria-pressed={r.mode === "set"} onClick={() => dispatch({ type: "row", index: i, patch: { mode: "set" } })}>
                    A recent set
                  </button>
                  {l.logged && (
                    <button type="button" aria-pressed={r.mode === "logged"} onClick={() => dispatch({ type: "row", index: i, patch: { mode: "logged" } })}>
                      From my log
                    </button>
                  )}
                </div>
                {r.mode === "logged" && l.logged && (
                  <span className="pk-muted">
                    Your best in the last 90 days: {fmt(l.logged.kg)} x {l.logged.reps}.
                  </span>
                )}
                {r.mode === "one_rm" && (
                  <input
                    className="pk-input pk-big"
                    inputMode="decimal"
                    aria-label={`${l.label} 1-rep max in ${s.unit}`}
                    placeholder={s.unit}
                    value={r.weight}
                    onChange={(e) => dispatch({ type: "row", index: i, patch: { weight: e.target.value } })}
                  />
                )}
                {r.mode === "set" && (
                  <div className="pk-pair">
                    <label className="pk-field">
                      <span>Weight ({s.unit})</span>
                      <input className="pk-input" inputMode="decimal" aria-label={`${l.label} weight in ${s.unit}`} value={r.weight} onChange={(e) => dispatch({ type: "row", index: i, patch: { weight: e.target.value } })} />
                    </label>
                    <label className="pk-field">
                      <span>Reps, 1 to 10</span>
                      <input
                        className="pk-input"
                        inputMode="numeric"
                        aria-label={`${l.label} reps`}
                        value={r.reps}
                        onChange={(e) => dispatch({ type: "row", index: i, patch: { reps: e.target.value.replace(/\D/g, "").slice(0, 2) } })}
                      />
                    </label>
                  </div>
                )}
                {est !== null ? (
                  <span className="pk-muted">
                    Max about {fmt(est)}
                    {template.tmPct !== 1 ? `. Training max ${fmt(trainingMax(est, template.tmPct))}.` : "."}
                    {preview ? ` Your first sets: ${preview}.` : ""}
                  </span>
                ) : r.mode === "set" && Number(r.reps) > 10 ? (
                  <span className="pk-muted">Use a set of 10 reps or fewer.</span>
                ) : null}
              </PkCard>
            );
          })}
        </>
      )}

      {step === "days" && (
        <>
          <h1 className="pk-question" ref={headingRef} tabIndex={-1}>When do you train?</h1>
          <PkSection label="Days you train">
            <div className="td-days" role="group" aria-label="Days you train">
              {WEEKDAY_SHORT.map((label, i) => (
                <button key={label} type="button" className="td-day" aria-pressed={s.days.includes(i + 1)} onClick={() => dispatch({ type: "day", day: i + 1 })}>
                  {label}
                </button>
              ))}
            </div>
            <span className="pk-small">Your program moves on when you finish a session, so a missed day just waits for you.</span>
          </PkSection>
          <label className="pk-field">
            <span>Start date</span>
            <input className="pk-input" type="date" value={s.startDate} min={today} onChange={(e) => dispatch({ type: "startDate", value: e.target.value || today })} />
          </label>
        </>
      )}

      {step === "review" && (
        <>
          <h1 className="pk-question" ref={headingRef} tabIndex={-1}>Ready to go</h1>
          <div>
            {lifts.map((l) => (
              <div key={l.lift} className="pk-sum">
                <span>{l.label} max</span>
                <span>{maxes[l.lift] !== undefined ? fmt(maxes[l.lift]!) : "Not set"}</span>
              </div>
            ))}
            <div className="pk-sum">
              <span>Weights in</span>
              <span>
                {s.unit}, {fmt(stepKg)} jumps
              </span>
            </div>
            <div className="pk-sum">
              <span>Training days</span>
              <span>{s.days.length ? s.days.map((d) => WEEKDAY_SHORT[d - 1]).join(" ") : "None picked"}</span>
            </div>
            <div className="pk-sum">
              <span>First session</span>
              <span>{shortDate(dates[0] ?? s.startDate)}</span>
            </div>
          </div>
          <PkSection label="Your first week">
            {weightsMoveBetweenSessions(template) && <span className="pk-small">Later sessions go up when you get all your reps.</span>}
            {firstWeek(template, maxes, stepKg, s.unit, extra).map((d, i) => (
              <div key={i} className="pk-day">
                <span className="pk-day-name">
                  {dates[i] ? `${shortDate(dates[i])}, ` : ""}
                  {d.name}
                </span>
                {d.lines.map((line, k) => (
                  <span key={k} className="pk-muted">
                    {line}
                  </span>
                ))}
              </div>
            ))}
          </PkSection>
        </>
      )}

      <StickyBar>
        {step === "review" ? (
          <button type="button" className="pk-cta" onClick={submit} disabled={pending}>
            {pending ? "Starting" : "Start program"}
          </button>
        ) : (
          <button type="button" className="pk-cta" onClick={next}>
            Next: {STEP_TITLE[steps[s.at + 1]].toLowerCase()}
          </button>
        )}
      </StickyBar>
      {s.at > 0 ? (
        <button type="button" className="pk-ghost" onClick={() => go(s.at - 1)} disabled={pending}>
          Back
        </button>
      ) : (
        <Link href={backHref} className="pk-ghost">
          Back
        </Link>
      )}
    </div>
  );
}
