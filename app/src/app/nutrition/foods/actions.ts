"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deleteFood, saveFood, type FoodInputLib } from "@/lib/nutritionLibrary";

const num = z.coerce.number().finite().min(0).max(1_000_000).catch(0);

const schema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1, "Give the food a name.").max(160),
  category: z.string().trim().max(80).nullable().default(null),
  servingSize: z.coerce.number().finite().min(0).max(100000).catch(100),
  servingUnit: z.string().trim().min(1).max(30).default("g"),
  protein: num,
  carbs: num,
  fat: num,
  calories: num,
});

export type FoodResult = { ok: true; id: number } | { ok: false; error: string };

export async function saveFoodAction(raw: unknown): Promise<FoodResult> {
  await requireUser();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid food." };
  const id = saveFood(parsed.data as FoodInputLib);
  revalidatePath("/nutrition/foods");
  revalidatePath("/nutrition/meals");
  return { ok: true, id };
}

export async function deleteFoodAction(id: number) {
  await requireUser();
  const p = z.coerce.number().int().positive().safeParse(id);
  if (!p.success) return;
  deleteFood(p.data);
  revalidatePath("/nutrition/foods");
}
