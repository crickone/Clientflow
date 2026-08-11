import "server-only";

import { MailgunSender, parseMailgunEvent, verifyMailgunSignature } from "./mailgun";
import type { CampaignSender } from "./types";

export * from "./types";
export { MailgunSender, parseMailgunEvent, verifyMailgunSignature };

// Stateless — all per-call state lives in the call args (fromDomain, msg,
// …), never on the instance — same lifecycle reasoning as
// lib/ai/providers/index.ts's cached provider instances. One instance for
// the whole process.
const mailgunSender = new MailgunSender();

/**
 * Resolves a tenant to the CampaignSender that sends its campaign email.
 * Single provider today (Mailgun) regardless of `tenantId` — the parameter
 * exists now, unused, so a future per-tenant Mailgun SUBACCOUNT (or an
 * entirely different provider per tenant) can be resolved here later without
 * reshaping every call site. Same "id in, adapter out" shape as
 * lib/ai/providers' getProvider(model).
 */
export function getCampaignSender(tenantId: number): CampaignSender {
  void tenantId;
  return mailgunSender;
}
