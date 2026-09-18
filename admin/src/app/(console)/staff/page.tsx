import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { requireAdminSession } from "@/lib/session";
import { Card } from "@/components/ui/Card";
import { StaffRoleForm } from "@/components/StaffRoleForm";
import type { StaffResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Who has console access, and what each of them may do.
 *
 * Visible to both roles -- knowing who can reach client data is not
 * privileged information within the team -- but only an owner can change a
 * role, and the API enforces that regardless of what this page renders.
 */
export default async function StaffPage({ searchParams }: { searchParams: { error?: string; saved?: string } }) {
  const me = await requireAdminSession();
  const { staff } = await api<StaffResponse>("/staff");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 760 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Platform staff</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--text-secondary)" }}>
          An <strong>owner</strong> can do everything, including offboarding a business, waiving or comping
          invoices, and changing these roles. A <strong>manager</strong> does everything else: support, credits,
          caps, opening a business, and notes.
        </p>
      </div>

      {searchParams.error && (
        <p role="alert" style={{ margin: 0, color: "var(--red)", fontSize: 13.5 }}>{searchParams.error}</p>
      )}
      {searchParams.saved && (
        <p style={{ margin: 0, color: "var(--green)", fontSize: 13.5 }}>Role updated.</p>
      )}

      <Card style={{ padding: 20 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Last login</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.userId}>
                <td>
                  {s.name ?? s.email}
                  {s.name && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.email}</div>
                  )}
                  {s.userId === me.userId && (
                    <span className="chip" style={{ marginLeft: 6, background: "var(--surface-2)" }}>you</span>
                  )}
                </td>
                <td>
                  {me.role === "owner" ? (
                    <StaffRoleForm userId={s.userId} role={s.role} isSelf={s.userId === me.userId} />
                  ) : (
                    <span className="chip" style={{ background: "var(--surface-2)" }}>{s.role}</span>
                  )}
                </td>
                <td>{s.lastLoginAt ? fmtDate(s.lastLoginAt) : "Never"}</td>
                <td>
                  {s.isActive ? (
                    <span className="chip" style={{ background: "rgba(63,185,80,.15)", color: "var(--green)" }}>active</span>
                  ) : (
                    <span className="chip" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>disabled</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {me.role !== "owner" && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
          Only an owner can change these. Ask one of the owners above.
        </p>
      )}
    </div>
  );
}
