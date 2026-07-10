"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Dumbbell, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { saveWorkoutAction } from "@/app/workout/workouts/actions";
import {
  blankExercise,
  dayVolume,
  SECTIONS,
  type ExerciseInput,
  type Section,
  type WorkoutInput,
} from "@/lib/workoutModel";
import type { ExerciseLibRow } from "@/lib/exerciseLibrary";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function WorkoutBuilder({ initial, exercises }: { initial: WorkoutInput; exercises: ExerciseLibRow[] }) {
  const router = useRouter();
  const [workout, setWorkout] = useState<WorkoutInput>(initial);
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));
  const [pickerSection, setPickerSection] = useState<Section | null>(null);
  const [saving, start] = useTransition();

  const volume = dayVolume(workout);

  const setExercise = (fi: number, patch: Partial<ExerciseInput>) =>
    setWorkout((w) => ({ ...w, exercises: w.exercises.map((e, j) => (j === fi ? { ...e, ...patch } : e)) }));
  const removeExercise = (fi: number) =>
    setWorkout((w) => ({ ...w, exercises: w.exercises.filter((_, j) => j !== fi) }));
  const addFromLibrary = (section: Section, lib: ExerciseLibRow) =>
    setWorkout((w) => ({
      ...w,
      exercises: [
        ...w.exercises,
        { ...blankExercise(section), name: lib.name, exerciseId: lib.id, muscleGroups: lib.muscleGroups },
      ],
    }));
  const addCustom = (section: Section) =>
    setWorkout((w) => ({ ...w, exercises: [...w.exercises, blankExercise(section)] }));

  const submit = (close: boolean) => {
    if (!workout.name.trim()) return toast.error("Enter a workout / day name.");
    start(async () => {
      const res = await saveWorkoutAction({
        ...workout,
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
      });
      if (res.ok) {
        toast.success("Workout saved.");
        if (close) router.push("/workout/workouts");
        else router.replace(`/workout/workouts/${res.id}`);
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button variant="ghost" size="icon" onClick={() => router.push("/workout/workouts")} aria-label="Back">
          <ArrowLeft size={16} />
        </Button>
        <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 24, textTransform: "uppercase" }}>
          {initial.id ? "Edit" : "Create a"} Workout
        </h1>
      </div>

      <div style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <Label htmlFor="w-name">Day name *</Label>
            <Input
              id="w-name"
              value={workout.name === "New Workout" ? "" : workout.name}
              onChange={(e) => setWorkout((w) => ({ ...w, name: e.target.value }))}
              placeholder="Enter day name"
            />
          </div>
          <div>
            <Label htmlFor="w-tags">Tags</Label>
            <Input id="w-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="Add tags (comma separated)" />
          </div>
        </div>

        {volume.length > 0 && (
          <div>
            <Label>Total volume sets</Label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {volume.map((v) => (
                <span key={v.group} style={volPill}>
                  {v.group} {v.sets}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {SECTIONS.map((sec) => {
        const rows = workout.exercises.map((ex, i) => ({ ex, i })).filter((x) => x.ex.section === sec.key);
        return (
          <div key={sec.key} style={card}>
            <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary)", fontFamily: "var(--font-mono), monospace" }}>
              {sec.label}
            </div>
            {rows.map(({ ex, i }, li) => (
              <ExerciseRow
                key={i}
                letter={LETTERS[li] ?? "•"}
                ex={ex}
                onPatch={(patch) => setExercise(i, patch)}
                onRemove={() => removeExercise(i)}
              />
            ))}
            <div>
              <Button variant="outline" size="sm" onClick={() => setPickerSection(sec.key)}>
                <Plus size={14} /> Add an Exercise
              </Button>
            </div>
          </div>
        );
      })}

      <div style={card}>
        <div>
          <Label htmlFor="w-instr">Instructions</Label>
          <Textarea id="w-instr" value={workout.instructions ?? ""} onChange={(e) => setWorkout((w) => ({ ...w, instructions: e.target.value }))} rows={3} placeholder="Enter workout instructions" />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <Button variant="ghost" onClick={() => router.push("/workout/workouts")} disabled={saving}>
          Cancel
        </Button>
        <Button variant="outline" onClick={() => submit(false)} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button onClick={() => submit(true)} disabled={saving}>
          Save &amp; Close
        </Button>
      </div>

      <ChooseExerciseSheet
        section={pickerSection}
        exercises={exercises}
        onClose={() => setPickerSection(null)}
        onPick={(lib) => pickerSection && addFromLibrary(pickerSection, lib)}
        onCustom={() => pickerSection && addCustom(pickerSection)}
      />
    </div>
  );
}

function ExerciseRow({
  letter,
  ex,
  onPatch,
  onRemove,
}: {
  letter: string;
  ex: ExerciseInput;
  onPatch: (patch: Partial<ExerciseInput>) => void;
  onRemove: () => void;
}) {
  return (
    <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 70px 90px 90px 30px", gap: 8, alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-mono), monospace", fontWeight: 600, color: "var(--text-tertiary)", textAlign: "center" }}>{letter}</span>
        <Input value={ex.name} onChange={(e) => onPatch({ name: e.target.value, exerciseId: null })} placeholder="Exercise name…" style={{ height: 34 }} />
        <NumCell value={ex.sets} onChange={(v) => onPatch({ sets: v })} placeholder="Sets" />
        <Input value={ex.reps ?? ""} onChange={(e) => onPatch({ reps: e.target.value })} placeholder="Reps" style={{ height: 34 }} />
        <NumCell value={ex.restSeconds} onChange={(v) => onPatch({ restSeconds: v })} placeholder="Rest" suffix="s" />
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

function ChooseExerciseSheet({
  section,
  exercises,
  onClose,
  onPick,
  onCustom,
}: {
  section: Section | null;
  exercises: ExerciseLibRow[];
  onClose: () => void;
  onPick: (lib: ExerciseLibRow) => void;
  onCustom: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    const base = query ? exercises.filter((e) => e.name.toLowerCase().includes(query)) : exercises;
    return base.slice(0, 60);
  }, [q, exercises]);

  return (
    <Sheet open={section !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title="Choose Exercise" width={420}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…" autoFocus />
          <button
            onClick={() => router.push("/workout/exercises")}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: "var(--accent-ink)", cursor: "pointer", fontSize: 13, alignSelf: "flex-start" }}
          >
            <Plus size={14} /> Add a new exercise to the library
          </button>
          <button
            onClick={onCustom}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13, alignSelf: "flex-start" }}
          >
            <Plus size={14} /> Add a custom exercise (one-off)
          </button>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {matches.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--text-tertiary)", padding: "8px 0" }}>No exercises found.</div>
            )}
            {matches.map((e) => (
              <button
                key={e.id}
                onClick={() => {
                  onPick(e);
                  toast.success(`${e.name} added`);
                }}
                style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: 8, border: "1px solid var(--hairline)", borderRadius: "var(--radius)", background: "transparent", cursor: "pointer" }}
              >
                <Thumb url={e.imageUrl} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>{e.name}</span>
                  {e.muscleGroups.length > 0 && (
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--text-tertiary)" }}>{e.muscleGroups.join(", ")}</span>
                  )}
                </span>
                <Plus size={16} style={{ marginLeft: "auto", color: "var(--text-tertiary)", flexShrink: 0 }} />
              </button>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 6 }}>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Thumb({ url }: { url: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />;
  }
  return (
    <span style={{ width: 40, height: 40, borderRadius: 6, background: "var(--surface-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)", flexShrink: 0 }}>
      <Dumbbell size={18} />
    </span>
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
        style={{ height: 34, width: "100%", padding: suffix ? "0 22px 0 10px" : "0 10px", borderRadius: "var(--radius)", border: "1px solid var(--hairline)", background: "var(--surface-2)", color: "var(--text-primary)", fontSize: 12.5, fontFamily: "var(--font-mono), monospace" }}
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
const volPill: React.CSSProperties = {
  fontSize: 12,
  padding: "3px 9px",
  borderRadius: 999,
  background: "rgba(34,197,94,0.12)",
  color: "#22c55e",
};
