import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

// Platform sign-in — always AdonisAgent-branded. Unauthenticated there is NO
// tenant, so we deliberately do NOT use getBusinessProfile()/getChromeLogoSrc()
// here: both fall back to the default tenant (renova) and would leak its name +
// logo onto the platform login. A null logo makes <Logo> render the AdonisAgent
// wordmark; an empty business name drops the "— <tenant>" sub-line beneath it.
export const metadata: Metadata = {
  title: "AdonisAgent",
  description: "Sign in to AdonisAgent.",
};

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
  return <LoginForm logoSrc={null} businessName="" notice={notice} />;
}
