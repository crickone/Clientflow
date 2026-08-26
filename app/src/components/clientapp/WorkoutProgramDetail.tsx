"use client";

import { useState } from "react";

import { Card, DocumentCard, PageTitle } from "@/components/clientapp/ui";
import { DayTabs } from "@/components/clientapp/DayTabs";
import { ExerciseSections } from "@/components/workout/ExerciseSections";
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
}: {
  program: ProgramInput;
  media: Record<string, string | null>;
}) {
  const [dayIdx, setDayIdx] = useState(0);
  const day = program.days[dayIdx];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={PROGRAM_TYPE_LABEL[program.type]}>{program.title}</PageTitle>

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
          <DayTabs labels={program.days.map((d, i) => d.name || `Day ${i + 1}`)} active={dayIdx} onChange={setDayIdx} />
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
