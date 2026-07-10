// Pure nutrition model — types + macro math shared by the server data layer and
// the client builder (no server-only imports).

export type PlanType = "full" | "macro" | "upload";
export type MacroMode = "per_meal" | "daily";
export type PlanStatus = "active" | "archived";

export interface Macros {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
}

export interface FoodInput {
  id?: number;
  name: string;
  quantity: number;
  unit: string | null;
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
}
export interface MealInput {
  id?: number;
  name: string;
  notes: string | null;
  // used when macroMode = "per_meal"
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
  foods: FoodInput[];
}
export interface DayInput {
  id?: number;
  name: string;
  notes: string | null;
  // used when macroMode = "daily"
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
  meals: MealInput[];
}
export interface PlanInput {
  id?: number;
  title: string;
  type: PlanType;
  macroMode: MacroMode | null;
  status: PlanStatus;
  tags: string[];
  notes: string | null;
  uploadFilename: string | null;
  uploadOriginalName: string | null;
  days: DayInput[];
}

export const ZERO_MACROS: Macros = { protein: 0, carbs: 0, fat: 0, calories: 0 };

function add(a: Macros, b: Macros): Macros {
  return {
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
    calories: a.calories + b.calories,
  };
}

export function roundMacros(m: Macros): Macros {
  return {
    protein: Math.round(m.protein),
    carbs: Math.round(m.carbs),
    fat: Math.round(m.fat),
    calories: Math.round(m.calories),
  };
}

export function mealTotals(meal: MealInput, type: PlanType, macroMode: MacroMode | null): Macros {
  if (type === "full") {
    return meal.foods.reduce(
      (acc, f) =>
        add(acc, { protein: f.protein, carbs: f.carbs, fat: f.fat, calories: f.calories }),
      ZERO_MACROS,
    );
  }
  if (type === "macro" && macroMode === "per_meal") {
    return { protein: meal.protein, carbs: meal.carbs, fat: meal.fat, calories: meal.calories };
  }
  return ZERO_MACROS;
}

export function dayTotals(day: DayInput, type: PlanType, macroMode: MacroMode | null): Macros {
  if (type === "macro" && macroMode === "daily") {
    return { protein: day.protein, carbs: day.carbs, fat: day.fat, calories: day.calories };
  }
  return day.meals.reduce((acc, m) => add(acc, mealTotals(m, type, macroMode)), ZERO_MACROS);
}

/** Macros shown for the whole plan in the list — the first day's totals. */
export function planDisplayTotals(plan: {
  type: PlanType;
  macroMode: MacroMode | null;
  days: DayInput[];
}): Macros {
  if (plan.type === "upload" || plan.days.length === 0) return ZERO_MACROS;
  return dayTotals(plan.days[0], plan.type, plan.macroMode);
}

// ── blank scaffolds for the builder ───────────────────────────────────────────

export function blankFood(): FoodInput {
  return { name: "", quantity: 1, unit: "serving", protein: 0, carbs: 0, fat: 0, calories: 0 };
}
export function blankMeal(name = "Meal"): MealInput {
  return { name, notes: null, protein: 0, carbs: 0, fat: 0, calories: 0, foods: [] };
}
export function blankDay(name = "Day 1", withMeal = true): DayInput {
  return {
    name,
    notes: null,
    protein: 0,
    carbs: 0,
    fat: 0,
    calories: 0,
    meals: withMeal ? [blankMeal("Main Meal")] : [],
  };
}
export function blankPlan(type: PlanType, macroMode: MacroMode | null): PlanInput {
  const withMeal = type === "full" || (type === "macro" && macroMode === "per_meal");
  return {
    title: "New Nutrition Plan",
    type,
    macroMode,
    status: "active",
    tags: [],
    notes: null,
    uploadFilename: null,
    uploadOriginalName: null,
    days: type === "upload" ? [] : [blankDay("Day 1", withMeal)],
  };
}

export const PLAN_TYPE_LABEL: Record<PlanType, string> = {
  full: "Full Plan",
  macro: "Macro Plan",
  upload: "Uploaded Plan",
};
