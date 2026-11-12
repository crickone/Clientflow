// app/src/lib/programs/panel.ts
/** What the client page shows about a member's DIY program. Pure: the server reads, this shapes. */
import { actorLabel } from "./cards";
import { MEMBER_AUTHOR } from "./memberTemplate";
import { dayTitle, summarisePlanned, summariseRx, weekInRound, weekLabel } from "./planner";
import { LIFT_LABEL, RULE_LABEL, type EngineState, type ExerciseRx, type LiftKey, type PlannedSession, type ProgramTemplate, type WeightUnit } from "./types";
import { formatWeight, kgToUnit } from "./units";

export interface PanelInput {
  enrolment: {
    id: number;
    status: "active" | "paused" | "ended";
    template: ProgramTemplate;
    state: EngineState;
    unit: WeightUnit;
    basedOnName: string | null;
    /** A program the member built for themselves: staff see it read-only. */
    memberBuilt?: boolean;
  } | null;
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
    /** A member-built program, read-only: each week, day and exercise with its rule. Null for a library program. */
    program: { title: string; days: { name: string; lines: string[] }[] }[] | null;
  };
  past: { name: string; ended: string }[];
}

/** A member-built exercise's rule in a line: "Add weight. 3 x 5. Adds 2.5 kg after a full session, 10% lighter after 3 misses in a row." */
export function describeRule(ex: ExerciseRx, unit: WeightUnit): string {
  const sets = summariseRx(ex.sets);
  const r = ex.rule;
  const fmt = (kg: number) => formatWeight(kg, unit);
  if (!r) return sets;
  switch (r.kind) {
    case "linear":
      return `${RULE_LABEL.linear}. ${sets}. Adds ${fmt(r.incKg)} after a full session, 10% lighter after ${r.deloadAfter === 1 ? "a miss" : `${r.deloadAfter} misses in a row`}.`;
    case "range":
      return `${RULE_LABEL.range}. ${sets}. Adds ${r.incKg ? fmt(r.incKg) : "the smallest jump"} when every set reaches the top.`;
    case "percent":
      return `${RULE_LABEL.percent}. ${sets} of the ${ex.lift ? LIFT_LABEL[ex.lift].toLowerCase() : "lift"} max.`;
    case "rpe":
      return `${RULE_LABEL.rpe}. ${sets}. Weight from the best logged set.`;
    case "manual":
      return `${RULE_LABEL.manual}. ${sets}. The member picks the weight.`;
    default: {
      const never: never = r;
      return never;
    }
  }
}

function programLines(t: ProgramTemplate, unit: WeightUnit): NonNullable<ProgramPanelData["live"]>["program"] {
  return t.weeks.map((w, i) => ({
    title: w.label ? `Week ${i + 1}: ${w.label}` : `Week ${i + 1}`,
    days: w.days.map((d) => ({ name: d.test ? `${d.name} (test day)` : d.name, lines: d.exercises.map((ex) => `${ex.name}${ex.joined ? ", superset with the one above" : ""}: ${describeRule(ex, unit)}`) })),
  }));
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
      byline: e.memberBuilt ? MEMBER_AUTHOR : e.basedOnName ? `Our version, based on ${e.basedOnName}` : t.author,
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
      program: e.memberBuilt ? programLines(t, e.unit) : null,
    },
    past,
  };
}
