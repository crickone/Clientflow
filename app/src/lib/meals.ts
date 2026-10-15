import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, gte, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { clientNutritionPlans, mealLogs, type MealLog } from "@/lib/db/schema";
import { getCurrentTenant } from "@/lib/db/tenant";
import { goalTarget } from "@/lib/goals";
import { GOAL_BY_KEY } from "@/lib/goalsModel";
import { getPlan } from "@/lib/nutrition";
import { dayTotals as planDayTotals } from "@/lib/nutritionModel";
import { dateKey } from "@/lib/trainingProgress";
import { applyItemDelta, dayTotals, scaleItem, type MealItem, type MealKind, type MealReading, type MealTotals } from "@/lib/mealsModel";

/** Meals a client logs in their app, for the CURRENT tenant (ambient `db`). */

export type MealRow = MealLog & { items: MealItem[] };

function withItems(m: MealLog): MealRow {
  let items: MealItem[] = [];
  try {
    items = JSON.parse(m.itemsJson) as MealItem[];
  } catch {
    items = [];
  }
  return { ...m, items };
}

// ── photos: data/tenants/<slug>/meals/<clientId>/<id>.jpg, served only to that client ──

function photoDir(clientId: number): string {
  const dir = path.join(process.cwd(), "data", "tenants", getCurrentTenant().slug, "meals", String(clientId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function savePhoto(clientId: number, bytes: Buffer, ext: "jpg" | "png" | "webp"): string {
  const name = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(photoDir(clientId), name), bytes);
  return name;
}

/** The absolute path of one of this client's photos, or null (never another client's, never a path outside the folder). */
export function photoPath(clientId: number, name: string): string | null {
  const safe = path.basename(name);
  if (safe !== name) return null;
  const full = path.join(photoDir(clientId), safe);
  return fs.existsSync(full) ? full : null;
}

// ── logging ──

export function logMeal(
  clientId: number,
  input: { reading: MealReading; servings: number; photo: string | null; loggedAt?: number } | { manual: { name: string } & MealTotals; loggedAt?: number },
): MealRow {
  const loggedAt = input.loggedAt ?? Date.now();
  const base = { clientId, day: dateKey(loggedAt), loggedAt, createdAt: new Date(), updatedAt: new Date() };
  let values;
  if ("manual" in input) {
    const m = input.manual;
    values = { ...base, name: m.name, itemsJson: "[]", calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, kind: "manual" as MealKind, servings: 1, confidence: null, notes: null, photo: null };
  } else {
    const r = input.reading;
    const k = r.kind === "label" ? Math.min(20, Math.max(0.25, input.servings || 1)) : 1;
    values = {
      ...base,
      name: r.name,
      itemsJson: JSON.stringify(r.items),
      calories: Math.round(r.calories * k),
      protein: Math.round(r.protein * k),
      carbs: Math.round(r.carbs * k),
      fat: Math.round(r.fat * k),
      kind: r.kind as MealKind,
      servings: k,
      confidence: r.confidence,
      notes: [r.serving && `Serving: ${r.serving}`, r.notes].filter(Boolean).join(" · ") || null,
      photo: input.photo,
    };
  }
  const [row] = db.insert(mealLogs).values(values).returning().all();
  return withItems(row);
}

export function updateMeal(clientId: number, id: number, patch: { name: string } & MealTotals): boolean {
  return (
    db
      .update(mealLogs)
      .set({ name: patch.name, calories: patch.calories, protein: patch.protein, carbs: patch.carbs, fat: patch.fat, updatedAt: new Date() })
      .where(and(eq(mealLogs.id, id), eq(mealLogs.clientId, clientId)))
      .run().changes > 0
  );
}

/** A label meal: change how many servings were eaten; the numbers scale from the per-serving values. */
export function setMealServings(clientId: number, id: number, servings: number): boolean {
  const row = db.select().from(mealLogs).where(and(eq(mealLogs.id, id), eq(mealLogs.clientId, clientId))).get();
  if (!row || row.kind !== "label") return false;
  const k = Math.min(20, Math.max(0.25, servings));
  const per = (v: number) => (row.servings > 0 ? v / row.servings : v);
  db.update(mealLogs)
    .set({
      servings: k,
      calories: Math.round(per(row.calories) * k),
      protein: Math.round(per(row.protein) * k),
      carbs: Math.round(per(row.carbs) * k),
      fat: Math.round(per(row.fat) * k),
      updatedAt: new Date(),
    })
    .where(eq(mealLogs.id, id))
    .run();
  return true;
}

export function deleteMeal(clientId: number, id: number): boolean {
  const row = db.select().from(mealLogs).where(and(eq(mealLogs.id, id), eq(mealLogs.clientId, clientId))).get();
  if (!row) return false;
  db.delete(mealLogs).where(eq(mealLogs.id, id)).run();
  if (row.photo) {
    const p = photoPath(clientId, row.photo);
    if (p) fs.rmSync(p, { force: true });
  }
  return true;
}

export function getMealName(clientId: number, id: number): string | null {
  return db.select({ name: mealLogs.name }).from(mealLogs).where(and(eq(mealLogs.id, id), eq(mealLogs.clientId, clientId))).get()?.name ?? null;
}

export function getMeal(clientId: number, id: number): MealRow | null {
  const row = db.select().from(mealLogs).where(and(eq(mealLogs.id, id), eq(mealLogs.clientId, clientId))).get();
  return row ? withItems(row) : null;
}

export function mealsForDay(clientId: number, day: string): MealRow[] {
  return db
    .select()
    .from(mealLogs)
    .where(and(eq(mealLogs.clientId, clientId), eq(mealLogs.day, day)))
    .orderBy(mealLogs.loggedAt)
    .all()
    .map(withItems);
}

/** Calories per day over a date range (inclusive), for the week strip. */
export function dailyCalories(clientId: number, fromDay: string, toDay: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of db
    .select({ day: mealLogs.day, calories: mealLogs.calories })
    .from(mealLogs)
    .where(and(eq(mealLogs.clientId, clientId), gte(mealLogs.day, fromDay), lte(mealLogs.day, toDay)))
    .all()) {
    out[m.day] = (out[m.day] ?? 0) + m.calories;
  }
  return out;
}

/**
 * The client's daily target. The goal they picked from their InBody scan
 * comes first (lib/goals.ts); otherwise their most recently assigned
 * nutrition plan: a "daily" macro plan's day total, or the average of a full
 * plan's days. Null when neither gives numbers.
 */
export function dailyTarget(clientId: number): MealTotals | null {
  const g = goalTarget(clientId);
  if (g) return { calories: g.target.calories, protein: g.target.protein, carbs: g.target.carbs, fat: g.target.fat };
  return planTarget(clientId);
}

/** Where the target comes from, for the label under it. */
export function targetSource(clientId: number): { kind: "goal"; label: string } | { kind: "plan" } | null {
  const g = goalTarget(clientId);
  if (g) return { kind: "goal", label: GOAL_BY_KEY[g.goal.goal].label };
  return planTarget(clientId) ? { kind: "plan" } : null;
}

function planTarget(clientId: number): MealTotals | null {
  const assigned = db
    .select({ planId: clientNutritionPlans.planId })
    .from(clientNutritionPlans)
    .where(eq(clientNutritionPlans.clientId, clientId))
    .orderBy(desc(clientNutritionPlans.assignedAt))
    .all();
  for (const a of assigned) {
    const plan = getPlan(a.planId);
    if (!plan || plan.type === "upload" || plan.days.length === 0) continue;
    const days = plan.days.map((d) => planDayTotals(d, plan.type, plan.macroMode)).filter((t) => t.calories > 0);
    if (days.length === 0) continue;
    const avg = dayTotals(days);
    const n = days.length;
    return { calories: Math.round(avg.calories / n), protein: Math.round(avg.protein / n), carbs: Math.round(avg.carbs / n), fat: Math.round(avg.fat / n) };
  }
  return null;
}

// ── fixing what's in a meal: the totals move by exactly the item changed ──

function writeItems(row: MealLog, items: MealItem[], totals: MealTotals, noteLine: string | null): void {
  const notes = noteLine ? [row.notes, noteLine].filter(Boolean).join(" · ").slice(0, 600) : row.notes;
  db.update(mealLogs)
    .set({ itemsJson: JSON.stringify(items), calories: totals.calories, protein: totals.protein, carbs: totals.carbs, fat: totals.fat, notes, updatedAt: new Date() })
    .where(eq(mealLogs.id, row.id))
    .run();
}

/** What the reader missed, priced from the client's words (lib/ai/priceItem) and added to the meal: one line per ingredient. */
export function addMealItems(clientId: number, id: number, added: MealItem[]): MealRow | null {
  const row = db.select().from(mealLogs).where(and(eq(mealLogs.id, id), eq(mealLogs.clientId, clientId))).get();
  if (!row || added.length === 0) return null;
  const items = [...withItems(row).items, ...added].slice(0, 30);
  const kept = items.slice(withItems(row).items.length);
  const totals = kept.reduce<MealTotals>((t, it) => applyItemDelta(t, it, 1), row);
  writeItems(row, items, totals, `${kept.map((i) => i.name).join(", ")} added by you`);
  return getMeal(clientId, id);
}

/** One line replaced by its raw ingredients (lib/ai/priceItem splitItem); the meal moves by the difference. */
export function splitMealItem(clientId: number, id: number, index: number, parts: MealItem[]): MealRow | null {
  const row = db.select().from(mealLogs).where(and(eq(mealLogs.id, id), eq(mealLogs.clientId, clientId))).get();
  if (!row || parts.length === 0) return null;
  const items = withItems(row).items;
  const item = items[index];
  if (!item) return null;
  const next = [...items.slice(0, index), ...parts, ...items.slice(index + 1)].slice(0, 30);
  const totals = parts.reduce<MealTotals>((t, it) => applyItemDelta(t, it, 1), applyItemDelta(row, item, -1));
  writeItems(row, next, totals, `${item.name} split into ingredients`);
  return getMeal(clientId, id);
}

export function removeMealItem(clientId: number, id: number, index: number): MealRow | null {
  const row = db.select().from(mealLogs).where(and(eq(mealLogs.id, id), eq(mealLogs.clientId, clientId))).get();
  if (!row) return null;
  const items = withItems(row).items;
  const item = items[index];
  if (!item) return null;
  writeItems(row, items.filter((_, i) => i !== index), applyItemDelta(row, item, -1), `${item.name} removed by you`);
  return getMeal(clientId, id);
}

/** Any of an item's numbers changed by the member; the meal moves by the difference. */
export function updateMealItem(clientId: number, id: number, index: number, next: MealItem): MealRow | null {
  const row = db.select().from(mealLogs).where(and(eq(mealLogs.id, id), eq(mealLogs.clientId, clientId))).get();
  if (!row) return null;
  const items = withItems(row).items;
  const item = items[index];
  if (!item) return null;
  const totals = applyItemDelta(applyItemDelta(row, item, -1), next, 1);
  writeItems(row, items.map((it, i) => (i === index ? next : it)), totals, `${next.name} changed by you`);
  return getMeal(clientId, id);
}
