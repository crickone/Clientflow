// Run: npm test -- src/lib/whatsapp/contactsModel.test.ts
import assert from "node:assert/strict";
import { mergeWaContacts, parseChatsPage, parseContactsPage, phoneFromWaId } from "./contactsModel";

let n = 0;
const ok = (c: boolean, m: string) => {
  assert.ok(c, m);
  n++;
};

ok(phoneFromWaId("353870000001") === "353870000001", "bare digits");
ok(phoneFromWaId("353870000001@s.whatsapp.net") === "353870000001", "a one-to-one chat id");
ok(phoneFromWaId("120363000000@g.us") === null, "a group is not a person");
ok(phoneFromWaId("status@broadcast") === null, "status is not a person");

const contacts = parseContactsPage({
  contacts: [
    { id: "353870000001", name: "Saved Example", pushname: "Their own name", saved: true, phonebook: true },
    { id: "353870000002", pushname: "Pushname Example", saved: false, phonebook: false },
    { id: "lid-not-a-number", name: "Odd", saved: true },
  ],
  count: 3,
  total: 1211,
});
ok(contacts.total === 1211 && contacts.items.length === 2, "two people, the odd id skipped, the total read");
ok(contacts.items[0].savedName === "Saved Example" && contacts.items[0].saved, "a saved contact keeps its saved name");
ok(contacts.items[1].savedName === null && contacts.items[1].pushname === "Pushname Example", "an unsaved one has only the name they gave");

const chats = parseChatsPage({
  chats: [
    { id: "353870000002@s.whatsapp.net", type: "contact", timestamp: 1794488812, last_message: { from_me: false, from_name: "Chat Name" } },
    { id: "353870000003@s.whatsapp.net", type: "contact", timestamp: 1794488000, last_message: { from_me: true, from_name: "The business" } },
    { id: "120363000000@g.us", type: "group", timestamp: 1794488000, name: "A group" },
    { id: "status@broadcast", type: "stories", timestamp: 1794488000 },
    { id: "353870000009@s.whatsapp.net", type: "contact", timestamp: 1794488000 },
  ],
  total: 1779,
});
ok(chats.items.length === 3 && chats.total === 1779, "one-to-one chats only");
ok(chats.items[0].lastChatAt === 1794488812000, "seconds to milliseconds");
ok(chats.items[1].pushname === null, "the business's own name on its message is not their name");

const merged = mergeWaContacts(contacts.items, chats.items, "+353 87 000 0009");
ok(merged.length === 3, "one row per number, the business's own number left out");
const two = merged.find((m) => m.phone === "353870000002")!;
ok(two.name === "Pushname Example" && two.lastChatAt === 1794488812000 && !two.saved, "a contact and its chat are one row");
ok(merged.find((m) => m.phone === "353870000001")!.name === "Saved Example", "the saved name wins");
ok(merged.find((m) => m.phone === "353870000003")!.saved === false, "a chat with no contact still comes in");

console.log(`contactsModel: ${n} checks passed.`);
