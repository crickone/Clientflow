import "server-only";

import { asc, eq, isNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { MAX_TABS_PER_USER, validateLayout } from "./catalog";
import { OVERVIEW_PRESET_KEY, PRESET_BY_KEY, presetAppliesTo, presetWidgets } from "./presets";
import { STORED_RANGE_KEYS, type StoredRangeKey } from "./range";
import type { Venue, WidgetRef } from "./types";

/**
 * Dashboard tab storage. A user's tabs resolve, in order, from:
 *   1. their own rows (user_id = them);
 *   2. the tenant's team default rows (user_id IS NULL);
 *   3. the platform Overview preset for the venue (in memory).
 * Reading never writes. Every mutation first materialises the resolved set
 * into the user's own rows (`ownRows`), then applies the change, so the
 * first edit is what forks a user off the team default.
 *
 * Tabs are addressed by INDEX (position order), which survives the copy.
 */

export interface DashboardTab {
  name: string;
  presetKey: string | null;
  range: StoredRangeKey;
  widgets: WidgetRef[];
}
export type TabSource = "own" | "team" | "platform";

const T = schema.dashboards;
const MAX_NAME = 40;

function parseWidgets(json: string): WidgetRef[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as WidgetRef[]) : [];
  } catch {
    return [];
  }
}

function asRange(v: string): StoredRangeKey {
  return (STORED_RANGE_KEYS as readonly string[]).includes(v) ? (v as StoredRangeKey) : "30d";
}

function toTab(r: schema.DashboardRow): DashboardTab {
  return { name: r.name, presetKey: r.presetKey, range: asRange(r.range), widgets: parseWidgets(r.widgets) };
}

function rowsFor(userId: number | null) {
  return db
    .select()
    .from(T)
    .where(userId === null ? isNull(T.userId) : eq(T.userId, userId))
    .orderBy(asc(T.position), asc(T.id))
    .all();
}

function platformTabs(venue: Venue): DashboardTab[] {
  const p = PRESET_BY_KEY.get(OVERVIEW_PRESET_KEY)!;
  return [{ name: p.name, presetKey: p.key, range: "30d", widgets: presetWidgets(p.key, venue)! }];
}

export function resolveTabs(userId: number, venue: Venue): { tabs: DashboardTab[]; source: TabSource } {
  const own = rowsFor(userId);
  if (own.length) return { tabs: own.map(toTab), source: "own" };
  const team = rowsFor(null);
  if (team.length) return { tabs: team.map(toTab), source: "team" };
  return { tabs: platformTabs(venue), source: "platform" };
}

function insertTabs(userId: number | null, list: DashboardTab[]): void {
  list.forEach((tab, i) => {
    db.insert(T)
      .values({
        userId,
        name: tab.name,
        presetKey: tab.presetKey,
        position: i,
        range: tab.range,
        widgets: JSON.stringify(tab.widgets),
      })
      .run();
  });
}

/** The user's own rows, copying the resolved set in first if they have none. */
function ownRows(userId: number, venue: Venue): schema.DashboardRow[] {
  const own = rowsFor(userId);
  if (own.length) return own;
  insertTabs(userId, resolveTabs(userId, venue).tabs);
  return rowsFor(userId);
}

function rowAt(userId: number, venue: Venue, index: number): schema.DashboardRow {
  const rows = ownRows(userId, venue);
  const row = rows[index];
  if (!row) throw new Error("That tab no longer exists.");
  return row;
}

function touch(id: number, patch: Partial<typeof T.$inferInsert>): void {
  db.update(T).set({ ...patch, updatedAt: new Date() }).where(eq(T.id, id)).run();
}

function renumber(rows: schema.DashboardRow[]): void {
  rows.forEach((r, i) => {
    if (r.position !== i) db.update(T).set({ position: i }).where(eq(T.id, r.id)).run();
  });
}

function cleanName(name: string): string {
  const n = name.trim().slice(0, MAX_NAME);
  if (!n) throw new Error("A tab needs a name.");
  return n;
}

export function saveTabWidgets(userId: number, venue: Venue, index: number, widgets: unknown): void {
  const clean = validateLayout(widgets);
  db.transaction(() => {
    const row = rowAt(userId, venue, index);
    touch(row.id, { widgets: JSON.stringify(clean) });
  });
}

export function setTabRange(userId: number, venue: Venue, index: number, range: string): void {
  if (!(STORED_RANGE_KEYS as readonly string[]).includes(range)) throw new Error(`Unsupported range ${range}.`);
  db.transaction(() => {
    const row = rowAt(userId, venue, index);
    touch(row.id, { range });
  });
}

export function addTab(
  userId: number,
  venue: Venue,
  input: { kind: "preset"; presetKey: string } | { kind: "blank" } | { kind: "duplicate"; index: number },
): number {
  return db.transaction(() => {
    const rows = ownRows(userId, venue);
    if (rows.length >= MAX_TABS_PER_USER) throw new Error(`You can have at most ${MAX_TABS_PER_USER} tabs.`);
    let tab: DashboardTab;
    if (input.kind === "preset") {
      const p = PRESET_BY_KEY.get(input.presetKey);
      if (!p) throw new Error("Unknown preset.");
      if (!presetAppliesTo(p, venue)) throw new Error("That preset is not available for this venue.");
      tab = { name: p.name, presetKey: p.key, range: "30d", widgets: presetWidgets(p.key, venue)! };
    } else if (input.kind === "duplicate") {
      const src = rows[input.index];
      if (!src) throw new Error("That tab no longer exists.");
      tab = { ...toTab(src), name: `${src.name} copy`.slice(0, MAX_NAME) };
    } else {
      tab = { name: "New tab", presetKey: null, range: "30d", widgets: [] };
    }
    db.insert(T)
      .values({
        userId,
        name: tab.name,
        presetKey: tab.presetKey,
        position: rows.length,
        range: tab.range,
        widgets: JSON.stringify(tab.widgets),
      })
      .run();
    return rows.length;
  });
}

export function renameTab(userId: number, venue: Venue, index: number, name: string): void {
  const clean = cleanName(name);
  db.transaction(() => {
    const row = rowAt(userId, venue, index);
    touch(row.id, { name: clean });
  });
}

export function deleteTab(userId: number, venue: Venue, index: number): void {
  db.transaction(() => {
    const rows = ownRows(userId, venue);
    if (rows.length <= 1) throw new Error("You can't delete your last tab.");
    const row = rows[index];
    if (!row) throw new Error("That tab no longer exists.");
    db.delete(T).where(eq(T.id, row.id)).run();
    renumber(rows.filter((r) => r.id !== row.id));
  });
}

export function moveTab(userId: number, venue: Venue, from: number, to: number): void {
  db.transaction(() => {
    const rows = ownRows(userId, venue);
    if (!rows[from] || to < 0 || to >= rows.length) throw new Error("That tab no longer exists.");
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    renumber(next);
  });
}

export function resetTab(userId: number, venue: Venue, index: number): void {
  db.transaction(() => {
    const row = rowAt(userId, venue, index);
    let widgets: WidgetRef[] | null = null;
    if (row.presetKey === OVERVIEW_PRESET_KEY) {
      const teamOverview = rowsFor(null).find((r) => r.presetKey === OVERVIEW_PRESET_KEY);
      if (teamOverview) widgets = parseWidgets(teamOverview.widgets);
    }
    if (!widgets && row.presetKey) widgets = presetWidgets(row.presetKey, venue);
    touch(row.id, { widgets: JSON.stringify(widgets ?? []) });
  });
}

/** Replace the team default set with copies of this user's current tabs. */
export function makeTeamDefault(userId: number, venue: Venue): void {
  db.transaction(() => {
    const mine = ownRows(userId, venue).map(toTab);
    db.delete(T).where(isNull(T.userId)).run();
    insertTabs(null, mine);
  });
}

export function clearTeamDefault(): void {
  db.delete(T).where(isNull(T.userId)).run();
}
