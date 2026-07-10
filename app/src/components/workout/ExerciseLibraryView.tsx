"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { deleteExerciseAction, saveExerciseAction } from "@/app/workout/exercises/actions";
import type { ExerciseLibRow } from "@/lib/exerciseLibrary";

export function ExerciseLibraryView({ exercises }: { exercises: ExerciseLibRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ExerciseLibRow | null>(null);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return exercises;
    return exercises.filter(
      (e) =>
        e.name.toLowerCase().includes(query) ||
        (e.category ?? "").toLowerCase().includes(query) ||
        e.muscleGroups.some((m) => m.toLowerCase().includes(query)),
    );
  }, [exercises, q]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
          {exercises.length} exercise{exercises.length === 1 ? "" : "s"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative", width: 240 }}>
            <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search exercises…" style={{ paddingLeft: 32 }} />
          </div>
          <Button onClick={() => { setEditing(null); setOpen(true); }}>
            <Plus size={15} /> Add exercise
          </Button>
        </div>
      </div>

      <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 680 }}>
            <div style={{ ...row, ...headRow }}>
              <div>Exercise</div>
              <div>Category</div>
              <div>Muscle groups</div>
              <div style={{ textAlign: "right" }}>Actions</div>
            </div>
            {filtered.length === 0 && (
              <div style={{ padding: "36px 16px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13.5 }}>
                No exercises yet. Click <strong>Add exercise</strong> to build your library.
              </div>
            )}
            {filtered.map((e) => (
              <div key={e.id} style={row}>
                <button onClick={() => { setEditing(e); setOpen(true); }} style={{ textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0, minWidth: 0 }}>
                  <span style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{e.name}</span>
                </button>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{e.category || "—"}</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {e.muscleGroups.length === 0 ? (
                    <span style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>—</span>
                  ) : (
                    e.muscleGroups.slice(0, 4).map((m) => (
                      <span key={m} style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 5, background: "var(--surface-2)", color: "var(--text-secondary)", fontFamily: "var(--font-mono), monospace" }}>
                        {m}
                      </span>
                    ))
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  <button onClick={() => { setEditing(e); setOpen(true); }} aria-label="Edit" style={iconBtn}>
                    <Pencil size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ExerciseSheet
        open={open}
        editing={editing}
        onClose={() => setOpen(false)}
        onSaved={() => { setOpen(false); router.refresh(); }}
      />
    </div>
  );
}

function ExerciseSheet({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: ExerciseLibRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [muscles, setMuscles] = useState("");
  const [equipment, setEquipment] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [instructions, setInstructions] = useState("");

  const [seed, setSeed] = useState<number | "new" | null>(null);
  const key = editing ? editing.id : "new";
  if (open && seed !== key) {
    setSeed(key);
    setName(editing?.name ?? "");
    setCategory(editing?.category ?? "");
    setMuscles((editing?.muscleGroups ?? []).join(", "));
    setEquipment(editing?.equipment ?? "");
    setVideoUrl(editing?.videoUrl ?? "");
    setImageUrl(editing?.imageUrl ?? "");
    setInstructions(editing?.instructions ?? "");
  }
  if (!open && seed !== null) setSeed(null);

  const submit = () => {
    if (!name.trim()) return toast.error("Give the exercise a name.");
    start(async () => {
      const res = await saveExerciseAction({
        id: editing?.id,
        name,
        category: category || null,
        muscleGroups: muscles.split(",").map((m) => m.trim()).filter(Boolean),
        equipment: equipment || null,
        videoUrl: videoUrl || null,
        imageUrl: imageUrl || null,
        instructions: instructions || null,
      });
      if (res.ok) {
        toast.success(editing ? "Exercise updated." : "Exercise added.");
        onSaved();
      } else toast.error(res.error);
    });
  };

  const remove = () => {
    if (!editing) return;
    start(async () => {
      await deleteExerciseAction(editing.id);
      toast.success("Exercise deleted.");
      onSaved();
    });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={editing ? "Edit exercise" : "Add exercise"} width={460}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <Label htmlFor="ex-name">Name</Label>
            <Input id="ex-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dumbbell Bench Press" autoFocus />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <Label htmlFor="ex-cat">Category</Label>
              <Input id="ex-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Chest" />
            </div>
            <div>
              <Label htmlFor="ex-equip">Equipment</Label>
              <Input id="ex-equip" value={equipment} onChange={(e) => setEquipment(e.target.value)} placeholder="e.g. Dumbbell" />
            </div>
          </div>
          <div>
            <Label htmlFor="ex-muscles">Muscle groups</Label>
            <Input id="ex-muscles" value={muscles} onChange={(e) => setMuscles(e.target.value)} placeholder="Chest, Triceps, Front Delts (comma separated)" />
            <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 4 }}>Used to compute total volume sets in programs.</div>
          </div>
          <div>
            <Label htmlFor="ex-video">Video URL</Label>
            <Input id="ex-video" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <Label htmlFor="ex-image">Image URL</Label>
            <Input id="ex-image" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div>
            <Label htmlFor="ex-instr">Instructions</Label>
            <Textarea id="ex-instr" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
            {editing ? (
              <Button variant="ghost" onClick={remove} disabled={pending} aria-label="Delete exercise">
                <Trash2 size={14} />
              </Button>
            ) : (
              <span />
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
              <Button onClick={submit} disabled={pending}>{pending ? "Saving…" : editing ? "Save" : "Add exercise"}</Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const row: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.6fr 1fr 1.6fr 0.6fr",
  gap: 12,
  padding: "11px 16px",
  borderBottom: "1px solid var(--hairline)",
  alignItems: "center",
  fontSize: 13,
};
const headRow: React.CSSProperties = {
  background: "var(--surface-1)",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono), monospace",
};
const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
};
