// app/src/lib/programs/cards.ts
/** Library cards, filters and small display helpers for the member app and staff screens. Pure. */
import type { ProgramContent } from "./content";
import { focusTag, lengthTag } from "./outline";
import { FAMILY_LABEL, LEVEL_LABEL, type Family, type LiftKey, type Phase, type ProgramTemplate } from "./types";

export interface ProgramCard {
  key: string;
  name: string;
  author: string;
  family: Family;
  familyLabel: string;
  levelLabel: string;
  daysPerWeek: number;
  lengthWeeks: number;
  who: string;
  warning: string | null;
  /** A gym copy: the platform program it is based on. */
  basedOn: string | null;
  lifts: LiftKey[];
}

export function toCard(t: ProgramTemplate, basedOn: string | null = null): ProgramCard {
  return {
    key: t.key,
    name: t.name,
    author: t.author,
    family: t.family,
    familyLabel: FAMILY_LABEL[t.family],
    levelLabel: LEVEL_LABEL[t.level],
    daysPerWeek: t.daysPerWeek,
    lengthWeeks: t.lengthWeeks,
    who: t.who,
    warning: t.warning ?? null,
    basedOn,
    lifts: t.lifts,
  };
}

/** "4 days a week for 13 weeks". */
export function cardLine(c: Pick<ProgramCard, "daysPerWeek" | "lengthWeeks">): string {
  return `${c.daysPerWeek} ${c.daysPerWeek === 1 ? "day" : "days"} a week for ${c.lengthWeeks} ${c.lengthWeeks === 1 ? "week" : "weeks"}`;
}

/** The author credit, or for a gym copy "Our version, based on Smolov base mesocycle". */
export function byline(c: Pick<ProgramCard, "author" | "basedOn">): string {
  return c.basedOn ? `Our version, based on ${c.basedOn}` : c.author;
}

export interface CardFilter {
  family: Family | "all";
  /** "3" is three or fewer. */
  days: "any" | "3" | "4" | "5+";
  /** short: up to 6 weeks; medium: 7 to 12; long: 13 or more. */
  length: "any" | "short" | "medium" | "long";
}

export const NO_FILTER: CardFilter = { family: "all", days: "any", length: "any" };

export function filterCards<T extends ProgramCard>(cards: T[], f: CardFilter): T[] {
  return cards.filter((c) => {
    if (f.family !== "all" && c.family !== f.family) return false;
    if (f.days === "3" && c.daysPerWeek > 3) return false;
    if (f.days === "4" && c.daysPerWeek !== 4) return false;
    if (f.days === "5+" && c.daysPerWeek < 5) return false;
    if (f.length === "short" && c.lengthWeeks > 6) return false;
    if (f.length === "medium" && (c.lengthWeeks < 7 || c.lengthWeeks > 12)) return false;
    if (f.length === "long" && c.lengthWeeks < 13) return false;
    return true;
  });
}

const FAMILIES: CardFilter["family"][] = ["all", "strength", "peaking", "beginner", "size"];
const DAY_FILTERS: CardFilter["days"][] = ["any", "3", "4", "5+"];
const LENGTH_FILTERS: CardFilter["length"][] = ["any", "short", "medium", "long"];
const pick = <T extends string>(options: T[], raw: string | string[] | undefined, fallback: T): T => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return options.includes(v as T) ? (v as T) : fallback;
};

/** The Programs tab's filters from its URL (?goal=&days=&length=). Anything unknown is "any". */
export function parseFilter(sp: { goal?: string | string[]; days?: string | string[]; length?: string | string[] }): CardFilter {
  return { family: pick(FAMILIES, sp.goal, "all"), days: pick(DAY_FILTERS, sp.days, "any"), length: pick(LENGTH_FILTERS, sp.length, "any") };
}

/** The query string that keeps the filters in the URL: "" when none are set. */
export function filterQuery(f: CardFilter): string {
  const q = new URLSearchParams();
  if (f.family !== "all") q.set("goal", f.family);
  if (f.days !== "any") q.set("days", f.days);
  if (f.length !== "any") q.set("length", f.length);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** The Programs tab's goal headings, in the order they are shown. */
export const GOAL_ORDER: Family[] = ["strength", "peaking", "beginner", "size"];
export const GOAL_LABEL: Record<Family, string> = {
  strength: "Get strong",
  peaking: "Peak your total",
  beginner: "Start lifting",
  size: "Build size",
};

/** A big card on the Programs tab: the library card plus the story the program tells. */
export interface StoryCard extends ProgramCard {
  summary: string;
  phases: Phase[];
  /** Days, length and focus pills. */
  tags: string[];
}

export function toStoryCard(t: ProgramTemplate, content: ProgramContent, basedOn: string | null = null): StoryCard {
  return {
    ...toCard(t, basedOn),
    summary: content.summary,
    phases: content.phases,
    tags: [`${t.daysPerWeek} ${t.daysPerWeek === 1 ? "day" : "days"}`, lengthTag(t, content.repeats), focusTag(t)],
  };
}

/** Cards under their goal headings, in GOAL_ORDER; empty groups are left out. */
export function groupByGoal<T extends ProgramCard>(cards: T[]): { family: Family; label: string; cards: T[] }[] {
  return GOAL_ORDER.map((family) => ({ family, label: GOAL_LABEL[family], cards: cards.filter((c) => c.family === family) })).filter((g) => g.cards.length > 0);
}


const DEFAULT_DAYS: Record<number, number[]> = {
  1: [1],
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 4, 5],
  6: [1, 2, 3, 4, 5, 6],
  7: [1, 2, 3, 4, 5, 6, 7],
};

/** Training weekdays to suggest for a program's days per week (1 = Monday). */
export function defaultWeekdays(daysPerWeek: number): number[] {
  return DEFAULT_DAYS[Math.max(1, Math.min(7, Math.round(daysPerWeek)))];
}

/** Who made a change-log entry, for the member ("You") or for staff ("Member"). */
export function actorLabel(actor: string, actorName: string | null, forMember: boolean): string {
  if (actor === "engine") return "Program";
  if (actor === "member") return forMember ? "You" : "Member";
  return actorName ? `Coach ${actorName}` : "Coach";
}
