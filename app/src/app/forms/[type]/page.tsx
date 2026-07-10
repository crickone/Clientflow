import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { requireUser } from "@/lib/auth";
import { listForms } from "@/lib/forms";
import { FORM_TYPE_META, type FormType } from "@/lib/formsModel";
import { FormsListView } from "@/components/forms/FormsListView";

export const dynamic = "force-dynamic";

const VALID = new Set(Object.keys(FORM_TYPE_META));

export default async function FormsListPage({ params }: { params: { type: string } }) {
  await requireUser();
  if (!VALID.has(params.type)) notFound();
  const type = params.type as FormType;
  const meta = FORM_TYPE_META[type];
  const forms = listForms(type);
  return (
    <div className="app-page">
      <PageHeader eyebrow="Forms" title={meta.label} subtitle={meta.intro[0]} />
      <FormsListView type={type} meta={meta} forms={forms} />
    </div>
  );
}
