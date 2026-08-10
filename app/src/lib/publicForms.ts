import "server-only";

import { asc, eq } from "drizzle-orm";

import { controlDb } from "@/lib/db/control";
import { getTenantById, getTenantDbById } from "@/lib/db/tenant";
import { forms, formQuestions, formShareLinks, formSubmissions } from "@/lib/db/schema";
import type { FieldType, FormInput, QuestionInput } from "@/lib/formsModel";

/**
 * PUBLIC form resolution + submission storage (Batch 4c,
 * improvement-plan-2026-08.md Theme D5 — the /f/<slug> public render +
 * submissions gap). A share link has no session, so it must resolve its
 * tenant from the SLUG alone — never from client input.
 *
 * `forms.share_slug` is only unique WITHIN a tenant's own forms table (every
 * tenant db autoincrements independently), so a bare slug lookup is ambiguous
 * across tenants. This mirrors the CMS's host->tenant routing
 * (site_domains, see lib/cms/resolveHost.ts): the control-plane
 * `form_share_links` table maps share_slug (globally unique, PK) ->
 * {tenantId, formId}, kept in sync by saveForm()/deleteForm() (lib/forms.ts).
 * Resolution here is one indexed control-db read, then one explicit open of
 * THAT tenant's own db — no scanning every tenant.
 *
 * Deliberately independent of lib/forms.ts (which imports the ambient,
 * cookie-resolved `db` proxy) — the public path must never go anywhere near
 * session/cookie-based tenant resolution.
 */

function parseOptions(csv: string | null): string[] {
  if (!csv) return [];
  return csv.split("|").map((s) => s.trim()).filter(Boolean);
}

export interface PublicForm {
  tenantId: number;
  tenantName: string;
  form: FormInput;
}

/**
 * Resolve a public share slug to its tenant + live form definition.
 * Returns null for: an unknown slug, a deactivated tenant, a deleted form
 * (a dangling mapping row left behind — self-heals, see deleteForm), or a
 * form its owner switched off ("Form is live and accepting submissions" ->
 * off). All of these are equally "not found" to a public visitor.
 */
export function resolveFormBySlug(slug: string): PublicForm | null {
  const clean = slug.trim();
  if (!clean) return null;

  const link = controlDb.select().from(formShareLinks).where(eq(formShareLinks.shareSlug, clean)).get();
  if (!link) return null;

  const tenant = getTenantById(link.tenantId);
  if (!tenant || !tenant.isActive) return null;

  const tdb = getTenantDbById(tenant.id);
  const row = tdb.select().from(forms).where(eq(forms.id, link.formId)).get();
  if (!row || !row.status) return null;

  const qs = tdb
    .select()
    .from(formQuestions)
    .where(eq(formQuestions.formId, row.id))
    .orderBy(asc(formQuestions.position))
    .all();

  const questions: QuestionInput[] = qs.map((q) => ({
    id: q.id,
    section: q.section,
    label: q.label,
    fieldType: q.fieldType as FieldType,
    options: parseOptions(q.options),
    required: q.required,
    isMetric: q.isMetric,
  }));

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    form: {
      id: row.id,
      type: row.type,
      title: row.title,
      isDefault: row.isDefault,
      status: row.status,
      triggerStatus: row.triggerStatus,
      content: row.content,
      questions,
    },
  };
}

export interface Answer {
  questionId: number;
  section: string;
  label: string;
  fieldType: FieldType;
  value: string;
}

/**
 * Field types the current builders can produce but this v1 public renderer
 * doesn't accept (no file-upload storage/endpoint yet — deferred, see the
 * batch report). Never block a submission on one of these regardless of its
 * `required` flag: a visitor has no way to satisfy it here.
 */
const UNSUPPORTED_INPUT_TYPES = new Set<FieldType>(["photo", "video"]);

const MAX_ANSWER_LENGTH = 5000;

/**
 * Map a form's questions onto raw posted `q_<questionId>` fields. Pure — no
 * DB, no request object — so it's trivially unit-testable, and shared by both
 * the JSON (fetch) and url-encoded (no-JS form post) submit paths once the
 * route handler has parsed either into a flat string map.
 */
export function buildAnswers(form: FormInput, raw: Record<string, string>): Answer[] {
  return form.questions
    .filter((q): q is QuestionInput & { id: number } => q.id != null)
    .map((q) => ({
      questionId: q.id,
      section: q.section,
      label: q.label,
      fieldType: q.fieldType,
      value: (raw[`q_${q.id}`] ?? "").toString().trim().slice(0, MAX_ANSWER_LENGTH),
    }));
}

/** Required-field validation. Returns a human-readable error, or null when
 *  the submission is acceptable. */
export function validateRequired(form: FormInput, answers: Answer[]): string | null {
  for (const q of form.questions) {
    if (!q.required || UNSUPPORTED_INPUT_TYPES.has(q.fieldType)) continue;
    const a = answers.find((x) => x.questionId === q.id);
    if (!a || !a.value) return `"${q.label}" is required.`;
  }
  return null;
}

/**
 * Best-effort submitter identity, sniffed from question labels (the default
 * contact-form catalog ships "Full name" / "Email" — see formsModel.ts
 * SUGGESTIONS.contact) so the admin list shows something useful at a glance
 * without depending on a fixed question schema.
 */
export function extractSubmitter(answers: Answer[]): { name: string | null; email: string | null } {
  const email = answers.find((a) => /e-?mail/i.test(a.label))?.value.trim() || null;
  const name = answers.find((a) => /name/i.test(a.label))?.value.trim() || null;
  return { name, email };
}

/**
 * Persist a submission under the given (server-resolved) tenant. Callers
 * MUST pass the tenantId resolveFormBySlug returned — never one taken from
 * client input.
 */
export function insertFormSubmission(tenantId: number, formId: number, answers: Answer[]): number {
  const tdb = getTenantDbById(tenantId);
  const { name, email } = extractSubmitter(answers);
  const row = tdb
    .insert(formSubmissions)
    .values({
      formId,
      tenantId,
      submitterName: name,
      submitterEmail: email,
      payload: JSON.stringify({ answers }),
    })
    .returning({ id: formSubmissions.id })
    .get();
  return row.id;
}
