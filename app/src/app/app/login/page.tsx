import { redirect } from "next/navigation";

import { getCurrentClient } from "@/lib/clientAuth";
import { getChromeLogoSrc } from "@/lib/branding";
import { getBusinessProfile } from "@/lib/businessProfile";
import { resolveCurrentTenant } from "@/lib/db/tenant";
import { ClientLoginForm } from "@/components/clientapp/ClientLoginForm";

export const dynamic = "force-dynamic";

export default async function ClientLoginPage() {
  if (getCurrentClient()) redirect("/app");
  // Pre-session there is usually no resolvable tenant (fail-closed resolution)
  // — render neutral. A lingering-but-valid client session still brands it.
  const tenant = resolveCurrentTenant();
  const logoSrc = tenant ? getChromeLogoSrc() : null;
  const businessName = tenant ? getBusinessProfile().businessName : "";
  return <ClientLoginForm logoSrc={logoSrc} businessName={businessName} />;
}
