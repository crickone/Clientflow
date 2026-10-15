/**
 * Meal logging in the client app: what the AI reads from a photo of a meal or
 * a food label, cleaned into numbers the app can trust; the day's totals; and
 * the target from the client's plan. Pure, so tested without a model or DB.
 */

export type MealItem = {
  name: string;
  /** How much, in words the client can check against the plate: "1 breast, palm-sized", "a cupped handful". */
  portion: string | null;
  grams: number | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

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
  /** How it was worked out: what gave the scale, what was assumed. Two or three short sentences. */
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
      portion: str(x.portion, 60) || null,
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
    notes: str(o.notes, 400) || null,
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

/** One item the client adds in words ("a tablespoon of pumpkin seeds"), as the AI priced it. Null when it isn't food. */
export function parseMealItem(raw: string): MealItem | null {
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
  if (o.food === false) return null;
  const name = str(o.name, 60);
  if (!name) return null;
  return {
    name,
    portion: str(o.portion, 60) || null,
    grams: o.grams === null || o.grams === undefined ? null : num(o.grams, 5000) || null,
    calories: num(o.calories),
    protein: num(o.protein, 1000),
    carbs: num(o.carbs, 1000),
    fat: num(o.fat, 1000),
  };
}

/**
 * Several items in one answer: {"items":[...]}, a bare [...], or a single
 * item object. Each is read as parseMealItem reads one; at most 12. Empty when
 * none of it is food.
 */
export function parseMealItems(raw: string): MealItem[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let v: unknown;
  try {
    v = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (!m) return [];
    try {
      v = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  const list = Array.isArray(v) ? v : v && typeof v === "object" && Array.isArray((v as { items?: unknown }).items) ? (v as { items: unknown[] }).items : [v];
  return list
    .slice(0, 12)
    .map((x) => parseMealItem(JSON.stringify(x)))
    .filter((x): x is MealItem => x !== null);
}

/** The same item at a different weight: everything scales with the grams. */
export function scaleItem(item: MealItem, grams: number): MealItem {
  if (!item.grams || item.grams <= 0 || !Number.isFinite(grams) || grams <= 0) return item;
  const k = Math.min(50, grams / item.grams);
  return {
    ...item,
    grams: Math.round(grams),
    portion: null, // the words no longer describe it
    calories: Math.round(item.calories * k),
    protein: Math.round(item.protein * k),
    carbs: Math.round(item.carbs * k),
    fat: Math.round(item.fat * k),
  };
}

/** Totals after an item is added (+) or removed (-): a meal's numbers move by exactly that item. */
export function applyItemDelta(t: MealTotals, item: MealTotals, sign: 1 | -1): MealTotals {
  const f = (a: number, b: number) => Math.max(0, Math.round(a + sign * b));
  return { calories: f(t.calories, item.calories), protein: f(t.protein, item.protein), carbs: f(t.carbs, item.carbs), fat: f(t.fat, item.fat) };
}

// ── the breakdown: how a meal's numbers were worked out, item by item ──

/** An item's numbers per 100 g, the figure its calories were scaled from. Null without a weight. */
export function per100(item: MealItem): MealTotals | null {
  if (!item.grams || item.grams <= 0) return null;
  const k = 100 / item.grams;
  return { calories: Math.round(item.calories * k), protein: Math.round(item.protein * k * 10) / 10, carbs: Math.round(item.carbs * k * 10) / 10, fat: Math.round(item.fat * k * 10) / 10 };
}

/** What the items add up to. */
export function itemsTotal(items: MealTotals[]): MealTotals {
  return dayTotals(items);
}

/**
 * The part of the meal's numbers no item accounts for: oil in the pan, a
 * sauce the photo couldn't separate, rounding. Null when it's under 5 kcal
 * and 1 g of each, which is just rounding.
 */
export function unaccounted(meal: MealTotals, items: MealTotals[]): MealTotals | null {
  if (items.length === 0) return null;
  const s = itemsTotal(items);
  const d = { calories: Math.round(meal.calories - s.calories), protein: Math.round(meal.protein - s.protein), carbs: Math.round(meal.carbs - s.carbs), fat: Math.round(meal.fat - s.fat) };
  return Math.abs(d.calories) < 5 && Math.abs(d.protein) <= 1 && Math.abs(d.carbs) <= 1 && Math.abs(d.fat) <= 1 ? null : d;
}

/** An item as the member edited it: names trimmed, numbers whole and sane. Null when it can't be saved. */
export function cleanItemEdit(prev: MealItem, patch: { name: string; grams: number | null; calories: number; protein: number; carbs: number; fat: number }): MealItem | null {
  const name = patch.name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) return null;
  const n = (v: number, max: number) => (Number.isFinite(v) ? Math.min(max, Math.max(0, Math.round(v))) : NaN);
  const grams = patch.grams === null ? null : n(patch.grams, 5000);
  const out = { calories: n(patch.calories, 5000), protein: n(patch.protein, 500), carbs: n(patch.carbs, 1000), fat: n(patch.fat, 500) };
  if ([out.calories, out.protein, out.carbs, out.fat].some(Number.isNaN) || (grams !== null && (Number.isNaN(grams) || grams < 1))) return null;
  const sameWeight = grams === prev.grams;
  return { name, portion: sameWeight ? prev.portion : null, grams, ...out };
}

/** A line that names several foods or a mixed dish, worth offering to split into its ingredients. */
export function looksMixed(name: string): boolean {
  return /[\/,+&]|\b(with|and|base|mix|blend)\b|porridge|overnight oats|oats|salad|smoothie|bowl|sandwich|wrap|stir.?fry|curry|stew|casserole|full irish|breakfast/i.test(name);
}

// ── which day a meal goes to ──

/**
 * When the member logs a meal while looking at an earlier day, it goes to
 * that day (at the same time of day as now). Today, a future day or anything
 * more than 60 days back logs to now.
 */
export function loggedAtFor(day: string | null | undefined, now: number, todayKey: string): number {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= todayKey) return now;
  const [y, m, d] = day.split("-").map(Number);
  const [ty, tm, td] = todayKey.split("-").map(Number);
  const daysBack = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86_400_000);
  if (daysBack <= 0 || daysBack > 60) return now;
  return now - daysBack * 86_400_000;
}

/** The Monday-to-Sunday week a day falls in, as seven "YYYY-MM-DD" keys. */
export function weekOf(day: string): string[] {
  const [y, m, d] = day.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const dow = new Date(base).getUTCDay(); // 0 = Sunday
  const monday = base - ((dow + 6) % 7) * 86_400_000;
  return Array.from({ length: 7 }, (_, i) => new Date(monday + i * 86_400_000).toISOString().slice(0, 10));
}

// ── the coach's view: a run of days at a glance ──

export type DaySummary = MealTotals & { day: string; meals: number };

export type PeriodSummary = {
  days: DaySummary[];
  /** Days with at least one meal logged. */
  daysLogged: number;
  /** Averages over the days that were logged, so a skipped day doesn't drag them down. */
  average: MealTotals | null;
  /** Logged days within 10% of the calorie target, and at 90% or more of the protein target. Null without a target. */
  onCalories: number | null;
  onProtein: number | null;
};

/** Totals per day for the given days (in order), with averages over the logged ones and how many hit the target. */
export function summarisePeriod(days: string[], meals: ({ day: string } & MealTotals)[], target: MealTotals | null): PeriodSummary {
  const out: DaySummary[] = days.map((day) => {
    const mine = meals.filter((m) => m.day === day);
    const t = dayTotals(mine);
    return { day, meals: mine.length, calories: Math.round(t.calories), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat) };
  });
  const logged = out.filter((d) => d.meals > 0);
  const sum = dayTotals(logged);
  const n = logged.length;
  const average = n ? { calories: Math.round(sum.calories / n), protein: Math.round(sum.protein / n), carbs: Math.round(sum.carbs / n), fat: Math.round(sum.fat / n) } : null;
  const onCalories = target && target.calories > 0 ? logged.filter((d) => Math.abs(d.calories - target.calories) <= target.calories * 0.1).length : null;
  const onProtein = target && target.protein > 0 ? logged.filter((d) => d.protein >= target.protein * 0.9).length : null;
  return { days: out, daysLogged: n, average, onCalories, onProtein };
}
