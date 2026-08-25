import type { Metadata } from "next";

import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const dynamic = "force-dynamic";

// Same platform-neutral treatment as /login (see that page's comment): staff
// can belong to multiple/no tenants pre-auth, so this never resolves a tenant
// for branding.
export const metadata: Metadata = {
  title: "Forgot password — AdonisAgent",
  description: "Reset your AdonisAgent password.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
