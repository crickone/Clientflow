import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth";
import { getChromeLogoSrc } from "@/lib/branding";
import { getBusinessProfile } from "@/lib/businessProfile";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { opened?: string };
}) {
  const user = await getSessionUser();
  if (user) {
    redirect(user.mustChangePassword ? "/change-password" : "/dashboard");
  }
  // Surfaced by the platform "Open business" handoff (app/open/route.ts) when
  // its one-time token was missing/expired/already used — never distinguishes
  // which, same uniform-failure posture as a bad password below.
  const notice =
    searchParams.opened === "expired"
      ? "That link has expired or was already used. Please sign in."
      : null;
  return (
    <LoginForm
      logoSrc={getChromeLogoSrc()}
      businessName={getBusinessProfile().businessName}
      notice={notice}
    />
  );
}
