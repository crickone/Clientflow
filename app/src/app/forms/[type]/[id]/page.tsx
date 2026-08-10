import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getForm, getFormSubmissionCount } from "@/lib/forms";
import { FORM_TYPE_META, type FormType } from "@/lib/formsModel";
import { FormWizard } from "@/components/forms/FormWizard";
import { ContactFormBuilder } from "@/components/forms/ContactFormBuilder";
import { TermsBuilder } from "@/components/forms/TermsBuilder";

export const dynamic = "force-dynamic";

const VALID = new Set(Object.keys(FORM_TYPE_META));

export default async function EditFormPage({ params }: { params: { type: string; id: string } }) {
  await requireUser();
  if (!VALID.has(params.type)) notFound();
  const type = params.type as FormType;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const form = getForm(id);
  if (!form || form.type !== type) notFound();
  const meta = FORM_TYPE_META[type];
  // Only contact forms are ever publicly submittable (see FORM_TYPE_META.contact).
  const submissionCount = meta.kind === "contact" ? getFormSubmissionCount(id) : 0;

  return (
    <div className="app-page" style={{ maxWidth: meta.kind === "wizard" ? 1040 : 900 }}>
      {meta.kind === "wizard" && <FormWizard initial={form} meta={meta} />}
      {meta.kind === "contact" && (
        <ContactFormBuilder initial={form} meta={meta} submissionCount={submissionCount} />
      )}
      {meta.kind === "terms" && <TermsBuilder initial={form} meta={meta} />}
    </div>
  );
}
