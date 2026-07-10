import "server-only";

import { asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  nutritionDays,
  nutritionFoods,
  nutritionMeals,
  nutritionPlans,
} from "@/lib/db/schema";
import {
  planDisplayTotals,
  type DayInput,
  type MacroMode,
  type Macros,
  type PlanInput,
  type PlanStatus,
} from "@/lib/nutritionModel";

function parseTags(csv: string | null): string[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export interface PlanListRow {
  id: number;
  title: string;
  type: PlanInput["type"];
  macroMode: MacroMode | null;
  status: PlanStatus;
  tags: string[];
  updatedAt: number;
  dayCount: number;
  totals: Macros;
  uploadOriginalName: string | null;
}

/** All plans with computed display macros (first day totals). */
export function listPlans(): PlanListRow[] {
  const plans = db.select().from(nutritionPlans).orderBy(desc(nutritionPlans.updatedAt)).all();
  if (plans.length === 0) return [];

  const planIds = plans.map((p) => p.id);
  const days = db.select().from(nutritionDays).where(inArray(nutritionDays.planId, planIds)).all();
  const dayIds = days.map((d) => d.id);
  const meals = dayIds.length
    ? db.select().from(nutritionMeals).where(inArray(nutritionMeals.dayId, dayIds)).all()
    : [];
  const mealIds = meals.map((m) => m.id);
  const foods = mealIds.length
    ? db.select().from(nutritionFoods).where(inArray(nutritionFoods.mealId, mealIds)).all()
    : [];

  const foodsByMeal = new Map<number, typeof foods>();
  for (const f of foods) {
    const arr = foodsByMeal.get(f.mealId) ?? [];
    arr.push(f);
    foodsByMeal.set(f.mealId, arr);
  }
  const mealsByDay = new Map<number, typeof meals>();
  for (const m of meals) {
    const arr = mealsByDay.get(m.dayId) ?? [];
    arr.push(m);
    mealsByDay.set(m.dayId, arr);
  }
  const daysByPlan = new Map<number, typeof days>();
  for (const d of days) {
    const arr = daysByPlan.get(d.planId) ?? [];
    arr.push(d);
    daysByPlan.set(d.planId, arr);
  }

  return plans.map((p) => {
    const planDays: DayInput[] = (daysByPlan.get(p.id) ?? [])
      .sort((a, b) => a.position - b.position)
      .map((d) => ({
        name: d.name,
        notes: d.notes,
        protein: d.protein,
        carbs: d.carbs,
        fat: d.fat,
        calories: d.calories,
        meals: (mealsByDay.get(d.id) ?? [])
          .sort((a, b) => a.position - b.position)
          .map((m) => ({
            name: m.name,
            notes: m.notes,
            protein: m.protein,
            carbs: m.carbs,
            fat: m.fat,
            calories: m.calories,
            foods: (foodsByMeal.get(m.id) ?? [])
              .sort((a, b) => a.position - b.position)
              .map((f) => ({
                name: f.name,
                quantity: f.quantity,
                unit: f.unit,
                protein: f.protein,
                carbs: f.carbs,
                fat: f.fat,
                calories: f.calories,
              })),
          })),
      }));
    return {
      id: p.id,
      title: p.title,
      type: p.type,
      macroMode: p.macroMode,
      status: p.status,
      tags: parseTags(p.tags),
      updatedAt: p.updatedAt.getTime(),
      dayCount: planDays.length,
      totals: planDisplayTotals({ type: p.type, macroMode: p.macroMode, days: planDays }),
      uploadOriginalName: p.uploadOriginalName,
    };
  });
}

/** One plan assembled into the builder's PlanInput shape (with ids), or null. */
export function getPlan(id: number): PlanInput | null {
  const plan = db.select().from(nutritionPlans).where(eq(nutritionPlans.id, id)).get();
  if (!plan) return null;

  const days = db
    .select()
    .from(nutritionDays)
    .where(eq(nutritionDays.planId, id))
    .orderBy(asc(nutritionDays.position))
    .all();
  const dayIds = days.map((d) => d.id);
  const meals = dayIds.length
    ? db
        .select()
        .from(nutritionMeals)
        .where(inArray(nutritionMeals.dayId, dayIds))
        .orderBy(asc(nutritionMeals.position))
        .all()
    : [];
  const mealIds = meals.map((m) => m.id);
  const foods = mealIds.length
    ? db
        .select()
        .from(nutritionFoods)
        .where(inArray(nutritionFoods.mealId, mealIds))
        .orderBy(asc(nutritionFoods.position))
        .all()
    : [];

  return {
    id: plan.id,
    title: plan.title,
    type: plan.type,
    macroMode: plan.macroMode,
    status: plan.status,
    tags: parseTags(plan.tags),
    notes: plan.notes,
    uploadFilename: plan.uploadFilename,
    uploadOriginalName: plan.uploadOriginalName,
    days: days.map((d) => ({
      id: d.id,
      name: d.name,
      notes: d.notes,
      protein: d.protein,
      carbs: d.carbs,
      fat: d.fat,
      calories: d.calories,
      meals: meals
        .filter((m) => m.dayId === d.id)
        .map((m) => ({
          id: m.id,
          name: m.name,
          notes: m.notes,
          protein: m.protein,
          carbs: m.carbs,
          fat: m.fat,
          calories: m.calories,
          foods: foods
            .filter((f) => f.mealId === m.id)
            .map((f) => ({
              id: f.id,
              name: f.name,
              quantity: f.quantity,
              unit: f.unit,
              protein: f.protein,
              carbs: f.carbs,
              fat: f.fat,
              calories: f.calories,
            })),
        })),
    })),
  };
}

/** Create or update a plan and fully replace its day/meal/food tree. Returns the id. */
export function savePlan(input: PlanInput): number {
  return db.transaction((tx) => {
    const tags = input.tags.map((t) => t.trim()).filter(Boolean).join(",") || null;
    const base = {
      title: input.title.trim() || "New Nutrition Plan",
      type: input.type,
      macroMode: input.macroMode,
      status: input.status,
      tags,
      notes: input.notes,
      uploadFilename: input.uploadFilename,
      uploadOriginalName: input.uploadOriginalName,
      updatedAt: new Date(),
    };

    let planId = input.id ?? 0;
    if (planId) {
      tx.update(nutritionPlans).set(base).where(eq(nutritionPlans.id, planId)).run();
      // wipe existing tree (cascade removes meals/foods)
      tx.delete(nutritionDays).where(eq(nutritionDays.planId, planId)).run();
    } else {
      const [row] = tx.insert(nutritionPlans).values(base).returning({ id: nutritionPlans.id }).all();
      planId = row.id;
    }

    input.days.forEach((day, di) => {
      const [dayRow] = tx
        .insert(nutritionDays)
        .values({
          planId,
          name: day.name.trim() || `Day ${di + 1}`,
          position: di,
          notes: day.notes,
          protein: day.protein,
          carbs: day.carbs,
          fat: day.fat,
          calories: day.calories,
        })
        .returning({ id: nutritionDays.id })
        .all();
      day.meals.forEach((meal, mi) => {
        const [mealRow] = tx
          .insert(nutritionMeals)
          .values({
            dayId: dayRow.id,
            name: meal.name.trim() || `Meal ${mi + 1}`,
            position: mi,
            notes: meal.notes,
            protein: meal.protein,
            carbs: meal.carbs,
            fat: meal.fat,
            calories: meal.calories,
          })
          .returning({ id: nutritionMeals.id })
          .all();
        meal.foods.forEach((food, fi) => {
          if (!food.name.trim()) return;
          tx.insert(nutritionFoods)
            .values({
              mealId: mealRow.id,
              name: food.name.trim(),
              quantity: food.quantity,
              unit: food.unit,
              protein: food.protein,
              carbs: food.carbs,
              fat: food.fat,
              calories: food.calories,
              position: fi,
            })
            .run();
        });
      });
    });

    return planId;
  });
}

export function deletePlan(id: number) {
  db.delete(nutritionPlans).where(eq(nutritionPlans.id, id)).run();
}

export function setPlanStatus(id: number, status: PlanStatus) {
  db.update(nutritionPlans)
    .set({ status, updatedAt: new Date() })
    .where(eq(nutritionPlans.id, id))
    .run();
}

export function duplicatePlan(id: number): number | null {
  const plan = getPlan(id);
  if (!plan) return null;
  return savePlan({
    ...plan,
    id: undefined,
    title: `${plan.title} (copy)`,
    status: "active",
  });
}
