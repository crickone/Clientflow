// app/src/lib/programs/panel.ts
/** What the client page shows about a member's DIY program. Pure: the server reads, this shapes. */
import { actorLabel } from "./cards";
import { summarisePlanned, weekLabel, weekNumber } from "./planner";
import { LIFT_LABEL, type EngineState, type LiftKey, type PlannedSession, type ProgramTemplate, type WeightUnit } from "./types";
import { formatWeight, kgToUnit } from "./units";

export interface PanelInput {
  enrolment: { id: number; status: "active" | "paused" | "ended"; template: ProgramTemplate; state: EngineState; unit: WeightUnit; basedOnName: string | null } | null;
  plan: PlannedSession | null;
  events: { id: number; at: number; actor: string; actorName: string | null; kind: string; reason: string }[];
  past: { name: string; endedAt: number | null }[];
}

export interface ProgramPanelData {
  live: null | {
    enrolmentId: number;
    name: string;
    byline: string;
    status: "active" | "paused";
    finished: boolean;
    weekLine: string;
    unit: WeightUnit;
    weeks: { index: number; label: string }[];
    currentWeek: number;
    lifts: { lift: LiftKey; label: string; max: string; tm: string | null; maxInUnit: number | null }[];
    next: { title: string; lines: string[] } | null;
    events: { id: number; when: string; who: string; lines: string[] }[];
    skipped: { when: string; text: string }[];
  };
  past: { name: string; ended: string }[];
}

const dayText = (ms: number) => new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });

export function panelFrom(input: PanelInput): ProgramPanelData {
  const past = input.past.map((p) => ({ name: p.name, ended: p.endedAt ? dayText(p.endedAt) : "-" }));
  const e = input.enrolment;
  if (!e || e.status === "ended") return { live: null, past };
  const t = e.template;
  const fmt = (kg: number) => formatWeight(kg, e.unit);
  return {
    live: {
      enrolmentId: e.id,
      name: t.name,
      byline: e.basedOnName ? `Our version, based on ${e.basedOnName}` : t.author,
      status: e.status,
      finished: e.state.finished,
      weekLine: e.state.finished ? "Block finished. Waiting for a new max." : weekLabel(t, e.state),
      unit: e.unit,
      weeks: t.weeks.map((w, i) => ({ index: i, label: w.label ? `Week ${i + 1}: ${w.label}` : `Week ${i + 1}` })),
      currentWeek: e.state.week,
      lifts: t.lifts.map((lift) => {
        const max = e.state.maxes[lift];
        const tm = e.state.tms[lift];
        return {
          lift,
          label: LIFT_LABEL[lift],
          max: max !== undefined ? fmt(max) : "-",
          tm: t.tmPct !== 1 && tm !== undefined ? fmt(tm) : null,
          maxInUnit: max !== undefined ? kgToUnit(max, e.unit) : null,
        };
      }),
      next: input.plan
        ? { title: `${input.plan.dayName}, week ${weekNumber(t, e.state)}`, lines: input.plan.exercises.map((x) => `${x.name} ${summarisePlanned(x.sets, e.unit)}`) }
        : null,
      events: input.events.map((ev) => ({ id: ev.id, when: dayText(ev.at), who: actorLabel(ev.actor, ev.actorName, false), lines: ev.reason.split("\n") })),
      skipped: input.events.filter((ev) => ev.kind === "skip").map((ev) => ({ when: dayText(ev.at), text: ev.reason })),
    },
    past,
  };
}
