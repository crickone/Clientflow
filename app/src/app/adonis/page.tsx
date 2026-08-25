import { getCurrentTenant } from "@/lib/db/tenant";
import { getCurrentMembership } from "@/lib/auth";
import { AdonisView } from "@/components/adonis/AdonisView";
import { transcribeConfigured } from "@/lib/ai/voiceTranscribe";
import { campaignSeedStarterMessage } from "@/components/marketing/buildCampaignSeed";

// Mirrors dashboard/page.tsx: no page-level auth guard call — a signed-out
// visitor is redirected to /login by `middleware.ts` at the edge before
// React runs, the root layout (`src/app/layout.tsx`) redirects any signed-
// in-but-unresolved session to /select-account for non-bare paths, and
// `getCurrentTenant()` fails closed (see the 2026-08-12 multitenancy
// hardening) if either invariant is ever bypassed. Staff-visible, NOT
// admin-only — the Orchestrator ("Adonis") chat is staff-facing today, same
// as its embed on the dashboard. `isAdmin` only gates the settings gear,
// whose target (/agents) is itself requireAdminPage()-gated, so we don't
// render a control that would silently bounce a non-admin.
export const dynamic = "force-dynamic";

export default async function AdonisPage({
  searchParams,
}: {
  searchParams: { seedName?: string; season?: string; startsOn?: string; endsOn?: string; angle?: string };
}) {
  const tenantId = getCurrentTenant().id;
  const isAdmin = getCurrentMembership()?.role === "admin";
  // Voice T2: computed here (server component — process.env is safe to
  // read) and passed down as a plain boolean — AdonisView/AssistantChat are
  // client components and must never read process.env themselves.
  const voiceEnabled = transcribeConfigured();
  // Campaign Engine "Build campaign" seed: a link from the seasonal calendar,
  // the campaign hub, or a research gap lands here with the 5 seed params (see
  // buildCampaignSeedHref, @/components/marketing/buildCampaignSeed). Decode
  // them into a pre-filled compose starter (never auto-sent — the operator
  // still reviews + hits send). Null for a bare /adonis visit. This is the one
  // and only agent chat in the app, so it's where "Build campaign" now lands.
  const initialInput = campaignSeedStarterMessage(searchParams) ?? undefined;
  return (
    // Key on the seed so a second "Build campaign" click with a DIFFERENT seed
    // (client-side nav, same route) remounts AdonisView — AssistantChat applies
    // `initialInput` only once per mount (its initialInputApplied ref), so
    // without a fresh mount the second seed would be silently dropped. A
    // seedless visit uses a constant key, so normal use never remounts.
    <AdonisView
      key={initialInput ?? "adonis"}
      tenantId={tenantId}
      isAdmin={isAdmin}
      voiceEnabled={voiceEnabled}
      initialInput={initialInput}
    />
  );
}
