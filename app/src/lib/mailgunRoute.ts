import "server-only";

import { readKeyForTenant, setKey } from "@/lib/settings";
import { recordSentMessage } from "@/lib/imapEmail";
import { getSendingDomain } from "@/lib/marketing/domains";
import { getCampaignSender } from "@/lib/marketing/sender";
import { mailgunFromAddress } from "@/lib/mailgunRouteModel";

/**
 * One-to-one email (receipts, vouchers, inbox replies) for a business whose
 * mailbox is connected over IMAP but whose outgoing SMTP server can't be
 * reached from our host: those emails go out through the business's own
 * verified Mailgun domain instead, from <mailbox name>@<domain>, with replies
 * to the real mailbox so they come back in through IMAP. Switched on when the
 * mailbox is connected and SMTP is unreachable; off when SMTP works.
 */
const ROUTE_KEY = "imap_send_via_mailgun";

/** The verified domain to send through, or null when this business sends over its own SMTP. */
export function mailgunRouteDomain(tenantId: number): string | null {
  if (!readKeyForTenant<boolean>(tenantId, ROUTE_KEY, false)) return null;
  const d = getSendingDomain(tenantId);
  return d && d.state === "verified" ? d.domain : null;
}

/** For the CURRENT tenant (called from the connect action). */
export function setMailgunRoute(on: boolean): void {
  setKey(ROUTE_KEY, on);
}

export async function sendThroughMailgun(
  tenantId: number,
  domain: string,
  opts: {
    fromName: string;
    mailboxEmail: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
    inReplyTo?: string;
    references?: string;
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const headers: Record<string, string> = { "Reply-To": opts.replyTo || opts.mailboxEmail };
  if (opts.inReplyTo) headers["In-Reply-To"] = opts.inReplyTo;
  if (opts.references) headers["References"] = opts.references;
  const res = await getCampaignSender(tenantId).send(
    domain,
    { name: opts.fromName, email: mailgunFromAddress(opts.mailboxEmail, domain) },
    { to: opts.to, subject: opts.subject, html: opts.html, text: opts.text, headers, tags: ["one-to-one"], tracking: false, tenantId },
  );
  if (!res.ok) return { ok: false, error: res.error };
  recordSentMessage(
    tenantId,
    opts.mailboxEmail,
    { fromName: opts.fromName, to: opts.to, subject: opts.subject, html: opts.html, inReplyTo: opts.inReplyTo, references: opts.references },
    res.providerId,
    opts.text,
  );
  return { ok: true, id: res.providerId };
}
