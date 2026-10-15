import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { cancellationRequests } from "@/lib/db/schema";
import { clientMembership } from "@/lib/clientApp";
import { addClientMessage } from "@/lib/clientMessages";
import { escapeHtml, renderEmailShell, sendEmail } from "@/lib/email";
import { setClientMembershipStatus } from "@/lib/memberships";
import { logActivity } from "@/lib/queries";

/**
 * A member's notice to cancel, sent from the app, for the CURRENT tenant
 * (ambient `db`). It records the date notice was given, puts a line on the
 * member's thread in the inbox, and emails the member a copy as their written
 * notice. Staff then end the membership or keep it.
 */

export type CancellationRequest = typeof cancellationRequests.$inferSelect;

function fmt(ms: number): string {
  return new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Dublin" });
}

export function pendingRequest(clientId: number): CancellationRequest | null {
  return (
    db
      .select()
      .from(cancellationRequests)
      .where(and(eq(cancellationRequests.clientId, clientId), eq(cancellationRequests.status, "pending")))
      .orderBy(desc(cancellationRequests.requestedAt))
      .get() ?? null
  );
}

/** The latest request of any status, for the staff view. */
export function latestRequest(clientId: number): CancellationRequest | null {
  return db.select().from(cancellationRequests).where(eq(cancellationRequests.clientId, clientId)).orderBy(desc(cancellationRequests.requestedAt)).get() ?? null;
}

export async function requestCancel(input: {
  client: { id: number; firstName: string; lastName: string; email: string | null };
  businessName: string;
  reason: string;
}): Promise<{ ok: true; request: CancellationRequest; emailed: boolean } | { ok: false; error: string }> {
  const m = clientMembership(input.client.id);
  if (!m) return { ok: false, error: "You don't have an active membership to cancel." };
  const already = pendingRequest(input.client.id);
  if (already) return { ok: true, request: already, emailed: false };

  const reason = input.reason.replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const now = Date.now();
  const [request] = db
    .insert(cancellationRequests)
    .values({ clientId: input.client.id, membershipId: m.id, membershipName: m.name, reason, status: "pending", requestedAt: now })
    .returning()
    .all();

  const who = `${input.client.firstName} ${input.client.lastName}`.trim();
  addClientMessage({
    clientId: input.client.id,
    direction: "inbound",
    channel: "system",
    content: `Cancellation notice from the app: ${who} asked to cancel ${m.name} on ${fmt(now)}.${reason ? ` Reason: ${reason}` : ""}`,
  });
  await logActivity("membership.cancel_request", `${who} asked to cancel ${m.name} in the app`, { clientId: input.client.id, requestId: request.id });

  let emailed = false;
  if (input.client.email) {
    const body = `<p>Hi ${escapeHtml(input.client.firstName)},</p>
<p>We got your notice to cancel your ${escapeHtml(m.name)} membership, sent from the app on ${fmt(now)}. Keep this email as your copy.</p>
<p>${escapeHtml(input.businessName)} will be in touch to confirm your last payment and the date your membership ends.</p>`;
    const r = await sendEmail({
      to: input.client.email,
      subject: `Your cancellation notice for ${m.name}`,
      html: renderEmailShell({ businessName: input.businessName, heading: "Cancellation notice received", bodyHtml: body }),
      text: `Hi ${input.client.firstName},\n\nWe got your notice to cancel your ${m.name} membership, sent from the app on ${fmt(now)}. Keep this email as your copy.\n\n${input.businessName} will be in touch to confirm your last payment and the date your membership ends.`,
    });
    emailed = r.ok;
  }
  return { ok: true, request, emailed };
}

export function withdrawRequest(clientId: number): boolean {
  const p = pendingRequest(clientId);
  if (!p) return false;
  db.update(cancellationRequests).set({ status: "withdrawn", handledAt: Date.now() }).where(eq(cancellationRequests.id, p.id)).run();
  addClientMessage({ clientId, direction: "inbound", channel: "system", content: `Cancellation notice withdrawn in the app on ${fmt(Date.now())}. ${p.membershipName} continues.` });
  return true;
}

/** Staff: end the membership, or keep it, and close the request. */
export function handleRequest(clientId: number, requestId: number, outcome: "ended" | "kept"): boolean {
  const r = db
    .select()
    .from(cancellationRequests)
    .where(and(eq(cancellationRequests.id, requestId), eq(cancellationRequests.clientId, clientId), eq(cancellationRequests.status, "pending")))
    .get();
  if (!r) return false;
  if (outcome === "ended" && r.membershipId) setClientMembershipStatus(r.membershipId, "cancelled");
  db.update(cancellationRequests).set({ status: "done", outcome, handledAt: Date.now() }).where(eq(cancellationRequests.id, r.id)).run();
  addClientMessage({
    clientId,
    direction: "note",
    channel: "system",
    content: outcome === "ended" ? `${r.membershipName} ended after the cancellation notice of ${fmt(r.requestedAt)}.` : `Cancellation notice of ${fmt(r.requestedAt)} closed. ${r.membershipName} kept.`,
  });
  return true;
}
