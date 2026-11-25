/**
 * The GoHighLevel import's dry run: what happens to every person, from the
 * two exports and a snapshot of this business (snapshot.ts). Pure: no DB,
 * so the whole plan is tested without one, and the import (apply.ts) only
 * carries out what the plan says.
 */
import { splitFullName } from "@/lib/humanName";
import { columnMatches, NEW_LEAD_FLOW, NURTURE_FLOW, resolveColumn, type ColumnRef } from "@/lib/leadFlows/flowModel";
import { pickForInterest } from "@/lib/leadFlows/flowPlan";
import { addDays, fitToWindow, hhmmToMinutes, morningOf, todayIn, type SendingWindow } from "@/lib/leadFlows/sendingWindow";
import type { FollowUpKey } from "@/lib/pipeline/followUpColumns";
import { resolveEntryStage, type StageRole } from "@/lib/pipeline/roles";
import { normalizePhone } from "@/lib/whatsapp/phone";

import { toCsv, type GhlContact, type GhlOpportunity } from "./csv";
import { decide, HOLDING, matchStaff, type FlowIntent, type ImportColumn } from "./mapping";
import { DAY_MS, planSteps, type PlacedStep, type StepPlan } from "./placement";
import type { AssigneeRow } from "./types";

// ── people ─────────────────────────────────────────────────────────────────────

/** One GoHighLevel person: the contact joined with its latest opportunity. */
export interface ImportPerson {
  ghlContactId: string;
  ghlOpportunityId: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Lowercased. */
  email: string | null;
  phone: string | null;
  createdAt: number | null;
  ghlStage: string | null;
  daysInStage: number | null;
  ghlSource: string | null;
  tags: string[];
  notes: string | null;
  treatment: string | null;
  usedBefore: string | null;
  town: string | null;
  /** Staff only: written to ghl_import_people and nowhere else. */
  staffMedicalNote: string | null;
  assignedName: string | null;
  dnd: boolean;
}

const blank = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

function personFrom(c: GhlContact | null, o: GhlOpportunity | null): ImportPerson {
  const split = splitFullName(o?.contactName ?? "");
  const first = blank(c?.firstName);
  const last = blank(c?.lastName);
  return {
    ghlContactId: (c?.contactId ?? o?.contactId)!,
    ghlOpportunityId: blank(o?.opportunityId),
    firstName: first ?? (last ? null : split.firstName),
    lastName: last ?? (first ? null : split.lastName),
    email: (blank(c?.email) ?? blank(o?.email))?.toLowerCase() ?? null,
    phone: blank(c?.phone) ?? blank(o?.phone),
    createdAt: c?.createdAt ?? o?.createdAt ?? null,
    ghlStage: blank(o?.stage),
    daysInStage: o?.daysInStage ?? null,
    ghlSource: blank(c?.source) ?? blank(o?.source),
    tags: [...new Set([...(c?.tags ?? []), ...(o?.tags ?? [])])],
    notes: blank(o?.notes),
    treatment: blank(c?.treatment),
    usedBefore: blank(c?.usedBefore),
    town: blank(c?.town),
    staffMedicalNote: blank(c?.medicalCondition),
    assignedName: blank(o?.assigned),
    dnd: c?.dnd ?? false,
  };
}

/** Contacts in file order, each with its most recently updated opportunity; then opportunities with no contact row. */
export function joinPeople(contacts: GhlContact[], opportunities: GhlOpportunity[]): ImportPerson[] {
  const stamp = (o: GhlOpportunity) => o.updatedAt ?? o.createdAt ?? 0;
  const latest = new Map<string, GhlOpportunity>();
  for (const o of opportunities) {
    const cur = latest.get(o.contactId);
    if (!cur || stamp(o) > stamp(cur)) latest.set(o.contactId, o);
  }
  const out: ImportPerson[] = [];
  const seen = new Set<string>();
  for (const c of contacts) {
    if (seen.has(c.contactId)) continue;
    seen.add(c.contactId);
    out.push(personFrom(c, latest.get(c.contactId) ?? null));
  }
  for (const o of latest.values()) {
    if (seen.has(o.contactId)) continue;
    seen.add(o.contactId);
    out.push(personFrom(null, o));
  }
  return out;
}

export function displayName(p: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || p.email || p.phone || "No name";
}

// ── the business ───────────────────────────────────────────────────────────────

export interface SnapshotLead {
  id: number;
  /** Lowercased. */
  email: string | null;
  phone: string | null;
  clientId: number | null;
  pipelineId: number;
  therapyInterest: string | null;
  marketingConsentAt: number | null;
  /** The latest stage move (lead_stage_events.at), else when the lead was created. */
  lastStageAt: number;
  inActiveFlow: boolean;
}

export interface SnapshotClient {
  id: number;
  /** Lowercased. */
  email: string | null;
  phone: string;
}

export interface SnapshotColumn {
  id: number;
  name: string;
  role: StageRole | null;
  systemKey: FollowUpKey | null;
  position: number;
}

export interface SnapshotFlow {
  key: string;
  label: string;
  enabled: boolean;
  messages: { channel: string; delayMs: number; matchInterest: string | null }[];
  startColumn: ColumnRef | null;
  finish: { column: ColumnRef; afterMs: number } | null;
}

export interface Snapshot {
  /** The default board, where imported leads go. */
  pipelineId: number;
  importedContactIds: Set<string>;
  leads: SnapshotLead[];
  clients: SnapshotClient[];
  /** Lowercased marketing contact addresses. */
  contactEmails: Set<string>;
  /** Lowercased addresses on the do-not-email list, any reason. */
  suppressedEmails: Set<string>;
  /** The default board's columns. */
  columns: SnapshotColumn[];
  /** Every lead flow but a booked call, on or off, in catalog order. */
  flows: SnapshotFlow[];
  staff: { userId: number; name: string }[];
  defaultAssigneeUserId: number | null;
  window: SendingWindow | null;
}

// ── the plan ───────────────────────────────────────────────────────────────────

export type Outcome = "create" | "update" | "unchanged" | "already_imported" | "skip";

export type LeadAction =
  | {
      /** Fill fields the lead has empty; leave its column, follow-ups and consent alone. */
      mode: "fill";
      existingId: number;
      assigneeUserId: number | null;
    }
  | {
      /** Put the lead in a column (a new lead, or an existing one moved). */
      mode: "place";
      existingId: number | null;
      /** null = the Holding column, created on import. */
      columnId: number | null;
      columnName: string;
      role: StageRole | null;
      /** When they entered the column: the stage event's time. */
      enteredAt: number;
      lost: boolean;
      /** Record marketing consent now. */
      consent: boolean;
      assigneeUserId: number | null;
    };

export interface RunAction {
  flowKey: string;
  flowLabel: string;
  enabled: boolean;
  steps: PlacedStep[];
  finishAt: number | null;
  emailOnly: boolean;
}

export interface PersonPlan {
  person: ImportPerson;
  outcome: Outcome;
  /** Why, in plain words. */
  note: string;
  /** Who they matched in Adonis, if anyone (a contact match has no id). */
  match: { kind: "lead" | "client" | "contact"; id: number | null } | null;
  lead: LeadAction | null;
  client: { existingId: number | null } | null;
  /** Add to marketing contacts (people with no opportunity). */
  contact: boolean;
  doNotContact: boolean;
  run: RunAction | null;
  /** Where they go, for the dry run: a column, "Clients", "Email contacts", "Do-not-email list" or "No change". */
  to: string;
}

export interface PlanTotals {
  people: number;
  /** Leads placed in a column (new or moved). */
  leads: number;
  clients: number;
  contactsOnly: number;
  /** Put on the email contacts: contacts-only people, and leads whose consent is recorded and who have an email. */
  emailContactsAdded: number;
  doNotContact: number;
  /** Matched to someone already in Adonis. */
  duplicates: number;
  alreadyImported: number;
  unchanged: number;
  skipped: number;
  columns: { name: string; count: number }[];
  /** Columns the import adds to the board. */
  newColumns: string[];
  flows: { key: string; label: string; enabled: boolean; people: number }[];
  /** Messages due in the 7 days from now, in flows that are on. */
  messagesNext7Days: number;
  /** People placed in a flow that is off. */
  waitingForFlowOff: number;
}

export interface ImportPlan {
  people: PersonPlan[];
  totals: PlanTotals;
  assignees: AssigneeRow[];
}

export interface PlanOptions {
  /** The day the files were exported, "YYYY-MM-DD" (Irish time). */
  exportDay: string;
  now: number;
  /** GoHighLevel user name -> Adonis user id, the operator's picks; null = the default assignee. */
  assignees?: Record<string, number | null>;
}

const HOLDING_NAME = "Holding";

function phoneKey(phone: string | null | undefined): string | null {
  const d = normalizePhone(phone);
  return d.length >= 7 ? d : null;
}

interface Index {
  leadByEmail: Map<string, SnapshotLead>;
  leadByPhone: Map<string, SnapshotLead>;
  clientByEmail: Map<string, SnapshotClient>;
  clientByPhone: Map<string, SnapshotClient>;
  holding: SnapshotColumn | null;
  entry: SnapshotColumn;
}

function indexSnapshot(snap: Snapshot): Index {
  const ix: Index = {
    leadByEmail: new Map(),
    leadByPhone: new Map(),
    clientByEmail: new Map(),
    clientByPhone: new Map(),
    holding: snap.columns.find((c) => c.role == null && c.systemKey == null && c.name.trim().toLowerCase() === HOLDING) ?? null,
    entry: (resolveEntryStage(snap.columns.map((c) => ({ ...c, colour: "" }))) as SnapshotColumn | null) ?? snap.columns[0],
  };
  for (const l of snap.leads) {
    if (l.email && !ix.leadByEmail.has(l.email)) ix.leadByEmail.set(l.email, l);
    const pk = phoneKey(l.phone);
    if (pk && !ix.leadByPhone.has(pk)) ix.leadByPhone.set(pk, l);
  }
  for (const c of snap.clients) {
    if (c.email && !ix.clientByEmail.has(c.email)) ix.clientByEmail.set(c.email, c);
    const pk = phoneKey(c.phone);
    if (pk && !ix.clientByPhone.has(pk)) ix.clientByPhone.set(pk, c);
  }
  return ix;
}

function assigneeFor(name: string | null, snap: Snapshot, opts: PlanOptions): number | null {
  const onTeam = (id: number | null | undefined) => (id != null && snap.staff.some((s) => s.userId === id) ? id : null);
  if (!name) return onTeam(snap.defaultAssigneeUserId);
  if (opts.assignees && name in opts.assignees) return onTeam(opts.assignees[name]) ?? onTeam(snap.defaultAssigneeUserId);
  return matchStaff(name, snap.staff) ?? onTeam(snap.defaultAssigneeUserId);
}

function flowForColumn(snap: Snapshot, col: SnapshotColumn): SnapshotFlow | null {
  return snap.flows.find((f) => f.startColumn != null && columnMatches(f.startColumn, col)) ?? null;
}

/** FNV-1a, 32-bit: a small stable hash, so a person's spread is the same on every run. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * How far into the sending window a person's messages go, by GoHighLevel
 * contact id: a whole number of minutes, at least an hour before the window
 * closes. Without it every imported message would be due at the minute the
 * window opens. No hours saved: the 09:00-21:00 WhatsApp window.
 */
export function spreadMs(contactId: string, window: SendingWindow | null): number {
  const windowMinutes = window ? hhmmToMinutes(window.end) - hhmmToMinutes(window.start) : 12 * 60;
  const slots = Math.max(1, windowMinutes - 60);
  return (hash32(contactId) % slots) * 60_000;
}

/** The opening of sending hours on the next sending day after today. */
function nextSendingDayOpen(now: number, window: SendingWindow | null): number {
  return fitToWindow(morningOf(addDays(todayIn(now), 1), window), "whatsapp", window);
}

function schedule(
  p: ImportPerson,
  interest: string | null,
  snap: Snapshot,
  flow: SnapshotFlow,
  o: { from: FlowIntent["from"]; emailOnly: boolean; entry: number; now: number; suppressed: boolean },
): StepPlan {
  const picked = pickForInterest(flow.messages, interest);
  const spread = spreadMs(p.ghlContactId, snap.window);
  return planSteps({
    messages: picked.map((m) => ({ channel: o.emailOnly && m.channel === "whatsapp" ? "email" : m.channel, delayMs: m.delayMs })),
    // A fresh start begins on the next sending day, so it sends nothing on the import day.
    startAt: (o.from === "start" ? nextSendingDayOpen(o.now, snap.window) : o.entry) + spread,
    doneThroughMs: o.from === "start" ? null : (p.daysInStage ?? 0) * DAY_MS,
    now: o.now,
    finishAfterMs: flow.finish?.afterMs ?? null,
    // A time pushed to the opening of sending hours moves on by the person's spread.
    fit: (at, ch) => {
      const t = fitToWindow(at, ch, snap.window);
      return t !== at ? t + spread : t;
    },
    dayOf: (at) => todayIn(at),
    canReceive: (ch) => (ch === "whatsapp" ? !!p.phone : ch === "email" ? !!p.email && !o.suppressed : false),
  });
}

function runFrom(flow: SnapshotFlow, sp: StepPlan, emailOnly: boolean): RunAction | null {
  if (sp.steps.length === 0 && sp.finishAt == null) return null;
  return { flowKey: flow.key, flowLabel: flow.label, enabled: flow.enabled, steps: sp.steps, finishAt: sp.finishAt, emailOnly };
}

function planPerson(p: ImportPerson, snap: Snapshot, ix: Index, opts: PlanOptions, seen: Set<string>): PersonPlan {
  const base = { person: p, match: null, lead: null, client: null, contact: false, doNotContact: false, run: null } as const;
  if (snap.importedContactIds.has(p.ghlContactId)) {
    return { ...base, outcome: "already_imported", note: "Already imported: nothing changes.", to: "No change" };
  }
  const keys = [p.email ? `e:${p.email}` : null, phoneKey(p.phone) ? `p:${phoneKey(p.phone)}` : null].filter((k): k is string => k != null);
  if (keys.some((k) => seen.has(k))) {
    return { ...base, outcome: "skip", note: "Same email or phone as another contact in these files: imported once.", to: "No change" };
  }
  keys.forEach((k) => seen.add(k));

  const d = decide({ stage: p.ghlStage, daysInStage: p.daysInStage, tags: p.tags, dnd: p.dnd });
  const pk = phoneKey(p.phone);
  const lead = (p.email ? ix.leadByEmail.get(p.email) : undefined) ?? (pk ? ix.leadByPhone.get(pk) : undefined) ?? null;
  const client = (p.email ? ix.clientByEmail.get(p.email) : undefined) ?? (pk ? ix.clientByPhone.get(pk) : undefined) ?? null;
  const isContact = !!p.email && snap.contactEmails.has(p.email);
  const match: PersonPlan["match"] = lead ? { kind: "lead", id: lead.id } : client ? { kind: "client", id: client.id } : isContact ? { kind: "contact", id: null } : null;
  const suppressed = !!p.email && snap.suppressedEmails.has(p.email);
  const dnc = d.doNotContact;
  const withDnc = { ...base, match, doNotContact: dnc };
  // A matched lead whose fields are only filled still has its follow-ups stopped by do not contact (apply.ts).
  const dncFill = dnc ? " Marked do not contact: follow-ups stopped." : "";
  const pl = d.placement;

  if (pl.kind === "contact") {
    if (lead || client) {
      return { ...withDnc, outcome: dnc ? "update" : "unchanged", note: `Already here as a ${lead ? "lead" : "client"}${dnc ? ": marked do not contact" : ""}.`, to: "No change" };
    }
    if (!p.email) return { ...withDnc, outcome: "skip", note: "No email address and no opportunity: nothing to add.", to: "No change" };
    if (dnc) return { ...withDnc, outcome: "create", note: "Do not contact: added to your do-not-email list.", to: "Do-not-email list" };
    if (isContact) return { ...withDnc, outcome: "unchanged", note: "Already on your email contacts.", to: "No change" };
    if (suppressed) return { ...withDnc, outcome: "unchanged", note: "On your do-not-email list: not added.", to: "No change" };
    return { ...withDnc, contact: true, outcome: "create", note: `${d.rule}.`, to: "Email contacts" };
  }

  const assignee = assigneeFor(p.assignedName, snap, opts);

  if (pl.kind === "client") {
    if (client) return { ...withDnc, client: { existingId: client.id }, outcome: "update", note: "Already a client here: missing details filled.", to: "Clients" };
    return {
      ...withDnc,
      client: { existingId: lead?.clientId ?? null },
      lead: lead ? { mode: "fill", existingId: lead.id, assigneeUserId: assignee } : null,
      outcome: lead ? "update" : "create",
      note: `${d.rule}.${lead ? dncFill : ""}`,
      to: "Clients",
    };
  }

  // A lead column.
  if (client && !lead && !pl.won) {
    return { ...withDnc, outcome: dnc ? "update" : "unchanged", note: "Already a client here: not put on the lead board.", to: "No change" };
  }
  // When they entered the GoHighLevel stage. Unknown (no days, no created date) counts as the
  // oldest for the comparison below, so a matched Adonis lead keeps its own column.
  const knownStageAt = p.daysInStage != null ? morningOf(addDays(opts.exportDay, -p.daysInStage), snap.window) : p.createdAt;
  const ghlStageAt = knownStageAt ?? opts.now;
  if (lead && (lead.inActiveFlow || lead.pipelineId !== snap.pipelineId || lead.lastStageAt >= (knownStageAt ?? 0))) {
    const why = lead.inActiveFlow
      ? "In an Adonis follow-up already: only missing details filled."
      : lead.pipelineId !== snap.pipelineId
        ? "On another board here: only missing details filled."
        : "Moved more recently in Adonis: only missing details filled.";
    return { ...withDnc, lead: { mode: "fill", existingId: lead.id, assigneeUserId: assignee }, outcome: "update", note: `${why}${dncFill}`, to: "No change" };
  }

  let note = d.rule;
  let intent = pl.flow;
  let col: SnapshotColumn | null = pl.column === HOLDING ? ix.holding : resolveColumn(pl.column as ColumnRef, snap.columns);
  const newHolding = pl.column === HOLDING && !col;
  if (!col && !newHolding) {
    col = ix.entry;
    note = `No such column on your board: placed in ${col.name}`;
    intent = null;
  }
  const consent = d.consent && !suppressed;
  const hasConsent = consent || (lead?.marketingConsentAt != null && !dnc);
  const interest = lead?.therapyInterest?.trim() || p.treatment;
  let enteredAt = intent?.from === "start" ? opts.now : ghlStageAt;
  let run: RunAction | null = null;

  if (intent && col && !dnc) {
    const flow = intent.via === "new_lead" ? (snap.flows.find((f) => f.key === NEW_LEAD_FLOW) ?? null) : flowForColumn(snap, col);
    if (!flow) note = `${note}. No follow-up starts in this column`;
    else if (flow.key === NURTURE_FLOW && !hasConsent) note = `${note}. No marketing consent: column only`;
    else {
      const sp = schedule(p, interest, snap, flow, { from: intent.from, emailOnly: intent.emailOnly, entry: ghlStageAt, now: opts.now, suppressed });
      // A finish move that would fall on the import day (after now, once spread) counts as ended: the
      // person moves on at import, and the next flow starts on the next sending day. Otherwise the
      // move would run later today and start nurture week 1 on the import day.
      const endsToday = sp.finishAt != null && todayIn(sp.finishAt) === todayIn(opts.now);
      if (!sp.ended && !endsToday) run = runFrom(flow, sp, intent.emailOnly);
      else if (flow.finish) {
        const next = resolveColumn(flow.finish.column, snap.columns);
        if (next) {
          col = next;
          enteredAt = opts.now;
          const nextFlow = flowForColumn(snap, next);
          if (nextFlow && !(nextFlow.key === NURTURE_FLOW && !hasConsent)) {
            run = runFrom(nextFlow, schedule(p, interest, snap, nextFlow, { from: "start", emailOnly: false, entry: opts.now, now: opts.now, suppressed }), false);
          }
          note = `${flow.label} would have ended by now: moved to ${next.name}${run ? " from the start" : ""}`;
        } else note = `${note}. Past the end of ${flow.label}: column only`;
      } else note = `${note}. Past the end of ${flow.label}: column only`;
    }
  }

  const columnName = col?.name ?? HOLDING_NAME;
  return {
    ...withDnc,
    lead: {
      mode: "place",
      existingId: lead?.id ?? null,
      columnId: col?.id ?? null,
      columnName,
      role: col?.role ?? null,
      enteredAt,
      lost: pl.lost,
      consent: consent && lead?.marketingConsentAt == null,
      assigneeUserId: assignee,
    },
    client: pl.won ? { existingId: lead?.clientId ?? client?.id ?? null } : null,
    run,
    outcome: lead || (pl.won && client) ? "update" : "create",
    note: `${note}.`,
    to: columnName,
  };
}

function totalsFor(plans: PersonPlan[], now: number): PlanTotals {
  const t: PlanTotals = {
    people: plans.length,
    leads: 0,
    clients: 0,
    contactsOnly: 0,
    emailContactsAdded: 0,
    doNotContact: 0,
    duplicates: 0,
    alreadyImported: 0,
    unchanged: 0,
    skipped: 0,
    columns: [],
    newColumns: [],
    flows: [],
    messagesNext7Days: 0,
    waitingForFlowOff: 0,
  };
  const cols = new Map<string, number>();
  const flows = new Map<string, PlanTotals["flows"][number]>();
  for (const p of plans) {
    if (p.outcome === "already_imported") {
      t.alreadyImported++;
      continue;
    }
    if (p.outcome === "skip") t.skipped++;
    if (p.outcome === "unchanged") t.unchanged++;
    if (p.match) t.duplicates++;
    if (p.lead?.mode === "place") {
      t.leads++;
      cols.set(p.lead.columnName, (cols.get(p.lead.columnName) ?? 0) + 1);
      if (p.lead.columnId == null && !t.newColumns.includes(p.lead.columnName)) t.newColumns.push(p.lead.columnName);
    }
    if (p.client) t.clients++;
    if (p.contact) t.contactsOnly++;
    if (p.contact || (p.lead?.mode === "place" && p.lead.consent && p.person.email)) t.emailContactsAdded++;
    // A skipped person is not imported, so nothing is marked (already imported is counted above).
    if (p.doNotContact && p.outcome !== "skip") t.doNotContact++;
    if (p.run) {
      const f = flows.get(p.run.flowKey) ?? { key: p.run.flowKey, label: p.run.flowLabel, enabled: p.run.enabled, people: 0 };
      f.people++;
      flows.set(p.run.flowKey, f);
      if (!p.run.enabled) t.waitingForFlowOff++;
      else t.messagesNext7Days += p.run.steps.filter((s) => s.dueAt >= now && s.dueAt < now + 7 * DAY_MS).length;
    }
  }
  t.columns = [...cols].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  t.flows = [...flows.values()].sort((a, b) => b.people - a.people);
  return t;
}

function assigneeRows(people: ImportPerson[], snap: Snapshot, opts: PlanOptions): AssigneeRow[] {
  const counts = new Map<string, number>();
  for (const p of people) if (p.assignedName) counts.set(p.assignedName, (counts.get(p.assignedName) ?? 0) + 1);
  return [...counts].map(([ghlName, n]) => {
    const matched = matchStaff(ghlName, snap.staff);
    const picked = opts.assignees && ghlName in opts.assignees ? opts.assignees[ghlName] : matched;
    const userId = picked != null && snap.staff.some((s) => s.userId === picked) ? picked : null;
    return { ghlName, people: n, matchedUserId: matched, userId };
  });
}

export function buildPlan(people: ImportPerson[], snap: Snapshot, opts: PlanOptions): ImportPlan {
  const ix = indexSnapshot(snap);
  const seen = new Set<string>();
  // Of two people with the same email or phone, the one with an opportunity is imported:
  // they are planned first. The plans stay in file order.
  const order = people.map((_, i) => i).sort((a, b) => Number(people[a].ghlStage == null) - Number(people[b].ghlStage == null) || a - b);
  const plans: PersonPlan[] = new Array(people.length);
  for (const i of order) plans[i] = planPerson(people[i], snap, ix, opts, seen);
  return { people: plans, totals: totalsFor(plans, opts.now), assignees: assigneeRows(people, snap, opts) };
}

// ── what the screen shows ──────────────────────────────────────────────────────

/** One person in the dry run. Never carries the medical note. */
export interface DryRunRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  fromStage: string;
  days: number | null;
  to: string;
  flow: string | null;
  flowOff: boolean;
  nextChannel: string | null;
  nextAt: number | null;
  doNotContact: boolean;
  outcome: Outcome;
  note: string;
}

export function dryRunRows(plan: ImportPlan): DryRunRow[] {
  return plan.people.map((p) => {
    const next = p.run?.steps[0] ?? null;
    return {
      id: p.person.ghlContactId,
      name: displayName(p.person),
      email: p.person.email ?? "",
      phone: p.person.phone ?? "",
      fromStage: p.person.ghlStage ?? "No opportunity",
      days: p.person.daysInStage,
      to: p.to,
      flow: p.run?.flowLabel ?? null,
      flowOff: p.run ? !p.run.enabled : false,
      nextChannel: next?.channel ?? null,
      nextAt: next?.dueAt ?? null,
      doNotContact: p.doNotContact,
      outcome: p.outcome,
      note: p.note,
    };
  });
}

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", email: "Email" };

export function dryRunCsv(rows: DryRunRow[], fmt: (ms: number) => string): string {
  return toCsv([
    ["Name", "Email", "Phone", "GoHighLevel stage", "Days in stage", "Goes to", "Follow-up", "Next message", "Next message at", "Do not contact", "Notes"],
    ...rows.map((r) => [
      r.name,
      r.email,
      r.phone,
      r.fromStage,
      r.days,
      r.to,
      r.flow ? `${r.flow}${r.flowOff ? " (off: waits)" : ""}` : "",
      r.nextChannel ? (CHANNEL[r.nextChannel] ?? r.nextChannel) : "",
      r.nextAt != null ? fmt(r.nextAt) : "",
      r.doNotContact ? "Yes" : "",
      r.note,
    ]),
  ]);
}
