// app/src/lib/programs/staffView.ts
import "server-only";

import { enrolmentEvents, listEnrolments, liveEnrolment, planFor } from "./enrolments";
import { getCopy } from "./library";
import { panelFrom, type ProgramPanelData } from "./panel";

/** The client page's DIY program panel, or null when the member has never run a program. */
export function programPanelData(clientId: number): ProgramPanelData | null {
  const live = liveEnrolment(clientId);
  const past = listEnrolments(clientId).filter((e) => e.status === "ended").slice(0, 10);
  if (!live && past.length === 0) return null;
  return panelFrom({
    enrolment: live
      ? { id: live.id, status: live.status, template: live.template, state: live.state, unit: live.unit, basedOnName: live.copyId ? (getCopy(live.copyId)?.basedOnName ?? null) : null }
      : null,
    plan: live && live.status === "active" ? planFor(live) : null,
    events: live ? enrolmentEvents(live.id, 40) : [],
    past: past.map((p) => ({ name: p.template.name, endedAt: p.endedAt })),
  });
}
