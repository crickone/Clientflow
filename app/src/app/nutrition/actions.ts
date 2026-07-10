"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { deletePlan, duplicatePlan, savePlan, setPlanStatus } from "@/lib/nutrition";
import type { PlanInput } from "@/lib/nutritionModel";

const num = z.coerce.number().finite().min(0).max(1_000_000).catch(0);

const foodSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().max(200),
  quantity: z.coerce.number().finite().min(0).max(100000).catch(1),
  unit: z.string().trim().max(40).nullable().default(null),
  protein: num,
  carbs: num,
  fat: num,
  calories: num,
});
const mealSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().max(120),
  notes: z.string().trim().max(4000).nullable().default(null),
  protein: num,
  carbs: num,
  fat: num,
  calories: num,
  foods: z.array(foodSchema).max(100),
});
const daySchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().max(120),
  notes: z.string().trim().max(4000).nullable().default(null),
  protein: num,
  carbs: num,
  fat: num,
  calories: num,
  meals: z.array(mealSchema).max(50),
});
const planSchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().trim().min(1, "Give the plan a title.").max(200),
  type: z.enum(["full", "macro", "upload"]),
  macroMode: z.enum(["per_meal", "daily"]).nullable().default(null),
  status: z.enum(["active", "archived"]).default("active"),
  tags: z.array(z.string().trim().max(80)).max(30).default([]),
  notes: z.string().trim().max(8000).nullable().default(null),
  uploadFilename: z.string().trim().max(300).nullable().default(null),
  uploadOriginalName: z.string().trim().max(300).nullable().default(null),
  days: z.array(daySchema).max(31),
});

export type SaveResult = { ok: true; id: number } | { ok: false; error: string };

export async function savePlanAction(raw: unknown): Promise<SaveResult> {
  await requireUser();
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid plan." };
  }
  const id = savePlan(parsed.data as PlanInput);
  revalidatePath("/nutrition");
  revalidatePath(`/nutrition/${id}`);
  return { ok: true, id };
}

const idSchema = z.coerce.number().int().positive();

export async function deletePlanAction(id: number) {
  await requireUser();
  const p = idSchema.safeParse(id);
  if (!p.success) return;
  deletePlan(p.data);
  revalidatePath("/nutrition");
}

export async function duplicatePlanAction(id: number): Promise<SaveResult> {
  await requireUser();
  const p = idSchema.safeParse(id);
  if (!p.success) return { ok: false, error: "Invalid id." };
  const newId = duplicatePlan(p.data);
  if (!newId) return { ok: false, error: "Plan not found." };
  revalidatePath("/nutrition");
  return { ok: true, id: newId };
}

export async function setPlanStatusAction(id: number, status: "active" | "archived") {
  await requireUser();
  const p = idSchema.safeParse(id);
  if (!p.success) return;
  setPlanStatus(p.data, status);
  revalidatePath("/nutrition");
}
