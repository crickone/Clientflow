// app/src/lib/adonisMap/peopleData.ts
import "server-only";

import { getTenantById, openTenantDb } from "@/lib/db/tenant";
import { emailKey, matchPeople, phoneKey, type ClientRec, type Decision, type LeadRec, type PeopleIndex } from "./person";

export type Sqlite = ReturnType<typeof openTenantDb>["sqlite"];

/** The business's own DB, by explicit id. Never the ambient tenant: getCurrentTenant() ignores runWithTenant. */
export function sqliteFor(tenantId: number): Sqlite {
  const t = getTenantById(tenantId);
  if (!t) throw new Error(`[adonisMap] unknown tenant ${tenantId}`);
  return openTenantDb(t.dbFile).sqlite;
}

export interface ClientFull extends ClientRec { createdAt: number }
export interface LeadFull extends LeadRec {
  source: string | null;
  campaign: string | null;
  leadScore: number | null;
  doNotCall: boolean;
  createdAt: number;
  stageName: string | null;
}
export interface PeopleData {
  clients: ClientFull[];
  leads: LeadFull[];
  decisions: Decision[];
  index: PeopleIndex;
  clientById: Map<number, ClientFull>;
  leadById: Map<number, LeadFull>;
  /** Display name per Person id. */
  personName: Map<string, string>;
  /** First Person id seen for each email / phone key (clients before leads). */
  personByEmail: Map<string, string>;
  personByPhone: Map<string, string>;
}

export function leadDisplayName(l: LeadRec): string {
  const n = `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim();
  return n || l.email || l.phone || `Lead ${l.id}`;
}

export function loadPeopleData(sq: Sqlite): PeopleData {
  const clients: ClientFull[] = (sq
    .prepare("SELECT id, first_name, last_name, email, phone, created_at FROM clients")
    .all() as { id: number; first_name: string; last_name: string; email: string | null; phone: string | null; created_at: number }[])
    .map((r) => ({ id: r.id, firstName: r.first_name, lastName: r.last_name, email: r.email, phone: r.phone, createdAt: r.created_at }));

  const leads: LeadFull[] = (sq
    .prepare(
      `SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.client_id, l.source, l.campaign, l.lead_score,
              l.do_not_call, l.created_at, COALESCE(ps.name, l.pipeline_stage) AS stage_name
         FROM leads l LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id`,
    )
    .all() as {
      id: number; first_name: string | null; last_name: string | null; email: string | null; phone: string | null;
      client_id: number | null; source: string | null; campaign: string | null; lead_score: number | null;
      do_not_call: number; created_at: number; stage_name: string | null;
    }[])
    .map((r) => ({
      id: r.id, firstName: r.first_name, lastName: r.last_name, email: r.email, phone: r.phone, clientId: r.client_id,
      source: r.source, campaign: r.campaign, leadScore: r.lead_score, doNotCall: r.do_not_call === 1,
      createdAt: r.created_at, stageName: r.stage_name,
    }));

  const decisions: Decision[] = (sq
    .prepare("SELECT lead_id, client_id, decision FROM person_link_decisions")
    .all() as { lead_id: number; client_id: number; decision: string }[])
    .map((r) => ({ leadId: r.lead_id, clientId: r.client_id, decision: r.decision === "join" ? "join" : "separate" }));

  const index = matchPeople(clients, leads, decisions);
  const personName = new Map<string, string>();
  const personByEmail = new Map<string, string>();
  const personByPhone = new Map<string, string>();
  const setOnce = (m: Map<string, string>, k: string, v: string) => {
    if (k && !m.has(k)) m.set(k, v);
  };
  for (const c of clients) {
    const pid = `c:${c.id}`;
    personName.set(pid, `${c.firstName} ${c.lastName}`.trim());
    setOnce(personByEmail, emailKey(c.email), pid);
    setOnce(personByPhone, phoneKey(c.phone), pid);
  }
  for (const l of leads) {
    const pid = index.leadPerson.get(l.id) ?? `l:${l.id}`;
    if (pid.startsWith("l:")) personName.set(pid, leadDisplayName(l));
    setOnce(personByEmail, emailKey(l.email), pid);
    setOnce(personByPhone, phoneKey(l.phone), pid);
  }
  return {
    clients, leads, decisions, index,
    clientById: new Map(clients.map((c) => [c.id, c])),
    leadById: new Map(leads.map((l) => [l.id, l])),
    personName, personByEmail, personByPhone,
  };
}
