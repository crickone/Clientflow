// Run: npm test -- src/lib/whatsapp/contactsSync.test.ts
//
// The WhatsApp contact import on a scratch business, from a stand-in
// provider: saved contacts and one-to-one chats land once per number, a second
// import refreshes them and keeps a hidden one hidden, nothing becomes a lead
// or gets a message, and the Contacts list joins them to the people already
// on file.
import Module from "node:module";

let contactsPages: unknown[] = [];
let chatsPages: unknown[] = [];
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/whatsapp")
    return {
      isWhatsAppConfigured: () => true,
      getWhatsAppBridge: () => ({
        connectionStatus: async () => ({ connected: true, phone: "353870000099" }),
        listContactsPage: async (offset: number) => contactsPages[offset / 500] ?? { contacts: [], total: 0 },
        listChatsPage: async (offset: number) => chatsPages[offset / 500] ?? { chats: [], total: 0 },
      }),
    };
  return realLoad.call(this, request, ...rest);
};

import "@/lib/leadFlows/testing/stubs";

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { runWithTenant } from "@/lib/db/tenant";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { makeScratchTenant } from "@/lib/leadFlows/testing/harness";

const scratch = makeScratchTenant("wa-contacts-test");

(async () => {
  const { syncWhatsAppContacts, hideWhatsAppContact, contactsSyncState } = await import("./contactsSync");
  const { loadDirectory } = await import("@/lib/contacts/directory");
  const { filterDirectory } = await import("@/lib/contacts/directoryModel");
  let n = 0;
  const ok = (c: boolean, m: string) => {
    assert.ok(c, m);
    n++;
  };
  try {
    await runWithTenant(scratch.tid, async () => {
      db.insert(schema.clients).values({ firstName: "Client", lastName: "Example", phone: "087 000 0001" }).run();
      // Known only by number: an Inbox conversation, and a lead someone already named.
      const [nameless] = db.insert(schema.leads).values({ source: "whatsapp", phone: "+353 87 000 0002", inboxOnly: true }).returning().all();
      const [named] = db.insert(schema.leads).values({ source: "whatsapp", firstName: "Typed", phone: "087 000 0001" }).returning().all();
      const leadsBefore = db.select().from(schema.leads).all().length;

      // Two pages of contacts (500 + 1), one page of chats.
      const many = Array.from({ length: 500 }, (_, i) => ({ id: String(353861000000 + i), pushname: `Person ${i}`, saved: false }));
      contactsPages = [
        { contacts: many, total: 501 },
        { contacts: [{ id: "353870000001", name: "Client (saved)", saved: true }], total: 501 },
      ];
      chatsPages = [
        {
          chats: [
            { id: "353870000002@s.whatsapp.net", type: "contact", timestamp: 1794488812, last_message: { from_me: false, from_name: "Chat Example" } },
            { id: "353870000099@s.whatsapp.net", type: "contact", timestamp: 1794488812 },
            { id: "120363000000@g.us", type: "group", timestamp: 1794488812 },
          ],
          total: 3,
        },
      ];
      const first = await syncWhatsAppContacts();
      ok(first.ok && first.count === 502, "every page read: 501 contacts and one chat, the business's own number and the group left out");
      const state = contactsSyncState();
      ok(state.okAt != null && state.count === 502 && state.error == null, "the result is kept for the page");
      ok(db.select().from(schema.leads).all().length === leadsBefore, "no lead made");
      ok(db.select().from(schema.automationQueue).all().length === 0, "nothing queued to send");
      const nl = db.select().from(schema.leads).where(eq(schema.leads.id, nameless.id)).get()!;
      ok(nl.firstName === "Chat" && nl.lastName === "Example", "a conversation known only by number is named from WhatsApp");
      ok(db.select().from(schema.leads).where(eq(schema.leads.id, named.id)).get()!.firstName === "Typed", "a name someone typed is never changed");

      const chat = db.select().from(schema.whatsappContacts).where(eq(schema.whatsappContacts.phone, "353870000002")).get()!;
      ok(hideWhatsAppContact(chat.id), "hidden");
      chatsPages = [{ chats: [{ id: "353870000002@s.whatsapp.net", type: "contact", timestamp: 1794499999, last_message: { from_me: false, from_name: "New Name" } }], total: 1 }];
      const second = await syncWhatsAppContacts();
      const again = db.select().from(schema.whatsappContacts).where(eq(schema.whatsappContacts.phone, "353870000002")).get()!;
      ok(second.ok && second.count === 502 && again.hidden && again.lastChatAt === 1794499999000, "a second import refreshes, keeps it hidden, adds no duplicate");

      const people = loadDirectory();
      const client = people.find((p) => p.clientId != null)!;
      ok(client.whatsappId != null && client.name === "Client Example" && client.tags.some((t) => t.kind === "whatsapp"), "the client and their WhatsApp contact are one row, with the client's name");
      ok(people.find((p) => p.inboxLeadId === nameless.id)?.name === "Chat Example", "hidden on WhatsApp but an Inbox conversation: still listed, by its new name");
      ok(filterDirectory(people, { filter: "whatsapp" }).length === 500, "WhatsApp only: the 500 not on file");
      const onlyWa = db.select().from(schema.whatsappContacts).where(eq(schema.whatsappContacts.phone, "353861000000")).get()!;
      hideWhatsAppContact(onlyWa.id);
      ok(!loadDirectory().some((p) => p.whatsappId === onlyWa.id) && filterDirectory(loadDirectory(), { filter: "whatsapp" }).length === 499, "a hidden WhatsApp-only contact is not listed");
    });
    console.log(`whatsapp contacts: ${n} checks passed.`);
  } finally {
    scratch.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
