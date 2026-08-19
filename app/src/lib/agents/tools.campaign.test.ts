// Run: npm test -- src/lib/agents/tools.campaign.test.ts
//
// Verifies Task 3 (Campaign Engine Slice 1 — the five campaign agent tools +
// registration): the three WRITE tools (create_campaign,
// approve_campaign_asset, launch_campaign) are registered in
// @/lib/assistant/tools's WRITE_TOOLS (the code-level barrier that keeps them
// off the chat loop's auto-execute path and forces an operator Approve
// click), while the two READ tools (plan_campaign, draft_campaign_asset) are
// NOT — even though draft_campaign_asset DOES persist (via setAssetDraft,
// "pending"->"drafted"): that's a deliberate, spec-called-out exception
// ("reads never persist beyond drafted") because a drafted asset never
// leaves the campaign's own building state and has no external/public
// exposure until approve_campaign_asset (a WRITE) promotes it — see
// tools.campaign.ts's header comment. Also verifies: all 5 tools are
// registered in TOOLS + wired into executeTool; create_campaign rejects a
// missing name and slugifies deterministically; create_campaign seeds the
// default 10-asset plan and pre-drafts the offer asset; the
// approve/next-asset/campaign-status progression end to end; the
// launch_campaign "ready" guard; and summarizeToolAction's human strings for
// the three writes.
//
// MODEL CALLS: generateAsset (@/lib/campaigns/generate) hits the Anthropic
// API — this environment has no Claude credentials, so it can't be called
// for real (same constraint tools.marketing.test.ts documents for
// draft_blog_post/draft_carousel). Rather than skip exercising
// draft_campaign_asset/plan_campaign entirely (as tools.marketing.test.ts
// does for its two model-calling READs), this file intercepts the
// "@/lib/campaigns/generate" require (alongside the existing react/
// next/navigation shims below) and swaps ONLY `generateAsset` for a
// deterministic stub — every other export of that module (notably the real
// `emailAngleFromTitle`) passes through untouched. That lets
// draft_campaign_asset's OWN persistence logic (getAsset -> generateAsset ->
// setAssetDraft) run for real and be asserted on, which is what the CARRY-IN
// round-trip regression lock below needs: proof that TWO independent
// draft_campaign_asset calls on the same email asset persist the SAME stable
// title both times (Task 2's fix, commit 2b0c5b7 — the email title is the
// stable angle label, never re-derived from the generated content) is much
// stronger evidence than re-testing emailAngleFromTitle's own purity, which
// src/lib/campaigns/emailAngle.test.ts already covers. This is the
// "otherwise assert it at the store level" fallback the task brief
// sanctions, upgraded slightly: instead of calling setAssetDraft directly
// (which would only prove the store never mutates a title it's given, not
// that the TOOL threads the real generated title through unchanged), it goes
// through the real draft_campaign_asset executor with only the model call
// itself faked out.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs). Mirrors the
// Module._load shim pattern from tools.marketing.test.ts / store.test.ts.
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
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in tools.campaign.test.ts");
      },
    };
  }
  if (request === "@/lib/campaigns/generate") {
    // Load the REAL module first (real emailAngleFromTitle + everything else
    // untouched), then override only generateAsset with a deterministic,
    // no-network stub. `calls` is closed over per require() of this module —
    // tools.campaign.ts imports generateAsset exactly once at its own module
    // top level, so its bound reference shares ONE counter for this whole
    // test run, which is what lets the round-trip check below prove two
    // SEPARATE generations happened (different call numbers) while the title
    // stays fixed.
    const real = realLoad.call(this, request, ...rest) as Record<string, unknown>;
    let calls = 0;
    return {
      ...real,
      generateAsset: async (
        asset: { kind: string; title: string },
        _campaign: unknown,
        _meter: unknown,
        tweak?: string,
      ) => {
        calls += 1;
        if (asset.kind === "email") {
          // Mirrors generate.ts's real email branch exactly: title is
          // asset.title, UNCHANGED — never re-derived from the subject/body.
          // That invariant is what the round-trip test below locks in.
          return {
            title: asset.title,
            body: JSON.stringify({
              subject: `Stub subject #${calls}`,
              content: `Stub content #${calls}${tweak ? ` (tweak: ${tweak})` : ""}`,
            }),
          };
        }
        return { title: asset.title, body: `Stub body #${calls} for ${asset.kind}${tweak ? ` (tweak: ${tweak})` : ""}` };
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as tools.marketing.test.ts).
(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const {
    CAMPAIGN_TOOLS,
    planCampaignTool,
    createCampaignTool,
    draftCampaignAssetTool,
    approveCampaignAssetTool,
    launchCampaignTool,
  } = requireLocal("./tools.campaign") as typeof import("./tools.campaign");
  const { TOOLS, WRITE_TOOLS, summarizeToolAction } =
    requireLocal("../assistant/tools") as typeof import("../assistant/tools");
  const { DEFAULT_ASSET_PLAN, listAssets, getAsset, getCampaign } =
    requireLocal("../campaigns/store") as typeof import("../campaigns/store");
  const { emailAngleFromTitle } = requireLocal("../campaigns/generate") as typeof import("../campaigns/generate");

  const slug = "agents-campaign-tools-test";
  const dbFile = `tenants/${slug}/${slug}.db`;

  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Agents Campaign Tools Test", dbFile) as { id: number };
  const tid = t.id;
  const ctx = { tenantId: tid };

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    // ── (a) THE SAFETY PROPERTY: exactly the 3 writes are gated behind
    // Approve; the 2 reads are not. ──
    for (const name of ["create_campaign", "approve_campaign_asset", "launch_campaign"]) {
      assert.ok(WRITE_TOOLS.has(name), `${name} is a write tool (requires Approve)`);
    }
    for (const name of ["plan_campaign", "draft_campaign_asset"]) {
      assert.ok(!WRITE_TOOLS.has(name), `${name} is a read tool — must NOT require approval`);
    }

    // All 5 registered in the central TOOLS list.
    const toolNames = new Set(TOOLS.map((tool) => tool.name));
    for (const name of [
      "plan_campaign",
      "create_campaign",
      "draft_campaign_asset",
      "approve_campaign_asset",
      "launch_campaign",
    ]) {
      assert.ok(toolNames.has(name), `"${name}" is registered in TOOLS`);
    }
    // Sanity: CAMPAIGN_TOOLS itself is exactly these 5 (proves TOOLS's spread
    // actually pulls from this module, not a coincidental other registration).
    assert.deepEqual(
      [...CAMPAIGN_TOOLS.map((t) => t.name)].sort(),
      ["approve_campaign_asset", "create_campaign", "draft_campaign_asset", "launch_campaign", "plan_campaign"],
      "CAMPAIGN_TOOLS exports exactly the 5 campaign tool schemas",
    );

    // ── (b) create_campaign (WRITE) — missing name rejected before any DB
    // write. ──
    const missingName = JSON.parse(runWithTenant(tid, () => createCampaignTool(ctx, { offer: "20% off" })).text);
    assert.ok(missingName.error, "create_campaign requires a name");

    // ── (c) create_campaign (WRITE) — a valid call slugifies the name
    // deterministically (lowercase, hyphenated, punctuation stripped) and
    // seeds the DEFAULT 10-asset plan when `assets` is omitted, with the
    // offer asset pre-drafted from the given offer text (status "drafted",
    // not left "pending") so its first card is Approve/Go-again like every
    // other asset. ──
    const offerText = "20% off all 6-week transformation programmes booked before June 30th";
    const created = JSON.parse(
      runWithTenant(tid, () =>
        createCampaignTool(ctx, {
          name: "Summer Shape Up 2026!",
          season: "Summer 2026",
          offer: offerText,
        }),
      ).text,
    );
    assert.ok(created.result && !created.error, "create_campaign succeeds for a valid call");
    const campaignId = created.campaignId as number;
    assert.ok(campaignId, "create_campaign returns the new campaign's id");
    assert.equal(created.slug, "summer-shape-up-2026", "name is slugified deterministically");

    const campaignRow = runWithTenant(tid, () => getCampaign(campaignId));
    assert.equal(campaignRow?.slug, "summer-shape-up-2026", "the persisted campaign row has the slugified slug");
    assert.equal(campaignRow?.offer, offerText, "the persisted campaign row's offer matches what was passed");
    assert.equal(campaignRow?.status, "building", "a freshly created campaign starts in status building");

    // Determinism: slugifying the SAME name again produces the SAME slug (no
    // random/timestamp suffix) — dedupe isn't required for v1, but the slug
    // itself must be a pure function of the name.
    const created2 = JSON.parse(
      runWithTenant(tid, () => createCampaignTool(ctx, { name: "Summer Shape Up 2026!", offer: "x" })).text,
    );
    assert.equal(
      runWithTenant(tid, () => getCampaign(created2.campaignId as number))?.slug,
      "summer-shape-up-2026",
      "slugify(name) is deterministic across two separate create_campaign calls with the same name",
    );

    const seededAssets = runWithTenant(tid, () => listAssets(campaignId));
    assert.equal(seededAssets.length, DEFAULT_ASSET_PLAN.length, "create_campaign seeds the default asset plan when assets is omitted");
    assert.deepEqual(
      seededAssets.map((a) => a.kind),
      DEFAULT_ASSET_PLAN.map((a) => a.kind),
      "seeded asset kinds/order match DEFAULT_ASSET_PLAN",
    );
    const offerAsset = seededAssets.find((a) => a.kind === "offer")!;
    assert.ok(offerAsset, "sanity: a seeded offer asset exists");
    assert.equal(offerAsset.status, "drafted", "the offer asset is pre-seeded as drafted, not left pending");
    assert.equal(offerAsset.body, offerText, "the offer asset's body is the offer text passed to create_campaign");
    assert.equal(created.nextAsset?.id, offerAsset.id, "nextAsset after create_campaign is the pre-drafted offer, ready to Approve/Go-again");

    // ── (d) create_campaign (WRITE) — a custom, trimmed `assets` array is
    // honoured instead of the default plan, and an invalid kind is rejected. ──
    const trimmed = JSON.parse(
      runWithTenant(tid, () =>
        createCampaignTool(ctx, {
          name: "Trimmed Kit",
          offer: "y",
          assets: [
            { kind: "offer", title: "Offer" },
            { kind: "blog", title: "Blog post" },
          ],
        }),
      ).text,
    );
    assert.ok(!trimmed.error, "create_campaign accepts a custom assets array");
    const trimmedAssets = runWithTenant(tid, () => listAssets(trimmed.campaignId as number));
    assert.equal(trimmedAssets.length, 2, "create_campaign seeds exactly the custom assets given, not the default 10");

    const badKind = JSON.parse(
      runWithTenant(tid, () =>
        createCampaignTool(ctx, { name: "Bad Kit", offer: "z", assets: [{ kind: "nonsense", title: "?" }] }),
      ).text,
    );
    assert.ok(badKind.error, "create_campaign rejects an asset with an invalid kind");

    // ── (e) draft_campaign_asset (READ) — missing/invalid ids rejected. ──
    const draftMissingIds = JSON.parse((await draftCampaignAssetTool(ctx, {})).text);
    assert.ok(draftMissingIds.error, "draft_campaign_asset requires campaignId and assetId");
    const draftUnknownAsset = JSON.parse(
      (await runWithTenant(tid, async () => draftCampaignAssetTool(ctx, { campaignId, assetId: 9_999_999 }))).text,
    );
    assert.ok(draftUnknownAsset.error, "draft_campaign_asset errors cleanly for an unknown assetId");

    // ── (f) CARRY-IN regression lock: draft the SAME email asset TWICE via
    // draft_campaign_asset (the real executor, model call stubbed — see the
    // header comment) and assert the PERSISTED title is unchanged across both
    // calls, while the body genuinely differs (proving two independent
    // generations actually happened, not a no-op) — locking in Task 2's fix
    // (commit 2b0c5b7): the email asset's title is the stable sequence-angle
    // label, never re-derived from the generated subject/content. ──
    const proofEmail = seededAssets.find((a) => a.kind === "email" && a.title === "Email — Proof")!;
    assert.ok(proofEmail, "sanity: the default plan has an 'Email — Proof' asset");

    const draft1 = JSON.parse(
      (await runWithTenant(tid, async () => draftCampaignAssetTool(ctx, { campaignId, assetId: proofEmail.id }))).text,
    );
    assert.ok(!draft1.error, "first draft_campaign_asset call on the email asset succeeds");
    assert.equal(draft1.title, "Email — Proof", "draft 1: title is the stable angle label");
    const row1 = runWithTenant(tid, () => getAsset(proofEmail.id));
    assert.equal(row1?.status, "drafted", "draft 1: the asset row status flipped to drafted");
    assert.equal(row1?.title, "Email — Proof", "draft 1: the PERSISTED title is the stable angle label");
    assert.equal(emailAngleFromTitle(row1!.title), "proof", "draft 1: emailAngleFromTitle(persisted title) still resolves to proof");

    const draft2 = JSON.parse(
      (
        await runWithTenant(tid, async () =>
          draftCampaignAssetTool(ctx, { campaignId, assetId: proofEmail.id, tweak: "make it punchier" }),
        )
      ).text,
    );
    assert.ok(!draft2.error, "second draft_campaign_asset call (a 'Go again' with a tweak) succeeds");
    assert.equal(draft2.title, "Email — Proof", "draft 2: title is STILL the stable angle label — unchanged from draft 1");
    assert.notEqual(draft2.body, draft1.body, "draft 2: the body actually changed — this was a real second generation, not a no-op");

    const row2 = runWithTenant(tid, () => getAsset(proofEmail.id));
    assert.equal(row2?.title, "Email — Proof", "draft 2: the PERSISTED title is UNCHANGED across both draft calls");
    assert.equal(row2?.body, draft2.body, "draft 2: the persisted body is the second (regenerated) draft, not the first");
    assert.equal(emailAngleFromTitle(row2!.title), "proof", "draft 2: emailAngleFromTitle(persisted title) still resolves to proof after regeneration");

    // ── (g) plan_campaign (READ) — returns a plan object shaped exactly per
    // spec: {name, season, startsOn, endsOn, offer, assets: DEFAULT_ASSET_PLAN},
    // nothing persisted. Exercised for real (model call stubbed, same as (f)). ──
    const plan = JSON.parse(
      (
        await runWithTenant(tid, async () =>
          planCampaignTool(ctx, { brief: "A summer transformation offer for new leads.", name: "Summer Shape Up 2026", season: "Summer 2026" }),
        )
      ).text,
    );
    assert.ok(!plan.error, "plan_campaign succeeds");
    assert.equal(plan.name, "Summer Shape Up 2026");
    assert.equal(plan.season, "Summer 2026");
    assert.ok(typeof plan.offer === "string" && plan.offer.length > 0, "plan_campaign returns a generated, non-empty offer");
    assert.deepEqual(plan.assets, DEFAULT_ASSET_PLAN, "plan_campaign proposes DEFAULT_ASSET_PLAN's exact 10-asset kit");
    const planMissingBrief = JSON.parse((await planCampaignTool(ctx, {})).text);
    assert.ok(planMissingBrief.error, "plan_campaign requires a brief");

    // ── (h) approve_campaign_asset (WRITE) — rejects an asset that was never
    // drafted, an unknown id, and a campaignId/assetId mismatch; a valid
    // approval advances nextAsset and only flips the campaign to "ready" once
    // EVERY asset is approved. ──
    const stillPendingBlog = seededAssets.find((a) => a.kind === "blog")!;
    const approvePending = runWithTenant(tid, () =>
      approveCampaignAssetTool(ctx, { campaignId, assetId: stillPendingBlog.id }),
    );
    assert.ok(JSON.parse(approvePending.text).error, "approve_campaign_asset rejects an asset that hasn't been drafted yet");

    const approveUnknown = runWithTenant(tid, () => approveCampaignAssetTool(ctx, { campaignId, assetId: 9_999_999 }));
    assert.ok(JSON.parse(approveUnknown.text).error, "approve_campaign_asset errors cleanly for an unknown assetId");

    const mismatch = runWithTenant(tid, () =>
      approveCampaignAssetTool(ctx, { campaignId: trimmed.campaignId, assetId: offerAsset.id }),
    );
    assert.ok(JSON.parse(mismatch.text).error, "approve_campaign_asset rejects an assetId that belongs to a DIFFERENT campaign");

    // Drive the whole campaign to "ready": draft (where not already drafted)
    // then approve every asset in sortOrder.
    let remaining = runWithTenant(tid, () => listAssets(campaignId));
    let lastApproveResult: { nextAsset: unknown; campaignStatus: string } | null = null;
    for (const asset of remaining) {
      if (asset.status === "pending") {
        const d = JSON.parse(
          (await runWithTenant(tid, async () => draftCampaignAssetTool(ctx, { campaignId, assetId: asset.id }))).text,
        );
        assert.ok(!d.error, `draft_campaign_asset succeeds for asset #${asset.id} (${asset.kind})`);
      }
      const approved = JSON.parse(runWithTenant(tid, () => approveCampaignAssetTool(ctx, { campaignId, assetId: asset.id })).text);
      assert.ok(approved.approved && !approved.error, `approve_campaign_asset succeeds for asset #${asset.id} (${asset.kind})`);
      lastApproveResult = approved;
    }
    assert.equal(lastApproveResult?.nextAsset, null, "after approving every asset, nextAsset is null");
    assert.equal(lastApproveResult?.campaignStatus, "ready", "after approving every asset, the campaign status flips to ready");
    assert.equal(runWithTenant(tid, () => getCampaign(campaignId))?.status, "ready", "the persisted campaign row's status is ready");

    // ── (i) launch_campaign (WRITE) — guards on status; only "ready"
    // campaigns can launch. ──
    const launchNotReady = JSON.parse(
      runWithTenant(tid, () => launchCampaignTool(ctx, { campaignId: trimmed.campaignId })).text,
    );
    assert.ok(launchNotReady.error, "launch_campaign refuses a campaign that isn't ready (still building)");

    const launched = JSON.parse(runWithTenant(tid, () => launchCampaignTool(ctx, { campaignId })).text);
    assert.ok(launched.result && !launched.error, "launch_campaign succeeds once every asset is approved");
    assert.equal(launched.status, "active");
    assert.equal(runWithTenant(tid, () => getCampaign(campaignId))?.status, "active", "the persisted campaign row's status is active after launch");

    const launchUnknown = JSON.parse(runWithTenant(tid, () => launchCampaignTool(ctx, { campaignId: 9_999_999 })).text);
    assert.ok(launchUnknown.error, "launch_campaign errors cleanly for an unknown campaignId");

    // ── (j) summarizeToolAction — human strings for the three writes. Content
    // (not exact punctuation) is what's asserted: the campaign/asset name
    // appears and the phrasing matches the action. Note: create_campaign's
    // count is computed from the ACTUAL `assets` array length passed in (here
    // 10, DEFAULT_ASSET_PLAN's real length) rather than hardcoded, so an
    // operator-trimmed plan is always described correctly. ──
    const createSummary = summarizeToolAction("create_campaign", { name: "Summer Shape Up 2026", assets: DEFAULT_ASSET_PLAN });
    assert.ok(createSummary.includes("Summer Shape Up 2026"), `create_campaign summary names the campaign: "${createSummary}"`);
    assert.ok(createSummary.includes(String(DEFAULT_ASSET_PLAN.length)), `create_campaign summary states the asset count: "${createSummary}"`);

    const approveSummary = summarizeToolAction("approve_campaign_asset", {
      campaignId,
      assetId: offerAsset.id,
      assetTitle: "Offer",
      campaignName: "Summer Shape Up 2026",
    });
    assert.ok(/approve/i.test(approveSummary), `approve_campaign_asset summary reads as an approval: "${approveSummary}"`);
    assert.ok(approveSummary.includes("Offer"), `approve_campaign_asset summary names the asset: "${approveSummary}"`);
    assert.ok(approveSummary.includes("Summer Shape Up 2026"), `approve_campaign_asset summary names the campaign: "${approveSummary}"`);
    // Graceful ID-based fallback when the optional display fields are absent
    // (mirrors send_whatsapp's `who` fallback to "lead #<id>" in
    // @/lib/assistant/tools) — assetId/campaignId are the only fields the
    // schema truly requires.
    const approveSummaryFallback = summarizeToolAction("approve_campaign_asset", { campaignId: 4, assetId: 12 });
    assert.ok(approveSummaryFallback.includes("12"), `approve_campaign_asset falls back to the numeric id: "${approveSummaryFallback}"`);

    const launchSummary = summarizeToolAction("launch_campaign", { campaignId, campaignName: "Summer Shape Up 2026" });
    assert.ok(/launch/i.test(launchSummary), `launch_campaign summary reads as a launch: "${launchSummary}"`);
    assert.ok(launchSummary.includes("Summer Shape Up 2026"), `launch_campaign summary names the campaign: "${launchSummary}"`);

    console.log("tools.campaign.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
