// app/src/components/clientapp/MyProgramCard.tsx
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { liveEnrolment, planFor, sessionTitle } from "@/lib/programs/enrolments";
import { summarisePlanned, weekNumber } from "@/lib/programs/planner";
import { openSession } from "@/lib/workoutLog";
import { Card } from "@/components/clientapp/ui";
import { StartProgramSessionButton } from "@/components/clientapp/StartProgramSessionButton";

/** Home and Workouts: the member's DIY program and its next session, every weight worked out. */
export function MyProgramCard({ clientId }: { clientId: number }) {
  const view = liveEnrolment(clientId);
  if (!view || view.status !== "active") return null;
  const plan = planFor(view);
  const open = openSession(clientId);
  const inProgress = !!open && open.enrolmentId === view.id;
  return (
    <Card style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>My program</span>
        <Link href="/app/programs/mine" style={{ fontSize: 13, color: "var(--accent-ink)", display: "inline-flex", alignItems: "center", gap: 2 }}>
          Details <ChevronRight size={14} />
        </Link>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
        {view.template.name}, week {weekNumber(view.template, view.state)} of {view.template.lengthWeeks}
      </div>
      {plan ? (
        <>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{sessionTitle(view, plan)}</div>
          {plan.exercises.slice(0, 4).map((ex) => (
            <div key={ex.index} style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.45 }}>
              <span style={{ color: "var(--text-primary)" }}>{ex.name}</span> {summarisePlanned(ex.sets, view.unit)}
            </div>
          ))}
          {plan.exercises.length > 4 && <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>And {plan.exercises.length - 4} more</div>}
          <StartProgramSessionButton label={inProgress ? "Continue session" : "Start session"} />
        </>
      ) : (
        <Link href="/app/programs/mine" style={{ fontSize: 13.5, color: "var(--accent-ink)" }}>
          Program done. Enter your new max to run it again.
        </Link>
      )}
    </Card>
  );
}
