"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { saveTrainingDaysAction } from "@/app/app/actions";
import { WEEKDAY_SHORT } from "@/lib/trainingProgress";

/** Pick which programme to follow and which days of the week to train on. */
export function TrainingDaysForm({
  programs,
  initialProgramId,
  initialWeekdays,
}: {
  programs: { id: number; title: string; dayNames: string[] }[];
  initialProgramId: number;
  initialWeekdays: number[];
}) {
  const router = useRouter();
  const [programId, setProgramId] = useState(initialProgramId);
  const [days, setDays] = useState<number[]>(initialWeekdays);
  const [pending, start] = useTransition();
  const program = programs.find((p) => p.id === programId) ?? programs[0];

  function toggle(d: number) {
    setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d].sort((a, b) => a - b)));
  }

  function save() {
    start(async () => {
      const r = await saveTrainingDaysAction(programId, days);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Training days saved");
      router.push("/app/workouts");
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {programs.length > 1 && (
        <div style={{ display: "grid", gap: 8 }}>
          <div className="td-label">Programme</div>
          <div style={{ display: "grid", gap: 8 }}>
            {programs.map((p) => (
              <button key={p.id} type="button" className="td-option" aria-pressed={p.id === programId} onClick={() => setProgramId(p.id)}>
                <span className="td-option-title">{p.title}</span>
                <span className="td-option-sub">{p.dayNames.length} day{p.dayNames.length === 1 ? "" : "s"}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        <div className="td-label">Days you train</div>
        <div className="td-days">
          {WEEKDAY_SHORT.map((label, i) => (
            <button key={label} type="button" className="td-day" aria-pressed={days.includes(i + 1)} onClick={() => toggle(i + 1)}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)" }}>
          {days.length === 0
            ? "Pick the days you plan to train."
            : program && days.length !== program.dayNames.length
              ? `Your programme has ${program.dayNames.length} days and you picked ${days.length}. The days run in order, so they will rotate across weeks.`
              : `Each training day gets the next day of your programme, in order.`}
        </div>
      </div>
      <Button onClick={save} loading={pending} style={{ width: "100%" }}>
        Save training days
      </Button>
    </div>
  );
}
