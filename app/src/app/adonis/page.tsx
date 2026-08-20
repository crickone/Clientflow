import { getCurrentTenant } from "@/lib/db/tenant";
import { AdonisView } from "@/components/adonis/AdonisView";

// Mirrors dashboard/page.tsx: no page-level auth guard call — the root
// layout (`src/app/layout.tsx`) already redirects any signed-in-but-
// unresolved session to /select-account and any signed-out visitor to
// /login before this ever renders, and `getCurrentTenant()` fails closed
// (see the 2026-08-12 multitenancy hardening) if that invariant is ever
// broken. Staff-visible, NOT admin-only — the Orchestrator ("Adonis") chat
// is staff-facing today, same as its embed on the dashboard.
export const dynamic = "force-dynamic";

export default async function AdonisPage() {
  const tenantId = getCurrentTenant().id;
  return <AdonisView tenantId={tenantId} />;
}
