import { api } from "@/lib/api";
import { requireAdminSession } from "@/lib/session";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { AlertList } from "@/components/inbox/AlertList";
import type { AlertsResponse, StaffResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** What needs a platform operator, across every business, ranked. */
export default async function InboxPage(props: { searchParams: Promise<{ snoozed?: string; mine?: string }> }) {
  const sp = await props.searchParams;
  const me = await requireAdminSession();
  const [{ alerts, counts }, staff] = await Promise.all([
    api<AlertsResponse>(`/alerts${sp.snoozed ? "?snoozed=1" : ""}`),
    api<StaffResponse>("/staff", { revalidate: 30, tags: ["fleet"] }),
  ]);
  const shown = sp.mine ? alerts.filter((a) => a.assignedTo === me.userId) : alerts;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader
        eyebrow="Fleet"
        title="Inbox"
        sub={counts.bad + counts.warn === 0 ? "Nothing open." : `${counts.bad} ${counts.bad === 1 ? "needs" : "need"} action, ${counts.warn} to watch. Checked every hour; serious ones are emailed as they open.`}
        actions={
          <form method="GET" className="toolbar">
            <label className="check"><input type="checkbox" name="mine" value="1" defaultChecked={Boolean(sp.mine)} /> Mine</label>
            <label className="check"><input type="checkbox" name="snoozed" value="1" defaultChecked={Boolean(sp.snoozed)} /> Show snoozed</label>
            <button className="btn btn--secondary btn--sm" type="submit">Apply</button>
          </form>
        }
      />
      <Card style={{ padding: "8px 26px" }}>
        <AlertList alerts={shown} staff={staff.staff} meId={me.userId} />
      </Card>
    </div>
  );
}
