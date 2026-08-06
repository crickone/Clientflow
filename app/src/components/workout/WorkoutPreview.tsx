"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Dumbbell, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { deleteWorkoutAction } from "@/app/workout/workouts/actions";
import { dayVolume, fmtRest, SECTIONS, type WorkoutInput } from "@/lib/workoutModel";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function WorkoutPreview({ workout, media }: { workout: WorkoutInput; media: Record<number, string | null> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const volume = dayVolume(workout);

  const remove = () =>
    start(async () => {
      if (!(await confirm({ title: `Delete "${workout.name}"?`, body: "This cannot be undone.", destructive: true }))) return;
      await deleteWorkoutAction(workout.id!);
      toast.success("Workout deleted.");
      router.push("/workout/workouts");
      router.refresh();
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button variant="ghost" size="icon" onClick={() => router.push("/workout/workouts")} aria-label="Back">
          <ArrowLeft size={16} />
        </Button>
        <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 22, textTransform: "uppercase" }}>Workout Preview</h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          <Button variant="outline" onClick={() => router.push(`/workout/workouts/${workout.id}`)}>
            <Pencil size={14} /> Edit
          </Button>
          <Button variant="ghost" onClick={remove} disabled={pending}>
            <Trash2 size={14} /> Delete
          </Button>
        </div>
      </div>

      <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", background: "var(--surface-1)", padding: 26, display: "flex", flexDirection: "column", gap: 22 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 26 }}>{workout.name}</h2>

        {volume.length > 0 && (
          <div>
            <div style={sectionLabel}>Total volume sets</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {volume.map((v) => (
                <span key={v.group} style={{ fontSize: 12.5, padding: "4px 11px", borderRadius: 999, background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>
                  {v.group} {v.sets}
                </span>
              ))}
            </div>
          </div>
        )}

        {SECTIONS.map((sec) => {
          const rows = workout.exercises.filter((e) => e.section === sec.key);
          if (rows.length === 0) return null;
          return (
            <div key={sec.key}>
              <div style={sectionLabel}>{sec.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                {rows.map((ex, i) => {
                  const url = ex.exerciseId ? media[ex.exerciseId] : null;
                  return (
                    <div key={i} style={exRow}>
                      <span style={{ fontFamily: "var(--font-mono), monospace", fontWeight: 700, color: "var(--text-tertiary)", width: 18, textAlign: "center" }}>{LETTERS[i] ?? "•"}</span>
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                      ) : (
                        <span style={{ width: 44, height: 44, borderRadius: 8, background: "var(--surface-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)", flexShrink: 0 }}>
                          <Dumbbell size={20} />
                        </span>
                      )}
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{ex.name}</span>
                      <span style={stat}>Sets: {ex.sets}</span>
                      {ex.reps && <span style={stat}>Reps: {ex.reps}</span>}
                      {ex.restSeconds > 0 && <span style={stat}>REST: {fmtRest(ex.restSeconds)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {workout.instructions && (
          <div>
            <div style={sectionLabel}>Instructions</div>
            <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{workout.instructions}</p>
          </div>
        )}
      </div>
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--text-primary)",
};
const exRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "12px 16px",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
};
const stat: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary)",
  minWidth: 90,
};
