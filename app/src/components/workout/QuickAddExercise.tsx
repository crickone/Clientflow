"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { saveExerciseAction } from "@/app/workout/exercises/actions";
import type { ExerciseLibRow } from "@/lib/exerciseLibrary";

/**
 * Add an exercise to the library without leaving the builder. This used to be
 * a link to the Exercise Library page, which threw away the workout being
 * built. Saves to the library, then hands the new row back to be added.
 */
export function QuickAddExercise({ initialName, onCreated, onCancel }: { initialName: string; onCreated: (lib: ExerciseLibRow) => void; onCancel: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [groups, setGroups] = useState("");
  const [video, setVideo] = useState("");
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const muscleGroups = groups.split(",").map((g) => g.trim()).filter(Boolean);
      const res = await saveExerciseAction({ name, muscleGroups, videoUrl: video.trim() || null });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${name.trim()} added to the library`);
      onCreated({ id: res.id, name: name.trim(), category: null, muscleGroups, equipment: null, videoUrl: video.trim() || null, imageUrl: null, instructions: null });
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", gap: 10, padding: 12, border: "1px solid var(--hairline)", borderRadius: "var(--radius)", background: "var(--surface-1)" }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>New library exercise</div>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Exercise name" autoFocus />
      <Input value={groups} onChange={(e) => setGroups(e.target.value)} placeholder="Muscle groups, comma separated (e.g. Chest, Triceps)" />
      <Input value={video} onChange={(e) => setVideo(e.target.value)} placeholder="YouTube link (optional)" />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} loading={pending} disabled={!name.trim()}>
          Save and add
        </Button>
      </div>
    </div>
  );
}
