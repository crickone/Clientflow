import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth";
import { getChromeLogoSrc } from "@/lib/branding";
import { getBusinessProfile } from "@/lib/businessProfile";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) {
    redirect(user.mustChangePassword ? "/change-password" : "/dashboard");
  }
  return (
    <LoginForm
      logoSrc={getChromeLogoSrc()}
      businessName={getBusinessProfile().businessName}
    />
  );
}
