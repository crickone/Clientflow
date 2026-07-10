import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getTrigger } from "@/lib/automations";
import { TriggerEditor } from "@/components/automations/TriggerEditor";

export const dynamic = "force-dynamic";

export default async function TriggerDetailPage({ params }: { params: { key: string } }) {
  await requireUser();
  const trigger = getTrigger(params.key);
  if (!trigger) notFound();
  return (
    <div className="app-page" style={{ maxWidth: 960 }}>
      <TriggerEditor initial={trigger} />
    </div>
  );
}
