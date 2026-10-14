// Run: npm test -- src/lib/ai/usageContext.test.ts
//
// Each AI cost is filed under the work it was for (a campaign, an Adonis
// chat, a post), so the account's AI usage page can say where it went.
import assert from "node:assert/strict";
import { controlSqlite } from "../db/control";
import { recordFlatUsage, recordUsage } from "./usage";
import { withUsageContext, withUsageContextIfNone } from "./usageContext";
import { getUsageReport } from "./usageReport";

(async () => {
  let passed = 0;
  const check = (name: string, cond: boolean) => {
    assert.ok(cond, name);
    passed++;
  };
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'usagectx-test'").run();
  const { id: tid } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('usagectx-test','Usage Ctx Test','tenants/usagectx-test/void.db',1) RETURNING id")
    .get() as { id: number };
  const rowsFor = () =>
    controlSqlite.prepare("SELECT agent_key, ref, label FROM ai_usage WHERE tenant_id = ? ORDER BY id").all(tid) as { agent_key: string; ref: string | null; label: string | null }[];
  const u = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreateTokens: 0 };

  try {
    recordUsage(tid, "brief", "claude-haiku-4-5-20251001", u);
    await withUsageContext({ ref: "campaign:2", label: "Black Friday Massage 2026" }, async () => {
      await new Promise((r) => setTimeout(r, 5)); // across an await
      recordUsage(tid, "orchestrator", "claude-sonnet-5-5", u);
      // a post designed inside the campaign stays under the campaign
      await withUsageContextIfNone({ ref: "post:9", label: "Post: Pick your massage" }, async () => {
        recordFlatUsage(tid, "carousel", "flux", 4);
      });
    });
    await withUsageContextIfNone({ ref: "post:9", label: "Post: Pick your massage" }, async () => {
      recordFlatUsage(tid, "carousel", "flux", 4);
    });

    const rows = rowsFor();
    check("a cost outside any work has no tag", rows[0].ref === null && rows[0].label === null);
    check("a cost inside a campaign is filed under it, across awaits", rows[1].ref === "campaign:2" && rows[1].label === "Black Friday Massage 2026");
    check("a post designed for the campaign stays under the campaign", rows[2].ref === "campaign:2");
    check("a post designed on its own is filed under the post", rows[3].ref === "post:9" && rows[3].label === "Post: Pick your massage");

    const report = getUsageReport(tid);
    check("the report totals the month", report.calls === 4 && report.totalCents > 0);
    check("the campaign is one line with two features", report.activity.some((g) => g.key === "campaign:2" && g.calls === 2 && g.parts.length === 2));
    check("the post is its own line", report.activity.some((g) => g.key === "post:9" && g.title === "Post: Pick your massage"));
    check("the untagged cost is grouped by feature", report.activity.some((g) => g.kind === "other" && g.title === "Daily brief"));
    check("an unknown month falls back to this one", getUsageReport(tid, "1999-01").month === report.month);

    console.log(`usageContext: ${passed} checks passed`);
  } finally {
    controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
