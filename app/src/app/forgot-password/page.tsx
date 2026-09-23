import type { Metadata } from "next";

import { getSessionUser } from "@/lib/auth";

import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const dynamic = "force-dynamic";

// Same platform-neutral treatment as /login (see that page's comment): staff
// can belong to multiple/no tenants pre-auth, so this never resolves a tenant
// for branding.
export const metadata: Metadata = {
  title: "Forgot password — AdonisAgent",
  description: "Reset your AdonisAgent password.",
};

export default async function ForgotPasswordPage() {
  // Deliberately NOT a redirect: wanting a new password while signed in is a
  // normal thing to want. The form just says so, and offers the way back.
  const user = await getSessionUser();
  return <ForgotPasswordForm signedInAs={user?.email ?? null} />;
}
