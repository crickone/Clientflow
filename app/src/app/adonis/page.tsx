import { getCurrentTenant } from "@/lib/db/tenant";
import { getCurrentMembership } from "@/lib/auth";
import { AdonisView } from "@/components/adonis/AdonisView";
import { transcribeConfigured } from "@/lib/ai/voiceTranscribe";

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

export default async function AdonisPage() {
  const tenantId = getCurrentTenant().id;
  const isAdmin = getCurrentMembership()?.role === "admin";
  // Voice T2: computed here (server component — process.env is safe to
  // read) and passed down as a plain boolean, same pattern as
  // `openRouterConfigured` in app/agents/[key]/page.tsx — AdonisView/
  // AssistantChat are client components and must never read process.env
  // themselves.
  const voiceEnabled = transcribeConfigured();
  return <AdonisView tenantId={tenantId} isAdmin={isAdmin} voiceEnabled={voiceEnabled} />;
}
