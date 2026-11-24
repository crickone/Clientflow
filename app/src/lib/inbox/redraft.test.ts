// Run: npm test -- src/lib/inbox/redraft.test.ts
//
// Which drafts get rewritten after a price change: the latest customer message
// in each conversation with an unsent draft and nothing after it. No AI call is
// made here (only the selection is tested).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("@/lib/db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("@/lib/db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("@/lib/db/schema");
  const { waitingDrafts } = requireLocal("./redraft") as typeof import("./redraft");

  const slug = "redraft-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const { id: tid } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Redraft Test", `tenants/${slug}/${slug}.db`) as { id: number };
  try {
    const tdb = getTenantDbById(tid);
    const lead = (first: string) => tdb.insert(schema.leads).values({ firstName: first, source: "facebook" }).returning().get().id;
    const now = Date.now();
    const msg = (leadId: number, direction: "inbound" | "outbound", minsAgo: number, status: "drafted" | "held" | "auto_sent" | null) =>
      tdb.insert(schema.leadMessages).values({
        leadId, direction, channel: "whatsapp", content: "How much is infrared?",
        createdAt: new Date(now - minsAgo * 60_000),
        autoReplyStatus: status ?? "none", aiSuggestedReply: status ? "Infrared is €65." : null,
      }).run();

    const waiting = lead("Waiting");     msg(waiting, "inbound", 30, "drafted");
    const held = lead("Held");           msg(held, "inbound", 30, "held");
    const answered = lead("Answered");   msg(answered, "inbound", 30, "drafted"); msg(answered, "outbound", 10, null);
    const sent = lead("AutoSent");       msg(sent, "inbound", 30, "auto_sent");
    const old = lead("Old");             msg(old, "inbound", 60 * 24 * 40, "drafted");

    await runWithTenant(tid, async () => {
      // The scratch database can outlive a run, so judge only this run's leads.
      const mine = new Set([waiting, held, answered, sent, old]);
      const got = waitingDrafts(now - 30 * 24 * 3600e3).map((w) => w.ownerId).filter((id) => mine.has(id)).sort();
      assert.deepEqual(got, [waiting, held].sort(), "only unanswered drafts in the last 30 days");
    });
    console.log("redraft: 1 check passed.");
  } finally {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
