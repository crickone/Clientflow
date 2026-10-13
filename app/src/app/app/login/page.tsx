import { redirect } from "next/navigation";

import { getCurrentClient } from "@/lib/clientAuth";
import { getChromeLogoSrc, getChromeLogoSrcForTenant } from "@/lib/branding";
import { getBusinessProfile, getBusinessProfileForTenant } from "@/lib/businessProfile";
import { resolveCurrentTenant } from "@/lib/db/tenant";
import { clientAppHost } from "@/lib/clientAppHost";
import { ClientLoginForm } from "@/components/clientapp/ClientLoginForm";

export const dynamic = "force-dynamic";

export default async function ClientLoginPage() {
  if (getCurrentClient()) redirect("/app");
  // On a business's own domain the domain names the business. Otherwise,
  // pre-session there is usually no resolvable tenant (fail-closed
  // resolution), so render neutral; a lingering valid session still brands it.
  const onHost = clientAppHost();
  if (onHost) {
    return (
      <ClientLoginForm logoSrc={getChromeLogoSrcForTenant(onHost.tenantId)} businessName={getBusinessProfileForTenant(onHost.tenantId).businessName} />
    );
  }
  const tenant = resolveCurrentTenant();
  const logoSrc = tenant ? getChromeLogoSrc() : null;
  const businessName = tenant ? getBusinessProfile().businessName : "";
  return <ClientLoginForm logoSrc={logoSrc} businessName={businessName} />;
}
