import { redirect } from "next/navigation";

import { getSessionUser, listActiveMemberships } from "@/lib/auth";
import { getChromeLogoSrc } from "@/lib/branding";
import { getBusinessProfile } from "@/lib/businessProfile";
import { Logo } from "@/components/ui/Logo";
import { AccountSelector } from "./AccountSelector";

export const dynamic = "force-dynamic";

/**
 * Account selector for a multi-clinic identity. Guarded on identity ONLY (not
 * requireUser, which would demand an active tenant that doesn't exist yet). A
 * single-clinic user never lands here — getCurrentMembership auto-resolves their
 * one membership, so the page guards send them straight to their dashboard.
 */
export default async function SelectAccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");

  const memberships = await listActiveMemberships(user.id);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--surface-1)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          padding: "36px 32px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
          <Logo src={getChromeLogoSrc()} alt={getBusinessProfile().businessName} height={28} />
        </div>
        <h1
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: 22,
            fontWeight: 400,
            color: "var(--text-primary)",
            textAlign: "center",
            textTransform: "uppercase",
            letterSpacing: "-0.005em",
            marginBottom: 6,
          }}
        >
          Choose an account
        </h1>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 13,
            textAlign: "center",
            marginBottom: 26,
          }}
        >
          Signed in as {user.email}
        </p>

        {memberships.length === 0 ? (
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: 14,
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            Your account isn&apos;t linked to any clinic yet. Ask an admin to add
            you, then sign in again.
          </p>
        ) : (
          <AccountSelector memberships={memberships} />
        )}
      </div>
    </div>
  );
}
