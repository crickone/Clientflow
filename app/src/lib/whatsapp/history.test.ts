// Run: npm test -- src/lib/whatsapp/history.test.ts
//
// A lead's WhatsApp chat filled in from a stand-in provider on a scratch
// business: missing messages added once, in order, with "phone" on what the
// business sent itself; nothing duplicated that the record already has (its
// own messages, a follow-up flow's send); phone-sent webhook messages land on
// the right lead or client, and an unknown number is left alone.
import Module from "node:module";
import type { ChatMessage } from "./historyModel";

let history: ChatMessage[] = [];
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/whatsapp") return { isWhatsAppConfigured: () => true, getWhatsAppBridge: () => ({ listChat: async () => history }) };
  return realLoad.call(this, request, ...rest);
};

import "@/lib/leadFlows/testing/stubs";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";

import { runWithTenant } from "@/lib/db/tenant";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { makeScratchTenant } from "@/lib/leadFlows/testing/harness";

fs.rmSync(path.join(process.cwd(), "data", "tenants", "wa-history-test"), { recursive: true, force: true });
const scratch = makeScratchTenant("wa-history-test");

(async () => {
  const { syncLeadWhatsApp, recordPhoneSent } = await import("./history");
  let n = 0;
  const ok = (c: boolean, m: string) => {
    assert.ok(c, m);
    n++;
  };
  try {
    await runWithTenant(scratch.tid, async () => {
      const [lead] = db.insert(schema.leads).values({ source: "whatsapp", firstName: "Example", phone: "087 000 0001" }).returning().all();
      const [client] = db.insert(schema.clients).values({ firstName: "Client", lastName: "Example", phone: "+353870000002" }).returning().all();
      // Already on the record: their reply (from the webhook) and a follow-up flow's WhatsApp.
      db.insert(schema.leadMessages).values({ leadId: lead.id, direction: "inbound", channel: "whatsapp", content: "Sorry, not for a while", providerMessageId: "in-2", sentAt: new Date(4000) }).run();
      db.insert(schema.automationQueue).values({ triggerKey: "lead_thinking", leadId: lead.id, channel: "whatsapp", body: "Flow message", dueAt: new Date(3000), status: "sent", providerMessageId: "flow-1" }).run();

      history = [
        { id: "tpl-1", fromMe: true, at: 1000, text: "Hi Example,\n\nJust checking in.", source: "mobile" },
        { id: "in-1", fromMe: false, at: 2000, text: "I will get back to you", source: "mobile" },
        { id: "flow-1", fromMe: true, at: 3000, text: "Flow message", source: "api" },
        { id: "typed-1", fromMe: true, at: 2500, text: "No problem, whenever you are ready", source: "mobile" },
        { id: "in-2", fromMe: false, at: 4000, text: "Sorry, not for a while", source: "mobile" },
      ];
      const first = await syncLeadWhatsApp(lead.id, { force: true });
      assert.deepEqual(first, { added: 3 });
      n++;
      const rows = db.select().from(schema.leadMessages).where(eq(schema.leadMessages.leadId, lead.id)).orderBy(asc(schema.leadMessages.createdAt)).all();
      assert.deepEqual(rows.map((r) => r.providerMessageId), ["tpl-1", "in-1", "typed-1", "in-2"], "in chat order, the flow's send not copied");
      n++;
      const tpl = rows[0];
      ok(tpl.direction === "outbound" && tpl.origin === "phone" && tpl.status === "sent" && tpl.sentAt?.getTime() === 1000, "the template is the business's, from its WhatsApp, at its own time");
      ok(rows[1].direction === "inbound" && rows[1].origin === null, "their reply is theirs");
      ok(!rows.some((r) => r.aiGenerated), "nothing marked as written by Adonis");

      assert.deepEqual(await syncLeadWhatsApp(lead.id, { force: true }), { added: 0 }, "a second pass adds nothing");
      n++;
      ok("skipped" in (await syncLeadWhatsApp(lead.id)), "at most once every few minutes");

      // Webhook: typed on the phone to the lead, then to the client, then to a stranger.
      ok(recordPhoneSent([{ id: "ph-1", fromMe: true, at: 5000, text: "See you Saturday", source: "mobile", toPhoneDigits: "353870000001" }]) === 1, "phone-sent to a lead recorded");
      ok(recordPhoneSent([{ id: "ph-1", fromMe: true, at: 5000, text: "See you Saturday", source: "mobile", toPhoneDigits: "353870000001" }]) === 0, "once");
      ok(recordPhoneSent([{ id: "ph-2", fromMe: true, at: 6000, text: "Your booking is confirmed", source: "mobile", toPhoneDigits: "353870000002" }]) === 1, "phone-sent to a client recorded");
      const cm = db.select().from(schema.clientMessages).where(eq(schema.clientMessages.clientId, client.id)).all();
      ok(cm.length === 1 && cm[0].origin === "phone" && cm[0].direction === "outbound", "on the client's record, from their WhatsApp");
      const leadsBefore = db.select().from(schema.leads).all().length;
      ok(recordPhoneSent([{ id: "ph-3", fromMe: true, at: 7000, text: "Hello", source: "mobile", toPhoneDigits: "353870009999" }]) === 0, "an unknown number is left alone");
      ok(db.select().from(schema.leads).all().length === leadsBefore, "an outbound message never makes a lead");
    });
    console.log(`whatsapp history: ${n} checks passed.`);
  } finally {
    scratch.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
