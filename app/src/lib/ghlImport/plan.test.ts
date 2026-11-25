// Run: npm test -- src/lib/ghlImport/plan.test.ts
//
// The whole dry run on a made-up business and made-up people: where each
// person goes, which follow-up and which step, duplicates, re-runs, do not
// contact, the totals, and that the dry run carries no medical note.
//
// Times: each person's messages are spread across the sending window by
// their GoHighLevel contact id (spreadMs), and a fresh start begins on the
// next sending day, so the checks add the person's spread to the time the
// step would have had at the opening of sending hours.
import assert from "node:assert/strict";

import { delayToMs, TRIGGER_LABELS } from "../automationModel";
import { FLOW_DEFAULTS } from "../leadFlows/flowModel";
import { FLOW_PRESETS } from "../leadFlows/presets";
import { localParts } from "../leadFlows/sendingWindow";
import type { GhlContact, GhlOpportunity } from "./csv";
import { buildPlan, dryRunCsv, dryRunRows, joinPeople, spreadMs, type Snapshot, type SnapshotFlow, type SnapshotLead } from "./plan";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};

const DAY = 86_400_000;
const NOW = Date.parse("2030-01-16T10:00:00Z"); // Wednesday, 10:00 Irish time
const EXPORT_DAY = "2030-01-16";
const MORNING = (daysAgo: number) => Date.parse("2030-01-16T09:00:00Z") - daysAgo * DAY;
const MEDICAL = "FAKE-MEDICAL-SENTINEL";
// The next sending day after the import: Thursday, sending hours open at 09:00 (no hours saved).
const TOMORROW_OPEN = Date.parse("2030-01-17T09:00:00Z");
const IMPORT_DAY_ENDS = Date.parse("2030-01-17T00:00:00Z");
// No hours saved: WhatsApp 09:00-21:00 every day.
const inWindow = (at: number) => {
  const m = localParts(at).minutes;
  return m >= 9 * 60 && m < 21 * 60;
};

// The default board: the nine columns and the five follow-up columns.
const columns: Snapshot["columns"] = [
  { id: 1, name: "New lead", role: "new", systemKey: null, position: 0 },
  { id: 2, name: "Hot lead", role: "engaged", systemKey: null, position: 1 },
  { id: 10, name: "No answer", role: null, systemKey: "no_answer", position: 2 },
  { id: 11, name: "Call back later", role: null, systemKey: "call_back", position: 3 },
  { id: 12, name: "Thinking about it", role: null, systemKey: "thinking", position: 4 },
  { id: 3, name: "Consultation booked", role: "booked", systemKey: null, position: 5 },
  { id: 4, name: "No-show", role: "no_show", systemKey: null, position: 6 },
  { id: 5, name: "Attended", role: "attended", systemKey: null, position: 7 },
  { id: 6, name: "Sale", role: "won", systemKey: null, position: 8 },
  { id: 7, name: "Repeat customer", role: "repeat", systemKey: null, position: 9 },
  { id: 13, name: "Long-term nurture", role: null, systemKey: "nurture", position: 10 },
  { id: 14, name: "Message undelivered", role: null, systemKey: "undelivered", position: 11 },
  { id: 8, name: "Lapsed", role: "lapsed", systemKey: null, position: 12 },
  { id: 9, name: "Lost", role: "lost", systemKey: null, position: 13 },
];

// Optimal Health's flows, all on except Thinking about it.
const preset = FLOW_PRESETS["optimal-health"];
const flow = (key: string, enabled = true): SnapshotFlow => {
  const d = FLOW_DEFAULTS[key];
  return {
    key,
    label: TRIGGER_LABELS[key] ?? key,
    enabled,
    messages: preset[key].map((m) => ({ channel: m.channel, delayMs: delayToMs(m.delayValue, m.delayUnit), matchInterest: m.matchInterest ?? null })),
    startColumn: d.startColumn,
    finish: d.finishColumn && d.finishAfter ? { column: d.finishColumn, afterMs: delayToMs(d.finishAfter.value, d.finishAfter.unit) } : null,
  };
};
const flows = [flow("new_lead"), flow("lead_no_answer"), flow("lead_call_back"), flow("lead_thinking", false), flow("lead_nurture")];

const existing = (over: Partial<SnapshotLead>): SnapshotLead => ({
  id: 500,
  email: null,
  phone: null,
  clientId: null,
  pipelineId: 1,
  therapyInterest: null,
  marketingConsentAt: null,
  lastStageAt: Date.parse("2029-06-01T00:00:00Z"),
  inActiveFlow: false,
  ...over,
});

const snap: Snapshot = {
  pipelineId: 1,
  importedContactIds: new Set(["done-1"]),
  leads: [
    existing({ id: 501, phone: "087 000 0009" }), // Ivan: matched by phone, old move
    existing({ id: 502, email: "joan@example.com", inActiveFlow: true }), // Joan: in a flow
    existing({ id: 503, email: "kate@example.com", lastStageAt: NOW - DAY }), // Kate: moved yesterday in Adonis
    existing({ id: 504, email: "liam@example.com", pipelineId: 7 }), // Liam: on a campaign board
  ],
  clients: [{ id: 900, email: "mary@example.com", phone: "" }],
  contactEmails: new Set(["nora@example.com"]),
  suppressedEmails: new Set(["olive@example.com"]),
  columns,
  flows,
  staff: [
    { userId: 1, name: "Sandra Example" },
    { userId: 2, name: "DJ" },
  ],
  defaultAssigneeUserId: 2,
  window: null,
};

const spread = (c: { contactId: string }) => spreadMs(c.contactId, snap.window);

let id = 0;
const contact = (first: string, over: Partial<GhlContact> = {}): GhlContact => ({
  contactId: `c-${++id}`,
  firstName: first,
  lastName: "Example",
  phone: `+3538700000${String(id).padStart(2, "0")}`,
  email: `${first.toLowerCase()}@example.com`,
  createdAt: Date.parse("2029-10-01T10:00:00Z"),
  tags: [],
  dnd: false,
  source: "Facebook",
  treatment: "",
  town: "Clonmel",
  medicalCondition: MEDICAL,
  usedBefore: "no",
  ...over,
});
const opp = (c: GhlContact, stage: string, days: number | null, over: Partial<GhlOpportunity> = {}): GhlOpportunity => ({
  opportunityId: `o-${c.contactId}`,
  contactId: c.contactId,
  contactName: `${c.firstName} ${c.lastName}`,
  phone: c.phone,
  email: c.email,
  pipeline: "Main Leads",
  stage,
  source: "Facebook",
  assigned: "Sandra Example",
  createdAt: Date.parse("2029-10-01T10:00:00Z"),
  updatedAt: Date.parse("2029-12-01T10:00:00Z"),
  notes: "Rang, no answer",
  tags: [],
  daysInStage: days,
  ...over,
});

const people = {
  aoife: contact("Aoife", { treatment: "Infrared Therapy" }),
  brian: contact("Brian"),
  ciara: contact("Ciara"),
  dara: contact("Dara"),
  eve: contact("Eve"),
  fiona: contact("Fiona", { dnd: true }),
  gavin: contact("Gavin", { tags: ["member"] }),
  hannah: contact("Hannah"),
  ivan: contact("Ivan", { phone: "+353870000009", email: "" }),
  joan: contact("Joan"),
  kate: contact("Kate"),
  liam: contact("Liam"),
  mary: contact("Mary"),
  nora: contact("Nora"),
  olive: contact("Olive"),
  pat: contact("Pat", { email: "hannah@example.com", phone: "" }),
  quinn: contact("Quinn"),
  rose: contact("Rose", { email: "", phone: "" }),
  done: { ...contact("Done"), contactId: "done-1" },
  won: contact("Wendy"),
};
const opps = [
  opp(people.aoife, "Long Term Nurture", 10),
  opp(people.brian, "Call Back Later", 3),
  opp(people.ciara, "Thinking About It", 40),
  opp(people.dara, "Call Back Later", 10),
  opp(people.eve, "Consult  Booked", 14),
  opp(people.fiona, "Long Term Nurture", 5),
  opp(people.ivan, "Call Back Later", 20),
  opp(people.joan, "Long Term Nurture", 30),
  opp(people.kate, "Long Term Nurture", 30),
  opp(people.liam, "Long Term Nurture", 30),
  opp(people.mary, "Long Term Nurture", 30),
  opp(people.quinn, "Holding", 3, { assigned: "Daniel O Dwyer" }),
  opp(people.won, "Won", 100),
  opp(people.done, "Lost", 3),
];
const persons = joinPeople(Object.values(people), opps);
const plan = buildPlan(persons, snap, { exportDay: EXPORT_DAY, now: NOW });
const of = (c: GhlContact) => plan.people.find((p) => p.person.ghlContactId === c.contactId)!;

ok(persons.length === Object.keys(people).length, "one person per contact");
ok(of(people.aoife).person.staffMedicalNote === MEDICAL, "the medical note is carried for the write");

// Aoife: 10 days into nurture, infrared: week 3's infrared WhatsApp is next, 14 days after she entered, at her spread.
{
  const p = of(people.aoife);
  ok(p.outcome === "create" && p.lead?.mode === "place" && p.lead.columnName === "Long-term nurture", "nurture column");
  ok(p.lead?.mode === "place" && p.lead.consent && p.lead.enteredAt === MORNING(10), "consent, entered 10 days ago (no spread on the stage time)");
  ok(p.run?.flowKey === "lead_nurture" && p.run.steps[0].dueAt === MORNING(10) + 14 * DAY + spread(people.aoife) && p.run.steps[0].channel === "whatsapp", "week 3 WhatsApp next, at her spread");
  ok(localParts(p.run!.steps[0].dueAt).date === "2030-01-20" && inWindow(p.run!.steps[0].dueAt), "on the expected day, inside sending hours");
  ok(p.run!.steps.length === 5, "weeks 3, 6, 8, 10 and 12 left");
  ok(p.lead?.mode === "place" && p.lead.assigneeUserId === 1, "assigned to Sandra by name");
}
// Brian: 3 days into Call back later: the 4-day WhatsApp tomorrow, then the move at 6 days, both at his spread.
{
  const p = of(people.brian);
  ok(p.lead?.mode === "place" && p.lead.columnName === "Call back later" && p.run?.flowKey === "lead_call_back", "call back column and flow");
  ok(p.run!.steps.length === 1 && p.run!.steps[0].dueAt === MORNING(3) + 4 * DAY + spread(people.brian) && p.run!.finishAt === MORNING(3) + 6 * DAY + spread(people.brian), "one WhatsApp, then the move");
  ok(localParts(p.run!.steps[0].dueAt).date === "2030-01-17" && inWindow(p.run!.steps[0].dueAt), "tomorrow, inside sending hours");
}
// Two people get different minutes, and the same person the same minute on every run.
{
  const a = of(people.aoife).run!.steps[0].dueAt;
  const b = of(people.brian).run!.steps[0].dueAt;
  ok(spread(people.aoife) !== spread(people.brian) && localParts(a).minutes !== localParts(b).minutes, "two contact ids get different minutes");
  const again = buildPlan(persons, snap, { exportDay: EXPORT_DAY, now: NOW });
  ok(again.people.find((p) => p.person.ghlContactId === people.aoife.contactId)!.run!.steps[0].dueAt === a, "the spread is the same on a second dry run");
  ok(spreadMs("c-x", { days: [1], start: "09:00", end: "09:30" }) === 0, "a window under an hour has no spread");
  ok(spreadMs("c-x", { days: [1], start: "09:00", end: "18:00" }) < 8 * 60 * 60_000 && spreadMs("c-x", null) < 11 * 60 * 60_000, "the spread ends an hour before the window closes");
}
// Ciara: 40 days thinking: stale, Long-term nurture from week 1, entered now. Week 1 starts on the next sending day.
{
  const p = of(people.ciara);
  ok(p.lead?.mode === "place" && p.lead.columnName === "Long-term nurture" && p.lead.enteredAt === NOW, "stale: nurture, entered now");
  ok(p.run?.flowKey === "lead_nurture" && p.run.steps[0].dueAt === TOMORROW_OPEN + spread(people.ciara) && p.run.steps[0].step === 0, "week 1 tomorrow, at her spread");
  ok(inWindow(p.run!.steps[0].dueAt), "inside sending hours");
  ok(p.run!.steps.every((s) => s.dueAt >= IMPORT_DAY_ENDS), "no message on the import day");
}
// Dara: 10 days into Call back later: the flow ended at 6 days, so she moves on to nurture from week 1.
{
  const p = of(people.dara);
  ok(p.lead?.mode === "place" && p.lead.columnName === "Long-term nurture" && p.lead.enteredAt === NOW && p.run?.flowKey === "lead_nurture" && p.run.steps[0].step === 0, "past its end: nurture from week 1, entered now");
  ok(p.run!.steps[0].dueAt === TOMORROW_OPEN + spread(people.dara) && p.run!.steps.every((s) => s.dueAt >= IMPORT_DAY_ENDS), "week 1 tomorrow at her spread, nothing on the import day");
}
// Eve: booked 14 days ago: Consultation booked, no flow.
ok(of(people.eve).lead?.mode === "place" && (of(people.eve).lead as { columnName: string }).columnName === "Consultation booked" && of(people.eve).run === null, "booked, no flow");
// Fiona: DND: column kept, no flow, no consent.
{
  const p = of(people.fiona);
  ok(p.doNotContact && p.run === null && p.lead?.mode === "place" && !p.lead.consent && p.lead.columnName === "Long-term nurture", "do not contact");
}
// Gavin: member tag, no opportunity: a client.
ok(of(people.gavin).client?.existingId === null && of(people.gavin).lead === null && of(people.gavin).to === "Clients", "member: new client");
// Hannah: no opportunity, no tags: an email contact.
ok(of(people.hannah).contact && of(people.hannah).to === "Email contacts", "contact only");
// Ivan: matched by phone (national format) to an Adonis lead, moved long ago: moved now.
{
  const p = of(people.ivan);
  ok(p.match?.kind === "lead" && p.match.id === 501 && p.lead?.mode === "place" && p.lead.existingId === 501 && p.outcome === "update", "matched by phone and moved");
  ok(p.run?.flowKey === "lead_nurture" && p.run.steps.every((s) => s.dueAt >= IMPORT_DAY_ENDS), "his fresh nurture start sends nothing on the import day");
}
// Joan: in an Adonis flow: only missing details.
ok(of(people.joan).lead?.mode === "fill" && of(people.joan).run === null && /follow-up/.test(of(people.joan).note), "in a flow: fill only");
// Kate: moved more recently in Adonis: only missing details.
ok(of(people.kate).lead?.mode === "fill" && /more recently/.test(of(people.kate).note), "newer Adonis stage kept");
// Liam: on another board: only missing details.
ok(of(people.liam).lead?.mode === "fill", "another board: fill only");
// Mary: already a client here, GoHighLevel says nurture: not put on the board.
ok(of(people.mary).lead === null && of(people.mary).outcome === "unchanged" && of(people.mary).match?.kind === "client", "a client stays a client");
// Nora: already an email contact.
ok(of(people.nora).outcome === "unchanged" && !of(people.nora).contact, "already a contact");
// Olive: on the do-not-email list: not added.
ok(!of(people.olive).contact && of(people.olive).outcome === "unchanged", "suppressed address not subscribed");
// Pat: same email as Hannah, later in the file: imported once.
ok(of(people.pat).outcome === "skip", "a twin in the file is skipped");
// Quinn: Holding, assigned to someone with no match: the default assignee; a new Holding column.
ok(of(people.quinn).lead?.mode === "place" && (of(people.quinn).lead as { columnId: number | null }).columnId === null && (of(people.quinn).lead as { columnName: string }).columnName === "Holding", "Holding, created on import");
ok((of(people.quinn).lead as { assigneeUserId: number | null }).assigneeUserId === 2, "no match: the default assignee");
// Rose: no email, no phone, no opportunity: nothing.
ok(of(people.rose).outcome === "skip", "nothing to add");
// Done: already imported.
ok(of(people.done).outcome === "already_imported", "already imported");
// Wendy: won: a client and a won lead.
ok(of(people.won).client?.existingId === null && (of(people.won).lead as { columnName: string }).columnName === "Sale", "won: client and Sale");

// The operator corrects an assignee.
{
  const again = buildPlan(persons, snap, { exportDay: EXPORT_DAY, now: NOW, assignees: { "Daniel O Dwyer": 1 } });
  const q = again.people.find((p) => p.person.ghlContactId === people.quinn.contactId)!;
  ok(q.lead?.mode === "place" && q.lead.assigneeUserId === 1, "the operator's pick wins");
  const row = again.assignees.find((a) => a.ghlName === "Daniel O Dwyer")!;
  ok(row.matchedUserId === null && row.userId === 1 && row.people === 1, "the assignee list shows the pick");
  const bad = buildPlan(persons, snap, { exportDay: EXPORT_DAY, now: NOW, assignees: { "Daniel O Dwyer": 99 } });
  ok((bad.people.find((p) => p.person.ghlContactId === people.quinn.contactId)!.lead as { assigneeUserId: number | null }).assigneeUserId === 2, "a user not on the team falls back to the default");
}

// Totals.
{
  const t = plan.totals;
  ok(t.people === persons.length && t.alreadyImported === 1, "people and already imported");
  ok(t.doNotContact === 1, "one do not contact");
  ok(t.clients === 2, "Gavin and Wendy are clients");
  ok(t.contactsOnly === 1, "Hannah is a contact");
  ok(t.duplicates >= 6, "Ivan, Joan, Kate, Liam, Mary and Nora matched");
  ok(t.columns.some((c) => c.name === "Holding" && c.count === 1) && t.newColumns.includes("Holding"), "the new Holding column is listed");
  const nurture = t.flows.find((f) => f.key === "lead_nurture")!;
  ok(nurture.people === 4 && nurture.enabled, "Aoife, Ciara, Dara and Ivan on nurture");
  const inSeven = plan.people.flatMap((p) => (p.run?.enabled ? p.run.steps : [])).filter((s) => s.dueAt >= NOW && s.dueAt < NOW + 7 * DAY).length;
  ok(t.messagesNext7Days === inSeven && inSeven > 0, "messages in the next 7 days");
}

// A flow that is off: placed, waiting.
{
  const ziggy = contact("Ziggy");
  const p = buildPlan(joinPeople([ziggy], [opp(ziggy, "Thinking About It", 2)]), snap, { exportDay: EXPORT_DAY, now: NOW });
  ok(p.people[0].run?.flowKey === "lead_thinking" && p.people[0].run.enabled === false, "placed on a flow that is off");
  ok(p.totals.waitingForFlowOff === 1 && p.totals.messagesNext7Days === 0, "counted as waiting, not as due");
}

// The dry run and its download carry no medical note.
{
  const rows = dryRunRows(plan);
  ok(rows.length === plan.people.length, "one row per person");
  ok(!JSON.stringify(rows).includes(MEDICAL), "no medical note in the dry run");
  const csv = dryRunCsv(rows, (ms) => new Date(ms).toISOString());
  ok(!csv.includes(MEDICAL) && csv.startsWith("Name,"), "no medical note in the download");
  const aoifeRow = rows.find((r) => r.id === people.aoife.contactId)!;
  ok(aoifeRow.to === "Long-term nurture" && aoifeRow.flow === "Long-term nurture" && aoifeRow.nextAt === MORNING(10) + 14 * DAY + spread(people.aoife) && aoifeRow.fromStage === "Long Term Nurture" && aoifeRow.days === 10, "a dry-run row says where, which flow and when");
}

// Twins: the person with an opportunity is imported, whatever the file order; plans stay in file order.
{
  const early = contact("Una"); // no opportunity, first in the file
  const late = { ...contact("Una"), phone: early.phone }; // same email and phone, with an opportunity
  const p = buildPlan(joinPeople([early, late], [opp(late, "Call Back Later", 3)]), snap, { exportDay: EXPORT_DAY, now: NOW });
  ok(p.people[0].person.ghlContactId === early.contactId && p.people[0].outcome === "skip", "the twin with no opportunity is skipped");
  ok(p.people[1].person.ghlContactId === late.contactId && p.people[1].lead?.mode === "place" && p.people[1].run?.flowKey === "lead_call_back", "the twin with an opportunity is imported");
}

// Do not contact is counted only for people who are imported.
{
  const vera = contact("Vera", { dnd: true, email: "", phone: "" });
  const p = buildPlan(joinPeople([vera], []), snap, { exportDay: EXPORT_DAY, now: NOW });
  ok(p.people[0].outcome === "skip" && p.people[0].doNotContact && p.totals.doNotContact === 0, "a skipped do-not-contact person is not counted");
}

// No days in stage and no created date: a matched Adonis lead keeps its column.
{
  const xena = contact("Xena", { createdAt: null });
  const s2: Snapshot = { ...snap, leads: [...snap.leads, existing({ id: 505, email: "xena@example.com" })] };
  const p = buildPlan(joinPeople([xena], [opp(xena, "Call Back Later", null, { createdAt: null, updatedAt: null })]), s2, { exportDay: EXPORT_DAY, now: NOW });
  ok(p.people[0].lead?.mode === "fill" && p.people[0].run === null, "an unknown stage time counts as the oldest: fill only");
}

// A matched lead in fill mode that is also do not contact.
{
  const yvonne = contact("Yvonne", { dnd: true });
  const s2: Snapshot = { ...snap, leads: [...snap.leads, existing({ id: 506, email: "yvonne@example.com", inActiveFlow: true })] };
  const p = buildPlan(joinPeople([yvonne], [opp(yvonne, "Long Term Nurture", 30)]), s2, { exportDay: EXPORT_DAY, now: NOW });
  ok(p.people[0].lead?.mode === "fill" && p.people[0].doNotContact && p.people[0].note.endsWith(" Marked do not contact: follow-ups stopped."), "the note says follow-ups stopped");
  ok(!of(people.joan).note.includes("do not contact"), "a fill without do not contact says nothing of it");
}

// Added to email contacts: the contacts-only people plus the placed leads whose consent is recorded and who have an email.
{
  // Hannah has no opportunity; the rest are leads with consent. Ivan (no email), Fiona (do not contact) and the fill-only matches are not.
  const added = [people.aoife, people.brian, people.ciara, people.dara, people.eve, people.hannah, people.quinn, people.won].map((c) => c.contactId).sort();
  const counted = plan.people.filter((p) => p.contact || (p.lead?.mode === "place" && p.lead.consent && !!p.person.email)).map((p) => p.person.ghlContactId).sort();
  assert.deepEqual(counted, added);
  n++;
  ok(plan.totals.emailContactsAdded === added.length && plan.totals.contactsOnly === 1, "email contacts added counts both");
}

console.log(`ghlImport plan: ${n} checks passed.`);
