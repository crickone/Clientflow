// Run: npm test -- src/lib/ghlImport/mapping.test.ts
//
// The agreed rules: GoHighLevel stage and days in stage to an Adonis
// column and follow-up, the tags for people with no opportunity, and do not
// contact. Boundaries at 14 days.
import assert from "node:assert/strict";

import { decide, matchStaff, STALE_AFTER_DAYS, type Decision, type Placement } from "./mapping";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};
const run = (stage: string | null, days: number | null, tags: string[] = [], dnd = false): Decision => decide({ stage, daysInStage: days, tags, dnd });
const lead = (d: Decision) => {
  assert.equal(d.placement.kind, "lead");
  return d.placement as Extract<Placement, { kind: "lead" }>;
};

ok(STALE_AFTER_DAYS === 14, "stale after 14 days");

// Long-term nurture: carried on where it was, at any age (the planner decides if it is past week 12).
{
  const p = lead(run("Long Term Nurture", 30));
  ok(p.column === "key:nurture" && p.flow?.via === "column" && p.flow.from === "resume" && !p.flow.emailOnly, "nurture resumes");
  ok(lead(run("long term  nurture", 200)).flow?.from === "resume", "case and spaces do not matter; old nurture still resumes (planner ends it)");
  ok(lead(run("Long Term Nurture", null)).flow === null, "unknown days: column only");
}

// The four follow-up stages, either side of 14 days.
for (const [stage, column, via] of [
  ["Call Back Later", "key:call_back", "column"],
  ["Thinking About It", "key:thinking", "column"],
  ["No Answer Call Back", "key:no_answer", "column"],
  ["New Lead", "role:new", "new_lead"],
] as const) {
  const fresh = lead(run(stage, 14));
  ok(fresh.column === column && fresh.flow?.via === via && fresh.flow.from === "resume", `${stage} at 14 days: its own column and flow`);
  const stale = lead(run(stage, 15));
  ok(stale.column === "key:nurture" && stale.flow?.via === "column" && stale.flow.from === "start", `${stage} at 15 days: Long-term nurture from week 1`);
  ok(lead(run(stage, 0)).column === column, `${stage} today: its own column`);
  ok(lead(run(stage, null)).column === column && lead(run(stage, null)).flow === null, `${stage}, days unknown: column only`);
}

// Consult booked (GoHighLevel writes it with two spaces).
ok(lead(run("Consult  Booked", 14)).column === "role:booked" && lead(run("Consult Booked", 14)).flow === null, "booked at 14 days: Consultation booked, no flow");
{
  const p = lead(run("Consult  Booked", 15));
  ok(p.column === "key:nurture" && p.flow?.from === "start", "booked 15 days ago: Long-term nurture from week 1");
}

// The rest.
{
  const u = lead(run("Message Undelivered", 20));
  ok(u.column === "key:undelivered" && u.flow?.emailOnly === true && u.flow.from === "resume", "undelivered: its column, email only");
  ok(lead(run("Holding", 3)).column === "holding" && lead(run("Holding", 3)).flow === null, "Holding column, no flow");
  ok(lead(run("Send Deposit Link", 100)).column === "role:engaged" && lead(run("Send Deposit Link", 1)).flow === null, "deposit link: Hot lead, no flow");
  const w = lead(run("Won", 100));
  ok(w.column === "role:won" && w.won && !w.lost && w.flow === null, "won: Sale, no flow");
  const l = lead(run("Lost", 2));
  ok(l.column === "role:lost" && l.lost && l.flow === null, "lost: Lost, no flow");
  const x = run("Something New", 2);
  ok(lead(x).column === "role:new" && lead(x).flow === null && /Something New/.test(x.rule), "an unknown stage: New lead, no flow, says which stage");
}

// Consent: leads that are not lost and not do-not-contact.
ok(run("Long Term Nurture", 3).consent, "a nurture lead gets consent");
ok(run("Won", 3).consent, "a won lead gets consent");
ok(!run("Lost", 3).consent, "a lost lead does not");
ok(!run(null, null).consent, "a contact-only person does not (they are added to contacts instead)");

// No opportunity: the tags decide.
ok(run(null, null, ["member"]).placement.kind === "client", "member: client");
ok(run(null, null, ["visited-once"]).placement.kind === "client", "visited once: client");
ok(run(null, null, ["lapsed-2-months", "lost"]).placement.kind === "client", "lapsed: client (a client tag wins over lost)");
ok(lead(run(null, null, ["lost"])).lost, "lost tag: lost lead");
ok(lead(run(null, null, ["not interested"])).lost, "not interested tag: lost lead");
ok(run(null, null, ["aug-2026-comp-outreach"]).placement.kind === "contact", "anyone else: email contact only");

// Do not contact: DND, or "not interested" anywhere.
{
  const d = run("Long Term Nurture", 3, [], true);
  ok(d.doNotContact && !d.consent && lead(d).flow === null && lead(d).column === "key:nurture", "DND: column kept, no flow, no consent");
  const t = run("Call Back Later", 3, ["lead", "not interested"]);
  ok(t.doNotContact && lead(t).flow === null, "not interested tag on an opportunity: do not contact");
  ok(run(null, null, [], true).doNotContact && run(null, null, [], true).placement.kind === "contact", "DND with no opportunity: still recorded, as do not contact");
  ok(!run("Won", 3).doNotContact, "no DND, no tag: contactable");
}

// Staff names.
const staff = [
  { userId: 1, name: "Sandra Example" },
  { userId: 2, name: "DJ" },
  { userId: 3, name: "Seán Ó Test" },
  { userId: 4, name: "Sandra Other" },
];
ok(matchStaff("Sandra Example", staff) === 1, "full name");
ok(matchStaff("  sandra   example ", staff) === 1, "case and spaces");
ok(matchStaff("Sean O Test", staff) === 3, "accents do not matter");
ok(matchStaff("Sandra Kalace", staff) === null, "two Sandras: a first name alone is not enough");
ok(matchStaff("Daniel O Dwyer", staff) === null, "no match: null (the screen lets the operator pick)");
ok(matchStaff("", staff) === null, "blank: null");
ok(matchStaff("Dj", [{ userId: 2, name: "DJ" }]) === 2, "a one-word name matches");

console.log(`ghlImport mapping: ${n} checks passed.`);
