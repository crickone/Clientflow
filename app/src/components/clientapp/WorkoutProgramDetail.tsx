"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { toast } from "sonner";

import { Card, DocumentCard, PageTitle } from "@/components/clientapp/ui";
import { DayTabs } from "@/components/clientapp/DayTabs";
import { ExerciseSections } from "@/components/workout/ExerciseSections";
import { Button } from "@/components/ui/Button";
import { startWorkoutAction } from "@/app/app/actions";
import { PROGRAM_TYPE_LABEL, type ProgramInput } from "@/lib/workoutModel";

/**
 * The full, read-only render of an assigned workout program for the client
 * app — day tabs + per-section exercise lists (type "detailed", reusing the
 * SAME ExerciseSections the admin's WorkoutPreview renders), a summary +
 * written content (type "simple"), or a link to the attached document (type
 * "upload"). Fed by `getProgram()` (the same tenant-DB assembly the admin
 * DetailedBuilder edits), ownership-checked upstream in lib/clientApp.ts's
 * assignedWorkoutProgramDetail — this component trusts its `program` prop
 * completely and does no auth of its own.
 */
export function WorkoutProgramDetail({
  program,
  media,
  open,
  initialDay = 0,
}: {
  program: ProgramInput;
  media: Record<string, string | null>;
  /** The member's workout in progress, if any, so this day can offer Continue. */
  open: { id: number; programId: number | null; dayPosition: number; dayName: string } | null;
  initialDay?: number;
}) {
  const router = useRouter();
  const [dayIdx, setDayIdx] = useState(Math.min(initialDay, Math.max(0, program.days.length - 1)));
  const [pending, start] = useTransition();
  const [blocked, setBlocked] = useState<{ error: string; id?: number } | null>(null);
  const day = program.days[dayIdx];
  const openHere = open && open.programId === program.id && open.dayPosition === dayIdx ? open : null;

  function startDay() {
    setBlocked(null);
    start(async () => {
      const r = await startWorkoutAction(program.id!, dayIdx);
      if (r.ok) return router.push(`/app/workouts/log/${r.sessionId}`);
      if (r.inProgressId) setBlocked({ error: r.error, id: r.inProgressId });
      else toast.error(r.error);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={program.type === "detailed" ? `${program.days.length} day${program.days.length === 1 ? "" : "s"}` : PROGRAM_TYPE_LABEL[program.type]}>{program.title}</PageTitle>

      {program.type === "upload" ? (
        <DocumentCard href={`/api/app/workout/file?program=${program.id}`} name={program.uploadOriginalName ?? program.title} />
      ) : program.type === "simple" ? (
        <Card style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {program.summary && <div style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>{program.summary}</div>}
          {program.content && (
            <p style={{ margin: 0, fontSize: 14, color: "var(--text-primary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{program.content}</p>
          )}
        </Card>
      ) : program.days.length === 0 ? (
        <Card>
          <div style={emptyStyle}>This program has no days yet — check back once your coach fills it in.</div>
        </Card>
      ) : (
        <>
          {program.summary && <div style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>{program.summary}</div>}
          <DayTabs labels={program.days.map((d, i) => d.name || `Day ${i + 1}`)} active={dayIdx} onChange={(i) => { setDayIdx(i); setBlocked(null); }} />
          {day && day.exercises.length > 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              <Button onClick={startDay} loading={pending} style={{ width: "100%", height: 48, fontSize: 15 }}>
                {!pending && <Play size={16} />}
                {openHere ? `Continue ${day.name || `Day ${dayIdx + 1}`}` : `Start ${day.name || `Day ${dayIdx + 1}`}`}
              </Button>
              {blocked && (
                <Card style={{ padding: "12px 14px", fontSize: 13.5, color: "var(--text-secondary)", display: "grid", gap: 6 }}>
                  {blocked.error}
                  {blocked.id && (
                    <Link href={`/app/workouts/log/${blocked.id}`} style={{ color: "var(--accent-ink)", fontWeight: 500 }}>
                      Open that workout
                    </Link>
                  )}
                </Card>
              )}
            </div>
          )}
          {day && (
            <Card style={{ display: "flex", flexDirection: "column", gap: 18, padding: 22 }}>
              <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 19, color: "var(--text-primary)" }}>{day.name}</div>
              <ExerciseSections exercises={day.exercises} instructions={day.instructions} media={media} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

const emptyStyle: React.CSSProperties = { fontSize: 13.5, color: "var(--text-secondary)", textAlign: "center", padding: "16px 0" };
