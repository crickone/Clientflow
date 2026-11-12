// app/src/components/clientapp/MemberProgramBuilder.tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronUp, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/clientapp/ui";
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
  removeWeek,
  setRest,
  type BuilderDraft,
} from "@/lib/programs/memberEditing";
import { MEMBER_LIMITS } from "@/lib/programs/memberTemplate";
import { stateKey, summariseRx } from "@/lib/programs/planner";
import { LIFT_KEYS, LIFT_LABEL, RULE_KINDS, RULE_LABEL, type ExerciseRx, type LiftKey, type ProgramTemplate, type RuleKind, type WeightUnit } from "@/lib/programs/types";
import { formatWeight, kgToUnit, unitToKg } from "@/lib/programs/units";

const RULE_HELP: Record<RuleKind, string> = {
  linear: "Adds weight after a session with every rep. Gets 10% lighter after the misses in a row you set.",
  range: "Adds weight when every set reaches the top of its range, then starts again at the bottom.",
  percent: "Each set is a percentage of your max.",
  rpe: "Each set has a target effort. The weight comes from your best logged set.",
  manual: "You choose the weight. It starts from last time.",
};

/** A number box that can be emptied while typing: an empty box is null, a usable number is passed on as typed. */
function NumberBox({ value, onValue, label, decimal, placeholder }: { value: number | null; onValue: (n: number | null) => void; label: string; decimal?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="pg-input bld-num"
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
  const start =
    r.kind === "linear" || r.kind === "range" || r.kind === "manual" ? (
      <label className="bld-field">
        <span className="td-label">Start at ({unit})</span>
        <NumberBox
          decimal
          label={`Start weight in ${unit}`}
          placeholder="Optional"
          value={inUnit(r.startKg)}
          onValue={(n) =>
            onChange((x) => {
              const cur = x.rule;
              if (cur && (cur.kind === "linear" || cur.kind === "range" || cur.kind === "manual")) {
                if (n === null || n <= 0) delete cur.startKg;
                else cur.startKg = unitToKg(n, unit);
              }
            })
          }
        />
        {running && nowKg !== null && <span className="bld-hint">Now {formatWeight(nowKg, unit)}. Change this to set a new weight from your next session.</span>}
      </label>
    ) : null;
  if (r.kind === "linear") {
    return (
      <div className="bld-fields">
        <label className="bld-field">
          <span className="td-label">Add each time ({unit})</span>
          <NumberBox
            decimal
            label={`Weight to add in ${unit}`}
            value={inUnit(r.incKg)}
            onValue={(n) =>
              onChange((x) => {
                if (x.rule?.kind === "linear") x.rule.incKg = n === null ? 0 : unitToKg(n, unit);
              })
            }
          />
        </label>
        <label className="bld-field">
          <span className="td-label">Lighter after misses</span>
          <NumberBox
            label="Misses in a row before it gets lighter"
            value={r.deloadAfter}
            onValue={(n) =>
              onChange((x) => {
                if (x.rule?.kind === "linear") x.rule.deloadAfter = n === null ? 0 : Math.round(n);
              })
            }
          />
        </label>
        {start}
      </div>
    );
  }
  if (r.kind === "range") {
    return (
      <div className="bld-fields">
        <label className="bld-field">
          <span className="td-label">Add at the top ({unit})</span>
          <NumberBox
            decimal
            label={`Weight to add in ${unit}`}
            placeholder="Smallest jump"
            value={inUnit(r.incKg)}
            onValue={(n) =>
              onChange((x) => {
                if (x.rule?.kind !== "range") return;
                if (n === null || n <= 0) delete x.rule.incKg;
                else x.rule.incKg = unitToKg(n, unit);
              })
            }
          />
        </label>
        {start}
      </div>
    );
  }
  if (r.kind === "percent") {
    return (
      <div className="bld-fields">
        <label className="bld-field">
          <span className="td-label">Percent of your</span>
          <select
            className="pg-input"
            value={ex.lift ?? ""}
            onChange={(e) => {
              const lift = e.target.value as LiftKey;
              onChange((x) => void (x.lift = lift));
            }}
          >
            {LIFT_KEYS.map((l) => (
              <option key={l} value={l}>
                {LIFT_LABEL[l]} max
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }
  if (r.kind === "manual") return <div className="bld-fields">{start}</div>;
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
    <div className="bld-sets">
      <div className="bld-set bld-set--head" aria-hidden>
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
        const setCount = (v: number | null) =>
          onChange((x) => {
            const cur = x.sets[si];
            if (cur.kind === "pct" || cur.kind === "amrap" || cur.kind === "rpe") cur.reps = v === null ? 0 : Math.round(v);
          });
        const setReps = (min: number | null, max: number | null, keepRange: boolean) =>
          onChange((x) => {
            const cur = x.sets[si];
            if (cur.kind !== "fixed") return;
            const lo = min === null ? 0 : Math.round(min);
            if (keepRange) cur.reps = { min: lo, max: max === null ? 0 : Math.round(max) };
            else cur.reps = max !== null && max > lo ? { min: lo, max: Math.round(max) } : lo;
          });
        return (
          <div key={si} className="bld-set">
            <span className="bld-setno">{n}</span>
            {kind === "linear" && (
              <>
                <NumberBox label={`Set ${n} reps`} value={fixedMin} onValue={(v) => setReps(v, null, false)} />
                <span />
              </>
            )}
            {kind === "range" && (
              <>
                <NumberBox label={`Set ${n} bottom of the rep range`} value={fixedMin} onValue={(v) => setReps(v, fixedMax, true)} />
                <NumberBox label={`Set ${n} top of the rep range`} value={fixedMax} onValue={(v) => setReps(fixedMin, v, true)} />
              </>
            )}
            {kind === "manual" && (
              <>
                <NumberBox label={`Set ${n} reps`} value={fixedMin} onValue={(v) => setReps(v, fixedMax, false)} />
                <NumberBox label={`Set ${n} top of the rep range`} placeholder="-" value={fixedMax} onValue={(v) => setReps(fixedMin, v, false)} />
              </>
            )}
            {kind === "percent" && (s.kind === "pct" || s.kind === "amrap") && (
              <>
                <NumberBox
                  decimal
                  label={`Set ${n} percentage of your max`}
                  value={Math.round(s.pct * 1000) / 10}
                  onValue={(v) =>
                    onChange((x) => {
                      const cur = x.sets[si];
                      if (cur.kind === "pct" || cur.kind === "amrap") cur.pct = v === null ? 0 : v / 100;
                    })
                  }
                />
                <NumberBox label={`Set ${n} reps`} value={s.reps} onValue={setCount} />
              </>
            )}
            {kind === "rpe" && s.kind === "rpe" && (
              <>
                <NumberBox
                  decimal
                  label={`Set ${n} RPE`}
                  value={s.rpe}
                  onValue={(v) =>
                    onChange((x) => {
                      const cur = x.sets[si];
                      if (cur.kind === "rpe") cur.rpe = v === null ? 0 : v;
                    })
                  }
                />
                <NumberBox label={`Set ${n} reps`} value={s.reps} onValue={setCount} />
              </>
            )}
            {plus ? (
              <button
                type="button"
                className="bld-plus"
                aria-pressed={s.kind === "amrap" || (s.kind === "fixed" && s.amrap === true)}
                aria-label={`Set ${n}: as many reps as you can`}
                onClick={() =>
                  onChange((x) => {
                    const cur = x.sets[si];
                    if (cur.kind === "fixed") {
                      if (cur.amrap) delete cur.amrap;
                      else cur.amrap = true;
                    } else if (cur.kind === "pct" || cur.kind === "amrap") x.sets[si] = { ...cur, kind: cur.kind === "pct" ? "amrap" : "pct" };
                  })
                }
              >
                +
              </button>
            ) : (
              <span />
            )}
            <button type="button" className="bld-icon" aria-label={`Remove set ${n}`} disabled={ex.sets.length === 1} onClick={() => onChange((x) => void x.sets.splice(si, 1))}>
              <Trash2 size={16} />
            </button>
          </div>
        );
      })}
      {ex.sets.length < MEMBER_LIMITS.sets && (
        <button type="button" className="bld-link" onClick={() => onChange((x) => addSet(x))}>
          <Plus size={16} /> Add set
        </button>
      )}
    </div>
  );
}

function ExerciseCard({
  ex,
  index,
  count,
  open,
  unit,
  running,
  nowKg,
  onToggle,
  onChange,
  onRule,
  onRename,
  onMove,
  onRemove,
}: {
  ex: ExerciseRx;
  index: number;
  count: number;
  open: boolean;
  unit: WeightUnit;
  running: boolean;
  nowKg: number | null;
  onToggle: () => void;
  onChange: Edit;
  onRule: (kind: RuleKind) => void;
  onRename: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const rule = ex.rule?.kind ?? "manual";
  return (
    <div className="bld-ex" data-joined={ex.joined ? "true" : undefined}>
      <button type="button" className="bld-ex-head" aria-expanded={open} onClick={onToggle}>
        <span className="bld-ex-title">
          <span className="bld-ex-name">{ex.name}</span>
          <span className="bld-ex-sub">
            {RULE_LABEL[rule]}. {summariseRx(ex.sets)}
            {ex.joined ? ". Joined to the one above" : ""}
          </span>
        </span>
        {open ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
      </button>
      {open && (
        <div className="bld-ex-body">
          <button type="button" className="bld-link" onClick={onRename}>
            <Pencil size={16} /> Change exercise
          </button>
          <div className="pg-chips" role="group" aria-label="How the weight moves">
            {RULE_KINDS.map((k) => (
              <button key={k} type="button" className="pg-chip" aria-pressed={rule === k} onClick={() => onRule(k)}>
                {RULE_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="bld-hint">{RULE_HELP[rule]}</div>
          <RuleFields ex={ex} unit={unit} running={running} nowKg={nowKg} onChange={onChange} />
          <SetRows ex={ex} onChange={onChange} />
          <label className="bld-field">
            <span className="td-label">Rest between sets (seconds)</span>
            <NumberBox label="Rest in seconds" value={ex.sets[0]?.rest ?? 0} onValue={(n) => onChange((x) => setRest(x, n ?? 0))} />
          </label>
          <label className="bld-field">
            <span className="td-label">Notes</span>
            <textarea
              className="pg-input bld-notes"
              rows={2}
              maxLength={MEMBER_LIMITS.notes}
              placeholder="Optional"
              value={ex.notes ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onChange((x) => {
                  if (v) x.notes = v;
                  else delete x.notes;
                });
              }}
            />
          </label>
          {index > 0 && (
            <button
              type="button"
              className="pg-chip"
              aria-pressed={ex.joined === true}
              onClick={() =>
                onChange((x) => {
                  if (x.joined) delete x.joined;
                  else x.joined = true;
                })
              }
            >
              Superset with the exercise above
            </button>
          )}
          <div className="bld-tools">
            <button type="button" className="bld-icon" aria-label={`Move ${ex.name} up`} disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp size={16} />
            </button>
            <button type="button" className="bld-icon" aria-label={`Move ${ex.name} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown size={16} />
            </button>
            <button type="button" className="bld-icon" aria-label={`Remove ${ex.name}`} onClick={onRemove}>
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type Picking = { w: number; di: number; xi: number | null } | null;

/**
 * The member's program builder: name and units, week tabs, days, and each
 * exercise with its rule, sets, rest and notes. Phone-first. Save checks
 * everything on the server and lists what needs fixing.
 * `from` is set for a new program (the builder's ?from=); `running` when the
 * member is running this program, with its working weights by state key.
 */
export function MemberProgramBuilder({
  id,
  from,
  initial,
  initialUnit,
  running,
  current,
}: {
  id: number | null;
  from: string | null;
  initial: ProgramTemplate;
  initialUnit: WeightUnit;
  running: boolean;
  current: Record<string, number>;
}) {
  const router = useRouter();
  const [d, setD] = useState<BuilderDraft>(() => draftFrom(initial, id !== null));
  const [unit, setUnit] = useState<WeightUnit>(initialUnit);
  const [wi, setWi] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState<Picking>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  // Set the moment the create action returns, so no later save can create a second program.
  const createdId = useRef<number | null>(null);
  const t = d.template;
  const w = Math.min(wi, t.weeks.length - 1);
  const week = t.weeks[w];

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
    if (p.xi === null) setOpen(`${p.w}-${p.di}-${t.weeks[p.w].days[p.di].exercises.length}`);
  }

  return (
    <div className="bld">
      {errors.length > 0 && (
        <div className="bld-errors" role="alert">
          <b>Not saved:</b>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset className="bld-lock" disabled={pending}>
      <Card style={{ display: "grid", gap: 12 }}>
        <label className="bld-field">
          <span className="td-label">Name</span>
          <input
            className="pg-input"
            maxLength={MEMBER_LIMITS.name}
            value={t.name}
            onChange={(e) => {
              const v = e.target.value;
              edit((x) => void (x.template.name = v));
            }}
          />
        </label>
        <div className="bld-field">
          <span className="td-label">Weights in</span>
          <div className="pg-chips" role="group" aria-label="Units">
            {(["kg", "lb"] as const).map((u) => (
              <button key={u} type="button" className="pg-chip" aria-pressed={unit === u} onClick={() => setUnit(u)}>
                {u === "kg" ? "Kilograms" : "Pounds"}
              </button>
            ))}
          </div>
          <span className="bld-hint">This changes how weights are shown on this screen. They are saved in kg.</span>
        </div>
        {running && <div className="bld-hint">You&rsquo;re running this program. Changes apply from your next session. Nothing you have logged changes.</div>}
      </Card>

      <div className="bld-weeks" role="group" aria-label="Weeks">
        {t.weeks.map((wk, i) => (
          <button key={i} type="button" aria-pressed={i === w} className="bld-tab" onClick={() => setWi(i)}>
            Week {i + 1}
            {wk.label ? `: ${wk.label}` : ""}
          </button>
        ))}
        {t.weeks.length < MEMBER_LIMITS.weeks && (
          <button
            type="button"
            className="bld-tab"
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
      <div className="bld-hint">{t.weeks.length === 1 ? "Week 1 repeats. Add a week to copy it and change the copy, for a block or a deload." : `The ${t.weeks.length} weeks run in order, then start again.`}</div>
      {t.weeks.length > 1 && (
        <div className="bld-tools">
          <button
            type="button"
            className="bld-icon"
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
            className="bld-icon"
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
            className="pg-input"
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
            className="bld-icon"
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
        <Card key={`${w}-${di}`} style={{ display: "grid", gap: 10 }}>
          <div className="bld-day-head">
            <input
              className="pg-input"
              aria-label={`Day ${di + 1} name`}
              maxLength={MEMBER_LIMITS.name}
              value={day.name}
              onChange={(e) => {
                const v = e.target.value;
                edit((x) => void (x.template.weeks[w].days[di].name = v));
              }}
            />
            <button type="button" className="bld-icon" aria-label={`Move ${day.name} up`} disabled={di === 0} onClick={() => {
 edit((x) => void moveDay(x.template, w, di, -1));
 setOpen(null);
 }}>
              <ArrowUp size={16} />
            </button>
            <button type="button" className="bld-icon" aria-label={`Move ${day.name} down`} disabled={di === week.days.length - 1} onClick={() => {
 edit((x) => void moveDay(x.template, w, di, 1));
 setOpen(null);
 }}>
              <ArrowDown size={16} />
            </button>
            <button type="button" className="bld-icon" aria-label={`Remove ${day.name}`} disabled={week.days.length === 1} onClick={() => {
 edit((x) => removeDay(x.template, w, di));
 setOpen(null);
 }}>
              <Trash2 size={16} />
            </button>
          </div>
          {day.exercises.length === 0 && <div className="bld-hint">No exercises yet.</div>}
          {day.exercises.map((ex, xi) => {
            const key = `${w}-${di}-${xi}`;
            return (
              <ExerciseCard
                key={key}
                ex={ex}
                index={xi}
                count={day.exercises.length}
                open={open === key}
                unit={unit}
                running={running}
                nowKg={current[stateKey(ex)] ?? null}
                onToggle={() => setOpen(open === key ? null : key)}
                onChange={(fn) => edit((x) => fn(x.template.weeks[w].days[di].exercises[xi]))}
                onRule={(k) =>
                  edit((x) => {
                    const list = x.template.weeks[w].days[di].exercises;
                    list[xi] = applyRule(list[xi], k);
                  })
                }
                onRename={() => setPicking({ w, di, xi })}
                onMove={(dir) => {
                  edit((x) => void moveExercise(x.template, w, di, xi, dir));
                  setOpen(null);
                }}
                onRemove={() => {
                  edit((x) => removeExercise(x.template, w, di, xi));
                  setOpen(null);
                }}
              />
            );
          })}
          {day.exercises.length < MEMBER_LIMITS.exercises && (
            <button type="button" className="bld-add" onClick={() => setPicking({ w, di, xi: null })}>
              <Plus size={16} /> Add exercise
            </button>
          )}
        </Card>
      ))}

      {week.days.length < MEMBER_LIMITS.days && (
        <button type="button" className="bld-add" onClick={() => edit((x) => addDay(x.template, w))}>
          <Plus size={16} /> Add a day
        </button>
      )}
      </fieldset>

      <div className="bld-save">
        <button type="button" className="pg-cta bld-save-btn" onClick={save} disabled={pending}>
          {pending ? "Saving" : "Save program"}
        </button>
      </div>

      {id !== null && !running && (
        <button type="button" className="bld-add bld-danger" onClick={remove} disabled={pending}>
          <Trash2 size={16} /> Delete this program
        </button>
      )}

      {picking && <ExercisePicker onClose={() => setPicking(null)} onPick={(hit) => pick(hit.name)} />}
    </div>
  );
}
