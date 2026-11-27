/**
 * The tenant this browser tab was RENDERED for, for requests that do not go
 * through `window.fetch`.
 *
 * TenantTabGuard stamps every same-origin /api fetch with TENANT_STAMP_HEADER.
 * An XMLHttpRequest (used where upload progress is needed) bypasses that
 * wrapper, so the guard also records the tab's tenant here and such callers
 * add `tabTenantHeaders()` themselves. When one of them gets the stale-tab 409,
 * `reportTenantMismatch` hands it to the guard, which takes the screen exactly
 * as it does for a fetch. Browser-only state; no server imports.
 */
import { TENANT_MISMATCH_CODE, TENANT_STAMP_HEADER } from "./tenantStampRules";

let tabTenantId: number | null = null;

/** Called by TenantTabGuard. Null when the page has no tenant (login and the like). */
export function setTabTenant(id: number | null): void {
  tabTenantId = id;
}

/** The stamp header for this tab, or nothing when there is no tenant to stamp. */
export function tabTenantHeaders(): Record<string, string> {
  return tabTenantId == null ? {} : { [TENANT_STAMP_HEADER]: String(tabTenantId) };
}

export const TENANT_MISMATCH_EVENT = "adonis:tenant-mismatch";

/** The stale-tab message from a 409 body, or null when the answer is anything else. Pure. */
export function tenantMismatchMessage(status: number, body: string): string | null {
  if (status !== 409) return null;
  try {
    const parsed = JSON.parse(body) as { code?: unknown; error?: unknown };
    if (parsed?.code !== TENANT_MISMATCH_CODE) return null;
    return typeof parsed.error === "string" && parsed.error ? parsed.error : "This tab is on a different account. Reload it.";
  } catch {
    return null;
  }
}

/** Tell TenantTabGuard this tab is stale (from a request it could not see). */
export function reportTenantMismatch(message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(TENANT_MISMATCH_EVENT, { detail: message }));
}
