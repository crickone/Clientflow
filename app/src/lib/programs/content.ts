// app/src/lib/programs/content.ts
/**
 * What a program page says about a program: its summary, its phases, why it
 * works and its byline. Platform programs carry these in their template files;
 * a gym copy keeps the original's, fitted to its own weeks; a member-built
 * program gets them from its days and week labels. Pure.
 */
import { isFullBlock } from "./editing";
import { MEMBER_AUTHOR, memberLine } from "./memberTemplate";
import { weekInRound } from "./planner";
import type { EngineState, Phase, ProgramTemplate } from "./types";

export interface ProgramContent {
  summary: string;
  /** Run from week 1 to phaseSpan with no gaps. */
  phases: Phase[];
  /** The phases describe one pass through the template's weeks, which repeats. */
  repeats: boolean;
  /** Null for a member-built program. */
  whyItWorks: string | null;
  /** The author, "Our version, based on X" for a gym copy, or "Built by the member". */
  byline: string;
}

export type ContentSource = { kind: "platform" } | { kind: "copy"; basedOnName: string } | { kind: "member" };

/** The phase used for weeks a gym added past the original's phases. */
export const ADDED_WEEKS_PHASE = "Added weeks";

/** "Week 3", "Weeks 1 to 4". */
export function weeksText(from: number, to: number): string {
  return from === to ? `Week ${from}` : `Weeks ${from} to ${to}`;
}

/** "A", "A and B", "A, B and C". */
export function listText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** How many weeks the phases cover: one pass through the weeks when they repeat, else the program's length. */
export function phaseSpan(t: Pick<ProgramTemplate, "weeks" | "lengthWeeks">, repeats: boolean): number {
  return Math.max(1, repeats ? t.weeks.length : t.lengthWeeks);
}

/**
 * Phases fitted to `span` weeks: a phase that starts after the last week is
 * dropped, one that runs past it is clipped, and weeks past the last phase
 * become one "Added weeks" phase. Never returns an empty list.
 */
export function fitPhases(phases: Phase[], span: number): Phase[] {
  const out: Phase[] = [];
  for (const p of phases) {
    if (p.fromWeek > span) continue;
    out.push({ ...p, toWeek: Math.min(p.toWeek, span) });
  }
  const last = out[out.length - 1]?.toWeek ?? 0;
  if (last < span) out.push({ name: out.length ? ADDED_WEEKS_PHASE : weeksText(1, span), fromWeek: last + 1, toWeek: span, note: out.length ? "Weeks added in our version." : "" });
  return out;
}

/** A member program's phases: consecutive weeks that share a label merge; unlabelled weeks are named by their numbers. */
export function memberPhases(t: Pick<ProgramTemplate, "weeks">): Phase[] {
  const out: Phase[] = [];
  t.weeks.forEach((w, i) => {
    const label = w.label?.trim() ?? "";
    const prev = out[out.length - 1];
    const prevLabel = prev && t.weeks[prev.fromWeek - 1].label?.trim();
    if (prev && (prevLabel ?? "") === label) {
      prev.toWeek = i + 1;
      return;
    }
    // Day names left blank are skipped; a week with none named has no note.
    const days = w.days.map((d) => d.name.trim()).filter(Boolean);
    out.push({ name: label, fromWeek: i + 1, toWeek: i + 1, note: days.length ? `${listText(days)}.` : "" });
  });
  for (const p of out) if (!p.name) p.name = weeksText(p.fromWeek, p.toWeek);
  return out;
}

/** Everything the program page and cards say about a program. */
export function programContent(t: ProgramTemplate, src: ContentSource): ProgramContent {
  if (src.kind === "member") {
    return { summary: memberLine(t), phases: memberPhases(t), repeats: true, whyItWorks: null, byline: MEMBER_AUTHOR };
  }
  const repeats = t.phasesRepeat === true;
  return {
    summary: t.summary ?? t.who,
    phases: fitPhases(t.phases ?? [], phaseSpan(t, repeats)),
    repeats,
    whyItWorks: t.whyItWorks ?? null,
    byline: src.kind === "copy" ? `Our version, based on ${src.basedOnName}` : t.author,
  };
}

/**
 * A gym copy or an enrolment snapshot saved before programs had content
 * takes it from the program it came from. Fields it has are kept.
 */
export function withContentFrom(t: ProgramTemplate, original: ProgramTemplate | null): ProgramTemplate {
  if (!original) return t;
  const out: ProgramTemplate = { ...t };
  if (out.summary === undefined && original.summary !== undefined) out.summary = original.summary;
  if (out.whyItWorks === undefined && original.whyItWorks !== undefined) out.whyItWorks = original.whyItWorks;
  if (out.phases === undefined && original.phases !== undefined) out.phases = original.phases.map((p) => ({ ...p }));
  if (out.phasesRepeat === undefined && original.phasesRepeat !== undefined) out.phasesRepeat = original.phasesRepeat;
  return out;
}

/**
 * The phase the member is in. Repeating phases follow the week of the cycle.
 * Otherwise they follow the week of the round; a short cycle run for longer
 * (StrongLifts' two weeks for 12) has no phase after its first round.
 */
export function currentPhase(content: Pick<ProgramContent, "phases" | "repeats">, t: Pick<ProgramTemplate, "weeks" | "lengthWeeks">, s: Pick<EngineState, "week" | "cycle">): number | null {
  let wk: number;
  if (content.repeats) wk = s.week + 1;
  else {
    const r = weekInRound(t, s);
    if (r.round > 1 && !isFullBlock(t)) return null;
    wk = r.week;
  }
  const i = content.phases.findIndex((p) => wk >= p.fromWeek && wk <= p.toWeek);
  return i === -1 ? null : i;
}

/** The content check every platform program must pass. */
export function contentErrors(t: ProgramTemplate): string[] {
  const errors: string[] = [];
  if (!t.summary?.trim()) errors.push(`${t.key}: needs a summary.`);
  if (!t.whyItWorks?.trim()) errors.push(`${t.key}: needs a line on why it works.`);
  const phases = t.phases ?? [];
  if (phases.length === 0) return [...errors, `${t.key}: needs phases.`];
  const span = phaseSpan(t, t.phasesRepeat === true);
  let next = 1;
  phases.forEach((p, i) => {
    const name = p.name.trim() || `Phase ${i + 1}`;
    if (!p.name.trim()) errors.push(`${t.key}: each phase needs a name.`);
    if (!p.note.trim()) errors.push(`${t.key}: ${name} needs a note.`);
    if (p.fromWeek !== next || p.toWeek < p.fromWeek) errors.push(`${t.key}: ${name} should start at week ${next}.`);
    next = p.toWeek + 1;
  });
  if (next - 1 !== span) errors.push(`${t.key}: the phases end at week ${next - 1}, not week ${span}.`);
  return errors;
}
