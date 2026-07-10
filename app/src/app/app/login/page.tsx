import { redirect } from "next/navigation";

import { getCurrentClient } from "@/lib/clientAuth";
import { getChromeLogoSrc } from "@/lib/branding";
import { getBusinessProfile } from "@/lib/businessProfile";
import { ClientLoginForm } from "@/components/clientapp/ClientLoginForm";

export const dynamic = "force-dynamic";

export default async function ClientLoginPage() {
  if (getCurrentClient()) redirect("/app");
  const logoSrc = getChromeLogoSrc();
  const businessName = getBusinessProfile().businessName;
  return <ClientLoginForm logoSrc={logoSrc} businessName={businessName} />;
}
