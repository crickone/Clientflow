// Run: npm test -- src/lib/ads/accountInsights.test.ts
//
// Optimal Health had ads running from Meta Ads Manager and the Ads page
// showed "No ad campaigns yet": it only listed campaigns built in
// AdonisAgent. The overview now reads EVERY campaign on the chosen ad
// account. Checks:
//   - results follow each campaign's objective, as Ads Manager counts them
//   - the join of campaigns + insights: running first, quiet ones counted
//     not listed, an AdonisAgent campaign opens here, others in Ads Manager
//   - account totals, leads and cost per lead
//   - a refused token is reported, not thrown, and marks the reconnect
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
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const m = requireLocal("./accountInsightsModel") as typeof import("./accountInsightsModel");

  // ── the rules ──
  assert.equal(m.resultKindFor("OUTCOME_LEADS"), "leads");
  assert.equal(m.resultKindFor("LEAD_GENERATION"), "leads");
  assert.equal(m.resultKindFor("OUTCOME_TRAFFIC"), "link_clicks");
  assert.equal(m.resultKindFor("OUTCOME_AWARENESS"), "reach");
  assert.equal(m.resultKindFor("OUTCOME_ENGAGEMENT", [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "3" }]), "messages", "click-to-message ads live under engagement");
  assert.equal(m.resultKindFor("OUTCOME_ENGAGEMENT", [{ action_type: "post_engagement", value: "40" }]), "engagement");
  assert.equal(m.actionCount([{ action_type: "onsite_conversion.lead_grouped", value: "7" }], "leads"), 7, "a lead reported under another name still counts");
  assert.equal(m.actionCount([{ action_type: "lead", value: "5" }, { action_type: "onsite_conversion.lead_grouped", value: "5" }], "leads"), 5, "never double-counted");
  assert.deepEqual(m.numbersOf({ spend: "50.5", impressions: "2000", reach: "1500", inline_link_clicks: "40" }), { spend: 50.5, impressions: 2000, reach: 1500, linkClicks: 40, ctr: 2 });
  assert.equal(m.numbersOf({}).ctr, null);
  assert.equal(m.costPer(100, 8), 12.5);
  assert.equal(m.costPer(100, 0), null);
  assert.equal(m.stateOf("ACTIVE"), "active");
  assert.equal(m.stateOf("ADSET_PAUSED"), "paused");
  assert.equal(m.stateOf("WITH_ISSUES"), "issue");
  assert.equal(m.rangeOf("bogus").key, "30d", "an unknown range falls back to 30 days");
  assert.equal(m.adsManagerUrl("act_123", "999"), "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123&selected_campaign_ids=999");

  // ── the fetch, against a faked Meta ──
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const grants = requireLocal("../facebook/grants") as typeof import("../facebook/grants");
  const health = requireLocal("../facebook/health") as typeof import("../facebook/health");
  const { getAdsOverview } = requireLocal("./accountInsights") as typeof import("./accountInsights");

  const slug = "ads-overview-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Ads Overview Test", `tenants/${slug}/${slug}.db`) as { id: number }).id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM meta_grants WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM facebook_ad_accounts WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenant_alerts WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  let refused = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (refused) return new Response(JSON.stringify({ error: { message: "Error validating access token", code: 190 } }), { status: 400 });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.pathname.endsWith("/act_77/campaigns")) {
      return json({
        data: [
          { id: "c-lead", name: "Black Friday massage", objective: "OUTCOME_LEADS", effective_status: "ACTIVE" },
          { id: "c-old", name: "Summer HBOT", objective: "OUTCOME_TRAFFIC", effective_status: "PAUSED" },
          { id: "c-paused-spent", name: "Infrared push", objective: "OUTCOME_TRAFFIC", effective_status: "PAUSED" },
          { id: "c-ours", name: "Built here", objective: "OUTCOME_ENGAGEMENT", effective_status: "ACTIVE" },
        ],
      });
    }
    if (url.pathname.endsWith("/act_77/insights") && url.searchParams.get("level") === "campaign") {
      return json({
        data: [
          { campaign_id: "c-lead", spend: "80", impressions: "4000", reach: "3000", inline_link_clicks: "60", actions: [{ action_type: "lead", value: "8" }] },
          { campaign_id: "c-paused-spent", spend: "120", impressions: "9000", reach: "6000", inline_link_clicks: "150", actions: [{ action_type: "link_click", value: "150" }] },
          { campaign_id: "c-ours", spend: "10", impressions: "1000", reach: "900", inline_link_clicks: "5", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "4" }] },
        ],
      });
    }
    if (url.pathname.endsWith("/act_77/insights")) {
      return json({ data: [{ spend: "210", impressions: "14000", reach: "8500", inline_link_clicks: "215" }] });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  try {
    grants.saveGrant(tid, "EAAtokads000000000000000000000000", "system_user", null, 1);
    grants.saveAdAccounts(tid, [{ id: "act_77", name: "Optimal Health & Recovery", currency: "EUR" }]);
    await runWithTenant(tid, async () => {
      // A campaign launched from AdonisAgent opens its own page.
      getTenantDbById(tid)
        .insert(schema.adCampaigns)
        .values({ adAccountId: "act_77", name: "Built here", objective: "messages", status: "active", spec: JSON.stringify({ adSets: [] }), metaIds: JSON.stringify({ campaignId: "c-ours" }) } as typeof schema.adCampaigns.$inferInsert)
        .run();

      const o = await getAdsOverview(tid, "30d", { fresh: true });
      assert.ok(o);
      const a = o!.accounts[0];
      assert.equal(a.error, null);
      assert.deepEqual(a.campaigns.map((c) => c.id), ["c-lead", "c-ours", "c-paused-spent"], "running first by spend, then the rest; quiet ones left out");
      assert.equal(a.quiet, 1, "the paused campaign with no spend is counted, not listed");
      const lead = a.campaigns[0];
      assert.equal(lead.resultLabel, "Leads");
      assert.equal(lead.results, 8);
      assert.equal(lead.costPerResult, 10);
      assert.ok(lead.href.startsWith("https://adsmanager.facebook.com/"), "an Ads Manager campaign opens in Ads Manager");
      assert.equal(lead.builtHere, false);
      const ours = a.campaigns[1];
      assert.equal(ours.builtHere, true);
      assert.match(ours.href, /^\/marketing\/ads\/\d+$/, "an AdonisAgent campaign opens here");
      assert.equal(ours.resultLabel, "Conversations");
      assert.equal(a.totals.spend, 210);
      assert.equal(a.leads, 8);
      assert.equal(a.costPerLead, 10, "cost per lead uses lead campaigns' spend only");
      assert.equal(a.conversations, 4);

      // A refused token: reported on the account, and the reconnect is marked.
      refused = true;
      const bad = await getAdsOverview(tid, "7d", { fresh: true });
      assert.match(bad!.accounts[0].error ?? "", /access token/);
      assert.equal(health.connectionProblems(tid).some((p) => p.kind === "ads"), true, "the ads connection is marked for reconnect");
    });
    console.log("accountInsights: every campaign on the ad account, results by objective, totals, refusals; 34 checks passed.");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
