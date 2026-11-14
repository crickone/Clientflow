// app/src/components/workout/ProgramCopyEditor.tsx
"use client";

import { useState, useTransition, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { SET_KINDS, blankExercise, convertSet, mostDays, repsMax, repsMin, withReps } from "@/lib/programs/editing";
import { CANONICAL_EXERCISES } from "@/lib/programs/exercises";
import { schemeLabel, weekLabel } from "@/lib/programs/planner";
import { LIFT_LABEL, type ExerciseRx, type LiftKey, type ProgramTemplate, type SetRx } from "@/lib/programs/types";

/**
 * A number box that can be emptied while typing. Each usable number is kept as
 * it is typed (the caller clamps it); leaving the box shows what was kept, so
 * an empty or unusable entry goes back to the last good value. With
 * allowEmpty, an empty box is a value of its own (null).
 */
function NumberField({
  value,
  onValue,
  allowEmpty,
  onBlur,
  ...rest
}: Omit<ComponentProps<typeof Input>, "value" | "onChange" | "type"> & { value: number | null; onValue: (n: number | null) => void; allowEmpty?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      {...rest}
      type="number"
      value={draft ?? (value === null ? "" : String(value))}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        const n = Number(v);
        if (v.trim() !== "" && Number.isFinite(n)) onValue(n);
        else if (v.trim() === "" && allowEmpty) onValue(null);
      }}
      onBlur={(e) => {
        setDraft(null);
        onBlur?.(e);
      }}
    />
  );
}

function ExerciseEditor({
  ex,
  lifts,
  first,
  last,
  onChange,
  onRemove,
  onMove,
}: {
  ex: ExerciseRx;
  lifts: LiftKey[];
  first: boolean;
  last: boolean;
  onChange: (fn: (e: ExerciseRx) => void) => void;
  onRemove?: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const known = CANONICAL_EXERCISES.some((c) => c.name === ex.name);
  return (
    <div className="pe-ex">
      <div className="pe-ex-head">
        <select value={ex.name} aria-label="Exercise" onChange={(e) => onChange((x) => void (x.name = e.target.value))}>
          {!known && <option value={ex.name}>{ex.name}</option>}
          {CANONICAL_EXERCISES.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={ex.lift ?? ""} aria-label="The max it uses" onChange={(e) => onChange((x) => void (x.lift = (e.target.value || undefined) as LiftKey | undefined))}>
          <option value="">No max</option>
          {lifts.map((l) => (
            <option key={l} value={l}>
              {LIFT_LABEL[l]} max
            </option>
          ))}
        </select>
        <div className="pe-ex-tools">
          <button type="button" className="pe-icon" aria-label="Move up" disabled={first} onClick={() => onMove(-1)}>
            <ArrowUp size={14} />
          </button>
          <button type="button" className="pe-icon" aria-label="Move down" disabled={last} onClick={() => onMove(1)}>
            <ArrowDown size={14} />
          </button>
          {onRemove && (
            <button type="button" className="pe-icon" aria-label={`Remove ${ex.name}`} onClick={onRemove}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      <Input value={ex.notes ?? ""} placeholder="Notes for the member (optional)" onChange={(e) => onChange((x) => void (x.notes = e.target.value || undefined))} />
      {ex.stages && ex.stages.length > 0 ? (
        <p className="pe-hint">Rep schemes set by the progression: {ex.stages.map((s) => schemeLabel(s)).join(", then ")}.</p>
      ) : (
        <div className="pe-sets">
          <div className="pe-set pe-set--head" aria-hidden>
            <span>Set</span>
            <span>Type</span>
            <span>Load</span>
            <span>Reps</span>
            <span>Up to</span>
            <span>Rest (s)</span>
            <span />
          </div>
          {ex.sets.map((s, si) => (
            <div key={si} className="pe-set">
              <span className="pe-setno">{si + 1}</span>
              <select value={s.kind} aria-label={`Set ${si + 1} type`} onChange={(e) => onChange((x) => void (x.sets[si] = convertSet(x.sets[si], e.target.value as SetRx["kind"])))}>
                {SET_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <span className="pe-load">
                {(s.kind === "pct" || s.kind === "amrap") && (
                  <>
                    <NumberField
                      step="0.5"
                      aria-label={`Set ${si + 1} percentage`}
                      value={Math.round(s.pct * 1000) / 10}
                      onValue={(n) =>
                        onChange((x) => {
                          const cur = x.sets[si];
                          if (n !== null && (cur.kind === "pct" || cur.kind === "amrap")) cur.pct = n / 100;
                        })
                      }
                    />
                    <span className="pe-muted">%{s.addKg ? ` + ${s.addKg} kg` : ""}</span>
                  </>
                )}
                {s.kind === "rpe" && (
                  <>
                    <span className="pe-muted">RPE</span>
                    <NumberField
                      step="0.5"
                      min={5}
                      max={10}
                      aria-label={`Set ${si + 1} RPE`}
                      value={s.rpe}
                      onValue={(n) =>
                        onChange((x) => {
                          const cur = x.sets[si];
                          if (n !== null && cur.kind === "rpe") cur.rpe = Math.max(5, Math.min(10, n));
                        })
                      }
                    />
                  </>
                )}
                {s.kind === "fixed" && <span className="pe-muted">From progression{s.amrap ? ", as many as you can" : ""}</span>}
                {s.kind === "same_as_last" && <span className="pe-muted">As the set before</span>}
              </span>
              <NumberField
                min={1}
                aria-label={`Set ${si + 1} reps`}
                value={repsMin(s.reps)}
                onValue={(n) =>
                  onChange((x) => {
                    const cur = x.sets[si];
                    if (n === null) return;
                    const min = Math.max(1, Math.round(n));
                    if (cur.kind === "fixed" || cur.kind === "same_as_last") cur.reps = withReps(min, repsMax(cur.reps));
                    else cur.reps = min;
                  })
                }
              />
              {s.kind === "fixed" || s.kind === "same_as_last" ? (
                <NumberField
                  min={1}
                  allowEmpty
                  aria-label={`Set ${si + 1} top of the rep range`}
                  placeholder="-"
                  value={repsMax(s.reps)}
                  onValue={(n) =>
                    onChange((x) => {
                      const cur = x.sets[si];
                      if (cur.kind === "fixed" || cur.kind === "same_as_last") cur.reps = withReps(repsMin(cur.reps), n === null ? null : Math.round(n));
                    })
                  }
                />
              ) : (
                <span />
              )}
              <NumberField
                min={0}
                max={900}
                step={15}
                aria-label={`Set ${si + 1} rest in seconds`}
                value={s.rest}
                onValue={(n) => onChange((x) => void (n !== null && (x.sets[si].rest = Math.max(0, Math.min(900, Math.round(n))))))}
              />
              <button type="button" className="pe-icon" aria-label={`Remove set ${si + 1}`} disabled={ex.sets.length === 1} onClick={() => onChange((x) => void x.sets.splice(si, 1))}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="pl-link" style={{ justifySelf: "start" }} onClick={() => onChange((x) => void x.sets.push({ ...x.sets[x.sets.length - 1] }))}>
            <Plus size={14} /> Add set
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Weeks, then days, then exercises, then set rows, in the style of the Detailed builder.
 * fullBlock: the original's weeks are its whole length, so the length is the number of weeks.
 */
export type EditorSave = (t: ProgramTemplate, weekOrigins: (number | null)[]) => Promise<{ ok: true } | { ok: false; errors: string[] }>;

export function ProgramCopyEditor({
  save: saveTemplate,
  saveLabel,
  savedMessage,
  initial,
  lifts,
  engineLabel,
  isBlock,
  fullBlock,
}: {
  save: EditorSave;
  saveLabel: string;
  savedMessage: string;
  initial: ProgramTemplate;
  lifts: LiftKey[];
  engineLabel: string;
  isBlock: boolean;
  fullBlock: boolean;
}) {
  const router = useRouter();
  const [t, setT] = useState<ProgramTemplate>(initial);
  const [wi, setWi] = useState(0);
  // For each week of t, the index of the original week it came from; null for a copied week.
  const [origins, setOrigins] = useState<(number | null)[]>(() => initial.weeks.map((_, i) => i));
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const w = Math.min(wi, t.weeks.length - 1);
  const week = t.weeks[w];

  function edit(fn: (draft: ProgramTemplate) => void) {
    setT((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }

  function save() {
    start(async () => {
      const r = await saveTemplate(t, origins);
      if (!r.ok) {
        setErrors(r.errors);
        toast.error("Not saved. See what needs fixing at the top.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      setErrors([]);
      toast.success(savedMessage);
      setOrigins(t.weeks.map((_, i) => i));
      router.refresh();
    });
  }

  return (
    <div className="pe">
      {errors.length > 0 && (
        <div className="pe-errors" role="alert">
          <b>Not saved:</b>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="pe-card">
        <div className="pe-grid">
          <label className="pe-field">
            <span>Name</span>
            <Input value={t.name} onChange={(e) => edit((d) => void (d.name = e.target.value))} />
          </label>
          <label className="pe-field">
            <span>Who it is for</span>
            <Input value={t.who} onChange={(e) => edit((d) => void (d.who = e.target.value))} />
          </label>
          <label className="pe-field">
            <span>Warning line (optional)</span>
            <Input value={t.warning ?? ""} onChange={(e) => edit((d) => void (d.warning = e.target.value || undefined))} />
          </label>
          <div className="pe-field">
            <span>Days a week</span>
            <p className="pe-static">
              {mostDays(t)} {mostDays(t) === 1 ? "day" : "days"}, from the busiest week
            </p>
          </div>
          {fullBlock ? (
            <div className="pe-field">
              <span>Length</span>
              <p className="pe-static">
                {t.weeks.length} {t.weeks.length === 1 ? "week" : "weeks"}, one for each week below
              </p>
            </div>
          ) : (
            <label className="pe-field">
              <span>Length in weeks</span>
              <NumberField min={1} max={52} value={t.lengthWeeks} onValue={(n) => edit((d) => void (n !== null && (d.lengthWeeks = Math.max(1, Math.min(52, Math.round(n))))))} />
            </label>
          )}
        </div>
        <label className="pe-field">
          <span>Description</span>
          <Textarea rows={3} value={t.description} onChange={(e) => edit((d) => void (d.description = e.target.value))} />
        </label>
        <p className="pe-hint">
          Progression: {engineLabel}. It stays the original&rsquo;s.
          {lifts.length > 0 ? ` Keep at least one exercise using each of these maxes: ${lifts.map((l) => LIFT_LABEL[l].toLowerCase()).join(", ")}.` : ""}
        </p>
      </section>

      <div className="pe-weeks" role="tablist" aria-label="Weeks">
        {t.weeks.map((_, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === w} className="pe-tab" onClick={() => setWi(i)}>
            {weekLabel(t, { week: i, cycle: 0 })}
          </button>
        ))}
        <button
          type="button"
          className="pe-tab"
          onClick={() => {
            edit((d) => void d.weeks.splice(w + 1, 0, structuredClone(d.weeks[w])));
            setOrigins((o) => [...o.slice(0, w + 1), null, ...o.slice(w + 1)]);
            setWi(w + 1);
          }}
        >
          <Plus size={14} /> Copy this week
        </button>
        {t.weeks.length > 1 && (
          <button
            type="button"
            className="pe-tab"
            onClick={() => {
              edit((d) => void d.weeks.splice(w, 1));
              setOrigins((o) => o.filter((_, i) => i !== w));
              setWi(Math.max(0, w - 1));
            }}
          >
            <Trash2 size={14} /> Remove this week
          </button>
        )}
      </div>
      <label className="pe-field" style={{ maxWidth: 360 }}>
        <span>{weekLabel(t, { week: w, cycle: 0 })}: label (optional)</span>
        <Input value={week.label ?? ""} onChange={(e) => edit((d) => void (d.weeks[w].label = e.target.value || undefined))} />
      </label>

      {week.days.map((dayRx, di) => (
        <section key={`${w}-${di}`} className="pe-card">
          <div className="pe-day-head">
            <Input aria-label="Day name" value={dayRx.name} onChange={(e) => edit((d) => void (d.weeks[w].days[di].name = e.target.value))} style={{ maxWidth: 280 }} />
            {isBlock && (
              <label className="pe-check">
                <input type="checkbox" checked={dayRx.test === true} onChange={(e) => edit((d) => void (d.weeks[w].days[di].test = e.target.checked || undefined))} /> Test day
              </label>
            )}
            {week.days.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => edit((d) => void d.weeks[w].days.splice(di, 1))}>
                <Trash2 size={14} /> Remove day
              </Button>
            )}
          </div>
          {dayRx.exercises.map((ex, xi) => (
            <ExerciseEditor
              key={xi}
              ex={ex}
              lifts={lifts}
              first={xi === 0}
              last={xi === dayRx.exercises.length - 1}
              onChange={(fn) => edit((d) => fn(d.weeks[w].days[di].exercises[xi]))}
              onRemove={dayRx.exercises.length > 1 ? () => edit((d) => void d.weeks[w].days[di].exercises.splice(xi, 1)) : undefined}
              onMove={(dir) =>
                edit((d) => {
                  const list = d.weeks[w].days[di].exercises;
                  const j = xi + dir;
                  if (j < 0 || j >= list.length) return;
                  [list[xi], list[j]] = [list[j], list[xi]];
                })
              }
            />
          ))}
          <Button variant="secondary" size="sm" onClick={() => edit((d) => void d.weeks[w].days[di].exercises.push(blankExercise()))}>
            <Plus size={14} /> Add exercise
          </Button>
        </section>
      ))}

      <Button variant="secondary" size="sm" onClick={() => edit((d) => void d.weeks[w].days.push({ name: `Day ${week.days.length + 1}`, exercises: [blankExercise()] }))}>
        <Plus size={14} /> Add day
      </Button>

      <div className="pe-save">
        <Button onClick={save} loading={pending}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
