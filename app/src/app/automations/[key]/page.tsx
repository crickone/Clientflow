import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { getTrigger } from "@/lib/automations";
import { getBusinessProfile } from "@/lib/businessProfile";
import { LEAD_SEQUENCE_KEYS } from "@/lib/automationModel";
import { TriggerEditor } from "@/components/automations/TriggerEditor";
import { FlowActivity } from "@/components/automations/FlowActivity";
import type { RunStatus } from "@/lib/leadFlows/activityModel";

export const dynamic = "force-dynamic";

const STATUSES = new Set(["active", "finished", "stopped"]);

export default async function TriggerDetailPage(props: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ tab?: string; status?: string }>;
}) {
  const params = await props.params;
  const sp = await props.searchParams;
  await requireUser();
  const trigger = getTrigger(params.key);
  if (!trigger) notFound();
  // Lead follow-ups keep a record of everyone who went through them.
  const hasPeople = (LEAD_SEQUENCE_KEYS as readonly string[]).includes(params.key);
  const tab = hasPeople && sp.tab === "people" ? "people" : "messages";
  const status = (sp.status && STATUSES.has(sp.status) ? sp.status : "all") as RunStatus | "all";
  const tabLink = (key: "messages" | "people", label: string) => (
    <Link
      href={`/automations/${params.key}${key === "people" ? "?tab=people" : ""}`}
      aria-current={tab === key ? "page" : undefined}
      style={{
        padding: "0 2px 10px",
        fontSize: 14,
        fontWeight: tab === key ? 600 : 500,
        color: tab === key ? "var(--text-primary)" : "var(--text-tertiary)",
        boxShadow: tab === key ? "inset 0 -2px 0 var(--text-primary)" : undefined,
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
  return (
    <div className="app-page" style={{ maxWidth: tab === "people" ? 1100 : 960 }}>
      {hasPeople && (
        <nav aria-label="Automation sections" style={{ display: "flex", gap: 22, borderBottom: "1px solid var(--hairline)", marginBottom: 20 }}>
          {tabLink("messages", "Messages")}
          {tabLink("people", "People")}
        </nav>
      )}
      {tab === "people" ? (
        <>
          <h1 style={{ margin: "0 0 16px", fontSize: 24 }}>{trigger.label}</h1>
          <FlowActivity triggerKey={params.key} status={status} />
        </>
      ) : (
        <TriggerEditor initial={trigger} businessName={getBusinessProfile().businessName} />
      )}
    </div>
  );
}
