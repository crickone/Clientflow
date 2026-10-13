"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { startOwnWorkoutAction, startWorkoutAction } from "@/app/app/actions";
import type { StartResult } from "@/lib/workoutLog";

/**
 * Starts a programme day (programId + dayPosition) or, with neither, the
 * member's own workout, then opens the log. A workout already open with sets
 * ticked blocks with a toast that links to it.
 */
export function StartWorkoutButton({
  programId,
  dayPosition,
  label,
  variant = "primary",
  size = "md",
}: {
  programId?: number;
  dayPosition?: number;
  label: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const own = programId === undefined;

  function go() {
    start(async () => {
      const r: StartResult = own ? await startOwnWorkoutAction() : await startWorkoutAction(programId, dayPosition ?? 0);
      if (r.ok) return router.push(`/app/workouts/log/${r.sessionId}`);
      const openId = r.inProgressId;
      toast.error(r.error, openId ? { action: { label: "Open it", onClick: () => router.push(`/app/workouts/log/${openId}`) } } : undefined);
    });
  }

  return (
    <Button variant={variant} size={size} onClick={go} loading={pending} style={{ width: "100%" }}>
      {!pending && (own ? <Plus size={16} /> : <Play size={15} />)}
      {label}
    </Button>
  );
}
