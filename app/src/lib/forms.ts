import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { formQuestions, forms } from "@/lib/db/schema";
import type { FieldType, FormInput, FormType, QuestionInput } from "@/lib/formsModel";

function parseOpts(csv: string | null): string[] {
  if (!csv) return [];
  return csv.split("|").map((s) => s.trim()).filter(Boolean);
}

export interface FormListRow {
  id: number;
  type: FormType;
  title: string;
  isDefault: boolean;
  status: boolean;
  triggerStatus: boolean;
  shareSlug: string | null;
  questionCount: number;
  createdAt: number;
  updatedAt: number;
}

export function listForms(type: FormType): FormListRow[] {
  const rows = db
    .select()
    .from(forms)
    .where(eq(forms.type, type))
    .orderBy(desc(forms.updatedAt))
    .all();
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const qs = db
    .select({ id: formQuestions.id, formId: formQuestions.formId })
    .from(formQuestions)
    .where(inArray(formQuestions.formId, ids))
    .all();
  const counts = new Map<number, number>();
  for (const q of qs) counts.set(q.formId, (counts.get(q.formId) ?? 0) + 1);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    isDefault: r.isDefault,
    status: r.status,
    triggerStatus: r.triggerStatus,
    shareSlug: r.shareSlug,
    questionCount: counts.get(r.id) ?? 0,
    createdAt: r.createdAt.getTime(),
    updatedAt: r.updatedAt.getTime(),
  }));
}

export function getForm(id: number): FormInput | null {
  const form = db.select().from(forms).where(eq(forms.id, id)).get();
  if (!form) return null;
  const qs = db
    .select()
    .from(formQuestions)
    .where(eq(formQuestions.formId, id))
    .orderBy(asc(formQuestions.position))
    .all();
  return {
    id: form.id,
    type: form.type,
    title: form.title,
    isDefault: form.isDefault,
    status: form.status,
    triggerStatus: form.triggerStatus,
    content: form.content,
    questions: qs.map((q) => ({
      id: q.id,
      section: q.section,
      label: q.label,
      fieldType: q.fieldType as FieldType,
      options: parseOpts(q.options),
      required: q.required,
      isMetric: q.isMetric,
    })),
  };
}

function randomSlug(): string {
  return `f-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function saveForm(input: FormInput): number {
  return db.transaction((tx) => {
    const slug =
      input.type === "contact"
        ? tx.select({ s: forms.shareSlug }).from(forms).where(eq(forms.id, input.id ?? 0)).get()?.s || randomSlug()
        : null;
    const base = {
      type: input.type,
      title: input.title.trim(),
      isDefault: input.isDefault,
      status: input.status,
      triggerStatus: input.triggerStatus,
      content: input.content,
      shareSlug: slug,
      updatedAt: new Date(),
    };
    let formId = input.id ?? 0;
    if (formId) {
      tx.update(forms).set(base).where(eq(forms.id, formId)).run();
      tx.delete(formQuestions).where(eq(formQuestions.formId, formId)).run();
    } else {
      const [row] = tx.insert(forms).values(base).returning({ id: forms.id }).all();
      formId = row.id;
    }
    // Only one default per type.
    if (input.isDefault) {
      tx.update(forms)
        .set({ isDefault: false })
        .where(and(eq(forms.type, input.type), eq(forms.isDefault, true)))
        .run();
      tx.update(forms).set({ isDefault: true }).where(eq(forms.id, formId)).run();
    }
    input.questions.forEach((q: QuestionInput, i) => {
      if (!q.label.trim()) return;
      tx.insert(formQuestions)
        .values({
          formId,
          section: q.section,
          label: q.label.trim(),
          fieldType: q.fieldType,
          options: q.options.length ? q.options.map((o) => o.trim()).filter(Boolean).join("|") : null,
          required: q.required,
          isMetric: q.isMetric,
          position: i,
        })
        .run();
    });
    return formId;
  });
}

export function deleteForm(id: number) {
  db.delete(forms).where(eq(forms.id, id)).run();
}

export function setFormStatus(id: number, status: boolean) {
  db.update(forms).set({ status, updatedAt: new Date() }).where(eq(forms.id, id)).run();
}

export function setFormTriggerStatus(id: number, triggerStatus: boolean) {
  db.update(forms).set({ triggerStatus, updatedAt: new Date() }).where(eq(forms.id, id)).run();
}

export function setFormDefault(id: number) {
  const form = db.select().from(forms).where(eq(forms.id, id)).get();
  if (!form) return;
  db.transaction((tx) => {
    tx.update(forms).set({ isDefault: false }).where(eq(forms.type, form.type)).run();
    tx.update(forms).set({ isDefault: true, updatedAt: new Date() }).where(eq(forms.id, id)).run();
  });
}

export function duplicateForm(id: number): number | null {
  const f = getForm(id);
  if (!f) return null;
  return saveForm({ ...f, id: undefined, title: `${f.title || "Form"} (copy)`, isDefault: false });
}
