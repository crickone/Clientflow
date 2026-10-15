import "server-only";

import { and, desc, eq, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { clientAgreements, formSubmissions, forms } from "@/lib/db/schema";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getForm } from "@/lib/forms";
import type { FormInput } from "@/lib/formsModel";
import { buildAnswers, insertFormSubmission, validateRequired, type Answer } from "@/lib/publicForms";
import { readKey, setKey } from "@/lib/settings";
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
 * Welcome Q&A they fill in, for the CURRENT tenant (ambient `db`). Off until
 * the business turns it on, so switching it on never surprises anyone.
 */

export interface AgreementSettings {
  /** Members must agree (and answer the Welcome Q&A) before the app opens. */
  on: boolean;
  /** An Initial Questionnaire from Forms to ask after the documents; null for none. */
  welcomeFormId: number | null;
}

const KEY = "app_agreements";

export function getAgreementSettings(): AgreementSettings {
  const s = readKey<Partial<AgreementSettings>>(KEY, {});
  return { on: s.on === true, welcomeFormId: typeof s.welcomeFormId === "number" ? s.welcomeFormId : null };
}

export function setAgreementSettings(next: AgreementSettings): void {
  setKey(KEY, next);
}

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

/** Everything a member agrees to, in the order they see it: ours first, then the business's. */
export function requiredDocs(): AgreementDoc[] {
  const contact = businessContact();
  return [...platformDocs(contact), ...businessTerms(contact.name)];
}

function accepted(clientId: number): AcceptedRow[] {
  return db
    .select({ docKey: clientAgreements.docKey, version: clientAgreements.version, acceptedAt: clientAgreements.acceptedAt })
    .from(clientAgreements)
    .where(eq(clientAgreements.clientId, clientId))
    .all();
}

/** The Welcome Q&A form when one is set, switched on and has questions. */
export function welcomeForm(settings = getAgreementSettings()): (FormInput & { id: number }) | null {
  if (!settings.welcomeFormId) return null;
  const f = getForm(settings.welcomeFormId);
  if (!f || !f.status || f.type !== "initial" || f.questions.length === 0) return null;
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
  const settings = getAgreementSettings();
  if (!settings.on) return null;
  const docs = pendingDocs(requiredDocs(), accepted(clientId));
  const form = welcomeForm(settings);
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
  const settings = getAgreementSettings();
  const docs = agreementStatus(requiredDocs(), accepted(clientId)).map((s) => ({
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
  return { on: settings.on, docs, welcome };
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

/** How many members have agreed to the current version of everything, for the settings card. */
export function agreementCounts(): { required: number } {
  return { required: requiredDocs().length };
}

/** The Initial Questionnaires the business can pick as its Welcome Q&A. */
export function welcomeChoices(): { id: number; title: string; status: boolean }[] {
  return db
    .select({ id: forms.id, title: forms.title, status: forms.status })
    .from(forms)
    .where(eq(forms.type, "initial"))
    .orderBy(forms.id)
    .all();
}
