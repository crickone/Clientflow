import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { formSubmissions, forms } from "@/lib/db/schema";
import { getCurrentTenant } from "@/lib/db/tenant";
import { getForm } from "@/lib/forms";
import type { FormInput } from "@/lib/formsModel";
import { buildAnswers, insertFormSubmission, validateRequired, type Answer } from "@/lib/publicForms";
import { readKey, setKey } from "@/lib/settings";
import { dateKey } from "@/lib/trainingProgress";
import { checkinState, photoNames, type CheckinState } from "@/lib/memberChoicesModel";

/**
 * Weekly check-ins in the client app, for the CURRENT tenant (ambient `db`).
 * The business picks a Check-in form and a day; from that day a member sees
 * "Check-in due" until they send one. Photos are kept per member under
 * data/tenants/<slug>/checkins/<clientId>/ and shown only to that member and
 * the business's staff.
 */

export interface CheckinSettings {
  formId: number | null;
  /** 1 = Monday ... 7 = Sunday. */
  weekday: number;
}

const KEY = "app_checkins";

export function getCheckinSettings(): CheckinSettings {
  const s = readKey<Partial<CheckinSettings>>(KEY, {});
  const weekday = typeof s.weekday === "number" && s.weekday >= 1 && s.weekday <= 7 ? s.weekday : 1;
  return { formId: typeof s.formId === "number" ? s.formId : null, weekday };
}

export function setCheckinSettings(next: CheckinSettings): void {
  setKey(KEY, next);
}

/** The check-in form when one is set, switched on and has questions. */
export function checkinForm(settings = getCheckinSettings()): (FormInput & { id: number }) | null {
  if (!settings.formId) return null;
  const f = getForm(settings.formId);
  if (!f || !f.status || f.type !== "checkin" || f.questions.length === 0) return null;
  return f as FormInput & { id: number };
}

export function checkinChoices(): { id: number; title: string; status: boolean }[] {
  return db.select({ id: forms.id, title: forms.title, status: forms.status }).from(forms).where(eq(forms.type, "checkin")).orderBy(forms.id).all();
}

export interface CheckinView {
  id: number;
  formTitle: string;
  at: number;
  answers: Answer[];
}

/** A member's check-ins, newest first (any check-in form, so a form swap keeps the history). */
export function listCheckins(clientId: number, limit = 52): CheckinView[] {
  return db
    .select({ id: formSubmissions.id, payload: formSubmissions.payload, createdAt: formSubmissions.createdAt, title: forms.title })
    .from(formSubmissions)
    .innerJoin(forms, eq(forms.id, formSubmissions.formId))
    .where(and(eq(formSubmissions.clientId, clientId), eq(forms.type, "checkin")))
    .orderBy(desc(formSubmissions.createdAt))
    .limit(limit)
    .all()
    .map((r) => {
      let answers: Answer[] = [];
      try {
        answers = (JSON.parse(r.payload) as { answers?: Answer[] }).answers ?? [];
      } catch {
        answers = [];
      }
      return { id: r.id, formTitle: r.title || "Check-in", at: r.createdAt.getTime(), answers };
    });
}

/** Where this member stands this week, or null when the business has no check-in set up. */
export function memberCheckin(clientId: number): (CheckinState & { form: FormInput & { id: number }; weekday: number }) | null {
  const settings = getCheckinSettings();
  const form = checkinForm(settings);
  if (!form) return null;
  const last = listCheckins(clientId, 1)[0];
  return { ...checkinState(settings.weekday, dateKey(Date.now()), last ? dateKey(last.at) : null), form, weekday: settings.weekday };
}

export function saveCheckin(tenantId: number, clientId: number, raw: Record<string, string>): { ok: true } | { ok: false; error: string } {
  const form = checkinForm();
  if (!form) return { ok: false, error: "Check-ins aren't set up yet." };
  // Photo answers may only name this member's own uploads.
  const clean: Record<string, string> = { ...raw };
  for (const q of form.questions) {
    if (q.fieldType !== "photo" || q.id == null) continue;
    const k = `q_${q.id}`;
    clean[k] = photoNames(raw[k] ?? "")
      .filter((n) => photoPath(clientId, n))
      .join("|");
  }
  const answers = buildAnswers(form, clean);
  const err = validateRequired(form, answers);
  if (err) return { ok: false, error: err };
  for (const q of form.questions) {
    if (q.fieldType === "photo" && q.required && !clean[`q_${q.id}`]) return { ok: false, error: `Add a photo for "${q.label}".` };
  }
  insertFormSubmission(tenantId, form.id, answers, clientId);
  return { ok: true };
}

// ── photos ──

function photoDir(clientId: number): string {
  const dir = path.join(process.cwd(), "data", "tenants", getCurrentTenant().slug, "checkins", String(clientId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveCheckinPhoto(clientId: number, bytes: Buffer, ext: "jpg" | "png" | "webp"): string {
  const name = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(photoDir(clientId), name), bytes);
  return name;
}

/** The absolute path of one of this member's check-in photos, or null. */
export function photoPath(clientId: number, name: string): string | null {
  if (photoNames(name)[0] !== name) return null;
  const full = path.join(photoDir(clientId), name);
  return fs.existsSync(full) ? full : null;
}
