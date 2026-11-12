"use client";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { StaffRoleForm } from "@/components/StaffRoleForm";
import { fmtDate } from "@/lib/format";
import type { PlatformRole, PlatformStaffRow } from "@/lib/types";

export function StaffTable({ staff, me }: { staff: PlatformStaffRow[]; me: { userId: number; role: PlatformRole } }) {
  const columns: Column<PlatformStaffRow>[] = [
    {
      key: "email", label: "Person", sortable: true, hideable: false,
      render: (s) => (
        <>
          {s.name ?? s.email}
          {s.name && <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{s.email}</div>}
          {s.userId === me.userId && <span className="chip" style={{ marginLeft: 6 }}>you</span>}
        </>
      ),
    },
    { key: "role", label: "Role", sortable: true, render: (s) => (me.role === "owner" ? <StaffRoleForm userId={s.userId} role={s.role} isSelf={s.userId === me.userId} /> : <span className="chip">{s.role}</span>) },
    { key: "lastLoginAt", label: "Last login", sortable: true, render: (s) => (s.lastLoginAt ? fmtDate(s.lastLoginAt) : "Never") },
    { key: "isActive", label: "Status", sortable: true, value: (s) => (s.isActive ? 1 : 0), render: (s) => (s.isActive ? <span className="chip active">active</span> : <span className="chip">disabled</span>) },
  ];
  return <DataTable rows={staff} columns={columns} rowKey={(s) => s.userId} defaultSort={{ key: "email", dir: "asc" }} csvName="platform-staff" empty="No staff." />;
}
