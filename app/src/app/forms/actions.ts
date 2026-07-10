"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import {
  deleteForm,
  duplicateForm,
  saveForm,
  setFormDefault,
  setFormStatus,
  setFormTriggerStatus,
} from "@/lib/forms";
import type { FormInput } from "@/lib/formsModel";

const questionSchema = z.object({
  id: z.number().int().positive().optional(),
  section: z.string().trim().max(40).default("main"),
  label: z.string().trim().max(300),
  fieldType: z.enum(["number", "short", "long", "dropdown", "photo", "video", "metric"]),
  options: z.array(z.string().trim().max(120)).max(40).default([]),
  required: z.coerce.boolean(),
  isMetric: z.coerce.boolean(),
});
const formSchema = z.object({
  id: z.number().int().positive().optional(),
  type: z.enum(["initial", "checkin", "habits", "contact", "terms"]),
  title: z.string().trim().min(1, "Give the form a title.").max(200),
  isDefault: z.coerce.boolean(),
  status: z.coerce.boolean(),
  triggerStatus: z.coerce.boolean(),
  content: z.string().max(40000).nullable().default(null),
  questions: z.array(questionSchema).max(200),
});

export type SaveResult = { ok: true; id: number } | { ok: false; error: string };

export async function saveFormAction(raw: unknown): Promise<SaveResult> {
  await requireUser();
  const parsed = formSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid form." };
  const id = saveForm(parsed.data as FormInput);
  revalidatePath(`/forms/${parsed.data.type}`);
  revalidatePath(`/forms/${parsed.data.type}/${id}`);
  return { ok: true, id };
}

const idSchema = z.coerce.number().int().positive();

export async function deleteFormAction(id: number, type: string) {
  await requireUser();
  const p = idSchema.safeParse(id);
  if (!p.success) return;
  deleteForm(p.data);
  revalidatePath(`/forms/${type}`);
}

export async function setFormStatusAction(id: number, status: boolean, type: string) {
  await requireUser();
  const p = idSchema.safeParse(id);
  if (!p.success) return;
  setFormStatus(p.data, Boolean(status));
  revalidatePath(`/forms/${type}`);
}

export async function setFormTriggerStatusAction(id: number, status: boolean, type: string) {
  await requireUser();
  const p = idSchema.safeParse(id);
  if (!p.success) return;
  setFormTriggerStatus(p.data, Boolean(status));
  revalidatePath(`/forms/${type}`);
}

export async function setFormDefaultAction(id: number, type: string) {
  await requireUser();
  const p = idSchema.safeParse(id);
  if (!p.success) return;
  setFormDefault(p.data);
  revalidatePath(`/forms/${type}`);
}

export async function duplicateFormAction(id: number, type: string): Promise<SaveResult> {
  await requireUser();
  const p = idSchema.safeParse(id);
  if (!p.success) return { ok: false, error: "Invalid id." };
  const newId = duplicateForm(p.data);
  if (!newId) return { ok: false, error: "Form not found." };
  revalidatePath(`/forms/${type}`);
  return { ok: true, id: newId };
}
