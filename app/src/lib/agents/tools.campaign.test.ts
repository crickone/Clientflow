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
// default 11-asset plan and pre-drafts the offer asset; the
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
  const { DEFAULT_ASSET_PLAN, listAssets, getAsset, getCampaign, setAssetDraft } =
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
    // seeds the DEFAULT 11-asset plan when `assets` is omitted, with the
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
    assert.equal(trimmedAssets.length, 2, "create_campaign seeds exactly the custom assets given, not the default 11");

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
    assert.deepEqual(plan.assets, DEFAULT_ASSET_PLAN, "plan_campaign proposes DEFAULT_ASSET_PLAN's exact 11-asset kit");
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
      (await runWithTenant(tid, async () => launchCampaignTool(ctx, { campaignId: trimmed.campaignId }))).text,
    );
    assert.ok(launchNotReady.error, "launch_campaign refuses a campaign that isn't ready (still building)");

    const launched = JSON.parse(
      (await runWithTenant(tid, async () => launchCampaignTool(ctx, { campaignId }))).text,
    );
    assert.ok(launched.result && !launched.error, "launch_campaign succeeds once every asset is approved");
    assert.equal(launched.status, "active");
    assert.equal(runWithTenant(tid, () => getCampaign(campaignId))?.status, "active", "the persisted campaign row's status is active after launch");

    // This tenant has NO CMS site (sites starts empty — see the header
    // comment on tools.marketing.test.ts's equivalent setup), so the blog
    // asset above never materialised (Task 4 carry-in: externalKind stays
    // null on a 0-site tenant) — launch must tolerate that and skip it
    // rather than crash or falsely claim a publish. The 3 social assets
    // ALSO never materialised here — this file's generateAsset stub (see
    // the header comment) returns a plain string body for "social", not the
    // {caption,slides} JSON materialiseAsset needs, so they're tolerated
    // the same way, just for a different reason (unparseable body, not a
    // missing site). Only the 3 email assets (whose stub body IS valid
    // JSON) actually materialised. A dedicated real-materialised-social
    // scenario proving the queue behaviour follows below (i3).
    assert.deepEqual(
      launched.published,
      [],
      "no CMS site exists on this tenant, so the blog asset was never materialised — launch skips it (Task 4 carry-in), publishing nothing",
    );
    assert.equal(launched.queued.length, 3, "exactly the 3 materialised email assets are queued here (social didn't materialise under this test's stub; offer/ad_copy/video_script have no external home)");
    assert.deepEqual(
      launched.queued.map((q: { kind: string }) => q.kind).sort(),
      ["email", "email", "email"],
      "the queued items here are exactly the materialised email assets",
    );
    assert.ok(
      launched.queued.every((q: { where: unknown }) => typeof q.where === "string" && q.where.length > 0),
      "every queued item carries a non-empty honest label",
    );
    assert.ok(
      launched.queued.every((q: { kind: string; where: string }) => q.kind === "email" && /ready to send in Email campaigns/.test(q.where)),
      "email items are honestly labelled 'ready to send' — never claimed sent (no scheduler is fired)",
    );

    const launchUnknown = JSON.parse(
      (await runWithTenant(tid, async () => launchCampaignTool(ctx, { campaignId: 9_999_999 }))).text,
    );
    assert.ok(launchUnknown.error, "launch_campaign errors cleanly for an unknown campaignId");

    // ── (i2) launch_campaign — blog ACTUALLY publishes for real. The flow
    // above never exercised this (no CMS site on that tenant), so it only
    // proved the tolerate-and-skip half. Seed exactly one site, build a
    // fresh (trimmed, for speed) offer+blog campaign, draft+approve the
    // blog asset (materialises it against the real site), launch, and
    // assert the underlying blog_posts row is genuinely publishState =
    // "published" with siteId matching the seeded site — proof launch.ts's
    // publishBlog re-derives siteId via getBlogPost rather than guessing,
    // and that the summary's "published" claim is truthful, not just text. ──
    const { sites: sitesTable, blogPosts: blogPostsTable } = requireLocal("../db/schema") as typeof import("../db/schema");
    const seededSite = runWithTenant(tid, () => {
      const { db: tdb } = requireLocal("../db") as typeof import("../db");
      return tdb.insert(sitesTable).values({ slug: "campaign-test-site", name: "Campaign Test Site" }).returning().get();
    });
    assert.ok(seededSite?.id, "blog-publish test sanity: a CMS site now exists on this tenant");

    const blogCampaign = JSON.parse(
      runWithTenant(tid, () =>
        createCampaignTool(ctx, {
          name: "Blog Publish Test",
          offer: "blog-only kit",
          assets: [
            { kind: "offer", title: "Offer" },
            { kind: "blog", title: "Blog post" },
          ],
        }),
      ).text,
    );
    assert.ok(!blogCampaign.error, "blog-publish test: create_campaign succeeds");
    const blogCampaignId = blogCampaign.campaignId as number;
    const blogCampaignAssets = runWithTenant(tid, () => listAssets(blogCampaignId));
    const offerAssetForBlogTest = blogCampaignAssets.find((a) => a.kind === "offer")!;
    const blogAssetForBlogTest = blogCampaignAssets.find((a) => a.kind === "blog")!;

    assert.ok(
      JSON.parse(
        runWithTenant(tid, () =>
          approveCampaignAssetTool(ctx, { campaignId: blogCampaignId, assetId: offerAssetForBlogTest.id }),
        ).text,
      ).approved,
      "blog-publish test: the pre-drafted offer asset approves",
    );
    const blogDraft = JSON.parse(
      (
        await runWithTenant(tid, async () =>
          draftCampaignAssetTool(ctx, { campaignId: blogCampaignId, assetId: blogAssetForBlogTest.id }),
        )
      ).text,
    );
    assert.ok(!blogDraft.error, "blog-publish test: draft_campaign_asset succeeds for the blog asset");
    const blogApprove = JSON.parse(
      runWithTenant(tid, () =>
        approveCampaignAssetTool(ctx, { campaignId: blogCampaignId, assetId: blogAssetForBlogTest.id }),
      ).text,
    );
    assert.ok(blogApprove.approved && !blogApprove.error, "blog-publish test: blog asset approves");
    assert.equal(blogApprove.externalKind, "blog_post", "blog-publish test: the blog asset materialised to a real blog_posts row");
    const materialisedBlogId = blogApprove.externalId as number;
    assert.equal(
      runWithTenant(tid, () => getCampaign(blogCampaignId))?.status,
      "ready",
      "blog-publish test: the campaign is ready once both its assets are approved",
    );

    const blogPostBeforeLaunch = runWithTenant(tid, () => {
      const { db: tdb } = requireLocal("../db") as typeof import("../db");
      return tdb.select().from(blogPostsTable).all().find((p) => p.id === materialisedBlogId);
    });
    assert.equal(blogPostBeforeLaunch?.publishState, "draft", "blog-publish test sanity: the materialised post starts as a draft, not yet published");

    const blogLaunch = JSON.parse(
      (await runWithTenant(tid, async () => launchCampaignTool(ctx, { campaignId: blogCampaignId }))).text,
    );
    assert.ok(blogLaunch.result && !blogLaunch.error, "blog-publish test: launch_campaign succeeds");
    assert.equal(blogLaunch.published.length, 1, "blog-publish test: exactly one asset published");
    assert.equal(blogLaunch.published[0].kind, "blog", "blog-publish test: the published item is the blog asset");
    assert.equal(blogLaunch.published[0].title, "Blog post", "blog-publish test: the published item carries the asset's title");
    assert.ok(
      /published/i.test(blogLaunch.published[0].where),
      `blog-publish test: the published item's "where" reads as published: "${blogLaunch.published[0].where}"`,
    );
    assert.deepEqual(blogLaunch.queued, [], "blog-publish test: the offer asset has no external home, so nothing is queued");

    const blogPostAfterLaunch = runWithTenant(tid, () => {
      const { db: tdb } = requireLocal("../db") as typeof import("../db");
      return tdb.select().from(blogPostsTable).all().find((p) => p.id === materialisedBlogId);
    });
    assert.equal(
      blogPostAfterLaunch?.publishState,
      "published",
      "blog-publish test: the REAL blog_posts row is now published — launch_campaign genuinely calls setPublishState, not just claims to",
    );
    assert.equal(
      blogPostAfterLaunch?.siteId,
      seededSite.id,
      "blog-publish test: the published post's siteId matches the seeded site — proves siteId was re-derived via getBlogPost, not guessed",
    );
    assert.ok(blogPostAfterLaunch?.publishedAt, "blog-publish test: publishedAt is set");

    // ── (i2b) launch_campaign — the landing page's live URL is surfaced in
    // `published`, honestly, once a site exists AND the campaign has an
    // approved landing_page asset (Campaign Engine Slice 2, Task 4). Reuses
    // `seededSite` from (i2) above — still this tenant's only site at this
    // point in the test, still status "draft" (no primaryHost) — so this
    // proves the representative-site pick falls back to "the only site there
    // is" and the resulting URL is the exact dev-path shape
    // `/site/<siteSlug>/c/<campaignSlug>`, exercising the real
    // launch_campaign tool end to end (landingUrl.test.ts covers the pure
    // rule itself in isolation). landing_page never materialises to an
    // external row (materialise.ts, by design), so externalKind stays null
    // even though the launch summary reports it. ──
    const landingCampaign = JSON.parse(
      runWithTenant(tid, () =>
        createCampaignTool(ctx, {
          name: "Landing URL Test",
          offer: "landing-only kit",
          assets: [
            { kind: "offer", title: "Offer" },
            { kind: "landing_page", title: "Landing page" },
          ],
        }),
      ).text,
    );
    assert.ok(!landingCampaign.error, "landing-url test: create_campaign succeeds");
    const landingCampaignId = landingCampaign.campaignId as number;
    const landingCampaignAssets = runWithTenant(tid, () => listAssets(landingCampaignId));
    const offerAssetForLandingTest = landingCampaignAssets.find((a) => a.kind === "offer")!;
    const landingAssetForLandingTest = landingCampaignAssets.find((a) => a.kind === "landing_page")!;

    assert.ok(
      JSON.parse(
        runWithTenant(tid, () =>
          approveCampaignAssetTool(ctx, { campaignId: landingCampaignId, assetId: offerAssetForLandingTest.id }),
        ).text,
      ).approved,
      "landing-url test: the pre-drafted offer asset approves",
    );
    const landingDraft = JSON.parse(
      (
        await runWithTenant(tid, async () =>
          draftCampaignAssetTool(ctx, { campaignId: landingCampaignId, assetId: landingAssetForLandingTest.id }),
        )
      ).text,
    );
    assert.ok(!landingDraft.error, "landing-url test: draft_campaign_asset succeeds for the landing_page asset");
    const landingApprove = JSON.parse(
      runWithTenant(tid, () =>
        approveCampaignAssetTool(ctx, { campaignId: landingCampaignId, assetId: landingAssetForLandingTest.id }),
      ).text,
    );
    assert.ok(landingApprove.approved && !landingApprove.error, "landing-url test: landing_page asset approves");
    assert.equal(
      landingApprove.externalKind,
      null,
      "landing-url test: landing_page never materialises to an external row (by design)",
    );
    assert.equal(
      runWithTenant(tid, () => getCampaign(landingCampaignId))?.status,
      "ready",
      "landing-url test: the campaign is ready once both its assets are approved",
    );

    const landingLaunch = JSON.parse(
      (await runWithTenant(tid, async () => launchCampaignTool(ctx, { campaignId: landingCampaignId }))).text,
    );
    assert.ok(landingLaunch.result && !landingLaunch.error, "landing-url test: launch_campaign succeeds");
    assert.equal(
      landingLaunch.published.length,
      1,
      "landing-url test: exactly one item published — the landing URL line",
    );
    assert.equal(
      landingLaunch.published[0].kind,
      "landing_page",
      "landing-url test: the published item is the landing_page asset",
    );
    assert.equal(
      landingLaunch.published[0].title,
      "Landing page",
      "landing-url test: the published item carries the asset's title",
    );
    assert.equal(
      landingLaunch.published[0].where,
      `landing page live at /site/campaign-test-site/c/${landingCampaign.slug}`,
      "landing-url test: the exact honest 'landing page live at …' label, dev-path shape (seededSite has no primaryHost)",
    );
    assert.deepEqual(
      landingLaunch.queued,
      [],
      "landing-url test: nothing to queue for an offer+landing_page-only kit",
    );

    // ── (i3) launch_campaign — social ACTUALLY gets queued, never
    // auto-posted, once genuinely materialised. The shared flow above never
    // exercised this (its generateAsset stub returns a plain string for
    // "social", not valid {caption,slides} JSON, so materialisation there
    // always no-ops). Inject a validly-shaped draft directly via
    // setAssetDraft (bypassing the stub) so this asset genuinely
    // materialises into a real carousel_sets row, then launch and assert
    // it's queued with the exact honest label. ──
    const socialCampaign = JSON.parse(
      runWithTenant(tid, () =>
        createCampaignTool(ctx, {
          name: "Social Queue Test",
          offer: "social-only kit",
          assets: [{ kind: "social", title: "Social post 1" }],
        }),
      ).text,
    );
    assert.ok(!socialCampaign.error, "social-queue test: create_campaign succeeds");
    const socialCampaignId = socialCampaign.campaignId as number;
    const socialAsset = runWithTenant(tid, () => listAssets(socialCampaignId))[0];

    runWithTenant(tid, () =>
      setAssetDraft(socialAsset.id, {
        title: socialAsset.title,
        body: JSON.stringify({
          caption: "Test caption",
          slides: [{ template: "carousel-cover", heading: "H", body: "B", image: "" }],
        }),
      }),
    );
    const socialApprove = JSON.parse(
      runWithTenant(tid, () =>
        approveCampaignAssetTool(ctx, { campaignId: socialCampaignId, assetId: socialAsset.id }),
      ).text,
    );
    assert.ok(socialApprove.approved && !socialApprove.error, "social-queue test: social asset approves");
    assert.equal(socialApprove.externalKind, "carousel_set", "social-queue test: the social asset materialised to a real carousel_sets row");
    assert.equal(
      runWithTenant(tid, () => getCampaign(socialCampaignId))?.status,
      "ready",
      "social-queue test: campaign is ready once its one asset is approved",
    );

    const socialLaunch = JSON.parse(
      (await runWithTenant(tid, async () => launchCampaignTool(ctx, { campaignId: socialCampaignId }))).text,
    );
    assert.ok(socialLaunch.result && !socialLaunch.error, "social-queue test: launch_campaign succeeds");
    assert.deepEqual(socialLaunch.published, [], "social-queue test: nothing is auto-published for a social-only kit");
    assert.equal(socialLaunch.queued.length, 1, "social-queue test: exactly one item queued");
    assert.equal(socialLaunch.queued[0].kind, "social");
    assert.equal(
      socialLaunch.queued[0].where,
      "social ready to post (auto-posting coming after Meta review)",
      "social-queue test: the exact honest label — auto-posting is never claimed",
    );

    // ── (i-regression) Idempotent approve + materialise — re-approving an
    // already-approved email asset must never create a duplicate email_campaign
    // record nor re-spend AI money on image generation. Create a fresh campaign,
    // draft an email asset, approve it (materialising it), count the
    // email_campaigns rows, then approve again and assert no new rows were
    // created + the response carries alreadyApproved: true. ──
    const regressionCampaign = JSON.parse(
      runWithTenant(tid, () =>
        createCampaignTool(ctx, { name: "Regression Test Campaign", offer: "50% off" }),
      ).text,
    );
    assert.ok(!regressionCampaign.error, "regression test: create_campaign succeeds");
    const regCampaignId = regressionCampaign.campaignId as number;

    // Find an email asset to draft and approve.
    const regAssets = runWithTenant(tid, () => listAssets(regCampaignId));
    const regEmailAsset = regAssets.find((a) => a.kind === "email")!;
    assert.ok(regEmailAsset, "regression test: campaign has an email asset");

    // Draft the email asset.
    const regDraft = JSON.parse(
      (await runWithTenant(tid, async () => draftCampaignAssetTool(ctx, { campaignId: regCampaignId, assetId: regEmailAsset.id }))).text,
    );
    assert.ok(!regDraft.error, "regression test: draft_campaign_asset succeeds");

    // Count email_campaigns rows before first approval.
    const countBeforeFirstApprove = runWithTenant(tid, () => {
      const { db: db2 } = requireLocal("../db") as typeof import("../db");
      const { emailCampaigns } = requireLocal("../db/schema") as typeof import("../db/schema");
      return db2.select({ id: emailCampaigns.id }).from(emailCampaigns).all().length;
    });

    // First approval: materialises to a real email_campaigns row.
    const regApprove1 = JSON.parse(
      runWithTenant(tid, () => approveCampaignAssetTool(ctx, { campaignId: regCampaignId, assetId: regEmailAsset.id })).text,
    );
    assert.ok(!regApprove1.error && regApprove1.approved, "regression test: first approval succeeds");
    assert.equal(regApprove1.externalKind, "email_campaign", "regression test: first approval materialised to an email_campaign");
    assert.ok(
      typeof regApprove1.externalId === "number" && regApprove1.externalId > 0,
      "regression test: first approval captures the externalId",
    );

    const countAfterFirstApprove = runWithTenant(tid, () => {
      const { db: db2 } = requireLocal("../db") as typeof import("../db");
      const { emailCampaigns } = requireLocal("../db/schema") as typeof import("../db/schema");
      return db2.select({ id: emailCampaigns.id }).from(emailCampaigns).all().length;
    });
    assert.equal(
      countAfterFirstApprove,
      countBeforeFirstApprove + 1,
      "regression test: first approval created exactly one email_campaigns row",
    );

    // Second approval (re-approval): must be idempotent — no new rows, no re-spend.
    const regApprove2 = JSON.parse(
      runWithTenant(tid, () => approveCampaignAssetTool(ctx, { campaignId: regCampaignId, assetId: regEmailAsset.id })).text,
    );
    assert.ok(!regApprove2.error && regApprove2.approved, "regression test: second approval succeeds");
    assert.equal(regApprove2.alreadyApproved, true, "regression test: second approval response carries alreadyApproved: true");
    assert.equal(
      regApprove2.externalId,
      regApprove1.externalId,
      "regression test: second approval returns the same externalId as first",
    );
    assert.equal(
      regApprove2.externalKind,
      "email_campaign",
      "regression test: second approval returns the same externalKind",
    );

    const countAfterSecondApprove = runWithTenant(tid, () => {
      const { db: db2 } = requireLocal("../db") as typeof import("../db");
      const { emailCampaigns } = requireLocal("../db/schema") as typeof import("../db/schema");
      return db2.select({ id: emailCampaigns.id }).from(emailCampaigns).all().length;
    });
    assert.equal(
      countAfterSecondApprove,
      countAfterFirstApprove,
      "regression test: second approval created NO new email_campaigns rows — idempotent",
    );

    // ── (i4-regression) Approved assets can't be regenerated — closes
    // stale-content path. Once an asset is approved (materialised + status
    // flipped), calling draft_campaign_asset again must reject it, keeping
    // status=approved and body unchanged. Create a fresh campaign, draft+approve
    // an email asset (materialised), then call draft_campaign_asset AGAIN on
    // that approved asset and assert: (a) error returned (already approved /
    // can't regenerate), (b) asset status STILL "approved" (not flipped back to
    // drafted), (c) asset body UNCHANGED (no regeneration ran). ──
    const noRedraftCampaign = JSON.parse(
      runWithTenant(tid, () =>
        createCampaignTool(ctx, { name: "No-Redraft Test Campaign", offer: "25% off" }),
      ).text,
    );
    assert.ok(!noRedraftCampaign.error, "no-redraft test: create_campaign succeeds");
    const noRedraftCampaignId = noRedraftCampaign.campaignId as number;

    const noRedraftAssets = runWithTenant(tid, () => listAssets(noRedraftCampaignId));
    const noRedraftEmailAsset = noRedraftAssets.find((a) => a.kind === "email")!;
    assert.ok(noRedraftEmailAsset, "no-redraft test: campaign has an email asset");

    // Draft the email asset.
    const noRedraftInitialDraft = JSON.parse(
      (await runWithTenant(tid, async () => draftCampaignAssetTool(ctx, { campaignId: noRedraftCampaignId, assetId: noRedraftEmailAsset.id }))).text,
    );
    assert.ok(!noRedraftInitialDraft.error, "no-redraft test: initial draft_campaign_asset succeeds");
    const initialBody = noRedraftInitialDraft.body as string;

    // Approve the asset (materialises it).
    const noRedraftApprove = JSON.parse(
      runWithTenant(tid, () =>
        approveCampaignAssetTool(ctx, { campaignId: noRedraftCampaignId, assetId: noRedraftEmailAsset.id }),
      ).text,
    );
    assert.ok(!noRedraftApprove.error && noRedraftApprove.approved, "no-redraft test: approval succeeds");
    assert.equal(noRedraftApprove.externalKind, "email_campaign", "no-redraft test: asset materialised to an email_campaign");

    // Verify the asset is now approved in the DB.
    const assetBeforeRedraft = runWithTenant(tid, () => getAsset(noRedraftEmailAsset.id));
    assert.equal(assetBeforeRedraft?.status, "approved", "no-redraft test: asset status is approved after approval");
    assert.equal(assetBeforeRedraft?.body, initialBody, "no-redraft test: asset body is the initial draft before redraft attempt");

    // Now try to redraft the already-approved asset — should reject.
    const noRedraftAttempt = JSON.parse(
      (await runWithTenant(tid, async () => draftCampaignAssetTool(ctx, { campaignId: noRedraftCampaignId, assetId: noRedraftEmailAsset.id, tweak: "make it punchier" }))).text,
    );
    assert.ok(noRedraftAttempt.error, "no-redraft test: draft_campaign_asset rejects redrafting an approved asset");
    assert.ok(
      /already approved/.test(noRedraftAttempt.error) || /can't be regenerated/.test(noRedraftAttempt.error),
      `no-redraft test: error message mentions approval/regeneration: "${noRedraftAttempt.error}"`,
    );

    // Verify the asset status is STILL approved and body is UNCHANGED.
    const assetAfterRedraft = runWithTenant(tid, () => getAsset(noRedraftEmailAsset.id));
    assert.equal(assetAfterRedraft?.status, "approved", "no-redraft test: asset status STILL approved after redraft rejection");
    assert.equal(assetAfterRedraft?.body, initialBody, "no-redraft test: asset body UNCHANGED after redraft rejection");

    // ── (j) summarizeToolAction — human strings for the three writes. Content
    // (not exact punctuation) is what's asserted: the campaign/asset name
    // appears and the phrasing matches the action. Note: create_campaign's
    // count is computed from the ACTUAL `assets` array length passed in (here
    // 11, DEFAULT_ASSET_PLAN's real length) rather than hardcoded, so an
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
