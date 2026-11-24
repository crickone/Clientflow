/**
 * Pure rules for sending a business's one-to-one email through its verified
 * Mailgun domain when its own mailbox can receive (IMAP) but its outgoing
 * server can't be reached from our host (Railway blocks SMTP ports 25, 465
 * and 587 on its smaller plans). See lib/mailgunRoute.ts.
 */

/** A connection that never got through (blocked port, no answer), as opposed to a wrong password. */
export function isUnreachableSmtpError(message: string): boolean {
  return /ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ESOCKET|ECONNECTION|timed? ?out|Greeting never received|Connection closed unexpectedly/i.test(message);
}

/** The mailbox's own name on the verified domain: info@example.ie + mg.example.ie -> info@mg.example.ie. */
export function mailgunFromAddress(mailboxEmail: string, domain: string): string {
  const local = (mailboxEmail.split("@")[0] || "hello").trim().toLowerCase().replace(/[^a-z0-9._+-]/g, "") || "hello";
  return `${local}@${domain.trim().toLowerCase()}`;
}
