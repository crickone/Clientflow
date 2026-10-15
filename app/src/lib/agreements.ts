import "server-only";

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { clientAgreements, clientCredentials, formSubmissions, forms } from "@/lib/db/schema";
import { authDb } from "@/lib/db/control";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getForm } from "@/lib/forms";
import type { FormInput } from "@/lib/formsModel";
import { buildAnswers, insertFormSubmission, validateRequired, type Answer } from "@/lib/publicForms";
import {
  agreementStatus,
  businessTermsDoc,
  pendingDocs,
  platformDocs,
  type AcceptedRow,
  type AgreementDoc,
  type BusinessContact,
} from "@/lib/agreementsModel";

/**
 * Before a member uses the client app: the documents they agree to and the
 * Welcome Q&A they fill in, for the CURRENT tenant (ambient `db`). Driven by
 * Forms, with no separate switch:
 *   - any switched-on Terms & Conditions form means every member signs ours
 *     and all of the business's switched-on terms before the app opens;
 *   - the Default Initial Questionnaire, when switched on, is asked once after.
 */

export function businessContact(): BusinessContact {
  const p = getBusinessProfile();
  return { name: p.businessName || "Your gym", email: p.email ?? "", phone: p.phone ?? "" };
}

/** The business's own terms: every switched-on Terms & Conditions form with some text. */
function businessTerms(businessName: string): AgreementDoc[] {
  return db
    .select({ id: forms.id, title: forms.title, content: forms.content })
    .from(forms)
    .where(and(eq(forms.type, "terms"), eq(forms.status, true), isNotNull(forms.content)))
    .orderBy(forms.id)
    .all()
    .filter((f) => (f.content ?? "").trim().length > 0)
    .map((f) => businessTermsDoc({ id: f.id, title: f.title, content: f.content! }, businessName));
}

/**
 * Everything a member agrees to, in the order they see it: ours first, then
 * the business's. Nothing until the business switches on terms of its own.
 */
export function requiredDocs(): AgreementDoc[] {
  const contact = businessContact();
  const theirs = businessTerms(contact.name);
  return theirs.length ? [...platformDocs(contact), ...theirs] : [];
}

/** Ours, with the business's name and contact in, for previews on the Forms page. */
export function ourDocs(): AgreementDoc[] {
  return platformDocs(businessContact());
}

function accepted(clientId: number): AcceptedRow[] {
  return db
    .select({ docKey: clientAgreements.docKey, version: clientAgreements.version, acceptedAt: clientAgreements.acceptedAt })
    .from(clientAgreements)
    .where(eq(clientAgreements.clientId, clientId))
    .all();
}

/** The Welcome Q&A: the Default Initial Questionnaire, when it's switched on and has questions. */
export function welcomeForm(): (FormInput & { id: number }) | null {
  const row = db
    .select({ id: forms.id })
    .from(forms)
    .where(and(eq(forms.type, "initial"), eq(forms.isDefault, true), eq(forms.status, true)))
    .get();
  if (!row) return null;
  const f = getForm(row.id);
  if (!f || f.questions.length === 0) return null;
  return f as FormInput & { id: number };
}

function welcomeSubmission(clientId: number, formId: number) {
  return db
    .select()
    .from(formSubmissions)
    .where(and(eq(formSubmissions.formId, formId), eq(formSubmissions.clientId, clientId)))
    .orderBy(desc(formSubmissions.createdAt))
    .get();
}

export interface Onboarding {
  docs: AgreementDoc[];
  welcome: (FormInput & { id: number }) | null;
}

/** What this member still has to do before the app opens; null when nothing (or the business has it off). */
export function onboardingFor(clientId: number): Onboarding | null {
  const docs = pendingDocs(requiredDocs(), accepted(clientId));
  const form = welcomeForm();
  const welcome = form && !welcomeSubmission(clientId, form.id) ? form : null;
  return docs.length || welcome ? { docs, welcome } : null;
}

/**
 * Record the member's agreement to the documents they ticked. Each must be
 * the CURRENT version: if a document changed while they were reading, nothing
 * is saved and they're shown the new text.
 */
export function acceptDocs(
  clientId: number,
  ticked: { key: string; version: string }[],
  meta: { ip: string | null; userAgent: string | null },
): { ok: true } | { ok: false; error: string } {
  const pending = pendingDocs(requiredDocs(), accepted(clientId));
  for (const d of pending) {
    const t = ticked.find((x) => x.key === d.key);
    if (!t) return { ok: false, error: `Tick "${d.title}" to continue.` };
    if (t.version !== d.version) return { ok: false, error: `"${d.title}" has just been updated. Read the new version and tick it again.` };
  }
  const now = Date.now();
  if (pending.length) {
    db.insert(clientAgreements)
      .values(
        pending.map((d) => ({
          clientId,
          docKey: d.key,
          title: d.title,
          version: d.version,
          body: d.body,
          acceptedAt: now,
          ip: meta.ip?.slice(0, 64) ?? null,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
        })),
      )
      .run();
  }
  return { ok: true };
}

/** Save the member's Welcome Q&A answers. */
export function saveWelcome(tenantId: number, clientId: number, raw: Record<string, string>): { ok: true } | { ok: false; error: string } {
  const form = welcomeForm();
  if (!form) return { ok: true };
  const answers = buildAnswers(form, raw);
  const err = validateRequired(form, answers);
  if (err) return { ok: false, error: err };
  insertFormSubmission(tenantId, form.id, answers, clientId);
  return { ok: true };
}

// ── staff view ──

export interface ClientAgreementView {
  on: boolean;
  docs: { key: string; title: string; owner: "platform" | "business"; acceptedAt: number | null; current: boolean }[];
  welcome: { title: string; at: number; answers: Answer[] } | null;
}

export function clientAgreementView(clientId: number): ClientAgreementView {
  const required = requiredDocs();
  const docs = agreementStatus(required, accepted(clientId)).map((s) => ({
    key: s.doc.key,
    title: s.doc.title,
    owner: s.doc.owner,
    acceptedAt: s.acceptedAt,
    current: s.current,
  }));
  const sub = db
    .select({ formId: formSubmissions.formId, payload: formSubmissions.payload, createdAt: formSubmissions.createdAt, title: forms.title })
    .from(formSubmissions)
    .innerJoin(forms, eq(forms.id, formSubmissions.formId))
    .where(and(eq(formSubmissions.clientId, clientId), eq(forms.type, "initial")))
    .orderBy(desc(formSubmissions.createdAt))
    .get();
  let welcome: ClientAgreementView["welcome"] = null;
  if (sub) {
    let answers: Answer[] = [];
    try {
      answers = (JSON.parse(sub.payload) as { answers?: Answer[] }).answers ?? [];
    } catch {
      answers = [];
    }
    welcome = { title: sub.title || "Welcome Q&A", at: sub.createdAt.getTime(), answers };
  }
  return { on: required.length > 0, docs, welcome };
}

/** The exact text a member agreed to, for one document (the latest acceptance). */
export function agreedCopy(clientId: number, docKey: string) {
  return (
    db
      .select()
      .from(clientAgreements)
      .where(and(eq(clientAgreements.clientId, clientId), eq(clientAgreements.docKey, docKey)))
      .orderBy(desc(clientAgreements.acceptedAt))
      .get() ?? null
  );
}

/** How many of the business's app members have signed everything current, for the Terms page. */
export function signoffProgress(tenantId: number): { members: number; signed: number } {
  const required = requiredDocs();
  const members = authDb
    .select({ clientId: clientCredentials.clientId })
    .from(clientCredentials)
    .where(and(eq(clientCredentials.tenantId, tenantId), eq(clientCredentials.isActive, true)))
    .all()
    .map((r) => r.clientId);
  if (!required.length || !members.length) return { members: members.length, signed: 0 };
  const rows = db
    .select({ clientId: clientAgreements.clientId, docKey: clientAgreements.docKey, version: clientAgreements.version, acceptedAt: clientAgreements.acceptedAt })
    .from(clientAgreements)
    .where(inArray(clientAgreements.clientId, members))
    .all();
  const signed = members.filter((id) => pendingDocs(required, rows.filter((r) => r.clientId === id)).length === 0).length;
  return { members: members.length, signed };
}

export interface ClientFormView {
  id: number;
  title: string;
  type: string;
  at: number;
  answers: Answer[];
}

/** Every form this member has filled in from the app, newest first. Check-ins have their own tab. */
export function clientForms(clientId: number): ClientFormView[] {
  return db
    .select({ id: formSubmissions.id, payload: formSubmissions.payload, createdAt: formSubmissions.createdAt, title: forms.title, type: forms.type })
    .from(formSubmissions)
    .innerJoin(forms, eq(forms.id, formSubmissions.formId))
    .where(eq(formSubmissions.clientId, clientId))
    .orderBy(desc(formSubmissions.createdAt))
    .all()
    .filter((r) => r.type !== "checkin")
    .map((r) => {
      let answers: Answer[] = [];
      try {
        answers = (JSON.parse(r.payload) as { answers?: Answer[] }).answers ?? [];
      } catch {
        answers = [];
      }
      return { id: r.id, title: r.title || "Questionnaire", type: r.type, at: r.createdAt.getTime(), answers };
    });
}
