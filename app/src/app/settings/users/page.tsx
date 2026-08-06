import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { desc, eq } from "drizzle-orm";

import { PageHeader } from "@/components/layout/PageHeader";
import { authDb } from "@/lib/db/control";
import { memberships, users } from "@/lib/db/schema";
import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { listPendingInviteEmails } from "@/lib/invites";
import { isEmailConfigured } from "@/lib/email";
import { UsersManager } from "@/components/settings/UsersManager";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requireAdminPage();
  // requireAdminPage guarantees an admin membership in the active tenant.
  const tenantId = getCurrentMembership()!.tenant.id;

  // The roster is the set of memberships in the ACTIVE clinic, joined to each
  // person's identity. Role / active reflect this clinic; name / email / login
  // are identity-level (shared across the person's clinics).
  const all = authDb
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
      isActive: memberships.isActive,
      lastLoginAt: users.lastLoginAt,
      mustChangePassword: users.mustChangePassword,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, tenantId))
    .orderBy(desc(memberships.createdAt))
    .all();

  const pendingInvites = listPendingInviteEmails(tenantId);
  const emailReady = isEmailConfigured();

  const serialised = all.map((u) => ({
    ...u,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.getTime() : null,
    createdAt: u.createdAt.getTime(),
    invitePending: pendingInvites.has(u.email.toLowerCase()),
  }));

  return (
    <div className="app-page" style={{ maxWidth: 1000 }}>
      <Link
        href="/settings"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--text-secondary)",
          fontSize: 13,
          marginBottom: 14,
          textDecoration: "none",
        }}
      >
        <ArrowLeft size={14} strokeWidth={1.75} />
        Back to settings
      </Link>
      <PageHeader
        eyebrow="Configure"
        title="Users & permissions"
        subtitle="Manage staff and admin accounts."
      />
      <UsersManager
        users={serialised}
        currentUserId={me.id}
        emailReady={emailReady}
      />
    </div>
  );
}
