/**
 * Meal logging in the client app: what the AI reads from a photo of a meal or
 * a food label, cleaned into numbers the app can trust; the day's totals; and
 * the target from the client's plan. Pure, so tested without a model or DB.
 */

export type MealItem = { name: string; grams: number | null; calories: number; protein: number; carbs: number; fat: number };

export type MealKind = "meal" | "label" | "manual";
export type Confidence = "high" | "medium" | "low";

export type MealReading = {
  kind: "meal" | "label";
  name: string;
  items: MealItem[];
  /** Per serving for a label; for the whole plate for a meal. */
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** For a label: what one serving is ("30 g", "1 bar"), if it says. */
  serving: string | null;
  confidence: Confidence;
  /** One short line on how it was worked out or what was assumed. */
  notes: string | null;
};

export type MealTotals = { calories: number; protein: number; carbs: number; fat: number };

const num = (v: unknown, max = 10000): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(max, Math.round(n));
};
const str = (v: unknown, max = 120): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Strip a code fence and parse the model's JSON. Null when it isn't a reading at all. */
export function parseMealReading(raw: string): MealReading | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let v: unknown;
  try {
    v = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      v = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.food === false || o.kind === "none") return null;
  const items: MealItem[] = (Array.isArray(o.items) ? o.items : [])
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .map((x) => ({
      name: str(x.name, 60),
      grams: x.grams === null || x.grams === undefined ? null : num(x.grams, 5000) || null,
      calories: num(x.calories),
      protein: num(x.protein, 1000),
      carbs: num(x.carbs, 1000),
      fat: num(x.fat, 1000),
    }))
    .filter((x) => x.name)
    .slice(0, 12);
  const name = str(o.name, 80) || (items[0]?.name ?? "");
  if (!name) return null;
  // Totals: the model's, or the sum of its items when it left them out.
  const sum = (k: keyof MealTotals) => items.reduce((s, i) => s + i[k], 0);
  const calories = num(o.calories) || sum("calories");
  const confidence: Confidence = o.confidence === "high" || o.confidence === "low" ? o.confidence : "medium";
  return {
    kind: o.kind === "label" ? "label" : "meal",
    name,
    items,
    calories,
    protein: num(o.protein, 1000) || sum("protein"),
    carbs: num(o.carbs, 1000) || sum("carbs"),
    fat: num(o.fat, 1000) || sum("fat"),
    serving: str(o.serving, 40) || null,
    confidence,
    notes: str(o.notes, 200) || null,
  };
}

/** A label reading times the servings eaten. */
export function scaleReading(r: MealTotals, servings: number): MealTotals {
  const k = Number.isFinite(servings) && servings > 0 ? Math.min(20, servings) : 1;
  return { calories: Math.round(r.calories * k), protein: Math.round(r.protein * k), carbs: Math.round(r.carbs * k), fat: Math.round(r.fat * k) };
}

export function dayTotals(meals: MealTotals[]): MealTotals {
  return meals.reduce(
    (t, m) => ({ calories: t.calories + m.calories, protein: t.protein + m.protein, carbs: t.carbs + m.carbs, fat: t.fat + m.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/** Calories as people read them: "1,240 kcal". */
export function kcal(n: number): string {
  return `${Math.round(n).toLocaleString("en-IE")} kcal`;
}

/** "Breakfast", "Lunch", "Dinner" or "Snack" from the Irish time of day, for a logged meal's default name. */
export function mealSlot(ms: number): string {
  const h = Number(new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", hour: "2-digit", hour12: false }).format(ms));
  if (h < 11) return "Breakfast";
  if (h < 15) return "Lunch";
  if (h < 21) return "Dinner";
  return "Snack";
}
