import "server-only";

import { eq } from "drizzle-orm";

import { getTenantDbById } from "@/lib/db/tenant";
import { sendingDomains, type SendingDomain } from "@/lib/db/schema";
import { getCampaignSender } from "@/lib/marketing/sender";
import type { DomainStatus } from "@/lib/marketing/sender/types";

/**
 * Per-tenant sending-domain CRUD + verify — the record-keeping half of
 * "connect a sending domain" (the HTTP calls themselves live behind
 * CampaignSender; see ./sender). Every function here takes `tenantId` as an
 * EXPLICIT parameter and always resolves the tenant DB via
 * getTenantDbById(tenantId) — never the ambient request-scoped `db` proxy —
 * mirroring lib/imapEmail.ts's smtpSend/syncImapInbox: a function shaped
 * this way must stay safe to call from a background job (e.g. a future
 * periodic re-verify sweep across every tenant) with no request/cookie
 * context at all, and the ambient `db` proxy would silently resolve to the
 * wrong tenant (or the default tenant) in that case.
 *
 * `sending_domains` has no tenant_id column — it lives inside the tenant's
 * OWN db file, so the file itself is already the tenant scope (see
 * schema.ts). "One active domain per tenant" is therefore enforced HERE, at
 * the application layer: connectDomain always updates the existing row if
 * one exists rather than ever allowing a second row.
 */

export interface SendingDomainRecord {
  domain: string;
  mailgunDomainId: string | null;
  state: "unverified" | "verified" | "failed";
  dnsRecords: DomainStatus["dnsRecords"];
  verifiedAt: number | null; // epoch ms
  createdAt: number; // epoch ms
}

function parseDnsRecords(raw: string | null): DomainStatus["dnsRecords"] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as DomainStatus["dnsRecords"]) : [];
  } catch {
    return [];
  }
}

function toRecord(row: SendingDomain): SendingDomainRecord {
  return {
    domain: row.domain,
    mailgunDomainId: row.mailgunDomainId,
    state: row.state as SendingDomainRecord["state"],
    dnsRecords: parseDnsRecords(row.dnsRecords),
    verifiedAt: row.verifiedAt ? row.verifiedAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
  };
}

/** The tenant's one sending domain, or null if none has been connected yet. */
export function getSendingDomain(tenantId: number): SendingDomainRecord | null {
  const tdb = getTenantDbById(tenantId);
  const row = tdb.select().from(sendingDomains).get();
  return row ? toRecord(row) : null;
}

/**
 * Connect (or replace) the tenant's sending domain: registers it with the
 * tenant's CampaignSender, then stores it UNVERIFIED with the DNS records
 * the provider wants published. Always the update-if-exists path (see the
 * module doc comment) — a tenant reconnecting/retrying a domain replaces its
 * one row rather than accumulating history. Never throws (registerDomain
 * itself never throws — see CampaignSender's doc comment); a provider
 * failure comes back as `{ok:false,error}` and nothing is written.
 */
export async function connectDomain(
  tenantId: number,
  domain: string,
): Promise<{ ok: true; record: SendingDomainRecord } | { ok: false; error: string }> {
  const clean = domain.trim().toLowerCase();
  if (!clean) return { ok: false, error: "Enter a domain." };

  const sender = getCampaignSender(tenantId);
  const registered = await sender.registerDomain(clean);
  if (!registered.ok) return { ok: false, error: registered.error };

  const tdb = getTenantDbById(tenantId);
  const existing = tdb.select({ id: sendingDomains.id }).from(sendingDomains).get();
  const values = {
    domain: clean,
    mailgunDomainId: registered.id,
    state: "unverified" as const,
    dnsRecords: JSON.stringify(registered.dnsRecords),
    verifiedAt: null,
  };
  if (existing) {
    tdb.update(sendingDomains).set(values).where(eq(sendingDomains.id, existing.id)).run();
  } else {
    tdb.insert(sendingDomains).values(values).run();
  }

  const record = getSendingDomain(tenantId);
  // Can't be null — the row was just written above, on the same connection.
  return { ok: true, record: record! };
}

/**
 * Re-check the tenant's connected domain against the provider and persist
 * any state change — "Check verification" in the UI. `verifiedAt` is set the
 * first time (and only the first time) the provider reports "verified";
 * later refreshes that stay verified don't re-stamp it.
 */
export async function refreshDomainStatus(
  tenantId: number,
): Promise<{ ok: true; record: SendingDomainRecord } | { ok: false; error: string }> {
  const tdb = getTenantDbById(tenantId);
  const existing = tdb.select().from(sendingDomains).get();
  if (!existing) return { ok: false, error: "No sending domain connected yet." };

  const sender = getCampaignSender(tenantId);
  const status = await sender.getDomainStatus(existing.domain);
  if (!status.ok) return { ok: false, error: status.error };

  tdb
    .update(sendingDomains)
    .set({
      state: status.status.state,
      dnsRecords: JSON.stringify(status.status.dnsRecords),
      verifiedAt: status.status.state === "verified" ? (existing.verifiedAt ?? new Date()) : existing.verifiedAt,
    })
    .where(eq(sendingDomains.id, existing.id))
    .run();

  const record = getSendingDomain(tenantId);
  return { ok: true, record: record! };
}

/** Disconnect (remove) the tenant's sending domain, if any. A no-op if none is connected. */
export function disconnectDomain(tenantId: number): void {
  const tdb = getTenantDbById(tenantId);
  tdb.delete(sendingDomains).run();
}
