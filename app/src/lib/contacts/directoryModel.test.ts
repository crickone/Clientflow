// Run: npm test -- src/lib/contacts/directoryModel.test.ts
import assert from "node:assert/strict";
import { buildDirectory, filterDirectory, parseFilter, phoneKey, type DirectoryRecord } from "./directoryModel";

let n = 0;
const ok = (c: boolean, m: string) => {
  assert.ok(c, m);
  n++;
};

ok(phoneKey("087 000 0001") === phoneKey("+353 87 000 0001"), "national and international forms of a number match");
ok(phoneKey("12") === null, "too short to be a number");

const records: DirectoryRecord[] = [
  // One person: a client, an old lead card with the same email, and a WhatsApp contact with the same number.
  { kind: "client", id: 1, name: "Client Example", email: "client@example.com", phone: "087 000 0001", lastAt: 1000 },
  { kind: "lead", id: 10, name: "Client Example", email: "CLIENT@example.com", phone: null, stage: "Sale", inboxOnly: false, createdAt: 5, lastAt: null },
  { kind: "whatsapp", id: 100, name: "Client (gym)", phone: "353870000001", lastAt: 3000, hidden: false },
  // A lead on the board, also on the mailing list (joined by email), and the mailing row carries a phone that joins a WhatsApp chat.
  { kind: "lead", id: 11, name: "Lead Example", email: "lead@example.com", phone: null, stage: "Hot lead", inboxOnly: false, createdAt: 6, lastAt: 2000 },
  { kind: "mailing", id: 50, name: null, email: "lead@example.com", phone: "+353 87 000 0002" },
  { kind: "whatsapp", id: 101, name: null, phone: "353870000002", lastAt: null, hidden: false },
  // An Inbox-only conversation.
  { kind: "lead", id: 12, name: "", email: null, phone: "+353870000003", stage: null, inboxOnly: true, createdAt: 7, lastAt: 2500 },
  // WhatsApp only: one shown, one hidden.
  { kind: "whatsapp", id: 102, name: "Supplier Example", phone: "353870000004", lastAt: 100, hidden: false },
  { kind: "whatsapp", id: 103, name: "Family Example", phone: "353870000005", lastAt: 4000, hidden: true },
  // Mailing list only.
  { kind: "mailing", id: 51, name: "Mail Example", email: "mail@example.com", phone: null },
];

const people = buildDirectory(records);
ok(people.length === 5, "five people: the hidden WhatsApp-only one is left out");
const client = people.find((p) => p.clientId === 1)!;
ok(client.name === "Client Example" && client.leadId === 10 && client.whatsappId === 100, "a client, their lead card and their WhatsApp joined");
ok(client.tags.map((t) => t.label).join() === "Client,Lead: Sale,WhatsApp", "tags say what they are");
ok(client.lastAt === 3000 && client.category === "client", "last message is the newest of any record");
ok(people[0].clientId === 1, "newest first");

const lead = people.find((p) => p.leadId === 11)!;
ok(lead.mailingId === 50 && lead.whatsappId === 101, "joined through the mailing list's phone, transitively");
ok(lead.phone === "+353 87 000 0002" && lead.category === "lead", "the mailing list's phone is shown");

const inbox = people.find((p) => p.inboxLeadId === 12)!;
ok(inbox.tags[0].label === "Not a lead" && inbox.category === "not_lead" && inbox.name === "+353870000003", "an Inbox-only conversation, named by its number");

const wa = people.find((p) => p.whatsappId === 102)!;
ok(wa.whatsappOnly && wa.name === "Supplier Example" && wa.phone === "+353870000004", "a WhatsApp-only contact");

ok(filterDirectory(people, { filter: "clients" }).length === 1, "Clients");
ok(filterDirectory(people, { filter: "leads" }).length === 1, "Leads");
ok(filterDirectory(people, { filter: "not_leads" }).length === 3, "Not leads: Inbox-only, WhatsApp-only, mailing-only");
ok(filterDirectory(people, { filter: "whatsapp" }).map((p) => p.whatsappId).join() === "102", "WhatsApp only");
ok(filterDirectory(people, { q: "supplier" }).length === 1, "search by name");
ok(filterDirectory(people, { q: "087 000 0004" }).map((p) => p.whatsappId).join() === "102", "search by a national number finds the international one");
ok(filterDirectory(people, { q: "LEAD@EXAMPLE" }).length === 1, "search by email");
ok(parseFilter("nonsense") === "all" && parseFilter("whatsapp") === "whatsapp", "unknown filter is All");

console.log(`directoryModel: ${n} checks passed.`);
