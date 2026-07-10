import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { blankForm, FORM_TYPE_META, type FormType } from "@/lib/formsModel";
import { FormWizard } from "@/components/forms/FormWizard";
import { ContactFormBuilder } from "@/components/forms/ContactFormBuilder";
import { TermsBuilder } from "@/components/forms/TermsBuilder";

export const dynamic = "force-dynamic";

const VALID = new Set(Object.keys(FORM_TYPE_META));

export default async function NewFormPage({ params }: { params: { type: string } }) {
  await requireUser();
  if (!VALID.has(params.type)) notFound();
  const type = params.type as FormType;
  const meta = FORM_TYPE_META[type];
  const initial = blankForm(type);

  return (
    <div className="app-page" style={{ maxWidth: meta.kind === "wizard" ? 1040 : 900 }}>
      {meta.kind === "wizard" && <FormWizard initial={initial} meta={meta} />}
      {meta.kind === "contact" && <ContactFormBuilder initial={initial} meta={meta} />}
      {meta.kind === "terms" && <TermsBuilder initial={initial} meta={meta} />}
    </div>
  );
}
