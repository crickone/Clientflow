/**
 * Pure tests for the campaign-build "progress strip" model (Campaign Engine
 * Slice 1, Task 6 — AssistantChat's Go-again + progress strip). Everything
 * under test has zero DOM/React/server imports (campaignProgress.ts only
 * pulls in @/lib/campaigns/plan, itself zero-import — see that file's own
 * header comment), so this loads under the plain tsx test runner with no
 * shim, exactly like src/lib/campaigns/prompts.test.ts / assetBody.test.ts.
 * Run: npm test -- src/components/messaging/campaignProgress.test.ts
 */
import assert from "node:assert/strict";

import { DEFAULT_ASSET_PLAN } from "@/lib/campaigns/plan";
import {
  campaignGoAgainMessage,
  campaignPlanEventFromActions,
  campaignProgressEventFromResult,
  deriveCampaignProgress,
  type CampaignProgressEvent,
} from "./campaignProgress";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// ── campaignPlanEventFromActions ────────────────────────────────────────────

check(
  "campaignPlanEventFromActions: null when no create_campaign action present",
  campaignPlanEventFromActions([{ name: "approve_campaign_asset", input: { campaignId: 1, assetId: 2 } }]) === null,
);

check("campaignPlanEventFromActions: null on an empty actions list", campaignPlanEventFromActions([]) === null);

{
  const ev = campaignPlanEventFromActions([
    {
      name: "create_campaign",
      input: {
        name: "Summer Shape Up 2026",
        offer: "6 weeks free",
        assets: [
          { kind: "offer", title: "Offer", sortOrder: 0 },
          { kind: "blog", title: "Blog post", sortOrder: 1 },
        ],
      },
    },
  ]);
  check("campaignPlanEventFromActions: recognises a create_campaign action", ev !== null && ev.type === "plan");
  check(
    "campaignPlanEventFromActions: extracts the campaign name",
    ev?.type === "plan" && ev.name === "Summer Shape Up 2026",
  );
  check(
    "campaignPlanEventFromActions: extracts kind+title for each asset",
    ev?.type === "plan" && ev.assets.length === 2 && ev.assets[0].kind === "offer" && ev.assets[1].title === "Blog post",
  );
}

{
  // Out-of-order input array, ordered by explicit sortOrder, not array position.
  const ev = campaignPlanEventFromActions([
    {
      name: "create_campaign",
      input: {
        name: "X",
        assets: [
          { kind: "blog", title: "Blog post", sortOrder: 1 },
          { kind: "offer", title: "Offer", sortOrder: 0 },
        ],
      },
    },
  ]);
  check(
    "campaignPlanEventFromActions: sorts by explicit sortOrder, not array position",
    ev?.type === "plan" && ev.assets[0].kind === "offer" && ev.assets[1].kind === "blog",
  );
}

{
  const ev = campaignPlanEventFromActions([
    { name: "create_campaign", input: { name: "X", assets: [{ kind: "offer", sortOrder: 0 }] } },
  ]);
  check(
    "campaignPlanEventFromActions: falls back to kind when title is missing",
    ev?.type === "plan" && ev.assets[0].title === "offer",
  );
}

{
  const ev = campaignPlanEventFromActions([{ name: "create_campaign", input: { name: "X" } }]);
  check(
    "campaignPlanEventFromActions: falls back to DEFAULT_ASSET_PLAN when assets is omitted",
    ev?.type === "plan" && ev.assets.length === DEFAULT_ASSET_PLAN.length && ev.assets[0].kind === "offer",
  );
}

{
  const ev = campaignPlanEventFromActions([{ name: "create_campaign", input: { name: "X", assets: [] } }]);
  check(
    "campaignPlanEventFromActions: falls back to DEFAULT_ASSET_PLAN when assets is an empty array (mirrors createCampaignTool's own fallback condition)",
    ev?.type === "plan" && ev.assets.length === DEFAULT_ASSET_PLAN.length,
  );
}

{
  const ev = campaignPlanEventFromActions([{ name: "create_campaign", input: {} }]);
  check(
    "campaignPlanEventFromActions: defaults the name to \"Campaign\" when missing",
    ev?.type === "plan" && ev.name === "Campaign",
  );
}

{
  const ev = campaignPlanEventFromActions([
    {
      name: "create_campaign",
      input: { name: "X", assets: [{ kind: "offer", title: "Offer", sortOrder: 0 }, { title: "No kind here" }] },
    },
  ]);
  check(
    "campaignPlanEventFromActions: drops entries with no recognisable kind, keeps the rest",
    ev?.type === "plan" && ev.assets.length === 1 && ev.assets[0].kind === "offer",
  );
}

// ── campaignProgressEventFromResult ─────────────────────────────────────────

check(
  "campaignProgressEventFromResult: null for a non-campaign tool name",
  campaignProgressEventFromResult("save_blog_post", JSON.stringify({ campaignId: 1 })) === null,
);

check(
  "campaignProgressEventFromResult: null for malformed JSON (never throws)",
  campaignProgressEventFromResult("create_campaign", "not json{") === null,
);

check(
  "campaignProgressEventFromResult: null when campaignId is missing",
  campaignProgressEventFromResult("create_campaign", JSON.stringify({ result: "ok" })) === null,
);

check(
  "campaignProgressEventFromResult: null when campaignId is null (not coerced to 0)",
  campaignProgressEventFromResult("create_campaign", JSON.stringify({ campaignId: null })) === null,
);

{
  const ev = campaignProgressEventFromResult(
    "create_campaign",
    JSON.stringify({ result: "Created", campaignId: 5, slug: "x", nextAsset: { id: 10, kind: "blog", title: "Blog post", sortOrder: 1, status: "pending" } }),
  );
  check(
    "campaignProgressEventFromResult: parses create_campaign's shape (full-row nextAsset)",
    ev?.type === "progress" && ev.campaignId === 5 && (ev.nextAsset as any)?.title === "Blog post",
  );
}

{
  // Defensive: the idempotent already-approved no-op path used to return a
  // narrower {id,kind,title} nextAsset before Task 6 fixed it at the source
  // (tools.campaign.ts) to match the normal path's full row — this module
  // still tolerates the narrow shape regardless (see its header comment).
  const ev = campaignProgressEventFromResult(
    "approve_campaign_asset",
    JSON.stringify({ result: "already approved", campaignId: 5, approved: true, alreadyApproved: true, nextAsset: { id: 11, kind: "social", title: "Social post 1" }, campaignStatus: "building" }),
  );
  check(
    "campaignProgressEventFromResult: parses a narrow {id,kind,title} nextAsset (defensive — see header comment)",
    ev?.type === "progress" && ev.campaignId === 5 && (ev.nextAsset as any)?.title === "Social post 1",
  );
}

{
  const ev = campaignProgressEventFromResult(
    "approve_campaign_asset",
    JSON.stringify({ result: "done", campaignId: 5, approved: true, nextAsset: null, campaignStatus: "ready" }),
  );
  check(
    "campaignProgressEventFromResult: approve_campaign_asset with nextAsset null carries through as null",
    ev?.type === "progress" && ev.nextAsset === null,
  );
}

{
  const ev = campaignProgressEventFromResult(
    "launch_campaign",
    JSON.stringify({ result: "Launched", campaignId: 5, status: "active", published: [], queued: [] }),
  );
  check(
    "campaignProgressEventFromResult: launch_campaign always yields nextAsset null (no per-asset field to read)",
    ev?.type === "progress" && ev.campaignId === 5 && ev.nextAsset === null,
  );
}

// ── campaignGoAgainMessage ───────────────────────────────────────────────────

{
  const msg = campaignGoAgainMessage({ name: "create_campaign", input: { name: "Summer Shape Up 2026" } }, "make it punchier");
  check("campaignGoAgainMessage (plan): contains the literal trigger phrase \"Go again\"", msg.includes("Go again"));
  check("campaignGoAgainMessage (plan): names the campaign", msg.includes("Summer Shape Up 2026"));
  check("campaignGoAgainMessage (plan): includes the tweak", msg.includes("make it punchier"));
}

check(
  "campaignGoAgainMessage (plan): no dangling \"for ''\" when the name is blank",
  !campaignGoAgainMessage({ name: "create_campaign", input: {} }, "").includes('for "'),
);

check(
  "campaignGoAgainMessage (plan): omits the tweak suffix when no tweak given",
  campaignGoAgainMessage({ name: "create_campaign", input: { name: "X" } }, "   ") === 'Go again on the campaign plan for "X".',
);

{
  const msg = campaignGoAgainMessage(
    { name: "approve_campaign_asset", input: { campaignId: 5, assetId: 2, assetTitle: "Blog post" } },
    "shorter",
  );
  check("campaignGoAgainMessage (asset): contains \"Go again\"", msg.includes("Go again"));
  check("campaignGoAgainMessage (asset): quotes the asset title", msg.includes('"Blog post"'));
  check("campaignGoAgainMessage (asset): includes the tweak", msg.includes("shorter"));
  check("campaignGoAgainMessage (asset): includes the campaignId", msg.includes("5"));
  check("campaignGoAgainMessage (asset): includes the assetId", msg.includes("2"));
}

check(
  "campaignGoAgainMessage (asset): falls back to \"that asset\" when assetTitle is missing",
  campaignGoAgainMessage({ name: "approve_campaign_asset", input: { campaignId: 5, assetId: 2 } }, "") ===
    "Go again on that asset (campaign 5, asset 2).",
);

// ── deriveCampaignProgress ──────────────────────────────────────────────────

check("deriveCampaignProgress: empty event list yields null", deriveCampaignProgress([]) === null);

{
  const events: CampaignProgressEvent[] = [
    { type: "plan", name: "X", assets: [{ kind: "offer", title: "Offer" }, { kind: "blog", title: "Blog post" }] },
  ];
  const model = deriveCampaignProgress(events);
  check("deriveCampaignProgress: a lone plan event yields campaignId null", model?.campaignId === null);
  check(
    "deriveCampaignProgress: a lone plan event marks every asset pending",
    model?.assets.every((a) => a.status === "pending") === true,
  );
}

{
  const events: CampaignProgressEvent[] = [
    { type: "plan", name: "X", assets: [{ kind: "offer", title: "Offer" }, { kind: "blog", title: "Blog post" }] },
    { type: "progress", campaignId: 7, nextAsset: { id: 1, kind: "offer", title: "Offer" } },
  ];
  const model = deriveCampaignProgress(events);
  check("deriveCampaignProgress: a progress event sets the campaignId", model?.campaignId === 7);
  check(
    "deriveCampaignProgress: the matched asset becomes \"current\", the rest stay \"pending\"",
    model?.assets[0].status === "current" && model?.assets[1].status === "pending",
  );
}

{
  const events: CampaignProgressEvent[] = [
    { type: "plan", name: "X", assets: [{ kind: "offer", title: "Offer" }, { kind: "blog", title: "Blog post" }, { kind: "social", title: "Social post 1" }] },
    { type: "progress", campaignId: 7, nextAsset: { id: 2, kind: "blog", title: "Blog post" } },
    { type: "progress", campaignId: 7, nextAsset: { id: 3, kind: "social", title: "Social post 1" } },
  ];
  const model = deriveCampaignProgress(events);
  check(
    "deriveCampaignProgress: earlier assets flip to \"done\" as progress advances",
    model?.assets[0].status === "done" && model?.assets[1].status === "done" && model?.assets[2].status === "current",
  );
}

{
  const events: CampaignProgressEvent[] = [
    { type: "plan", name: "X", assets: [{ kind: "offer", title: "Offer" }, { kind: "blog", title: "Blog post" }] },
    { type: "progress", campaignId: 7, nextAsset: null },
  ];
  const model = deriveCampaignProgress(events);
  check(
    "deriveCampaignProgress: nextAsset null marks every asset \"done\" (campaign ready/launched)",
    model?.assets.every((a) => a.status === "done") === true,
  );
}

{
  // The core shape-drift tolerance case (defensive — see this module's
  // header comment): a narrow {id, kind, title} nextAsset (no status/
  // sortOrder), the shape the idempotent no-op path used to send before
  // Task 6 fixed it at the source, must still place correctly, identically
  // to the full-row shape.
  const events: CampaignProgressEvent[] = [
    { type: "plan", name: "X", assets: [{ kind: "offer", title: "Offer" }, { kind: "social", title: "Social post 1" }] },
    { type: "progress", campaignId: 7, nextAsset: { id: 9, kind: "social", title: "Social post 1" } }, // narrow shape only
  ];
  const model = deriveCampaignProgress(events);
  check(
    "deriveCampaignProgress: narrow {id,kind,title} nextAsset (no status/sortOrder) still places the current asset correctly",
    model?.assets[0].status === "done" && model?.assets[1].status === "current",
  );
}

{
  // Title doesn't match (custom-renamed on a redraft, say) but kind does —
  // falls back to the first not-yet-done asset of that kind.
  const events: CampaignProgressEvent[] = [
    {
      type: "plan",
      name: "X",
      assets: [{ kind: "social", title: "Social post 1" }, { kind: "social", title: "Social post 2" }],
    },
    { type: "progress", campaignId: 7, nextAsset: { id: 9, kind: "social", title: "Renamed mid-build" } },
  ];
  const model = deriveCampaignProgress(events);
  check(
    "deriveCampaignProgress: falls back to matching by kind when the title doesn't match any tracked asset",
    model?.assets[0].status === "current",
  );
}

{
  const events: CampaignProgressEvent[] = [
    { type: "plan", name: "X", assets: [{ kind: "offer", title: "Offer" }] },
    { type: "progress", campaignId: 7, nextAsset: { id: 1, kind: "offer", title: "Offer" } },
    { type: "progress", campaignId: 999, nextAsset: null }, // an unrelated campaignId
  ];
  const model = deriveCampaignProgress(events);
  check(
    "deriveCampaignProgress: a progress event for a different campaignId is ignored, not corrupting existing state",
    model?.campaignId === 7 && model?.assets[0].status === "current",
  );
}

check(
  "deriveCampaignProgress: a progress event with no preceding plan event is ignored (stays null)",
  deriveCampaignProgress([{ type: "progress", campaignId: 1, nextAsset: null }]) === null,
);

{
  // A second plan event (e.g. "Go again" on the plan itself, or a second
  // campaign built later in the same conversation) fully resets state.
  const events: CampaignProgressEvent[] = [
    { type: "plan", name: "First", assets: [{ kind: "offer", title: "Offer" }] },
    { type: "progress", campaignId: 1, nextAsset: null },
    { type: "plan", name: "Second", assets: [{ kind: "offer", title: "Offer" }, { kind: "blog", title: "Blog post" }] },
  ];
  const model = deriveCampaignProgress(events);
  check("deriveCampaignProgress: a later plan event replaces the campaign name", model?.name === "Second");
  check("deriveCampaignProgress: a later plan event resets campaignId to null", model?.campaignId === null);
  check(
    "deriveCampaignProgress: a later plan event resets every asset back to pending",
    model?.assets.every((a) => a.status === "pending") === true && model?.assets.length === 2,
  );
}

{
  // End-to-end: campaignPlanEventFromActions + campaignProgressEventFromResult
  // feeding straight into deriveCampaignProgress, as AssistantChat wires them.
  const planEvent = campaignPlanEventFromActions([
    { name: "create_campaign", input: { name: "Launch Test", assets: [{ kind: "offer", title: "Offer", sortOrder: 0 }] } },
  ])!;
  const createResultEvent = campaignProgressEventFromResult(
    "create_campaign",
    JSON.stringify({ result: "Created", campaignId: 42, nextAsset: { id: 1, kind: "offer", title: "Offer" } }),
  )!;
  const launchResultEvent = campaignProgressEventFromResult(
    "launch_campaign",
    JSON.stringify({ result: "Launched", campaignId: 42, status: "active" }),
  )!;
  const model = deriveCampaignProgress([planEvent, createResultEvent, launchResultEvent]);
  check(
    "deriveCampaignProgress: end-to-end plan -> create -> launch settles on all-done",
    model?.campaignId === 42 && model?.assets.every((a) => a.status === "done") === true,
  );
}

console.log(`\n${passed} passed`);
