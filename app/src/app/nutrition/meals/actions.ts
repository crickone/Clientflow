"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deleteMeal, getMeal, saveMeal, type MealInputLib } from "@/lib/nutritionLibrary";

const num = z.coerce.number().finite().min(0).max(1_000_000).catch(0);

const itemSchema = z.object({
  id: z.number().int().positive().optional(),
  foodId: z.number().int().positive().nullable().default(null),
  name: z.string().trim().max(200),
  quantity: z.coerce.number().finite().min(0).max(100000).catch(1),
  unit: z.string().trim().max(30).nullable().default(null),
  protein: num,
  carbs: num,
  fat: num,
  calories: num,
});

const schema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Give the meal a name.").max(160),
  category: z.string().trim().max(80).nullable().default(null),
  notes: z.string().trim().max(4000).nullable().default(null),
  items: z.array(itemSchema).max(100),
});

export type MealResult = { ok: true; id: number } | { ok: false; error: string };

export async function saveMealAction(raw: unknown): Promise<MealResult> {
  await requireUser();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid meal." };
  const id = saveMeal(parsed.data as MealInputLib);
  revalidatePath("/nutrition/meals");
  return { ok: true, id };
}

export async function getMealAction(id: number): Promise<MealInputLib | null> {
  await requireUser();
  const p = z.coerce.number().int().positive().safeParse(id);
  if (!p.success) return null;
  return getMeal(p.data);
}

export async function deleteMealAction(id: number) {
  await requireUser();
  const p = z.coerce.number().int().positive().safeParse(id);
  if (!p.success) return;
  deleteMeal(p.data);
  revalidatePath("/nutrition/meals");
}
