"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Dumbbell, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { saveCircuitAction } from "@/app/workout/circuits/actions";
import { blankExercise, type CircuitInput, type ExerciseInput } from "@/lib/workoutModel";
import type { ExerciseLibRow } from "@/lib/exerciseLibrary";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function CircuitBuilder({ initial, exercises }: { initial: CircuitInput; exercises: ExerciseLibRow[] }) {
  const router = useRouter();
  const [circuit, setCircuit] = useState<CircuitInput>(initial);
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));
  const [restMin, setRestMin] = useState(Math.floor(initial.restBetweenSeconds / 60));
  const [restSec, setRestSec] = useState(initial.restBetweenSeconds % 60);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, start] = useTransition();

  const setExercise = (fi: number, patch: Partial<ExerciseInput>) =>
    setCircuit((c) => ({ ...c, exercises: c.exercises.map((e, j) => (j === fi ? { ...e, ...patch } : e)) }));
  const removeExercise = (fi: number) => setCircuit((c) => ({ ...c, exercises: c.exercises.filter((_, j) => j !== fi) }));
  const addFromLibrary = (lib: ExerciseLibRow) =>
    setCircuit((c) => ({ ...c, exercises: [...c.exercises, { ...blankExercise("workout"), name: lib.name, exerciseId: lib.id, muscleGroups: lib.muscleGroups }] }));
  const addCustom = () => setCircuit((c) => ({ ...c, exercises: [...c.exercises, blankExercise("workout")] }));

  const submit = (close: boolean) => {
    if (!circuit.name.trim()) return toast.error("Enter a circuit title.");
    start(async () => {
      const res = await saveCircuitAction({
        ...circuit,
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
        restBetweenSeconds: restMin * 60 + restSec,
      });
      if (res.ok) {
        toast.success("Circuit saved.");
        if (close) router.push("/workout/circuits");
        else router.replace(`/workout/circuits/${res.id}`);
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button variant="ghost" size="icon" onClick={() => router.push("/workout/circuits")} aria-label="Back">
          <ArrowLeft size={16} />
        </Button>
        <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 24, textTransform: "uppercase" }}>
          {initial.id ? "Edit" : "Create a"} Circuit
        </h1>
      </div>

      <div style={card}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <Label htmlFor="c-title">Circuit title *</Label>
            <Input id="c-title" value={circuit.name === "New Circuit" ? "" : circuit.name} onChange={(e) => setCircuit((c) => ({ ...c, name: e.target.value }))} placeholder="Enter circuit title" />
          </div>
          <div>
            <Label htmlFor="c-tags">Tags</Label>
            <Input id="c-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="Add tags (comma separated)" />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <Label htmlFor="c-rounds">Number of rounds *</Label>
            <Input id="c-rounds" type="number" min={1} value={circuit.rounds} onChange={(e) => setCircuit((c) => ({ ...c, rounds: Number(e.target.value) || 1 }))} />
          </div>
          <div>
            <Label>Rest between rounds</Label>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ position: "relative", flex: 1 }}>
                <Input type="number" min={0} value={restMin} onChange={(e) => setRestMin(Math.max(0, Number(e.target.value) || 0))} />
                <span style={unitStyle}>Min</span>
              </div>
              <div style={{ position: "relative", flex: 1 }}>
                <Input type="number" min={0} max={59} value={restSec} onChange={(e) => setRestSec(Math.min(59, Math.max(0, Number(e.target.value) || 0)))} />
                <span style={unitStyle}>Sec</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary)", fontFamily: "var(--font-mono), monospace" }}>Circuit</div>
        {circuit.exercises.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>No exercises yet.</div>}
        {circuit.exercises.map((ex, i) => (
          <ExerciseRow key={i} letter={LETTERS[i] ?? "•"} ex={ex} onPatch={(patch) => setExercise(i, patch)} onRemove={() => removeExercise(i)} />
        ))}
        <div>
          <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            <Plus size={14} /> Add an Exercise
          </Button>
        </div>
      </div>

      <div style={card}>
        <div>
          <Label htmlFor="c-instr">Instructions</Label>
          <Textarea id="c-instr" value={circuit.instructions ?? ""} onChange={(e) => setCircuit((c) => ({ ...c, instructions: e.target.value }))} rows={3} placeholder="Enter circuit instructions" />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <Button variant="ghost" onClick={() => router.push("/workout/circuits")} disabled={saving}>Cancel</Button>
        <Button variant="outline" onClick={() => submit(false)} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        <Button onClick={() => submit(true)} disabled={saving}>Save &amp; Close</Button>
      </div>

      <ChooseExerciseSheet open={pickerOpen} exercises={exercises} onClose={() => setPickerOpen(false)} onPick={addFromLibrary} onCustom={addCustom} />
    </div>
  );
}

function ExerciseRow({ letter, ex, onPatch, onRemove }: { letter: string; ex: ExerciseInput; onPatch: (patch: Partial<ExerciseInput>) => void; onRemove: () => void }) {
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
            <span key={g} style={{ fontSize: 10.5, padding: "1px 7px", borderRadius: 5, background: "var(--surface-2)", color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace" }}>{g}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ChooseExerciseSheet({ open, exercises, onClose, onPick, onCustom }: { open: boolean; exercises: ExerciseLibRow[]; onClose: () => void; onPick: (lib: ExerciseLibRow) => void; onCustom: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (query ? exercises.filter((e) => e.name.toLowerCase().includes(query)) : exercises).slice(0, 60);
  }, [q, exercises]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title="Choose Exercise" width={420}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…" autoFocus />
          <button onClick={() => router.push("/workout/exercises")} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: "var(--accent-ink)", cursor: "pointer", fontSize: 13, alignSelf: "flex-start" }}>
            <Plus size={14} /> Add a new exercise to the library
          </button>
          <button onClick={onCustom} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13, alignSelf: "flex-start" }}>
            <Plus size={14} /> Add a custom exercise (one-off)
          </button>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            {matches.length === 0 && <div style={{ fontSize: 13, color: "var(--text-tertiary)", padding: "8px 0" }}>No exercises found.</div>}
            {matches.map((e) => (
              <button key={e.id} onClick={() => { onPick(e); toast.success(`${e.name} added`); }} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", padding: 8, border: "1px solid var(--hairline)", borderRadius: "var(--radius)", background: "transparent", cursor: "pointer" }}>
                <Thumb url={e.imageUrl} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>{e.name}</span>
                  {e.muscleGroups.length > 0 && <span style={{ display: "block", fontSize: 11.5, color: "var(--text-tertiary)" }}>{e.muscleGroups.join(", ")}</span>}
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
      <input type="number" min={0} step={1} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} placeholder={placeholder} style={{ height: 34, width: "100%", padding: suffix ? "0 22px 0 10px" : "0 10px", borderRadius: "var(--radius)", border: "1px solid var(--hairline)", background: "var(--surface-2)", color: "var(--text-primary)", fontSize: 12.5, fontFamily: "var(--font-mono), monospace" }} />
      {suffix && <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--text-tertiary)" }}>{suffix}</span>}
    </div>
  );
}

const card: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 14, border: "1px solid var(--hairline)", borderRadius: "var(--radius)", background: "var(--surface-1)", padding: 20 };
const unitStyle: React.CSSProperties = { position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--text-tertiary)" };
