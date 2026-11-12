// app/src/lib/programs/cards.ts
/** Library cards, filters and small display helpers for the member app and staff screens. Pure. */
import { FAMILY_LABEL, LEVEL_LABEL, type Family, type LiftKey, type ProgramTemplate } from "./types";

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

export function filterCards(cards: ProgramCard[], f: CardFilter): ProgramCard[] {
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
