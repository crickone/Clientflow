"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/queries";
import {
  connectDomain,
  disconnectDomain,
  refreshDomainStatus,
  type SendingDomainRecord,
} from "@/lib/marketing/domains";

/**
 * Server actions for connecting/checking/disconnecting the CURRENT tenant's
 * campaign sending domain. Mirrors imapActions.ts's gating exactly: every
 * action is admin-only, and the tenant is always the SERVER's idea of
 * "current membership" (getCurrentMembership) — never a value the client
 * supplies. Only the three actions below + the result type are exported.
 */

export type DomainActionResult = { ok: true; record: SendingDomainRecord } | { ok: false; error: string };

// Basic hostname shape check (>=2 labels, valid label chars) — defense in
// depth at the edge; the provider's own API is still the real validator.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** The current session's tenant — NEVER read from client input. Throws if unauthenticated. */
function tenantId(): number {
  const m = getCurrentMembership();
  if (!m) throw new Error("UNAUTHENTICATED");
  return m.tenant.id;
}

/** Connect (or replace) the tenant's sending domain and store the DNS records the provider wants published. */
export async function connectSendingDomainAction(domain: string): Promise<DomainActionResult> {
  await requireAdmin();
  const clean = String(domain ?? "").trim().toLowerCase();
  if (!clean) return { ok: false, error: "Enter a domain." };
  if (!DOMAIN_RE.test(clean)) {
    return { ok: false, error: "Enter a valid domain (e.g. mail.yourbusiness.com)." };
  }

  const result = await connectDomain(tenantId(), clean);
  if (!result.ok) return result;

  await logActivity("domains.connect", `Connected sending domain ${result.record.domain}`);
  revalidatePath("/campaigns/domains");
  return result;
}

/** Re-check the tenant's connected domain against the provider ("Check verification"). */
export async function refreshSendingDomainAction(): Promise<DomainActionResult> {
  await requireAdmin();
  const result = await refreshDomainStatus(tenantId());
  if (!result.ok) return result;

  revalidatePath("/campaigns/domains");
  return result;
}

/** Disconnect the current tenant's sending domain. */
export async function disconnectSendingDomainAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  disconnectDomain(tenantId());
  await logActivity("domains.disconnect", "Disconnected sending domain");
  revalidatePath("/campaigns/domains");
  return { ok: true };
}
