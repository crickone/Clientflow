"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { deleteWorkoutAction } from "@/app/workout/workouts/actions";
import type { WorkoutInput } from "@/lib/workoutModel";
import { ExerciseSections } from "./ExerciseSections";

export function WorkoutPreview({ workout, media }: { workout: WorkoutInput; media: Record<string, string | null> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const confirm = useConfirm();

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

        <ExerciseSections exercises={workout.exercises} instructions={workout.instructions} media={media} />
      </div>
    </div>
  );
}
