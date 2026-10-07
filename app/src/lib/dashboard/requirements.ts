import "server-only";

import { getSiteAvailability } from "@/lib/campaigns/store";
import { getSendingDomain } from "@/lib/marketing/domains";
import { listCompetitors } from "@/lib/research/store";
import { hasSocialConnection } from "@/lib/social/metrics";
import { isAnalyticsConnected, isGoogleProfileConnected, isSearchConsoleConnected } from "@/lib/google/business";
import type { Requirement } from "./types";

export const REQUIREMENT_CTA: Record<Requirement, { title: string; body: string; href: string; action: string }> = {
  site: {
    title: "Add your website",
    body: "This widget reads your website's data.",
    href: "/cms",
    action: "Open websites",
  },
  sendingDomain: {
    title: "Connect a sending domain",
    body: "Email results appear once a verified domain sends.",
    href: "/campaigns/domains",
    action: "Connect domain",
  },
  social: {
    title: "Connect Facebook",
    body: "Connect your Facebook Page (and its Instagram) to see your social numbers.",
    href: "/settings/integrations/facebook",
    action: "Connect Facebook",
  },
  google: {
    title: "Connect Google",
    body: "Connect your Google Business Profile to see how people find you in Search and Maps.",
    href: "/settings/integrations/google",
    action: "Connect Google",
  },
  searchConsole: {
    title: "Connect Search Console",
    body: "Pick your website in Search Console to see what people search before they click through.",
    href: "/settings/integrations/google",
    action: "Open Google settings",
  },
  analytics: {
    title: "Connect Google Analytics",
    body: "Pick your Analytics property to see visits to your website.",
    href: "/settings/integrations/google",
    action: "Open Google settings",
  },
  competitors: {
    title: "Add competitors",
    body: "Track local competitors to compare ratings.",
    href: "/marketing/research",
    action: "Open research",
  },
};

async function safe(fn: () => boolean | Promise<boolean>): Promise<boolean> {
  try {
    return await fn();
  } catch {
    return false;
  }
}

export async function checkRequirements(tenantId: number): Promise<Record<Requirement, boolean>> {
  const [site, sendingDomain, competitors, social, google, searchConsole, analytics] = await Promise.all([
    safe(async () => (await getSiteAvailability()).siteCount > 0),
    safe(() => getSendingDomain(tenantId)?.state === "verified"),
    safe(() => listCompetitors({ trackedOnly: true, excludeSelf: true }).length > 0),
    safe(() => hasSocialConnection(tenantId)),
    safe(() => isGoogleProfileConnected(tenantId)),
    safe(() => isSearchConsoleConnected(tenantId)),
    safe(() => isAnalyticsConnected(tenantId)),
  ]);
  return { site, sendingDomain, competitors, social, google, searchConsole, analytics };
}
