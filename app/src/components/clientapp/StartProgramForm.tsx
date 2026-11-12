// app/src/components/clientapp/StartProgramForm.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/clientapp/ui";
import { startProgramAction, type MaxEntry } from "@/app/app/programs/actions";
import type { LiftKey, WeightUnit } from "@/lib/programs/types";
import { STEP_OPTIONS, formatWeight, kgToUnit, maxFromSet, parseWeightIn, trainingMax, type StepKey } from "@/lib/programs/units";
import { WEEKDAY_SHORT } from "@/lib/trainingProgress";

interface LiftRow {
  lift: LiftKey;
  label: string;
  logged: { kg: number; reps: number; e1rm: number } | null;
  /** A max carried from the member's last program, filled in as their 1-rep max. */
  keptKg?: number | null;
}
interface RowState {
  mode: MaxEntry["kind"];
  weight: string;
  reps: string;
}

/** Maxes three ways, units, smallest jump, start date and training days. */
export function StartProgramForm({
  programKey,
  tmPct,
  lifts,
  initialUnit,
  initialStep,
  defaultWeekdays,
  today,
}: {
  programKey: string;
  tmPct: number;
  lifts: LiftRow[];
  initialUnit: WeightUnit;
  initialStep: StepKey;
  defaultWeekdays: number[];
  today: string;
}) {
  const router = useRouter();
  const [unit, setUnit] = useState<WeightUnit>(initialUnit);
  const [step, setStep] = useState<StepKey>(initialUnit === "lb" ? "5lb" : initialStep === "5lb" ? "2.5kg" : initialStep);
  const [rows, setRows] = useState<RowState[]>(
    lifts.map((l) => (l.keptKg ? { mode: "one_rm", weight: String(kgToUnit(l.keptKg, initialUnit)), reps: "" } : { mode: l.logged ? "logged" : "one_rm", weight: "", reps: "" })),
  );
  const [startDate, setStartDate] = useState(today);
  const [days, setDays] = useState<number[]>(defaultWeekdays);
  const [pending, start] = useTransition();

  const setRow = (i: number, patch: Partial<RowState>) => setRows((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  function estimate(i: number): number | null {
    const r = rows[i];
    if (r.mode === "logged") return lifts[i].logged?.e1rm ?? null;
    const kg = parseWeightIn(r.weight, unit);
    if (kg === null || kg <= 0) return null;
    return r.mode === "one_rm" ? kg : maxFromSet(kg, Number(r.reps));
  }

  function pickUnit(u: WeightUnit) {
    setUnit(u);
    setStep(u === "lb" ? "5lb" : "2.5kg");
  }

  function toggleDay(d: number) {
    setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d].sort((a, b) => a - b)));
  }

  function submit() {
    start(async () => {
      const maxes: MaxEntry[] = rows.map((r, i) => ({
        lift: lifts[i].lift,
        kind: r.mode,
        weight: r.mode === "logged" ? null : Number(r.weight.replace(",", ".")) || null,
        reps: r.mode === "set" ? Number(r.reps) || null : null,
      }));
      const res = await startProgramAction({ key: programKey, unit, step, startDate, weekdays: days, maxes });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Program started");
      router.push("/app/programs/mine");
      router.refresh();
    });
  }

  const steps = STEP_OPTIONS.filter((s) => s.unit === unit);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card style={{ display: "grid", gap: 12 }}>
        <div className="td-label">Units</div>
        <div className="pg-chips" role="group" aria-label="Units">
          {(["kg", "lb"] as const).map((u) => (
            <button key={u} type="button" className="pg-chip" aria-pressed={unit === u} onClick={() => pickUnit(u)}>
              {u === "kg" ? "Kilograms" : "Pounds"}
            </button>
          ))}
        </div>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="td-label">Smallest jump</span>
          <select className="pg-input" value={step} onChange={(e) => setStep(e.target.value as StepKey)}>
            {steps.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>Every weight rounds to this jump.</div>
      </Card>

      {lifts.map((l, i) => {
        const r = rows[i];
        const est = estimate(i);
        return (
          <Card key={l.lift} style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{l.label}</div>
            {l.keptKg ? <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>Filled in from your last program.</div> : null}
            <div className="pg-chips" role="group" aria-label={`How to set your ${l.label.toLowerCase()} max`}>
              {l.logged && (
                <button type="button" className="pg-chip" aria-pressed={r.mode === "logged"} onClick={() => setRow(i, { mode: "logged" })}>
                  Best logged
                </button>
              )}
              <button type="button" className="pg-chip" aria-pressed={r.mode === "one_rm"} onClick={() => setRow(i, { mode: "one_rm" })}>
                1-rep max
              </button>
              <button type="button" className="pg-chip" aria-pressed={r.mode === "set"} onClick={() => setRow(i, { mode: "set" })}>
                A recent set
              </button>
            </div>
            {r.mode === "logged" && l.logged && (
              <div style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>
                Your best in the last 90 days: {formatWeight(l.logged.kg, unit)} x {l.logged.reps}.
              </div>
            )}
            {r.mode === "one_rm" && (
              <input className="pg-input" inputMode="decimal" aria-label={`${l.label} 1-rep max in ${unit}`} placeholder={`Max in ${unit}`} value={r.weight} onChange={(e) => setRow(i, { weight: e.target.value })} />
            )}
            {r.mode === "set" && (
              <div className="pg-row">
                <input className="pg-input" inputMode="decimal" aria-label={`${l.label} weight in ${unit}`} placeholder={`Weight in ${unit}`} value={r.weight} onChange={(e) => setRow(i, { weight: e.target.value })} />
                <input className="pg-input" inputMode="numeric" aria-label={`${l.label} reps`} placeholder="Reps, 1 to 10" value={r.reps} onChange={(e) => setRow(i, { reps: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
              </div>
            )}
            {est !== null ? (
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                Max about {formatWeight(est, unit)}
                {tmPct !== 1 ? `. Training max ${formatWeight(trainingMax(est, tmPct), unit)}.` : "."}
              </div>
            ) : r.mode === "set" && Number(r.reps) > 10 ? (
              <div style={{ fontSize: 13, color: "var(--danger)" }}>Use a set of 10 reps or fewer.</div>
            ) : null}
          </Card>
        );
      })}

      <Card style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="td-label">Start date</span>
          <input className="pg-input" type="date" value={startDate} min={today} onChange={(e) => setStartDate(e.target.value || today)} />
        </label>
        <div style={{ display: "grid", gap: 8 }}>
          <div className="td-label">Days you train</div>
          <div className="td-days">
            {WEEKDAY_SHORT.map((label, i) => (
              <button key={label} type="button" className="td-day" aria-pressed={days.includes(i + 1)} onClick={() => toggleDay(i + 1)}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>Your program moves on when you finish a session, so a missed day just waits for you.</div>
        </div>
      </Card>

      <Button onClick={submit} loading={pending} style={{ width: "100%" }}>
        Start program
      </Button>
    </div>
  );
}
