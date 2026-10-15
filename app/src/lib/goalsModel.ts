import type { Metrics } from "@/lib/inbody/metrics";
import type { MealTotals } from "@/lib/mealsModel";

/**
 * A goal picked from an InBody scan: drop body fat, maintain, or build
 * muscle, each turned into a daily calorie and macro target. Pure, so the
 * client app, the coach's view and the tests all see the same numbers.
 *
 * How the numbers are made:
 *   BMR          the scanner's own figure when it printed one, else
 *                Katch-McArdle from lean mass (370 + 21.6 x kg lean).
 *   maintenance  BMR x an activity factor the client picks.
 *   goal         fat loss takes off 20% (never more than 500 kcal, never
 *                below BMR); building adds 10% (200-350 kcal); maintaining
 *                changes nothing.
 *   protein      by body weight: 2.0 g/kg losing, 1.6 maintaining, 1.8 building.
 *   fat          25% of calories (30% maintaining).
 *   carbs        whatever calories are left.
 */

export type GoalKey = "lose" | "maintain" | "build";
export type ActivityKey = "light" | "moderate" | "active";

export interface GoalDef {
  key: GoalKey;
  label: string;
  /** One plain sentence on what the target does. */
  line: string;
}

export const GOALS: GoalDef[] = [
  { key: "lose", label: "Drop body fat", line: "A steady deficit with enough protein to keep your muscle." },
  { key: "maintain", label: "Maintain", line: "Eat what you use. Good when you are happy where you are." },
  { key: "build", label: "Build muscle", line: "A small surplus so the extra goes to muscle, not fat." },
];

export const GOAL_BY_KEY = Object.fromEntries(GOALS.map((g) => [g.key, g])) as Record<GoalKey, GoalDef>;

export interface ActivityDef {
  key: ActivityKey;
  label: string;
  sub: string;
  factor: number;
}

export const ACTIVITIES: ActivityDef[] = [
  { key: "light", label: "1 to 2 days", sub: "a week of training", factor: 1.4 },
  { key: "moderate", label: "3 to 4 days", sub: "a week of training", factor: 1.55 },
  { key: "active", label: "5 or more", sub: "days a week, or an active job", factor: 1.75 },
];

export const ACTIVITY_BY_KEY = Object.fromEntries(ACTIVITIES.map((a) => [a.key, a])) as Record<ActivityKey, ActivityDef>;

export function isGoalKey(v: unknown): v is GoalKey {
  return v === "lose" || v === "maintain" || v === "build";
}

export function isActivityKey(v: unknown): v is ActivityKey {
  return v === "light" || v === "moderate" || v === "active";
}

/** Lean mass in kg from whatever the scan gave us, or null. */
export function leanMass(m: Metrics): number | null {
  if (m.ffm && m.ffm > 0) return m.ffm;
  if (m.weight && m.weight > 0 && m.pbf !== undefined && m.pbf >= 0 && m.pbf < 100) return m.weight * (1 - m.pbf / 100);
  return null;
}

/** Resting calories: the scanner's own BMR when sane, else from lean mass. Null when the scan has neither. */
export function bmrFrom(m: Metrics): { bmr: number; source: "scan" | "lean" } | null {
  if (m.bmr && m.bmr >= 600 && m.bmr <= 4000) return { bmr: Math.round(m.bmr), source: "scan" };
  const lean = leanMass(m);
  if (lean === null) return null;
  return { bmr: Math.round(370 + 21.6 * lean), source: "lean" };
}

export interface GoalTarget extends MealTotals {
  goal: GoalKey;
  activity: ActivityKey;
  bmr: number;
  bmrSource: "scan" | "lean";
  maintenance: number;
  /** Calories above (+) or below (-) maintenance. */
  delta: number;
}

const PROTEIN_PER_KG: Record<GoalKey, number> = { lose: 2.0, maintain: 1.6, build: 1.8 };
const FAT_SHARE: Record<GoalKey, number> = { lose: 0.25, maintain: 0.3, build: 0.25 };

/** The daily target for one goal from one scan, or null when the scan can't give a BMR. */
export function recommend(m: Metrics, goal: GoalKey, activity: ActivityKey): GoalTarget | null {
  const b = bmrFrom(m);
  if (!b) return null;
  const maintenance = Math.round(b.bmr * ACTIVITY_BY_KEY[activity].factor);
  let delta = 0;
  if (goal === "lose") delta = -Math.min(500, Math.round(maintenance * 0.2), Math.max(0, maintenance - b.bmr));
  if (goal === "build") delta = Math.min(350, Math.max(200, Math.round(maintenance * 0.1)));
  const calories = maintenance + delta;

  // Protein by body weight; a scan with lean mass but no weight falls back to lean x 2.2.
  const weight = m.weight && m.weight > 0 ? m.weight : null;
  const lean = leanMass(m);
  const protein = Math.round(weight ? weight * PROTEIN_PER_KG[goal] : (lean ?? 0) * 2.2);
  const fat = Math.round((calories * FAT_SHARE[goal]) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));

  return { goal, activity, bmr: b.bmr, bmrSource: b.source, maintenance, delta, calories, protein, carbs, fat };
}

/** All three options side by side, for the picker. */
export function recommendAll(m: Metrics, activity: ActivityKey): Record<GoalKey, GoalTarget> | null {
  const out = {} as Record<GoalKey, GoalTarget>;
  for (const g of GOALS) {
    const t = recommend(m, g.key, activity);
    if (!t) return null;
    out[g.key] = t;
  }
  return out;
}

/** "-400 kcal a day" / "+250 kcal a day" / "your maintenance". */
export function describeDelta(delta: number): string {
  if (delta === 0) return "your maintenance";
  return `${delta > 0 ? "+" : "-"}${Math.abs(delta).toLocaleString("en-IE")} kcal a day`;
}
