import "server-only";

import { asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { foodLibrary, mealTemplateItems, mealTemplates } from "@/lib/db/schema";
import type { Macros } from "@/lib/nutritionModel";

// ── Foods ─────────────────────────────────────────────────────────────────────

export interface FoodInputLib {
  id?: number;
  name: string;
  category: string | null;
  servingSize: number;
  servingUnit: string;
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
}

export interface FoodRow {
  id: number;
  name: string;
  category: string | null;
  servingSize: number;
  servingUnit: string;
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
}

export function listFoods(): FoodRow[] {
  return db.select().from(foodLibrary).orderBy(asc(foodLibrary.name)).all();
}

export function saveFood(input: FoodInputLib): number {
  const base = {
    name: input.name.trim(),
    category: input.category?.trim() || null,
    servingSize: input.servingSize,
    servingUnit: input.servingUnit.trim() || "g",
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    calories: input.calories,
    updatedAt: new Date(),
  };
  if (input.id) {
    db.update(foodLibrary).set(base).where(eq(foodLibrary.id, input.id)).run();
    return input.id;
  }
  const [row] = db.insert(foodLibrary).values(base).returning({ id: foodLibrary.id }).all();
  return row.id;
}

export function deleteFood(id: number) {
  db.delete(foodLibrary).where(eq(foodLibrary.id, id)).run();
}

// ── Meals (reusable meal templates built from foods) ──────────────────────────

export interface MealItemInput {
  id?: number;
  foodId: number | null;
  name: string;
  quantity: number;
  unit: string | null;
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
}

export interface MealInputLib {
  id?: number;
  name: string;
  category: string | null;
  notes: string | null;
  items: MealItemInput[];
}

export interface MealRow {
  id: number;
  name: string;
  category: string | null;
  itemCount: number;
  totals: Macros;
  updatedAt: number;
}

function sumItems(items: { protein: number; carbs: number; fat: number; calories: number }[]): Macros {
  return items.reduce(
    (acc, i) => ({
      protein: acc.protein + i.protein,
      carbs: acc.carbs + i.carbs,
      fat: acc.fat + i.fat,
      calories: acc.calories + i.calories,
    }),
    { protein: 0, carbs: 0, fat: 0, calories: 0 },
  );
}

export function listMeals(): MealRow[] {
  const meals = db.select().from(mealTemplates).orderBy(desc(mealTemplates.updatedAt)).all();
  if (meals.length === 0) return [];
  const ids = meals.map((m) => m.id);
  const items = db
    .select()
    .from(mealTemplateItems)
    .where(inArray(mealTemplateItems.mealId, ids))
    .all();
  const byMeal = new Map<number, typeof items>();
  for (const it of items) {
    const arr = byMeal.get(it.mealId) ?? [];
    arr.push(it);
    byMeal.set(it.mealId, arr);
  }
  return meals.map((m) => {
    const its = byMeal.get(m.id) ?? [];
    return {
      id: m.id,
      name: m.name,
      category: m.category,
      itemCount: its.length,
      totals: sumItems(its),
      updatedAt: m.updatedAt.getTime(),
    };
  });
}

export function getMeal(id: number): MealInputLib | null {
  const meal = db.select().from(mealTemplates).where(eq(mealTemplates.id, id)).get();
  if (!meal) return null;
  const items = db
    .select()
    .from(mealTemplateItems)
    .where(eq(mealTemplateItems.mealId, id))
    .orderBy(asc(mealTemplateItems.position))
    .all();
  return {
    id: meal.id,
    name: meal.name,
    category: meal.category,
    notes: meal.notes,
    items: items.map((it) => ({
      id: it.id,
      foodId: it.foodId,
      name: it.name,
      quantity: it.quantity,
      unit: it.unit,
      protein: it.protein,
      carbs: it.carbs,
      fat: it.fat,
      calories: it.calories,
    })),
  };
}

export function saveMeal(input: MealInputLib): number {
  return db.transaction((tx) => {
    const base = {
      name: input.name.trim() || "New Meal",
      category: input.category?.trim() || null,
      notes: input.notes,
      updatedAt: new Date(),
    };
    let mealId = input.id ?? 0;
    if (mealId) {
      tx.update(mealTemplates).set(base).where(eq(mealTemplates.id, mealId)).run();
      tx.delete(mealTemplateItems).where(eq(mealTemplateItems.mealId, mealId)).run();
    } else {
      const [row] = tx.insert(mealTemplates).values(base).returning({ id: mealTemplates.id }).all();
      mealId = row.id;
    }
    input.items.forEach((it, i) => {
      if (!it.name.trim()) return;
      tx.insert(mealTemplateItems)
        .values({
          mealId,
          foodId: it.foodId,
          name: it.name.trim(),
          quantity: it.quantity,
          unit: it.unit,
          protein: it.protein,
          carbs: it.carbs,
          fat: it.fat,
          calories: it.calories,
          position: i,
        })
        .run();
    });
    return mealId;
  });
}

export function deleteMeal(id: number) {
  db.delete(mealTemplates).where(eq(mealTemplates.id, id)).run();
}
