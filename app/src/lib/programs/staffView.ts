// app/src/lib/programs/staffView.ts
import "server-only";

import { enrolmentEvents, listEnrolments, liveEnrolment, planFor } from "./enrolments";
import { getCopy } from "./library";
import { PANEL_EVENT_LIMIT, panelFrom, type ProgramPanelData } from "./panel";

/**
 * The client page's DIY program panel, or null when the member has never run a
 * program. A bad program row must never take the client page down, so any
 * failure here is logged and the panel is left out.
 */
export function programPanelData(clientId: number): ProgramPanelData | null {
  try {
    return buildPanel(clientId);
  } catch (err) {
    console.error(`[programs] panel for client ${clientId} failed:`, err);
    return null;
  }
}

function buildPanel(clientId: number): ProgramPanelData | null {
  const live = liveEnrolment(clientId);
  const past = listEnrolments(clientId).filter((e) => e.status === "ended").slice(0, 10);
  if (!live && past.length === 0) return null;
  return panelFrom({
    enrolment: live
      ? { id: live.id, status: live.status, template: live.template, state: live.state, unit: live.unit, basedOnName: live.copyId ? (getCopy(live.copyId)?.basedOnName ?? null) : null }
      : null,
    plan: live && live.status === "active" ? planFor(live) : null,
    events: live ? enrolmentEvents(live.id, PANEL_EVENT_LIMIT) : [],
    past: past.map((p) => ({ name: p.template.name, endedAt: p.endedAt })),
  });
}
