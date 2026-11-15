// app/src/components/clientapp/MyProgramCard.tsx
import Link from "next/link";

import { liveEnrolment, planFor } from "@/lib/programs/enrolments";
import { sessionMinutes } from "@/lib/programs/outline";
import { weekLabel } from "@/lib/programs/planner";
import { openSession } from "@/lib/workoutLog";
import { PkCard, SessionTable } from "@/components/clientapp/programs/kit";
import { StartProgramSessionButton } from "@/components/clientapp/StartProgramSessionButton";

/**
 * The member's DIY program and its next session.
 * "full" (Workouts): the one white card, with the day name, about how long it
 * takes, every set as a table and Start or Continue session.
 * "line" (Home): one row, "Press day · Week 1 of 12", and a compact Start button.
 */
export function MyProgramCard({ clientId, variant = "full" }: { clientId: number; variant?: "full" | "line" }) {
  const view = liveEnrolment(clientId);
  if (!view || view.status !== "active") return null;
  const plan = planFor(view);
  const open = openSession(clientId);
  const inProgress = !!open && open.enrolmentId === view.id;
  const week = weekLabel(view.template, view.state);

  if (variant === "line") {
    return (
      <div className="pk-row pk-row--quiet">
        <Link href="/app/programs/mine" className="pk-linkrow" style={{ flex: 1, minWidth: 0 }}>
          <span>{plan ? `${plan.dayName} · ${week}` : view.template.name}</span>
        </Link>
        {plan ? (
          <StartProgramSessionButton label={inProgress ? "Continue" : "Start"} compact />
        ) : (
          <Link href="/app/programs/mine" className="pk-ghost">
            See program
          </Link>
        )}
      </div>
    );
  }

  return (
    <PkCard>
      <div className="pk-row">
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <span className="pk-small">
            {view.template.name} · {week}
          </span>
          <h2 className="pk-card-title">{plan ? plan.dayName : "Program finished"}</h2>
        </div>
        <Link href="/app/programs/mine" className="pk-ghost">
          Details
        </Link>
      </div>
      {plan ? (
        <>
          <span className="pk-small">About {sessionMinutes(view.template)} minutes</span>
          <SessionTable exercises={plan.exercises} unit={view.unit} />
          <StartProgramSessionButton label={inProgress ? "Continue session" : "Start session"} />
        </>
      ) : (
        <Link href="/app/programs/mine" className="pk-ghost">
          {view.assignedBy ? "Block finished. Your coach will set what comes next." : "Program done. Enter your new max to run it again."}
        </Link>
      )}
    </PkCard>
  );
}
