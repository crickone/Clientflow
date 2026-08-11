/**
 * CampaignSender — the swappable email-SENDING adapter for the GHL-style
 * email marketing add-on (Task 3; Task 1 built credits — lib/email/
 * credits.ts — Task 2 built contacts/suppressions — lib/marketing/
 * contactImport.ts). One interface, one concrete implementation today
 * (MailgunSender, see ./mailgun.ts), resolved via getCampaignSender
 * (./index.ts) — mirrors lib/ai/providers' ModelProvider/getProvider shape
 * exactly: an interface + concrete impl(s) + a resolver, one stateless
 * instance per process. This file is pure types (no runtime code), so —
 * like lib/ai/providers/types.ts — it deliberately has no `import
 * "server-only"`: nothing here needs it, and a client component may still
 * type-only import from it (the import erases at compile time).
 *
 * Subaccount-ready: `CampaignSender.send` takes `fromDomain` PER CALL rather
 * than baking it into the sender instance, so a future per-tenant Mailgun
 * SUBACCOUNT (or an entirely different provider per tenant) can be threaded
 * through later without reshaping this interface.
 */

/**
 * One outbound campaign email. `campaignId`/`contactId`/`tenantId` travel
 * HERE (on the message) rather than as extra `send()` parameters, because
 * `CampaignSender.send`'s signature is fixed at (fromDomain, from, msg) —
 * MailgunSender injects them as Mailgun `v:`-prefixed user-variables, which
 * is the ONLY way Task 7's webhook route will later be able to resolve an
 * inbound delivery/bounce/complaint event back to "which campaign, which
 * contact, which tenant" (see parseMailgunEvent in ./mailgun.ts, which reads
 * campaignId/tenantId back out of the webhook's `user-variables`). All three
 * are optional so a one-off/manual send with no campaign yet can still go
 * through `send`.
 */
export interface CampaignMessage {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
  /** Extra RFC-5322 headers (e.g. List-Unsubscribe) — sent to Mailgun as `h:<Name>`. Never a `v:` user-variable. */
  headers?: Record<string, string>;
  tags?: string[];
  campaignId?: number;
  contactId?: number;
  tenantId?: number;
}

/** Every CampaignSender method returns a typed result instead of throwing — see CampaignSender's own doc comment for why. */
export type CampaignSendResult = { ok: true; providerId: string } | { ok: false; error: string };

export interface DomainStatus {
  state: "unverified" | "verified" | "failed";
  dnsRecords: { type: string; name: string; value: string }[];
}

/**
 * A parsed Mailgun webhook event — produced by parseMailgunEvent (see
 * ./mailgun.ts), which Task 7's webhook route will import and consume.
 * `severity` is only ever set on a `"failed"` event ("permanent" = hard
 * bounce, "temporary" = soft bounce).
 */
export interface MailgunEvent {
  event: "delivered" | "failed" | "complained" | "unsubscribed" | "opened" | "clicked";
  recipient: string;
  messageId: string;
  severity?: "temporary" | "permanent";
  campaignId?: number;
  tenantId?: number;
}

/**
 * The sending engine, behind a swappable interface — nothing outside an
 * implementation of this should ever call a provider's HTTP API directly.
 * Every method is async and MUST NEVER THROW: implementations return a typed
 * `{ok:false,error}` for every failure (network, auth, validation, missing
 * config) instead, so a caller never needs a try/catch around a send.
 */
export interface CampaignSender {
  /** Register a sending domain with the provider; returns the DNS records the caller must publish to verify it. */
  registerDomain(
    domain: string,
  ): Promise<{ ok: true; id: string; dnsRecords: DomainStatus["dnsRecords"] } | { ok: false; error: string }>;
  /** Re-check a previously registered domain's verification state (forces a fresh DNS check, not a cached read). */
  getDomainStatus(domain: string): Promise<{ ok: true; status: DomainStatus } | { ok: false; error: string }>;
  /** Send one campaign email FROM `fromDomain` (must already be a verified sending domain). */
  send(
    fromDomain: string,
    from: { name: string; email: string },
    msg: CampaignMessage,
  ): Promise<CampaignSendResult>;
}
