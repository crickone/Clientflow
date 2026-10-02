// Run: npm test -- src/lib/dashboard/data/communicationQueries.test.ts
//
// Smoke test: every communicationQueries loader once against a scratch tenant
// with a little seeded data.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return { redirect: () => { throw new Error("redirect stub called unexpectedly"); } };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../../db/control") as typeof import("../../db/control");
  const { runWithTenant } = requireLocal("../../db/tenant") as typeof import("../../db/tenant");
  const { db, schema } = requireLocal("../../db") as typeof import("../../db");
  const q = requireLocal("./communicationQueries") as typeof import("./communicationQueries");

  const slug = "dashboard-comm-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Dashboard Comm Test", `tenants/${slug}/${slug}.db`) as { id: number };
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const H = 3_600_000;
  const DAY = 24 * H;
  const now = Date.now();
  const from = now - 7 * DAY;
  const to = now + DAY;
  const at = (ms: number) => new Date(ms);

  try {
    await runWithTenant(t.id, async () => {
      const lead = db.insert(schema.leads).values({ firstName: "Lead", lastName: "One" }).returning().get();
      const client = db.insert(schema.clients).values({ firstName: "Client", lastName: "One", phone: "0" }).returning().get();

      db.insert(schema.leadMessages).values([
        { leadId: lead.id, direction: "inbound", channel: "whatsapp", content: "hi", createdAt: at(now - 3 * DAY), aiCategory: "new_lead", aiPriority: "high", aiTriagedAt: at(now - 3 * DAY), autoReplyStatus: "auto_sent" },
        { leadId: lead.id, direction: "outbound", channel: "whatsapp", content: "hello", createdAt: at(now - 3 * DAY + H), sentAt: at(now - 3 * DAY + H) },
        { leadId: lead.id, direction: "note", channel: null, content: "internal", createdAt: at(now - 3 * DAY) },
        { leadId: lead.id, direction: "outbound", channel: "system", content: "sys", createdAt: at(now - 3 * DAY) },
        { leadId: lead.id, direction: "inbound", channel: null, content: "later", createdAt: at(now - H), aiCategory: "faq", aiPriority: "normal", aiTriagedAt: at(now - H), autoReplyStatus: "drafted" },
      ]).run();
      db.insert(schema.clientMessages).values([
        { clientId: client.id, direction: "inbound", channel: "sms", content: "q", createdAt: at(now - 2 * DAY) },
      ]).run();
      db.insert(schema.emailMessages).values([
        { gmailMessageId: "g1", gmailThreadId: "th1", direction: "in", isRead: false, internalDate: at(now - 2 * DAY) },
        { gmailMessageId: "g2", gmailThreadId: "th1", direction: "out", isRead: true, internalDate: at(now - 2 * DAY + 2 * H) },
        { gmailMessageId: "g3", gmailThreadId: "th2", direction: "in", isRead: true, internalDate: null },
      ]).run();
      const tag = db.insert(schema.tags).values({ label: "Pricing", slug: "pricing" }).returning().get();
      db.insert(schema.conversationTags).values([
        { ownerType: "lead", ownerId: lead.id, tagId: tag.id },
        { ownerType: "client", ownerId: client.id, tagId: tag.id },
      ]).run();
      db.insert(schema.automationQueue).values([
        { triggerKey: "k", channel: "email", body: "b", dueAt: at(now - DAY), status: "sent", sentAt: at(now - DAY) },
        { triggerKey: "k", channel: "email", body: "b", dueAt: at(now - DAY), status: "failed" },
        { triggerKey: "k", channel: "email", body: "b", dueAt: at(now + H), status: "queued" },
        { triggerKey: "k", channel: "email", body: "b", dueAt: at(now - 60 * DAY), status: "sent", sentAt: at(now - 60 * DAY) },
      ]).run();

      assert.equal(q.unreadEmails(), 1, "only in + unread");

      const rows = q.loadMessages(from, to);
      // lead: 2 inbound + 1 outbound; client: 1; gmail: 2 (null internalDate skipped); notes and system excluded
      assert.equal(rows.length, 6);
      assert.ok(rows.some((r) => r.convo === "thread:th1" && r.direction === "outbound" && r.channel === "email"));
      assert.ok(rows.some((r) => r.convo === `lead:${lead.id}` && r.channel === null));
      assert.ok(rows.every((r) => typeof r.atMs === "number"));

      const answered = db.insert(schema.leads).values({ firstName: "Answered" }).returning().get();
      db.insert(schema.leadMessages).values([
        { leadId: answered.id, direction: "inbound", channel: "sms", content: "q", createdAt: at(now - 2 * H) },
        { leadId: answered.id, direction: "outbound", channel: "sms", content: "a", createdAt: at(now - H), sentAt: at(now - H) },
      ]).run();
      const waiting = q.awaitingReply(10);
      assert.deepEqual(waiting.map((w) => [w.kind, w.name, w.href]), [
        ["client", "Client One", `/clients/${client.id}`],
        ["lead", "Lead One", `/leads/${lead.id}`],
      ], "oldest wait first; answered and note/system-only excluded");
      assert.equal(q.awaitingReply(1).length, 1);

      assert.deepEqual(q.triageReplyCounts(from, to), { triaged: 2, autoSent: 1, forReview: 1 });
      assert.deepEqual(q.topTags(from, to, 8), [{ label: "Pricing", value: 2 }]);
      assert.deepEqual(q.automationCounts(from, to), { sent: 1, failed: 1, queued: 1 });
    });
    console.log("communicationQueries.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
