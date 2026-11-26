/**
 * Pure: everyone in the system as one list, one row per person. Clients,
 * leads (including Inbox-only conversations), the email mailing list and the
 * business's WhatsApp contacts are joined when they share a phone number
 * (last 9 digits) or an email address, transitively. No DB, no server-only.
 */

export type DirectoryRecord =
  | { kind: "client"; id: number; name: string; email: string | null; phone: string | null; lastAt: number | null }
  | { kind: "lead"; id: number; name: string; email: string | null; phone: string | null; stage: string | null; inboxOnly: boolean; createdAt: number; lastAt: number | null }
  | { kind: "mailing"; id: number; name: string | null; email: string; phone: string | null }
  | { kind: "whatsapp"; id: number; name: string | null; phone: string; lastAt: number | null; hidden: boolean };

export type DirectoryFilter = "all" | "clients" | "leads" | "not_leads" | "whatsapp";

export const DIRECTORY_FILTERS: { key: DirectoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "clients", label: "Clients" },
  { key: "leads", label: "Leads" },
  { key: "not_leads", label: "Not leads" },
  { key: "whatsapp", label: "WhatsApp only" },
];

export interface DirectoryTag {
  kind: "client" | "lead" | "not_lead" | "mailing" | "whatsapp";
  label: string;
}

export interface Person {
  key: string;
  name: string;
  phone: string | null;
  email: string | null;
  tags: DirectoryTag[];
  lastAt: number | null;
  clientId: number | null;
  /** The newest lead on the board. */
  leadId: number | null;
  /** The newest Inbox-only conversation, when there is no lead on the board. */
  inboxLeadId: number | null;
  mailingId: number | null;
  whatsappId: number | null;
  category: "client" | "lead" | "not_lead";
  whatsappOnly: boolean;
}

/** The last 9 digits of a phone number (enough to tell numbers apart, whatever the prefix), or null. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-9) : null;
}

const emailKey = (email: string | null | undefined): string | null => {
  const e = (email ?? "").trim().toLowerCase();
  return e.includes("@") ? e : null;
};

const maxOf = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));

/** One row per person, newest message first, then by name. Hidden WhatsApp-only people are left out. */
export function buildDirectory(records: DirectoryRecord[]): Person[] {
  // Union-find over record indexes, joined by shared phone or email.
  const parent = records.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map<string, number>();
  records.forEach((r, i) => {
    const keys = [phoneKey(r.phone), r.kind === "whatsapp" ? null : emailKey(r.email)].filter((k): k is string => !!k);
    for (const k of keys) {
      const tag = k.includes("@") ? `e:${k}` : `p:${k}`;
      const seen = owner.get(tag);
      if (seen == null) owner.set(tag, i);
      else parent[find(i)] = find(seen);
    }
  });
  const groups = new Map<number, DirectoryRecord[]>();
  records.forEach((r, i) => {
    const root = find(i);
    const g = groups.get(root) ?? [];
    g.push(r);
    groups.set(root, g);
  });

  const people: Person[] = [];
  for (const group of groups.values()) {
    const p = toPerson(group);
    if (p) people.push(p);
  }
  return people.sort((a, b) => (b.lastAt ?? -1) - (a.lastAt ?? -1) || a.name.localeCompare(b.name));
}

function toPerson(group: DirectoryRecord[]): Person | null {
  const clients = group.filter((r): r is Extract<DirectoryRecord, { kind: "client" }> => r.kind === "client");
  const leads = group.filter((r): r is Extract<DirectoryRecord, { kind: "lead" }> => r.kind === "lead").sort((a, b) => b.createdAt - a.createdAt);
  const boardLeads = leads.filter((l) => !l.inboxOnly);
  const inboxLeads = leads.filter((l) => l.inboxOnly);
  const mailing = group.filter((r): r is Extract<DirectoryRecord, { kind: "mailing" }> => r.kind === "mailing");
  const wa = group.filter((r): r is Extract<DirectoryRecord, { kind: "whatsapp" }> => r.kind === "whatsapp");

  const whatsappOnly = wa.length === group.length;
  if (whatsappOnly && wa.every((w) => w.hidden)) return null;

  const client = clients[0] ?? null;
  const lead = boardLeads[0] ?? null;
  const inbox = inboxLeads[0] ?? null;
  const visibleWa = wa.find((w) => !w.hidden) ?? wa[0] ?? null;
  const named = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
  const phoneOf = (r: DirectoryRecord | null) => (r?.phone ? r.phone : null);

  const name =
    named(client?.name) ?? named(lead?.name) ?? named(inbox?.name) ?? named(mailing[0]?.name) ?? named(visibleWa?.name) ??
    (visibleWa ? `+${visibleWa.phone}` : phoneOf(client) ?? phoneOf(lead) ?? phoneOf(inbox) ?? mailing[0]?.email ?? "Unknown");
  const phone = phoneOf(client) ?? phoneOf(lead) ?? phoneOf(inbox) ?? phoneOf(mailing[0] ?? null) ?? (visibleWa ? `+${visibleWa.phone}` : null);
  const email = client?.email ?? lead?.email ?? inbox?.email ?? mailing[0]?.email ?? null;

  const tags: DirectoryTag[] = [];
  if (client) tags.push({ kind: "client", label: "Client" });
  if (lead) tags.push({ kind: "lead", label: lead.stage ? `Lead: ${lead.stage}` : "Lead" });
  if (!client && !lead && inbox) tags.push({ kind: "not_lead", label: "Not a lead" });
  if (mailing.length) tags.push({ kind: "mailing", label: "Mailing list" });
  if (wa.length) tags.push({ kind: "whatsapp", label: "WhatsApp" });

  let lastAt: number | null = null;
  for (const r of group) if (r.kind !== "mailing") lastAt = maxOf(lastAt, r.lastAt);

  return {
    key: client ? `c${client.id}` : lead ? `l${lead.id}` : inbox ? `l${inbox.id}` : mailing[0] ? `m${mailing[0].id}` : `w${wa[0].id}`,
    name,
    phone,
    email,
    tags,
    lastAt,
    clientId: client?.id ?? null,
    leadId: lead?.id ?? null,
    inboxLeadId: !lead && inbox ? inbox.id : null,
    mailingId: mailing[0]?.id ?? null,
    whatsappId: visibleWa?.id ?? null,
    category: client ? "client" : lead ? "lead" : "not_lead",
    whatsappOnly,
  };
}

/** The people matching a filter and a search (name, phone digits, email). */
export function filterDirectory(people: Person[], opts: { filter?: DirectoryFilter; q?: string }): Person[] {
  const filter = opts.filter ?? "all";
  const q = (opts.q ?? "").trim().toLowerCase();
  // "087 123" finds "+353 87 123...": a national number's leading 0 is dropped.
  const qDigits = q.replace(/\D/g, "").replace(/^0+/, "");
  return people.filter((p) => {
    if (filter === "clients" && p.category !== "client") return false;
    if (filter === "leads" && p.category !== "lead") return false;
    if (filter === "not_leads" && p.category !== "not_lead") return false;
    if (filter === "whatsapp" && !p.whatsappOnly) return false;
    if (!q) return true;
    if (p.name.toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q)) return true;
    return qDigits.length >= 3 && (p.phone ?? "").replace(/\D/g, "").includes(qDigits);
  });
}

export function parseFilter(v: string | undefined): DirectoryFilter {
  return DIRECTORY_FILTERS.some((f) => f.key === v) ? (v as DirectoryFilter) : "all";
}
