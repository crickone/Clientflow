/**
 * Pure: how the booking screen lays out the treatment list.
 *
 * Two jobs. GROUPING by name into Recovery / Massage / Specialist, with an
 * Other group for anything the patterns do not know, so another business's
 * list still shows (it just lands in Other). COLLAPSING the treatments whose
 * names differ only by a "(30 min)" style suffix ("Swedish massage" and
 * "Swedish massage (30 min)") into one tile with a Length switch. Each length
 * is still its own therapy row with its own id, duration and price; the tile
 * only groups them on screen.
 */

import { euro } from "./format";

export interface TreatmentLike {
  id: number;
  name: string;
  defaultDurationMinutes: number;
  defaultPriceEur: number;
}

export interface TreatmentFamily<T extends TreatmentLike = TreatmentLike> {
  /** The base name lower-cased: stable across renders. */
  key: string;
  /** The base name, with any length suffix removed: "Swedish massage". */
  name: string;
  /** What the tile says: "Swedish" inside the Massage group. */
  label: string;
  /** Every length on offer, shortest first. One entry for most treatments. */
  options: T[];
  /** Picked when the tile is clicked: the option with no suffix, else the shortest. */
  primary: T;
}

export const GROUP_ORDER = ["Recovery", "Massage", "Specialist", "Other"] as const;
export type GroupName = (typeof GROUP_ORDER)[number];

export interface TreatmentGroup<T extends TreatmentLike = TreatmentLike> {
  name: GroupName;
  families: TreatmentFamily<T>[];
}

const LENGTH_SUFFIX = /\s*\(\s*\d+\s*(?:min|mins|minutes)\s*\)\s*$/i;

/** "Swedish massage (30 min)" -> "Swedish massage". */
export function baseName(name: string): string {
  return name.replace(LENGTH_SUFFIX, "").trim();
}

// Specialist first: "Indian head massage" and "Oncology massage" are
// specialist work even though they say "massage".
const RULES: [GroupName, RegExp][] = [
  ["Specialist", /reflexology|indian head|facial|lymphatic|oncology/i],
  ["Recovery", /hbot|hyperbaric|infrared|red light|pemf|hifem|cryo|sauna|compression/i],
  ["Massage", /massage|cupping|hot lava|pamper/i],
];

export function groupFor(name: string): GroupName {
  for (const [group, pattern] of RULES) if (pattern.test(name)) return group;
  return "Other";
}

/** Inside the Massage group the heading already says massage: "Swedish massage" -> "Swedish". */
export function tileLabel(name: string, group: GroupName): string {
  if (group !== "Massage") return name;
  return name.replace(/\s+massage$/i, "").trim() || name;
}

/** Groups in GROUP_ORDER, empty groups left out; families in the order their first treatment arrived. */
export function groupTreatments<T extends TreatmentLike>(treatments: T[]): TreatmentGroup<T>[] {
  const families = new Map<string, { name: string; options: T[] }>();
  for (const t of treatments) {
    const name = baseName(t.name);
    const key = name.toLowerCase();
    const family = families.get(key);
    if (family) family.options.push(t);
    else families.set(key, { name, options: [t] });
  }

  const byGroup = new Map<GroupName, TreatmentFamily<T>[]>();
  for (const [key, f] of families) {
    const group = groupFor(f.name);
    const options = [...f.options].sort((a, b) => a.defaultDurationMinutes - b.defaultDurationMinutes);
    const primary = f.options.find((o) => o.name.trim().toLowerCase() === key) ?? options[0];
    const family: TreatmentFamily<T> = { key, name: f.name, label: tileLabel(f.name, group), options, primary };
    const list = byGroup.get(group);
    if (list) list.push(family);
    else byGroup.set(group, [family]);
  }

  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ name: g, families: byGroup.get(g)! }));
}

/** The family a therapy id belongs to, or null. */
export function familyOf<T extends TreatmentLike>(groups: TreatmentGroup<T>[], therapyId: number | null): TreatmentFamily<T> | null {
  if (therapyId == null) return null;
  for (const g of groups) for (const f of g.families) if (f.options.some((o) => o.id === therapyId)) return f;
  return null;
}

/** Groups narrowed to families whose name, tile label or any option name contains the query. */
export function filterGroups<T extends TreatmentLike>(groups: TreatmentGroup<T>[], query: string): TreatmentGroup<T>[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({
      name: g.name,
      families: g.families.filter(
        (f) => f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q) || f.options.some((o) => o.name.toLowerCase().includes(q)),
      ),
    }))
    .filter((g) => g.families.length > 0);
}

/** What a tile click selects: the length a prepaid package covers when there is one, else the primary. */
export function pickOption<T extends TreatmentLike>(family: TreatmentFamily<T>, prepaidTherapyIds: ReadonlySet<number>): T {
  return family.options.find((o) => prepaidTherapyIds.has(o.id)) ?? family.primary;
}

/** The tile's small print: "60 min · €80" for one length, "from €50" for several. */
export function priceHint(family: TreatmentFamily): string {
  if (family.options.length === 1) {
    const only = family.options[0];
    return `${only.defaultDurationMinutes} min · ${euro(only.defaultPriceEur)}`;
  }
  return `from ${euro(Math.min(...family.options.map((o) => o.defaultPriceEur)))}`;
}

/** One Length switch button: "30 min · €50". */
export function lengthLabel(option: TreatmentLike): string {
  return `${option.defaultDurationMinutes} min · ${euro(option.defaultPriceEur)}`;
}
