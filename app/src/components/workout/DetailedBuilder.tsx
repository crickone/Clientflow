"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { saveProgramAction } from "@/app/workout/actions";
import {
  blankDay,
  blankExercise,
  dayVolume,
  SECTIONS,
  type ExerciseInput,
  type ProgramInput,
  type Section,
  type WorkoutDayInput,
} from "@/lib/workoutModel";
import type { ExerciseLibRow } from "@/lib/exerciseLibrary";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function DetailedBuilder({ initial, exercises }: { initial: ProgramInput; exercises: ExerciseLibRow[] }) {
  const router = useRouter();
  const [program, setProgram] = useState<ProgramInput>(initial);
  const [dayIdx, setDayIdx] = useState(0);
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));
  const [focused, setFocused] = useState<number | null>(null); // flat exercise index in the active day
  const [saving, start] = useTransition();

  const idx = Math.min(dayIdx, program.days.length - 1);
  const day = program.days[idx];
  const volume = dayVolume(day);

  const mutateDay = (di: number, fn: (d: WorkoutDayInput) => WorkoutDayInput) =>
    setProgram((p) => ({ ...p, days: p.days.map((d, i) => (i === di ? fn(d) : d)) }));
  const setDay = (patch: Partial<WorkoutDayInput>) => mutateDay(idx, (d) => ({ ...d, ...patch }));
  const setExercise = (fi: number, patch: Partial<ExerciseInput>) =>
    mutateDay(idx, (d) => ({ ...d, exercises: d.exercises.map((e, j) => (j === fi ? { ...e, ...patch } : e)) }));

  const addDay = () => {
    setProgram((p) => ({ ...p, days: [...p.days, blankDay(`Day ${p.days.length + 1}`)] }));
    setDayIdx(program.days.length);
  };
  const duplicateDay = () => {
    const copy: WorkoutDayInput = JSON.parse(JSON.stringify({ ...day, id: undefined, name: `${day.name} (copy)` }));
    setProgram((p) => ({ ...p, days: [...p.days, copy] }));
    setDayIdx(program.days.length);
  };
  const removeDay = (di: number) => {
    if (program.days.length <= 1) return;
    setProgram((p) => ({ ...p, days: p.days.filter((_, i) => i !== di) }));
    setDayIdx((v) => Math.max(0, v >= di ? v - 1 : v));
  };
  const addExercise = (section: Section) => {
    setProgram((p) => ({
      ...p,
      days: p.days.map((d, i) => (i === idx ? { ...d, exercises: [...d.exercises, blankExercise(section)] } : d)),
    }));
    setFocused(day.exercises.length);
  };
  const removeExercise = (fi: number) =>
    mutateDay(idx, (d) => ({ ...d, exercises: d.exercises.filter((_, j) => j !== fi) }));

  const submit = (close: boolean) => {
    if (!program.title.trim()) return toast.error("Enter a program title.");
    start(async () => {
      const res = await saveProgramAction({
        ...program,
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
      });
      if (res.ok) {
        toast.success("Program saved.");
        if (close) router.push("/workout");
        else router.replace(`/workout/${res.id}`);
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button variant="ghost" size="icon" onClick={() => router.push("/workout")} aria-label="Back">
          <ArrowLeft size={16} />
        </Button>
        <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 24, textTransform: "uppercase" }}>
          {initial.id ? "Edit" : "Create a"} Program
        </h1>
      </div>

      {/* meta */}
      <div style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <Label htmlFor="dp-title">Program title *</Label>
            <Input
              id="dp-title"
              value={program.title === "New Program" ? "" : program.title}
              onChange={(e) => setProgram((p) => ({ ...p, title: e.target.value }))}
              placeholder="Enter program title"
            />
          </div>
          <div>
            <Label htmlFor="dp-tags">Tags</Label>
            <Input id="dp-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="Add tags (comma separated)" />
          </div>
        </div>
        <div>
          <Label htmlFor="dp-overview">Program overview</Label>
          <Textarea id="dp-overview" value={program.summary ?? ""} onChange={(e) => setProgram((p) => ({ ...p, summary: e.target.value }))} rows={2} placeholder="Enter program overview" />
        </div>

        {/* day tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {program.days.map((d, i) => {
            const active = i === idx;
            return (
              <div
                key={i}
                onClick={() => setDayIdx(i)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 12px",
                  borderRadius: "var(--radius)",
                  border: active ? "1px solid var(--accent)" : "1px solid var(--hairline)",
                  background: active ? "var(--accent-soft)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 13, color: active ? "var(--accent-ink)" : "var(--text-secondary)" }}>{d.name || `Day ${i + 1}`}</span>
                {program.days.length > 1 && (
                  <button onClick={(e) => { e.stopPropagation(); removeDay(i); }} aria-label="Remove day" style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer", display: "inline-flex" }}>
                    <X size={13} />
                  </button>
                )}
              </div>
            );
          })}
          <Button variant="outline" size="sm" onClick={addDay}>
            <Plus size={14} /> Add New Day
          </Button>
          <Button variant="ghost" size="sm" onClick={duplicateDay}>
            <Copy size={14} /> Duplicate Day
          </Button>
        </div>

        <div style={{ maxWidth: 420 }}>
          <Label htmlFor="day-name">Day name *</Label>
          <Input id="day-name" value={day.name} onChange={(e) => setDay({ name: e.target.value })} placeholder="Enter day name" />
        </div>

        {volume.length > 0 && (
          <div>
            <Label>Total volume sets</Label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {volume.map((v) => (
                <span key={v.group} style={{ fontSize: 12, padding: "3px 9px", borderRadius: 999, background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>
                  {v.group} {v.sets}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* sections */}
      {SECTIONS.map((sec) => {
        const rows = day.exercises.map((ex, i) => ({ ex, i })).filter((x) => x.ex.section === sec.key);
        return (
          <div key={sec.key} style={card}>
            <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary)", fontFamily: "var(--font-mono), monospace" }}>
              {sec.label}
            </div>
            {rows.length === 0 && (
              <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>No exercises in this section yet.</div>
            )}
            {rows.map(({ ex, i }, li) => (
              <ExerciseRow
                key={i}
                letter={LETTERS[li] ?? "•"}
                ex={ex}
                library={exercises}
                focused={focused === i}
                onFocus={() => setFocused(i)}
                onBlur={() => setFocused((f) => (f === i ? null : f))}
                onPatch={(patch) => setExercise(i, patch)}
                onRemove={() => removeExercise(i)}
              />
            ))}
            <div>
              <Button variant="ghost" size="sm" onClick={() => addExercise(sec.key)}>
                <Plus size={14} /> Add an Exercise
              </Button>
            </div>
          </div>
        );
      })}

      {/* instructions */}
      <div style={card}>
        <div>
          <Label htmlFor="day-instructions">Instructions</Label>
          <Textarea id="day-instructions" value={day.instructions ?? ""} onChange={(e) => setDay({ instructions: e.target.value })} rows={3} placeholder="Enter workout instructions" />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <Button variant="ghost" onClick={() => router.push("/workout")} disabled={saving}>
          Cancel
        </Button>
        <Button variant="outline" onClick={() => submit(false)} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button onClick={() => submit(true)} disabled={saving}>
          Save &amp; Close
        </Button>
      </div>
    </div>
  );
}

function ExerciseRow({
  letter,
  ex,
  library,
  focused,
  onFocus,
  onBlur,
  onPatch,
  onRemove,
}: {
  letter: string;
  ex: ExerciseInput;
  library: ExerciseLibRow[];
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onPatch: (patch: Partial<ExerciseInput>) => void;
  onRemove: () => void;
}) {
  const matches = useMemo(() => {
    const q = ex.name.trim().toLowerCase();
    if (!q) return [];
    return library.filter((l) => l.name.toLowerCase().includes(q) && l.name.toLowerCase() !== q).slice(0, 6);
  }, [ex.name, library]);

  return (
    <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 70px 90px 90px 30px", gap: 8, alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-mono), monospace", fontWeight: 600, color: "var(--text-tertiary)", textAlign: "center" }}>{letter}</span>
        <div style={{ position: "relative" }}>
          <Input
            value={ex.name}
            onChange={(e) => onPatch({ name: e.target.value, exerciseId: null })}
            onFocus={onFocus}
            onBlur={() => setTimeout(onBlur, 120)}
            placeholder="Exercise name…"
            style={{ height: 34 }}
          />
          {focused && matches.length > 0 && (
            <div style={dropdown}>
              {matches.map((m) => (
                <button
                  key={m.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPatch({ name: m.name, exerciseId: m.id, muscleGroups: m.muscleGroups });
                  }}
                  style={dropItem}
                >
                  <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{m.name}</span>
                  {m.muscleGroups.length > 0 && (
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-tertiary)" }}>{m.muscleGroups.join(", ")}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <NumCell value={ex.sets} onChange={(v) => onPatch({ sets: v })} placeholder="Sets" />
        <Input value={ex.reps ?? ""} onChange={(e) => onPatch({ reps: e.target.value })} placeholder="Reps" style={{ height: 34 }} />
        <NumCell value={ex.restSeconds} onChange={(v) => onPatch({ restSeconds: v })} placeholder="Rest s" suffix="s" />
        <button onClick={onRemove} aria-label="Remove exercise" style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}>
          <Trash2 size={14} />
        </button>
      </div>
      {ex.muscleGroups.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", paddingLeft: 32 }}>
          {ex.muscleGroups.map((g) => (
            <span key={g} style={{ fontSize: 10.5, padding: "1px 7px", borderRadius: 5, background: "var(--surface-2)", color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace" }}>
              {g}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function NumCell({ value, onChange, placeholder, suffix }: { value: number; onChange: (v: number) => void; placeholder?: string; suffix?: string }) {
  return (
    <div style={{ position: "relative" }}>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        placeholder={placeholder}
        style={{
          height: 34,
          width: "100%",
          textAlign: "left",
          padding: suffix ? "0 22px 0 10px" : "0 10px",
          borderRadius: "var(--radius)",
          border: "1px solid var(--hairline)",
          background: "var(--surface-2)",
          color: "var(--text-primary)",
          fontSize: 12.5,
          fontFamily: "var(--font-mono), monospace",
        }}
      />
      {suffix && <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--text-tertiary)" }}>{suffix}</span>}
    </div>
  );
}

const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  background: "var(--surface-1)",
  padding: 20,
};
const dropdown: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  zIndex: 20,
  background: "var(--surface-1)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  boxShadow: "0 8px 28px rgba(0,0,0,0.28)",
  overflow: "hidden",
  maxHeight: 240,
  overflowY: "auto",
};
const dropItem: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  padding: "8px 12px",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid var(--hairline)",
  cursor: "pointer",
};
