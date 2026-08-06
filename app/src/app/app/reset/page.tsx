import { getChromeLogoSrc } from "@/lib/branding";
import { getBusinessProfile } from "@/lib/businessProfile";
import { verifyResetToken } from "@/lib/clientPasswordReset";
import { ClientResetForm, ClientResetMessage } from "@/components/clientapp/ClientResetForm";

export const dynamic = "force-dynamic";

export default function ClientResetPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = (searchParams.token ?? "").trim();
  const logoSrc = getChromeLogoSrc();
  const businessName = getBusinessProfile().businessName;

  if (!token) {
    return (
      <ClientResetMessage
        logoSrc={logoSrc}
        businessName={businessName}
        title="Invalid link"
        body="This link is missing its token. Request a new password reset from the sign-in screen."
      />
    );
  }

  const view = verifyResetToken(token);
  if (view.status === "valid") {
    // The link resolves the tenant + business itself, so show that business's
    // name/logo rather than whatever the current host resolves to.
    return (
      <ClientResetForm
        logoSrc={logoSrc}
        businessName={view.businessName}
        token={token}
        email={view.email}
      />
    );
  }

  const messages: Record<"expired" | "used" | "invalid", { title: string; body: string }> = {
    expired: {
      title: "Link expired",
      body: "This link has expired. Request a new one from the sign-in screen.",
    },
    used: {
      title: "Already used",
      body: "This link has already been used. Sign in with your new password, or request another reset.",
    },
    invalid: {
      title: "Invalid link",
      body: "We couldn't find this link. It may have been superseded by a newer one — request a fresh reset.",
    },
  };
  const msg = messages[view.status];
  return (
    <ClientResetMessage
      logoSrc={logoSrc}
      businessName={businessName}
      title={msg.title}
      body={msg.body}
    />
  );
}
