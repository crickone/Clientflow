// app/src/lib/adonisMap/decisions.ts
import "server-only";

import { leadDisplayName, loadPeopleData, sqliteFor, type ClientFull, type LeadFull } from "./peopleData";
import type { JoinReason } from "./person";

export interface LinkLine {
  leadId: number;
  clientId: number;
  name: string;
  detail: string;
  reason: string;
  canUnlink: boolean;
  href: string;
}

const JOIN_TEXT: Record<JoinReason, string> = {
  converted: "Converted",
  rules: "Same email or phone and first name",
  decided: "Joined by staff",
};

const detailOf = (r: { email: string | null; phone: string | null }) => [r.email, r.phone].filter(Boolean).join(" · ");

/** Records a staff decision on a lead/client pair. False when either record doesn't exist in this business. */
export function setDecision(tenantId: number, leadId: number, clientId: number, decision: "join" | "separate", userId: number | null): boolean {
  const sq = sqliteFor(tenantId);
  const lead = sq.prepare("SELECT id FROM leads WHERE id = ?").get(leadId);
  const client = sq.prepare("SELECT id FROM clients WHERE id = ?").get(clientId);
  if (!lead || !client) return false;
  sq.prepare(
    `INSERT INTO person_link_decisions (lead_id, client_id, decision, decided_by_user_id, decided_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(lead_id, client_id) DO UPDATE SET decision = excluded.decision,
       decided_by_user_id = excluded.decided_by_user_id, decided_at = excluded.decided_at`,
  ).run(leadId, clientId, decision, userId, Date.now());
  return true;
}

export function personLinksForClient(tenantId: number, clientId: number): { linked: LinkLine[]; reviews: LinkLine[] } {
  const p = loadPeopleData(sqliteFor(tenantId));
  const line = (l: LeadFull, reason: string, canUnlink: boolean): LinkLine => ({
    leadId: l.id, clientId, name: leadDisplayName(l), detail: detailOf(l), reason, canUnlink, href: `/leads/${l.id}`,
  });
  const linked = (p.index.clientLeads.get(clientId) ?? []).flatMap((id) => {
    const l = p.leadById.get(id);
    const why = p.index.joinReason.get(id) ?? "rules";
    return l ? [line(l, JOIN_TEXT[why], why !== "converted")] : [];
  });
  const reviews = p.index.reviews.filter((r) => r.clientId === clientId).flatMap((r) => {
    const l = p.leadById.get(r.leadId);
    return l ? [line(l, r.reason, false)] : [];
  });
  return { linked, reviews };
}

export function personLinksForLead(tenantId: number, leadId: number): { linked: LinkLine[]; reviews: LinkLine[] } {
  const p = loadPeopleData(sqliteFor(tenantId));
  const line = (c: ClientFull, reason: string, canUnlink: boolean): LinkLine => ({
    leadId, clientId: c.id, name: `${c.firstName} ${c.lastName}`.trim(), detail: detailOf(c), reason, canUnlink, href: `/clients/${c.id}`,
  });
  const linked: LinkLine[] = [];
  const pid = p.index.leadPerson.get(leadId);
  if (pid?.startsWith("c:")) {
    const c = p.clientById.get(Number(pid.slice(2)));
    const why = p.index.joinReason.get(leadId) ?? "rules";
    if (c) linked.push(line(c, JOIN_TEXT[why], why !== "converted"));
  }
  const reviews = p.index.reviews.filter((r) => r.leadId === leadId).flatMap((r) => {
    const c = p.clientById.get(r.clientId);
    return c ? [line(c, r.reason, false)] : [];
  });
  return { linked, reviews };
}
