// app/src/lib/adonisMap/person.ts
/**
 * One Person per human. Leads are LINKED to a client, never merged: the
 * records stay as they are and this index says which lead belongs to which
 * client. Worked out on every read from the records plus staff decisions.
 */
import { normalizePhone } from "@/lib/whatsapp/phone";
import { addDays } from "./engine";

export interface ClientRec { id: number; firstName: string; lastName: string; email: string | null; phone: string | null }
export interface LeadRec { id: number; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; clientId: number | null }
export interface Decision { leadId: number; clientId: number; decision: "join" | "separate" }
export type JoinReason = "converted" | "rules" | "decided";
export interface ReviewPair { leadId: number; clientId: number; reason: string }
export interface PeopleIndex {
  /** Person id for every lead: "c:<clientId>" when joined, else "l:<leadId>". */
  leadPerson: Map<number, string>;
  joinReason: Map<number, JoinReason>;
  /** The leads joined to each client, in lead order. */
  clientLeads: Map<number, number[]>;
  /** Pairs waiting for staff. */
  reviews: ReviewPair[];
}

export function emailKey(e: string | null | undefined): string {
  return (e ?? "").trim().toLowerCase();
}

/** E.164 digits, or "" when too short to trust as a match. */
export function phoneKey(p: string | null | undefined): string {
  const d = normalizePhone(p);
  return d.length >= 8 ? d : "";
}

export function firstKey(n: string | null | undefined): string {
  return (n ?? "").trim().toLowerCase();
}

/**
 * The rules:
 * - a lead with client_id set is that client (it converted);
 * - a staff "join" wins next; a staff "separate" removes that pair;
 * - one matching client (same email or phone) with the same first name joins;
 * - anything else that matches goes to review; name alone never matches.
 */
export function matchPeople(clients: ClientRec[], leads: LeadRec[], decisions: Decision[]): PeopleIndex {
  const byId = new Map(clients.map((c) => [c.id, c]));
  const byEmail = new Map<string, number[]>();
  const byPhone = new Map<string, number[]>();
  const add = (m: Map<string, number[]>, k: string, id: number) => {
    if (!k) return;
    const a = m.get(k) ?? [];
    if (!a.includes(id)) a.push(id);
    m.set(k, a);
  };
  for (const c of clients) {
    add(byEmail, emailKey(c.email), c.id);
    add(byPhone, phoneKey(c.phone), c.id);
  }
  const decided = new Map(decisions.map((d) => [`${d.leadId}:${d.clientId}`, d.decision]));

  const idx: PeopleIndex = { leadPerson: new Map(), joinReason: new Map(), clientLeads: new Map(), reviews: [] };
  const join = (leadId: number, clientId: number, why: JoinReason) => {
    idx.leadPerson.set(leadId, `c:${clientId}`);
    idx.joinReason.set(leadId, why);
    const a = idx.clientLeads.get(clientId) ?? [];
    a.push(leadId);
    idx.clientLeads.set(clientId, a);
  };

  for (const lead of leads) {
    if (lead.clientId !== null && byId.has(lead.clientId)) {
      join(lead.id, lead.clientId, "converted");
      continue;
    }
    const chosen = decisions.find((d) => d.leadId === lead.id && d.decision === "join" && byId.has(d.clientId));
    if (chosen) {
      join(lead.id, chosen.clientId, "decided");
      continue;
    }
    const e = emailKey(lead.email);
    const p = phoneKey(lead.phone);
    const viaEmail = new Set(e ? byEmail.get(e) ?? [] : []);
    const viaPhone = new Set(p ? byPhone.get(p) ?? [] : []);
    // Ambiguity is judged on every raw match, before "separate" pairs are removed:
    // a lead that matched two clients stays for staff even if one pair was kept apart.
    const raw = [...new Set([...viaEmail, ...viaPhone])];
    const ambiguous = raw.length > 1;
    const candidates = raw.filter((cid) => decided.get(`${lead.id}:${cid}`) !== "separate");
    const first = firstKey(lead.firstName);
    const sameFirst = (cid: number) => first !== "" && first === firstKey(byId.get(cid)?.firstName);
    if (!ambiguous && candidates.length === 1 && sameFirst(candidates[0])) {
      join(lead.id, candidates[0], "rules");
      continue;
    }
    for (const cid of candidates) {
      const reason = ambiguous
        ? "Matches more than one client"
        : viaEmail.has(cid)
          ? "Same email, different first name"
          : "Same phone, different first name";
      idx.reviews.push({ leadId: lead.id, clientId: cid, reason });
    }
    idx.leadPerson.set(lead.id, `l:${lead.id}`);
  }
  return idx;
}

export type Stage = "lead" | "member" | "lapsed" | "client";
export interface StageFacts {
  kind: "client" | "lead";
  activeMembership: boolean;
  /** An active package with sessions left (or unlimited). */
  activePackage: boolean;
  /** Last attended class or completed appointment, or null. */
  lastVisit: string | null;
  futureBookings: number;
  today: string;
}

/** The stage rule, written once. describe.ts shows the same rule to Adonis in words. */
export function personStage(f: StageFacts): Stage {
  if (f.kind === "lead") return "lead";
  const recent = f.lastVisit !== null && f.lastVisit >= addDays(f.today, -30);
  if (f.activeMembership || f.activePackage || recent) return "member";
  if (f.lastVisit !== null && f.futureBookings === 0) return "lapsed";
  return "client";
}
