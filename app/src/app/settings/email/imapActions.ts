"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin, getCurrentMembership } from "@/lib/auth";
import { deleteImapConnection, saveImapConnection, testImapConnection } from "@/lib/imapEmail";
import { getSendingDomain } from "@/lib/marketing/domains";
import { setMailgunRoute } from "@/lib/mailgunRoute";
import { mailgunFromAddress } from "@/lib/mailgunRouteModel";

/**
 * Server actions for connecting/testing/disconnecting a tenant's own
 * IMAP/SMTP mailbox (the generic "bring your own mailbox" counterpart to
 * gmailActions.ts's OAuth-based connect/disconnect). Mirrors gmailActions.ts's
 * gating exactly: every action is admin-only, and the tenant is always the
 * SERVER's idea of "current membership" — never a value the client supplies.
 *
 * Only the three actions below + their two types are exported. Every export
 * of a "use server" file is a public, directly-callable endpoint, so the zod
 * schema, the tenantId() helper, and the credsFromInput() mapper all stay
 * private to this module.
 */

export type ImapActionResult = { ok: true; note?: string } | { ok: false; error: string };

/**
 * Our host can't reach the mailbox's outgoing (SMTP) server, but the mailbox
 * itself signed in. With a verified sending domain that's fine: email goes
 * out through it. Returns the note to show, or the error when there's no
 * verified domain to fall back on.
 */
function blockedSmtpOutcome(email: string): { ok: true; note: string; domain: string } | { ok: false; error: string } {
  const d = getSendingDomain(tenantId());
  if (d && d.state === "verified") {
    return {
      ok: true,
      domain: d.domain,
      note: `Your mailbox signed in. Its outgoing server can't be reached from Adonis, so emails will send as ${mailgunFromAddress(email, d.domain)} through your verified domain, with replies going to ${email}.`,
    };
  }
  return {
    ok: false,
    error:
      "Your mailbox signed in, but Adonis can't reach its outgoing server. Verify a sending domain under Messaging > Sending domains, then connect again: Adonis will send through that domain instead.",
  };
}

/** Form input for connecting/testing a mailbox. `username` is not collected — it defaults to `email`. */
export type ImapFormInput = {
  email: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  fromName?: string;
};

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  imapHost: z.string().trim().min(1, "IMAP host is required"),
  imapPort: z.number().int("Port must be a whole number").min(1).max(65535),
  imapSecure: z.boolean(),
  smtpHost: z.string().trim().min(1, "SMTP host is required"),
  smtpPort: z.number().int("Port must be a whole number").min(1).max(65535),
  smtpSecure: z.boolean(),
  fromName: z.string().trim().max(120).optional(),
});

/** The current session's tenant — NEVER read from client input. Throws if unauthenticated. */
function tenantId(): number {
  const m = getCurrentMembership();
  if (!m) throw new Error("UNAUTHENTICATED");
  return m.tenant.id;
}

/** Maps validated form input to the credential shape testImapConnection expects (username = email). */
function credsFromInput(d: z.infer<typeof schema>) {
  return {
    imapHost: d.imapHost,
    imapPort: d.imapPort,
    imapSecure: d.imapSecure,
    smtpHost: d.smtpHost,
    smtpPort: d.smtpPort,
    smtpSecure: d.smtpSecure,
    username: d.email,
    password: d.password,
  };
}

/** Verify a candidate IMAP/SMTP credential pair actually works, without saving it. */
export async function testImapConnectionAction(input: ImapFormInput): Promise<ImapActionResult> {
  await requireAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const res = await testImapConnection(credsFromInput(parsed.data));
  if (!res.ok && res.smtpUnreachable) {
    const out = blockedSmtpOutcome(parsed.data.email);
    return out.ok ? { ok: true, note: out.note } : out;
  }
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * Verify then save a tenant's IMAP/SMTP mailbox connection. Always re-tests
 * the credentials first and never persists on a failed test — the same
 * "only store what was just proven to work" shape as the Gmail OAuth
 * callback, which only ever stores tokens Google itself just validated.
 */
export async function connectImapAction(input: ImapFormInput): Promise<ImapActionResult> {
  const me = await requireAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const d = parsed.data;

  const test = await testImapConnection(credsFromInput(d));
  let note: string | undefined;
  if (!test.ok) {
    if (!test.smtpUnreachable) return { ok: false, error: test.error };
    const out = blockedSmtpOutcome(d.email);
    if (!out.ok) return out;
    note = out.note;
  }

  saveImapConnection({
    tenantId: tenantId(),
    email: d.email,
    imapHost: d.imapHost,
    imapPort: d.imapPort,
    imapSecure: d.imapSecure,
    smtpHost: d.smtpHost,
    smtpPort: d.smtpPort,
    smtpSecure: d.smtpSecure,
    username: d.email,
    password: d.password,
    fromName: d.fromName || undefined,
    connectedByUserId: me.id,
  });
  setMailgunRoute(Boolean(note));
  revalidatePath("/settings/email");
  revalidatePath("/communication");
  return note ? { ok: true, note } : { ok: true };
}

/** Disconnect the current tenant's IMAP/SMTP mailbox. */
export async function disconnectImapAction(): Promise<ImapActionResult> {
  await requireAdmin();
  deleteImapConnection(tenantId());
  revalidatePath("/settings/email");
  revalidatePath("/communication");
  return { ok: true };
}
