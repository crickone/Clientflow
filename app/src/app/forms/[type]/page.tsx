import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { getCurrentMembership, requireUser } from "@/lib/auth";
import { ourDocs, requiredDocs, signoffProgress, welcomeForm } from "@/lib/agreements";
import { checkinForm, getCheckinDay } from "@/lib/checkins";
import { habitForm } from "@/lib/habits";
import { FormsAppNote } from "@/components/forms/FormsAppNote";
import { listForms } from "@/lib/forms";
import { FORM_TYPE_META, type FormType } from "@/lib/formsModel";
import { FormsListView } from "@/components/forms/FormsListView";

export const dynamic = "force-dynamic";

const VALID = new Set(Object.keys(FORM_TYPE_META));

export default async function FormsListPage(props: { params: Promise<{ type: string }> }) {
  const params = await props.params;
  await requireUser();
  if (!VALID.has(params.type)) notFound();
  const type = params.type as FormType;
  const meta = FORM_TYPE_META[type];
  const forms = listForms(type);
  const tenantId = getCurrentMembership()?.tenant.id ?? 0;
  const termsLive = requiredDocs().length > 0;
  return (
    <div className="app-page">
      <PageHeader eyebrow="Forms" title={meta.label} subtitle={meta.intro[0]} />
      {type === "terms" && <FormsAppNote kind="terms" live={termsLive} ours={ourDocs()} progress={signoffProgress(tenantId)} />}
      {type === "initial" && <FormsAppNote kind="initial" live={welcomeForm()?.title || (welcomeForm() ? "Untitled" : null)} termsLive={termsLive} />}
      {type === "habits" && <FormsAppNote kind="habits" live={habitForm()?.title ?? null} count={habitForm()?.habits.length ?? 0} />}
      {type === "checkin" && <FormsAppNote kind="checkin" live={checkinForm()?.title || (checkinForm() ? "Untitled" : null)} weekday={getCheckinDay()} />}
      <FormsListView type={type} meta={meta} forms={forms} />
    </div>
  );
}
