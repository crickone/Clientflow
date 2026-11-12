// app/src/lib/programs/panel.ts
/** What the client page shows about a member's DIY program. Pure: the server reads, this shapes. */
import { actorLabel } from "./cards";
import { dayTitle, summarisePlanned, weekInRound, weekLabel } from "./planner";
import { LIFT_LABEL, type EngineState, type LiftKey, type PlannedSession, type ProgramTemplate, type WeightUnit } from "./types";
import { formatWeight, kgToUnit } from "./units";

export interface PanelInput {
  enrolment: { id: number; status: "active" | "paused" | "ended"; template: ProgramTemplate; state: EngineState; unit: WeightUnit; basedOnName: string | null } | null;
  plan: PlannedSession | null;
  events: { id: number; at: number; actor: string; actorName: string | null; kind: string; reason: string }[];
  past: { name: string; endedAt: number | null }[];
}

/** How many change-log events the client page reads. */
export const PANEL_EVENT_LIMIT = 40;

export interface ProgramPanelData {
  live: null | {
    enrolmentId: number;
    name: string;
    byline: string;
    status: "active" | "paused";
    finished: boolean;
    weekLine: string;
    unit: WeightUnit;
    /**
     * The weeks a coach can move the member to, numbered as weeks of the
     * member's current round ("Week 5: 5s week" in 5/3/1's second cycle).
     * Empty for a program with a single repeating week: there is nowhere to move.
     */
    weeks: { index: number; number: number; label: string }[];
    /** The index into the template's weeks the member is on; matches a `weeks` index. */
    currentWeek: number;
    lifts: { lift: LiftKey; label: string; max: string; tm: string | null; maxInUnit: number | null }[];
    next: { title: string; lines: string[] } | null;
    events: { id: number; when: string; who: string; lines: string[] }[];
    /** The log was cut at PANEL_EVENT_LIMIT, so older changes are not shown. */
    eventsCapped: boolean;
    /** Skips among those events only. */
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
      weeks:
        t.weeks.length > 1
          ? t.weeks.map((w, i) => {
              const n = weekInRound(t, { week: i, cycle: e.state.cycle }).week;
              return { index: i, number: n, label: w.label ? `Week ${n}: ${w.label}` : `Week ${n}` };
            })
          : [],
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
        ? { title: dayTitle(input.plan.dayName, t, e.state), lines: input.plan.exercises.map((x) => `${x.name} ${summarisePlanned(x.sets, e.unit)}`) }
        : null,
      events: input.events.map((ev) => ({ id: ev.id, when: dayText(ev.at), who: actorLabel(ev.actor, ev.actorName, false), lines: ev.reason.split("\n") })),
      eventsCapped: input.events.length >= PANEL_EVENT_LIMIT,
      skipped: input.events.filter((ev) => ev.kind === "skip").map((ev) => ({ when: dayText(ev.at), text: ev.reason })),
    },
    past,
  };
}
