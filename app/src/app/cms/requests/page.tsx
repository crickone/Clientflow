import { Inbox } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { requireAdminPage } from "@/lib/auth";
import { listRequests } from "@/lib/cms/requests";
import { RequestActions } from "@/components/cms/RequestRow";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_COLOUR: Record<string, string> = {
  new: "#58a6ff",
  approved: "#d29922",
  declined: "#8b949e",
  fulfilled: "#3fb950",
};

export default async function RequestsPage() {
  await requireAdminPage();
  const requests = listRequests();

  return (
    <div className="app-page">
      <PageHeader eyebrow="CMS" title="Website requests" />

      {requests.length === 0 ? (
        <EmptyState
          icon={<Inbox size={32} strokeWidth={1.4} />}
          title="No requests yet"
          message="New website requests will appear here for you to review and build."
        />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {requests.map((r) => (
            <Card key={r.id} style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                    {r.businessName}
                  </span>
                  <Badge colour={STATUS_COLOUR[r.status]}>{r.status}</Badge>
                </div>
                <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 3 }}>
                  {[r.contactName, r.contactEmail].filter(Boolean).join(" · ") || "No contact"} ·{" "}
                  {formatDate(new Date(r.createdAt).toISOString())}
                </div>
                {r.notes && (
                  <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 8 }}>
                    {r.notes}
                  </p>
                )}
              </div>
              <RequestActions id={r.id} status={r.status} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
