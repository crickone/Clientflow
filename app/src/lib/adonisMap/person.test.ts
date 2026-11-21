// Run: npm test -- src/lib/adonisMap/person.test.ts
import assert from "node:assert/strict";

import { matchPeople, personStage, type ClientRec, type LeadRec } from "./person";

const clients: ClientRec[] = [
  { id: 1, firstName: "Niamh", lastName: "Byrne", email: "niamh.byrne@example.com", phone: "087 555 0142" },
  { id: 2, firstName: "Emma", lastName: "Doyle", email: "doyles@example.com", phone: "0861110001" },
  { id: 3, firstName: "Liam", lastName: "Murphy", email: null, phone: "0871110002" },
  { id: 4, firstName: "Orla", lastName: "Murphy", email: null, phone: "087 111 0002" },
  { id: 5, firstName: "Aoife", lastName: "Kelly", email: "Aoife.Kelly@Example.com", phone: "0870000005" },
];
const L = (id: number, v: Partial<LeadRec>): LeadRec => ({ id, firstName: null, lastName: null, email: null, phone: null, clientId: null, ...v });
const leads: LeadRec[] = [
  L(10, { firstName: "Niamh", phone: "+353 87 555 0142" }), // same phone + first name: joins
  L(11, { firstName: "Sean", lastName: "Byrne", phone: "0875550142" }), // same phone, other first name: review
  L(12, { firstName: "David", email: "DOYLES@example.com" }), // same email, other first name: review
  L(13, { firstName: "Liam", phone: "0871110002" }), // matches two clients: review against both
  L(14, { firstName: "aoife ", email: "aoife.kelly@example.com" }), // same email + first name, any case: joins
  L(15, { firstName: "Zoe", clientId: 2 }), // converted: joined whatever the rules say
  L(16, { firstName: "", phone: "0870000005" }), // an empty first name is never "the same": review
  L(17, { firstName: "Niamh", lastName: "Byrne" }), // name only: never joined, no review
  L(18, { firstName: "Niamh", email: "niamh.byrne@example.com" }), // would join, but staff kept it separate
  L(19, { firstName: "Sean", phone: "0875550142" }), // a review pair that staff joined
];
const idx = matchPeople(clients, leads, [
  { leadId: 18, clientId: 1, decision: "separate" },
  { leadId: 19, clientId: 1, decision: "join" },
]);

assert.equal(idx.leadPerson.get(10), "c:1");
assert.equal(idx.joinReason.get(10), "rules");
assert.equal(idx.leadPerson.get(11), "l:11");
assert.equal(idx.leadPerson.get(12), "l:12");
assert.equal(idx.leadPerson.get(13), "l:13");
assert.equal(idx.leadPerson.get(14), "c:5");
assert.equal(idx.leadPerson.get(15), "c:2");
assert.equal(idx.joinReason.get(15), "converted");
assert.equal(idx.leadPerson.get(16), "l:16");
assert.equal(idx.leadPerson.get(17), "l:17");
assert.equal(idx.leadPerson.get(18), "l:18", "a separate decision blocks an automatic join");
assert.equal(idx.leadPerson.get(19), "c:1");
assert.equal(idx.joinReason.get(19), "decided");
assert.deepEqual(idx.clientLeads.get(1), [10, 19]);
assert.deepEqual(idx.clientLeads.get(2), [15]);

const reviews = idx.reviews.map((r) => `${r.leadId}-${r.clientId}: ${r.reason}`).sort();
assert.deepEqual(reviews, [
  "11-1: Same phone, different first name",
  "12-2: Same email, different first name",
  "13-3: Matches more than one client",
  "13-4: Matches more than one client",
  "16-5: Same phone, different first name",
]);

const base = { kind: "client" as const, activeMembership: false, activePackage: false, lastVisit: null, futureBookings: 0, today: "2026-11-21" };
assert.equal(personStage({ ...base, kind: "lead" }), "lead");
assert.equal(personStage({ ...base, activeMembership: true }), "member");
assert.equal(personStage({ ...base, activePackage: true }), "member");
assert.equal(personStage({ ...base, lastVisit: "2026-10-22" }), "member", "a visit exactly 30 days ago still counts");
assert.equal(personStage({ ...base, lastVisit: "2026-10-21" }), "lapsed");
assert.equal(personStage({ ...base, lastVisit: "2026-10-21", futureBookings: 1 }), "client", "booked ahead is not lapsed");
assert.equal(personStage(base), "client", "a client who never visited");

console.log("person.test.ts: all assertions passed");
