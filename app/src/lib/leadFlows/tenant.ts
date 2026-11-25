import "server-only";

import { boundTenantId, getTenantById, resolveCurrentTenant } from "@/lib/db/tenant";

/**
 * The tenant the lead flows are working for: the runWithTenant binding
 * (ticker, webhooks, tests) first, else the request's business. Never
 * getCurrentTenant(), which ignores the binding.
 */
export function flowTenant(): { id: number; slug: string } | null {
  let id = boundTenantId();
  if (id == null) {
    try {
      id = resolveCurrentTenant()?.id ?? null;
    } catch {
      id = null;
    }
  }
  if (id == null) return null;
  const t = getTenantById(id);
  return t ? { id: t.id, slug: t.slug } : null;
}
