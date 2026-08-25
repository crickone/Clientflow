import type { Metadata } from "next";

import { verifyUserResetToken } from "@/lib/userPasswordReset";
import { ResetPasswordForm, ResetPasswordMessage } from "./ResetPasswordForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset password — AdonisAgent",
  description: "Set a new AdonisAgent password.",
};

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = (searchParams.token ?? "").trim();
  if (!token) {
    return (
      <ResetPasswordMessage
        title="Invalid link"
        body="This link is missing its token. Request a new password reset from the sign-in screen."
      />
    );
  }

  const view = verifyUserResetToken(token);
  if (view.status === "valid") {
    return <ResetPasswordForm token={token} email={view.email} />;
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
  return <ResetPasswordMessage title={msg.title} body={msg.body} />;
}
