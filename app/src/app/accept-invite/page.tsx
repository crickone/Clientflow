import { getInviteByToken } from "@/lib/invites";
import { AcceptInviteForm } from "@/components/auth/AcceptInviteForm";
import { InviteMessage } from "@/components/auth/InviteMessage";

export const dynamic = "force-dynamic";

export default function AcceptInvitePage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = (searchParams.token ?? "").trim();
  // Pre-session page: there is no resolvable tenant yet (and the invitee may
  // not even have an account), so this is platform-branded — the invite's own
  // tenantName still names the business they're joining in the form copy.
  const logoSrc = null;
  const businessName = "";

  if (!token) {
    return (
      <InviteMessage
        logoSrc={logoSrc}
        businessName={businessName}
        title="Invalid link"
        body="This invite link is missing its token. Ask your admin to send a fresh invite."
      />
    );
  }

  const invite = getInviteByToken(token);

  if (invite.status === "invalid") {
    return (
      <InviteMessage
        logoSrc={logoSrc}
        businessName={businessName}
        title="Invalid invite"
        body="We couldn't find this invite. It may have been cancelled — ask your admin to send a new one."
      />
    );
  }
  if (invite.status === "accepted") {
    return (
      <InviteMessage
        logoSrc={logoSrc}
        businessName={businessName}
        title="Already set up"
        body="This invite has already been used. You can sign in with your email and password."
        showSignIn
      />
    );
  }
  if (invite.status === "expired") {
    return (
      <InviteMessage
        logoSrc={logoSrc}
        businessName={businessName}
        title="Invite expired"
        body="This invite link has expired. Ask your admin to re-send it."
      />
    );
  }

  return (
    <AcceptInviteForm
      logoSrc={logoSrc}
      businessName={businessName}
      token={token}
      email={invite.email}
      initialName={invite.name ?? ""}
      tenantName={invite.tenantName}
    />
  );
}
