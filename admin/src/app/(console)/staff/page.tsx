import { api } from "@/lib/api";
import { requireAdminSession } from "@/lib/session";
import { Card } from "@/components/ui/Card";
import { StaffTable } from "@/components/StaffTable";
import type { StaffResponse } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

/**
 * Who has console access, and what each of them may do.
 *
 * Visible to both roles -- knowing who can reach client data is not
 * privileged information within the team -- but only an owner can change a
 * role, and the API enforces that regardless of what this page renders.
 */
export default async function StaffPage(props: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const searchParams = await props.searchParams;
  const me = await requireAdminSession();
  const { staff } = await api<StaffResponse>("/staff");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 760 }}>
      <PageHeader
        eyebrow="Console"
        title="Platform staff"
        sub={
          <>
            An <strong>owner</strong> can do everything, including offboarding a business, waiving or comping
            invoices, and changing these roles. A <strong>manager</strong> does everything else: support, credits,
            caps, opening a business, and notes.
          </>
        }
      />

      {searchParams.error && (
        <p role="alert" style={{ margin: 0, color: "var(--red)", fontSize: 13.5 }}>{searchParams.error}</p>
      )}
      {searchParams.saved && (
        <p style={{ margin: 0, color: "var(--green)", fontSize: 13.5 }}>Role updated.</p>
      )}

      <Card style={{ padding: "20px 26px 18px" }}>
        <StaffTable staff={staff} me={me} />
      </Card>

      {me.role !== "owner" && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
          Only an owner can change these. Ask one of the owners above.
        </p>
      )}
    </div>
  );
}
