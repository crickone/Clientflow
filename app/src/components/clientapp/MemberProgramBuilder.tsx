// app/src/components/clientapp/MemberProgramBuilder.tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { PkCard, StickyBar } from "@/components/clientapp/programs/kit";
import { Sheet } from "@/components/clientapp/programs/Sheet";
import { ExercisePicker } from "@/components/clientapp/ExercisePicker";
import { deleteBuiltProgramAction, saveBuiltProgramAction } from "@/app/app/programs/built/actions";
import {
  addDay,
  addSet,
  addWeek,
  applyRule,
  draftFrom,
  moveDay,
  moveExercise,
  moveWeek,
  newExercise,
  removeDay,
  removeExercise,
  removeSet,
  removeWeek,
  setDeloadAfter,
  setIncKg,
  setLift,
  setNotes,
  setRest,
  setSetCount,
  setSetPct,
  setSetReps,
  setSetRpe,
  setStartKg,
  toggleAmrap,
  toggleJoined,
  type BuilderDraft,
} from "@/lib/programs/memberEditing";
import { MEMBER_LIMITS, memberLine } from "@/lib/programs/memberTemplate";
import { stateKey, summariseRx } from "@/lib/programs/planner";
import { ruleSentence } from "@/lib/programs/progressionText";
import { LIFT_KEYS, LIFT_LABEL, RULE_KINDS, RULE_LABEL, type ExerciseRx, type LiftKey, type ProgramTemplate, type RuleKind, type WeightUnit } from "@/lib/programs/types";
import { STEP_5LB_KG, formatWeight, kgToUnit, unitToKg } from "@/lib/programs/units";

/** The rule picker's tiles, in the member's words. */
const RULE_TILE: Record<RuleKind, string> = {
  linear: "Add weight each session",
  range: "Rep range, then add weight",
  percent: "Percent of my max",
  rpe: "Target effort (RPE)",
  manual: "I choose the weight",
};

/** A number box that can be emptied while typing: an empty box is null, a usable number is passed on as typed. */
function NumberBox({ value, onValue, label, decimal, placeholder }: { value: number | null; onValue: (n: number | null) => void; label: string; decimal?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="pk-input pk-num"
      inputMode={decimal ? "decimal" : "numeric"}
      aria-label={label}
      placeholder={placeholder}
      value={draft ?? (value === null ? "" : String(value))}
      onChange={(e) => {
        const v = e.target.value.replace(",", ".");
        setDraft(v);
        if (v.trim() === "") return onValue(null);
        const n = Number(v);
        if (Number.isFinite(n)) onValue(n);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

type Edit = (fn: (ex: ExerciseRx) => void) => void;

function RuleFields({ ex, unit, running, nowKg, onChange }: { ex: ExerciseRx; unit: WeightUnit; running: boolean; nowKg: number | null; onChange: Edit }) {
  const r = ex.rule;
  if (!r) return null;
  const inUnit = (kg: number | undefined) => (kg === undefined ? null : kgToUnit(kg, unit));
  const toKg = (n: number | null) => (n === null ? null : unitToKg(n, unit));
  const start =
    r.kind === "linear" || r.kind === "range" || r.kind === "manual" ? (
      <label className="pk-field">
        <span>Start at ({unit})</span>
        <NumberBox decimal label={`Start weight in ${unit}`} placeholder="Optional" value={inUnit(r.startKg)} onValue={(n) => onChange((x) => setStartKg(x, toKg(n)))} />
        {running && nowKg !== null && <span className="pk-small">Now {formatWeight(nowKg, unit)}. Change this to set a new weight from your next session.</span>}
      </label>
    ) : null;
  if (r.kind === "linear") {
    return (
      <div className="pk-pair">
        <label className="pk-field">
          <span>Add each time ({unit})</span>
          <NumberBox decimal label={`Weight to add in ${unit}`} value={inUnit(r.incKg)} onValue={(n) => onChange((x) => setIncKg(x, toKg(n)))} />
        </label>
        <label className="pk-field">
          <span>Lighter after misses</span>
          <NumberBox label="Misses in a row before it gets lighter" value={r.deloadAfter} onValue={(n) => onChange((x) => setDeloadAfter(x, n))} />
        </label>
        {start}
      </div>
    );
  }
  if (r.kind === "range") {
    return (
      <div className="pk-pair">
        <label className="pk-field">
          <span>Add at the top ({unit})</span>
          <NumberBox decimal label={`Weight to add in ${unit}`} placeholder="Smallest jump" value={inUnit(r.incKg)} onValue={(n) => onChange((x) => setIncKg(x, toKg(n)))} />
        </label>
        {start}
      </div>
    );
  }
  if (r.kind === "percent") {
    return (
      <label className="pk-field">
        <span>Percent of your</span>
        <select className="pk-input" value={ex.lift ?? ""} onChange={(e) => onChange((x) => setLift(x, e.target.value as LiftKey))}>
          {LIFT_KEYS.map((l) => (
            <option key={l} value={l}>
              {LIFT_LABEL[l]} max
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (r.kind === "manual") return start;
  return null;
}

function SetRows({ ex, onChange }: { ex: ExerciseRx; onChange: Edit }) {
  const kind = ex.rule?.kind ?? "manual";
  const heads: Record<RuleKind, [string, string]> = {
    linear: ["Reps", ""],
    range: ["From", "To"],
    percent: ["%", "Reps"],
    rpe: ["RPE", "Reps"],
    manual: ["Reps", "Up to"],
  };
  const plus = kind === "linear" || kind === "percent";
  return (
    <div className="pk-sets">
      <div className="pk-set pk-set--head" aria-hidden>
        <span>Set</span>
        <span>{heads[kind][0]}</span>
        <span>{heads[kind][1]}</span>
        <span>{plus ? "Max reps" : ""}</span>
        <span />
      </div>
      {ex.sets.map((s, si) => {
        const n = si + 1;
        const fixedMin = s.kind === "fixed" ? (typeof s.reps === "number" ? s.reps : s.reps.min) : null;
        const fixedMax = s.kind === "fixed" && typeof s.reps !== "number" ? s.reps.max : null;
        return (
          <div key={si} className="pk-set">
            <span className="pk-setno">{n}</span>
            {kind === "linear" && (
              <>
                <NumberBox label={`Set ${n} reps`} value={fixedMin} onValue={(v) => onChange((x) => setSetReps(x, si, v, null, false))} />
                <span />
              </>
            )}
            {kind === "range" && (
              <>
                <NumberBox label={`Set ${n} bottom of the rep range`} value={fixedMin} onValue={(v) => onChange((x) => setSetReps(x, si, v, fixedMax, true))} />
                <NumberBox label={`Set ${n} top of the rep range`} value={fixedMax} onValue={(v) => onChange((x) => setSetReps(x, si, fixedMin, v, true))} />
              </>
            )}
            {kind === "manual" && (
              <>
                <NumberBox label={`Set ${n} reps`} value={fixedMin} onValue={(v) => onChange((x) => setSetReps(x, si, v, fixedMax, false))} />
                <NumberBox label={`Set ${n} top of the rep range`} placeholder="-" value={fixedMax} onValue={(v) => onChange((x) => setSetReps(x, si, fixedMin, v, false))} />
              </>
            )}
            {kind === "percent" && (s.kind === "pct" || s.kind === "amrap") && (
              <>
                <NumberBox decimal label={`Set ${n} percentage of your max`} value={Math.round(s.pct * 1000) / 10} onValue={(v) => onChange((x) => setSetPct(x, si, v))} />
                <NumberBox label={`Set ${n} reps`} value={s.reps} onValue={(v) => onChange((x) => setSetCount(x, si, v))} />
              </>
            )}
            {kind === "rpe" && s.kind === "rpe" && (
              <>
                <NumberBox decimal label={`Set ${n} RPE`} value={s.rpe} onValue={(v) => onChange((x) => setSetRpe(x, si, v))} />
                <NumberBox label={`Set ${n} reps`} value={s.reps} onValue={(v) => onChange((x) => setSetCount(x, si, v))} />
              </>
            )}
            {plus ? (
              <button
                type="button"
                className="pk-plus"
                aria-pressed={s.kind === "amrap" || (s.kind === "fixed" && s.amrap === true)}
                aria-label={`Set ${n}: as many reps as you can`}
                onClick={() => onChange((x) => toggleAmrap(x, si))}
              >
                +
              </button>
            ) : (
              <span />
            )}
            <button type="button" className="pk-icon" aria-label={`Remove set ${n}`} disabled={ex.sets.length === 1} onClick={() => onChange((x) => removeSet(x, si))}>
              <Trash2 size={16} />
            </button>
          </div>
        );
      })}
      {ex.sets.length < MEMBER_LIMITS.sets && (
        <button type="button" className="pk-ghost" onClick={() => onChange((x) => addSet(x))}>
          <Plus size={16} /> Add set
        </button>
      )}
    </div>
  );
}

/**
 * The edit sheet for one exercise: how it moves, its sets, reps and rest, the
 * rule's fields, notes, superset, a sentence on how it will progress, then
 * move, remove and Done. Every change goes straight into the draft.
 */
function ExerciseSheet({
  ex,
  index,
  count,
  unit,
  stepKg,
  running,
  nowKg,
  onChange,
  onRule,
  onRename,
  onMove,
  onRemove,
  onClose,
}: {
  ex: ExerciseRx;
  index: number;
  count: number;
  unit: WeightUnit;
  stepKg: number;
  running: boolean;
  nowKg: number | null;
  onChange: Edit;
  onRule: (kind: RuleKind) => void;
  onRename: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const rule = ex.rule?.kind ?? "manual";
  return (
    <Sheet
      title={ex.name}
      onClose={onClose}
      footer={
        <>
          <div className="pk-actions">
            <button type="button" className="pk-icon" aria-label={`Move ${ex.name} up`} disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp size={16} />
            </button>
            <button type="button" className="pk-icon" aria-label={`Move ${ex.name} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown size={16} />
            </button>
            <button type="button" className="pk-btn pk-btn--danger" onClick={onRemove}>
              <Trash2 size={16} aria-hidden /> Remove
            </button>
          </div>
          <button type="button" className="pk-cta" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <button type="button" className="pk-ghost" onClick={onRename}>
        <Pencil size={16} aria-hidden /> Change exercise
      </button>
      <div className="pk-section">
        <span className="pk-label">How it moves</span>
        <div className="pk-tiles" role="group" aria-label="How the weight moves">
          {RULE_KINDS.map((k) => (
            <button key={k} type="button" className="pk-tile" aria-pressed={rule === k} onClick={() => onRule(k)}>
              {RULE_TILE[k]}
            </button>
          ))}
        </div>
      </div>
      <SetRows ex={ex} onChange={onChange} />
      <label className="pk-field">
        <span>Rest between sets (seconds)</span>
        <NumberBox label="Rest in seconds" value={ex.sets[0]?.rest ?? 0} onValue={(n) => onChange((x) => setRest(x, n ?? 0))} />
      </label>
      <RuleFields ex={ex} unit={unit} running={running} nowKg={nowKg} onChange={onChange} />
      <label className="pk-field">
        <span>Notes</span>
        <textarea
          className="pk-input pk-notes"
          rows={2}
          maxLength={MEMBER_LIMITS.notes}
          placeholder="Optional"
          value={ex.notes ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onChange((x) => setNotes(x, v));
          }}
        />
      </label>
      {index > 0 && (
        <button type="button" className="pk-tile" aria-pressed={ex.joined === true} onClick={() => onChange((x) => toggleJoined(x))}>
          Superset with the exercise above
        </button>
      )}
      <p className="pk-muted">{ruleSentence(ex, unit, stepKg)}</p>
    </Sheet>
  );
}

type Spot = { w: number; di: number; xi: number | null };

/**
 * The member's program builder (direction A, day cards with an edit sheet):
 * name and units, week tabs, a card per day with a row per exercise, and a
 * sheet to edit the exercise tapped. Phone-first. Save checks everything on
 * the server and lists what needs fixing. While saving, everything is locked;
 * a new program is created once and every later save edits it.
 * `from` is set for a new program (the builder's ?from=); `running` when the
 * member is running this program, with its working weights by state key.
 */
export function MemberProgramBuilder({
  id,
  from,
  initial,
  initialUnit,
  stepKg,
  running,
  current,
}: {
  id: number | null;
  from: string | null;
  initial: ProgramTemplate;
  initialUnit: WeightUnit;
  /** The member's smallest jump, for the sentence on how an exercise progresses. */
  stepKg: number;
  running: boolean;
  current: Record<string, number>;
}) {
  const router = useRouter();
  const [d, setD] = useState<BuilderDraft>(() => draftFrom(initial, id !== null));
  const [unit, setUnit] = useState<WeightUnit>(initialUnit);
  const [wi, setWi] = useState(0);
  const [open, setOpen] = useState<{ w: number; di: number; xi: number } | null>(null);
  const [picking, setPicking] = useState<Spot | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  // Set the moment the create action returns, so no later save can create a second program.
  const createdId = useRef<number | null>(null);
  const t = d.template;
  const w = Math.min(wi, t.weeks.length - 1);
  const week = t.weeks[w];
  // The step the sentences use follows the unit shown on this screen.
  const shownStep = unit === "lb" ? STEP_5LB_KG : Math.abs(stepKg - STEP_5LB_KG) < 1e-3 ? 2.5 : stepKg;
  const sheetEx = open ? t.weeks[open.w]?.days[open.di]?.exercises[open.xi] : undefined;

  function edit(fn: (draft: BuilderDraft) => void) {
    setD((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }

  function save() {
    const sent = d;
    const programId = id ?? createdId.current;
    setOpen(null);
    start(async () => {
      const r = await saveBuiltProgramAction({ id: programId, from: programId === null ? from : null, template: sent.template, weekOrigins: sent.origins });
      if (!r.ok) {
        setErrors(r.errors);
        toast.error("Not saved. See what needs fixing at the top.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (programId === null) createdId.current = r.id;
      setErrors([]);
      // Saved: every week of the saved snapshot is now a saved week. If the draft moved on, leave origins alone.
      setD((prev) => (prev.template === sent.template ? { ...prev, origins: sent.template.weeks.map((_, i) => i) } : prev));
      toast.success(r.edited ? "Saved. Your program uses it from your next session." : "Saved.");
      if (id === null) router.replace(`/app/programs/built/${r.id}`);
      router.refresh();
    });
  }

  function remove() {
    if (id === null) return;
    // Ask before the transition starts, so the dialog is not inside it.
    if (!confirm(`Delete "${t.name || "this program"}"? This can't be undone.`)) return;
    start(async () => {
      const r = await deleteBuiltProgramAction(id);
      if (!r.ok) {
        setErrors([r.error]);
        toast.error(r.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      toast.success("Program deleted.");
      router.replace("/app/programs");
      router.refresh();
    });
  }

  function pick(name: string) {
    const p = picking;
    setPicking(null);
    if (!p) return;
    edit((x) => {
      const list = x.template.weeks[p.w].days[p.di].exercises;
      if (p.xi === null) list.push(newExercise(name));
      else list[p.xi].name = name;
    });
    // A new exercise opens in the sheet; a renamed one stays open.
    if (p.xi === null) setOpen({ w: p.w, di: p.di, xi: t.weeks[p.w].days[p.di].exercises.length });
  }

  return (
    <div className="pk">
      {errors.length > 0 && (
        <div className="pk-error" role="alert">
          <b>Not saved:</b>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset className="pk-lock" disabled={pending}>
        <PkCard>
          <label className="pk-field">
            <span>Name</span>
            <input
              className="pk-input"
              maxLength={MEMBER_LIMITS.name}
              value={t.name}
              onChange={(e) => {
                const v = e.target.value;
                edit((x) => void (x.template.name = v));
              }}
            />
          </label>
          <span className="pk-small">{memberLine(t)}</span>
          <div className="pk-field">
            <span>Weights in</span>
            <div className="pk-seg" role="group" aria-label="Units">
              {(["kg", "lb"] as const).map((u) => (
                <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)}>
                  {u === "kg" ? "Kilograms" : "Pounds"}
                </button>
              ))}
            </div>
            <span className="pk-small">This changes how weights are shown on this screen. They are saved in kg.</span>
          </div>
          {running && <span className="pk-small">You&rsquo;re running this program. Changes apply from your next session. Nothing you have logged changes.</span>}
        </PkCard>

        <div className="pk-tabs" role="group" aria-label="Weeks">
          {t.weeks.map((wk, i) => (
            <button key={i} type="button" aria-pressed={i === w} className="pk-tab" onClick={() => setWi(i)}>
              Week {i + 1}
              {wk.label ? `: ${wk.label}` : ""}
            </button>
          ))}
          {t.weeks.length < MEMBER_LIMITS.weeks && (
            <button
              type="button"
              className="pk-tab"
              onClick={() => {
                edit((x) => void addWeek(x, w));
                setOpen(null);
                setWi(w + 1);
              }}
            >
              <Copy size={16} aria-hidden /> Add a week
            </button>
          )}
        </div>
        <span className="pk-small">{t.weeks.length === 1 ? "Week 1 repeats. Add a week to copy it and change the copy, for a block or a deload." : `The ${t.weeks.length} weeks run in order, then start again.`}</span>
        {t.weeks.length > 1 && (
          <div className="pk-row">
            <button
              type="button"
              className="pk-icon"
              aria-label="Move this week earlier"
              disabled={w === 0}
              onClick={() => {
                edit((x) => void moveWeek(x, w, -1));
                setOpen(null);
                setWi(w - 1);
              }}
            >
              <ArrowLeft size={16} />
            </button>
            <button
              type="button"
              className="pk-icon"
              aria-label="Move this week later"
              disabled={w === t.weeks.length - 1}
              onClick={() => {
                edit((x) => void moveWeek(x, w, 1));
                setOpen(null);
                setWi(w + 1);
              }}
            >
              <ArrowRight size={16} />
            </button>
            <input
              className="pk-input"
              aria-label={`Week ${w + 1} label`}
              placeholder="Label, e.g. Deload"
              maxLength={60}
              value={week.label ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                edit((x) => {
                  if (v) x.template.weeks[w].label = v;
                  else delete x.template.weeks[w].label;
                });
              }}
            />
            <button
              type="button"
              className="pk-icon"
              aria-label={`Remove week ${w + 1}`}
              onClick={() => {
                edit((x) => removeWeek(x, w));
                setOpen(null);
                setWi(Math.max(0, w - 1));
              }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}

        {week.days.map((day, di) => (
          <PkCard key={`${w}-${di}`}>
            <div className="pk-row">
              <input
                className="pk-input"
                aria-label={`Day ${di + 1} name`}
                maxLength={MEMBER_LIMITS.name}
                value={day.name}
                onChange={(e) => {
                  const v = e.target.value;
                  edit((x) => void (x.template.weeks[w].days[di].name = v));
                }}
              />
              <button
                type="button"
                className="pk-icon"
                aria-label={`Move ${day.name} up`}
                disabled={di === 0}
                onClick={() => {
                  edit((x) => void moveDay(x.template, w, di, -1));
                  setOpen(null);
                }}
              >
                <ArrowUp size={16} />
              </button>
              <button
                type="button"
                className="pk-icon"
                aria-label={`Move ${day.name} down`}
                disabled={di === week.days.length - 1}
                onClick={() => {
                  edit((x) => void moveDay(x.template, w, di, 1));
                  setOpen(null);
                }}
              >
                <ArrowDown size={16} />
              </button>
              <button
                type="button"
                className="pk-icon"
                aria-label={`Remove ${day.name}`}
                disabled={week.days.length === 1}
                onClick={() => {
                  edit((x) => removeDay(x.template, w, di));
                  setOpen(null);
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
            {day.exercises.length === 0 && <span className="pk-small">No exercises yet.</span>}
            {day.exercises.map((ex, xi) => (
              <button key={`${w}-${di}-${xi}`} type="button" className="pk-ex" data-joined={ex.joined ? "true" : undefined} onClick={() => setOpen({ w, di, xi })}>
                <span className="pk-ex-name">
                  {ex.name}
                  <span>
                    {summariseRx(ex.sets)}
                    {ex.joined ? ", superset with the one above" : ""}
                  </span>
                </span>
                <span className="pk-badge">{RULE_LABEL[ex.rule?.kind ?? "manual"]}</span>
              </button>
            ))}
            {day.exercises.length < MEMBER_LIMITS.exercises && (
              <button type="button" className="pk-dashed" onClick={() => setPicking({ w, di, xi: null })}>
                <Plus size={16} /> Add exercise
              </button>
            )}
          </PkCard>
        ))}

        {week.days.length < MEMBER_LIMITS.days && (
          <button type="button" className="pk-dashed" onClick={() => edit((x) => addDay(x.template, w))}>
            <Plus size={16} /> Add a day
          </button>
        )}

        {open && sheetEx && !picking && (
          <ExerciseSheet
            ex={sheetEx}
            index={open.xi}
            count={t.weeks[open.w].days[open.di].exercises.length}
            unit={unit}
            stepKg={shownStep}
            running={running}
            nowKg={current[stateKey(sheetEx)] ?? null}
            onClose={() => setOpen(null)}
            onChange={(fn) => edit((x) => fn(x.template.weeks[open.w].days[open.di].exercises[open.xi]))}
            onRule={(k) =>
              edit((x) => {
                const list = x.template.weeks[open.w].days[open.di].exercises;
                list[open.xi] = applyRule(list[open.xi], k);
              })
            }
            onRename={() => setPicking(open)}
            onMove={(dir) => {
              const to = open.xi + dir;
              if (to < 0 || to >= t.weeks[open.w].days[open.di].exercises.length) return;
              edit((x) => void moveExercise(x.template, open.w, open.di, open.xi, dir));
              // The sheet follows the exercise it is editing.
              setOpen({ ...open, xi: to });
            }}
            onRemove={() => {
              edit((x) => removeExercise(x.template, open.w, open.di, open.xi));
              setOpen(null);
            }}
          />
        )}
      </fieldset>

      <StickyBar>
        <button type="button" className="pk-cta" onClick={save} disabled={pending}>
          {pending ? "Saving" : "Save program"}
        </button>
      </StickyBar>

      {id !== null && !running && (
        <button type="button" className="pk-dashed pk-btn--danger" onClick={remove} disabled={pending}>
          <Trash2 size={16} /> Delete this program
        </button>
      )}

      {picking && <ExercisePicker onClose={() => setPicking(null)} onPick={(hit) => pick(hit.name)} />}
    </div>
  );
}
