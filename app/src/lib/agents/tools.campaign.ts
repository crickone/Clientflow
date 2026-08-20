import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { slugify } from "@/lib/cms/blog";
import { generateAsset } from "@/lib/campaigns/generate";
import { materialiseAsset } from "@/lib/campaigns/materialise";
import { launchCampaign } from "@/lib/campaigns/launch";
import { getCampaignBuildModel, campaignModelLabel } from "@/lib/campaigns/buildModel";
import { estimateCampaignBuildCents, formatCentsEur } from "@/lib/campaigns/costEstimate";
import {
  ASSET_ORDER,
  DEFAULT_ASSET_PLAN,
  addAssets,
  approveAsset,
  createCampaign,
  getAsset,
  getCampaign,
  isTerminalStatus,
  listAssets,
  nextPendingAsset,
  setAssetDraft,
  setCampaignStatus,
} from "@/lib/campaigns/store";
import type { AssetDef, AssetKind, Campaign, CampaignAsset } from "@/lib/campaigns/store";

/**
 * Marketing-agent tools (Campaign Engine Slice 1, Tasks 3-4): the five tools
 * that drive the per-artifact campaign-kit build loop — plan a kit from a
 * brief, persist it, draft each asset one at a time, approve each one
 * (materialising it into its real home along the way), and launch once every
 * asset is approved. Wraps the EXISTING generation dispatch (`generateAsset`,
 * @/lib/campaigns/generate — itself reusing draftBlogPost/
 * generateCarouselSlides/draftCampaignEmail plus the new offer/ad_copy/
 * video_script prompts), the materialise-on-approve dispatch
 * (`materialiseAsset`, @/lib/campaigns/materialise — turns an approved
 * blog/social/email asset into a real blog_posts/carousel_sets/
 * email_campaigns DRAFT row), and the EXISTING campaign store
 * (`@/lib/campaigns/store`) — no new infrastructure here. Registered into
 * the central tool registry by `@/lib/assistant/tools` (TOOLS/executeTool/
 * WRITE_TOOLS/summarizeToolAction), exactly like tools.marketing.ts.
 *
 * `ToolArtifact`/`ToolResult`/`ToolContext` below are deliberately LOCAL,
 * structurally-identical copies of the ones in `@/lib/assistant/tools`
 * rather than imports from it — same circular-dependency reason documented
 * in `tools.marketing.ts`: that file imports THIS module's schemas and
 * executors to register them, so importing back from it here would cycle.
 * TypeScript's structural typing makes these interchangeable at every call
 * site.
 *
 * No local `tdb`/`resolveSite` helper (unlike tools.marketing.ts): every
 * `@/lib/campaigns/store` function reads/writes through the ambient,
 * request-scoped `db` proxy (@/lib/db) rather than an explicit per-tenant
 * connection — the same choice `@/lib/marketing/campaigns.ts` and
 * `@/lib/image/carousels.ts` make — and campaigns have no `site_id` (they're
 * tenant-wide, not per-site), so there's no resolveSite-style
 * disambiguation step to mirror. `ctx.tenantId` is still used below, as the
 * meter context's tenantId for AI spend accounting. Safe because every call
 * site that invokes executeTool for a tenant's tools (/api/assistant/chat,
 * /api/assistant/execute, /api/agents/[key]/chat) always wraps the call in
 * runWithTenant(ctx.tenantId, ...) first, so the ambient tenant is
 * guaranteed to equal ctx.tenantId. Tests must reproduce that wrapping (see
 * tools.campaign.test.ts).
 *
 * READ vs WRITE — one deliberate nuance vs. every other tool file: unlike
 * draft_blog_post/draft_carousel (which return a draft with NO persistence
 * at all), `draft_campaign_asset` DOES write a row (setAssetDraft moves the
 * asset's status "pending" -> "drafted") and is still classified as a READ
 * (absent from WRITE_TOOLS in @/lib/assistant/tools). That's intentional,
 * per the plan's Task 3 global constraint ("reads never persist beyond
 * drafted"): a "drafted" campaign_assets row never leaves the campaign's own
 * building state and has no external/public exposure — the real
 * write-approval gate is `approve_campaign_asset`, which promotes it.
 * `plan_campaign` never persists anything at all (transient in-memory
 * objects only, discarded after the call).
 *
 * Metering: every model-calling tool below (`plan_campaign`,
 * `draft_campaign_asset`) passes `{ tenantId: ctx.tenantId, agentKey:
 * "marketing" }` into `generateAsset`, which forwards it verbatim into
 * whichever underlying generator/meteredCreate call it dispatches to — same
 * agentKey the rest of the Marketing agent's tools use, so the Agents page's
 * per-agent spend breakdown stays meaningful.
 */
type ToolArtifact = { url: string; filename: string; label: string };
export type ToolResult = { text: string; artifact?: ToolArtifact };
export type ToolContext = { tenantId: number; userId?: number };

const ASSET_KIND_SET = new Set<string>(ASSET_ORDER);

/** Human label for a materialised external record — used only to phrase approve_campaign_asset's result string. */
const EXTERNAL_KIND_LABEL: Record<NonNullable<CampaignAsset["externalKind"]>, string> = {
  blog_post: "blog post",
  carousel_set: "carousel",
  email_campaign: "email campaign",
};

/** Validate + coerce a model-supplied `assets` array into AssetDef[], or an error message. Unknown kinds are rejected rather than silently dropped or defaulted. */
function normalizeAssetDefs(raw: unknown[]): AssetDef[] | { error: string } {
  const out: AssetDef[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = (raw[i] ?? {}) as Record<string, unknown>;
    const kind = String(item.kind || "");
    if (!ASSET_KIND_SET.has(kind)) {
      return { error: `assets[${i}].kind "${kind}" must be one of: ${ASSET_ORDER.join(", ")}.` };
    }
    const title = String(item.title || "").trim() || kind;
    const sortOrderArg = Number(item.sortOrder);
    const sortOrder = Number.isFinite(sortOrderArg) ? sortOrderArg : i;
    out.push({ kind: kind as AssetKind, title, sortOrder });
  }
  return out;
}

// ─── Tool schemas (what the model sees) ──────────────────────────────────────

export const CAMPAIGN_TOOLS: Anthropic.Tool[] = [
  {
    name: "plan_campaign",
    description:
      "Plan a new seasonal campaign kit from a brief: proposes a name/season/dates and GENERATES a real, house-rule-guarded core offer, plus the standard 11-asset build plan (one offer, one landing page, one blog post, 3 social posts, 3 emails, one ad copy, one video script). Returns ONLY a plan — it does NOT save anything. Show the plan to the operator for Approve/Go-again before calling create_campaign.",
    input_schema: {
      type: "object",
      properties: {
        brief: {
          type: "string",
          description:
            "What the campaign should be about — the season/theme/goal and any specifics for the offer (e.g. 'a summer transformation offer for new leads, running to June 30th').",
        },
        name: { type: "string", description: "Campaign name, e.g. 'Summer Shape Up 2026'. If omitted, propose one." },
        season: { type: "string", description: "e.g. 'Summer 2026'. Optional." },
        startsOn: { type: "string", description: "YYYY-MM-DD. Optional." },
        endsOn: { type: "string", description: "YYYY-MM-DD. Optional." },
      },
      required: ["brief"],
    },
  },
  {
    name: "create_campaign",
    description:
      "Persist a campaign and seed its asset plan. Call this ONLY after the operator has approved the plan from plan_campaign (or asked to trim it). The offer asset is saved as an immediate draft of the given offer text (ready for Approve/Go-again); every other asset starts pending, built one at a time via draft_campaign_asset.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Campaign name." },
        season: { type: "string", description: "Optional." },
        startsOn: { type: "string", description: "YYYY-MM-DD. Optional." },
        endsOn: { type: "string", description: "YYYY-MM-DD. Optional." },
        offer: { type: "string", description: "The approved offer text — normally plan_campaign's `offer` verbatim." },
        assets: {
          type: "array",
          description:
            "The asset plan to seed — normally plan_campaign's `assets` verbatim, or trimmed if the operator asked to drop some. Defaults to the standard 11-asset plan (offer, landing page, blog post, 3 social posts, 3 emails, ad copy, video script) if omitted.",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: [...ASSET_ORDER] },
              title: { type: "string" },
              sortOrder: { type: "integer", description: "Build order, 0-based. Defaults to the array position if omitted." },
            },
            required: ["kind", "title"],
          },
        },
      },
      required: ["name", "offer"],
    },
  },
  {
    name: "draft_campaign_asset",
    description:
      "Generate (or regenerate, with a tweak) ONE campaign asset's draft content — the next step in building a campaign kit one artifact at a time. Saves the draft to the asset, but this is NOT the operator's approval — show it in chat and only call approve_campaign_asset once they explicitly approve THAT asset.",
    input_schema: {
      type: "object",
      properties: {
        campaignId: { type: "integer" },
        assetId: { type: "integer", description: "The asset's id — see the campaign's nextAsset from create_campaign/approve_campaign_asset." },
        tweak: { type: "string", description: "Optional one-line instruction to change this draft on a 'Go again' (e.g. 'make it punchier')." },
      },
      required: ["campaignId", "assetId"],
    },
  },
  {
    name: "approve_campaign_asset",
    description:
      "Approve a campaign asset's current draft. ONLY call this after the operator has explicitly approved what draft_campaign_asset showed them for THAT asset — never batch-approve, never approve without an explicit go-ahead. When every asset in the campaign is approved, the campaign becomes ready to launch.",
    input_schema: {
      type: "object",
      properties: {
        campaignId: { type: "integer" },
        assetId: { type: "integer" },
        assetTitle: {
          type: "string",
          description: "Optional — this asset's title (e.g. from draft_campaign_asset's own result), purely so the operator sees a clear confirmation card.",
        },
        campaignName: { type: "string", description: "Optional — the campaign's name, purely for the confirmation card." },
      },
      required: ["campaignId", "assetId"],
    },
  },
  {
    name: "launch_campaign",
    description:
      "Launch a campaign once every asset is approved (status 'ready'). Only call this when the operator explicitly asks to launch/go live.",
    input_schema: {
      type: "object",
      properties: {
        campaignId: { type: "integer" },
        campaignName: { type: "string", description: "Optional — the campaign's name, purely for the confirmation card." },
      },
      required: ["campaignId"],
    },
  },
];

// ─── Executors ───────────────────────────────────────────────────────────────

/**
 * READ — plans a campaign kit from a brief: proposes name/season/dates and
 * GENERATES a real offer via generateAsset's "offer" branch (which reads the
 * tenant's Marketing Brain + venue voice through getBusinessContext(), and
 * restates the house-rules clause in its own prompt — see
 * @/lib/campaigns/prompts). The operator's brief rides in as `tweak`:
 * generateAsset's last parameter is exactly "extra instruction for this
 * draft", which is what a brief is at plan time (there's no saved offer yet
 * for it to riff on). Performs NO persistence — nothing is saved until
 * create_campaign.
 */
export async function planCampaignTool(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const brief = String(input.brief || "").trim();
  if (!brief) return { text: JSON.stringify({ error: "brief is required." }) };

  const name = input.name != null ? String(input.name).trim() : "";
  const season = input.season != null ? String(input.season).trim() : "";
  const startsOn = input.startsOn != null ? String(input.startsOn).trim() : "";
  const endsOn = input.endsOn != null ? String(input.endsOn).trim() : "";
  const draftName = name || "New campaign";

  // Transient (never persisted) Campaign/CampaignAsset shapes — just enough
  // for generateAsset's "offer" branch, which only reads asset.title and
  // campaign.{name,season,startsOn,endsOn,offer} (see prompts.ts's
  // campaignContextLines). Every other field is a placeholder that branch
  // never touches.
  const now = new Date();
  const transientCampaign: Campaign = {
    id: 0,
    name: draftName,
    slug: "",
    season: season || null,
    startsOn: startsOn || null,
    endsOn: endsOn || null,
    offer: "",
    status: "building",
    createdAt: now,
    updatedAt: now,
  };
  const transientOfferAsset: CampaignAsset = {
    id: 0,
    campaignId: 0,
    kind: "offer",
    title: "Offer",
    body: "",
    sortOrder: 0,
    status: "pending",
    externalKind: null,
    externalId: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const { body: offer } = await generateAsset(
      transientOfferAsset,
      transientCampaign,
      { tenantId: ctx.tenantId, agentKey: "marketing" },
      brief,
    );

    // Cost estimate (Campaign Engine Slice 4, Task 4) — purely informational,
    // never gates the plan: the tenant's chosen build model (buildModel.ts)
    // priced against the standard 11-asset plan via the pure estimator
    // (costEstimate.ts). Surfaced both as structured fields (estimateCents/
    // modelLabel, for any future UI consumer of this tool result) and folded
    // into `result`'s own text, since that's the one line the model reliably
    // relays to the operator when it shows the plan.
    const buildModel = await getCampaignBuildModel();
    const modelLabel = campaignModelLabel(buildModel);
    const estimateCents = estimateCampaignBuildCents(DEFAULT_ASSET_PLAN, buildModel);
    const estimateLine = `Estimated build cost: ${formatCentsEur(estimateCents)} on ${modelLabel} (an estimate — change the campaign model on the campaigns page to lower it).`;

    return {
      text: JSON.stringify({
        result: `Plan prepared — nothing has been saved. Show it to the operator; once they approve (trimming \`assets\` first if they want fewer), call create_campaign with this exact shape. ${estimateLine}`,
        name: draftName,
        season: season || null,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
        offer,
        assets: DEFAULT_ASSET_PLAN,
        estimateCents,
        modelLabel,
      }),
    };
  } catch (e) {
    return { text: JSON.stringify({ error: e instanceof Error ? e.message : "Failed to plan the campaign." }) };
  }
}

/** WRITE — persist a campaign + its asset plan. Call ONLY after the operator has approved plan_campaign's output. */
export function createCampaignTool(ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const name = String(input.name || "").trim();
  if (!name) return { text: JSON.stringify({ error: "name is required." }) };

  // `offer` is schema-required (steers the model to always pass the
  // already-approved plan's offer) but not runtime-fatal if somehow blank:
  // the campaign row still has its own DB default (""), it's just that the
  // offer asset below is left "pending" instead of pre-seeded — there's
  // nothing to seed it with.
  const offer = input.offer != null ? String(input.offer).trim() : "";
  const season = input.season != null ? String(input.season).trim() || null : null;
  const startsOn = input.startsOn != null ? String(input.startsOn).trim() || null : null;
  const endsOn = input.endsOn != null ? String(input.endsOn).trim() || null : null;

  let assetDefs: AssetDef[] = DEFAULT_ASSET_PLAN;
  if (Array.isArray(input.assets) && input.assets.length > 0) {
    const normalized = normalizeAssetDefs(input.assets);
    if (!Array.isArray(normalized)) return { text: JSON.stringify({ error: normalized.error }) };
    assetDefs = normalized;
  }

  // Deterministic, no random/timestamp suffix — two campaigns with the exact
  // same name land on the exact same slug (dedupe is not required for v1).
  const slug = slugify(name) || "campaign";

  const campaign = createCampaign({ name, slug, season, startsOn, endsOn, offer });
  const assets = addAssets(campaign.id, assetDefs);

  // Pre-seed the offer asset (kind "offer") with the already-generated,
  // already-shown offer text, moving it straight to "drafted" — so its first
  // card in chat is Approve/Go-again like every other asset, instead of
  // forcing a redundant regeneration of an offer the operator already saw
  // and approved at the plan step.
  if (offer) {
    const offerAsset = assets.find((a) => a.kind === "offer");
    if (offerAsset) setAssetDraft(offerAsset.id, { title: offerAsset.title || "Offer", body: offer });
  }

  const freshAssets = listAssets(campaign.id);
  const nextAsset = nextPendingAsset(freshAssets);

  return {
    text: JSON.stringify({
      result: `Created campaign "${name}" with ${assets.length} asset${assets.length === 1 ? "" : "s"}.`,
      campaignId: campaign.id,
      slug: campaign.slug,
      nextAsset,
    }),
  };
}

/**
 * READ — generate (or regenerate, with `tweak`) ONE asset's draft content and
 * save it (status -> "drafted"). See this file's header comment for why this
 * DOES persist a row yet is still a READ, not a WRITE_TOOLS entry.
 */
export async function draftCampaignAssetTool(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const campaignId = Number(input.campaignId);
  const assetId = Number(input.assetId);
  if (!campaignId) return { text: JSON.stringify({ error: "campaignId is required." }) };
  if (!assetId) return { text: JSON.stringify({ error: "assetId is required." }) };

  const campaign = getCampaign(campaignId);
  if (!campaign) return { text: JSON.stringify({ error: `No campaign with id ${campaignId}.` }) };
  if (isTerminalStatus(campaign.status)) {
    return { text: JSON.stringify({ error: `Campaign "${campaign.name}" is ${campaign.status} — no further changes.` }) };
  }

  const asset = getAsset(assetId);
  if (!asset) return { text: JSON.stringify({ error: `No asset with id ${assetId}.` }) };
  if (asset.campaignId !== campaignId) {
    return { text: JSON.stringify({ error: `Asset ${assetId} does not belong to campaign ${campaignId}.` }) };
  }
  if (asset.status === "approved") {
    return {
      text: JSON.stringify({
        error: `"${asset.title}" is already approved and can't be regenerated. Edit it in its home (the blog/social/email draft it was saved to), or start a fresh campaign.`,
      }),
    };
  }

  const tweak = input.tweak != null ? String(input.tweak).trim() || undefined : undefined;

  try {
    const draft = await generateAsset(asset, campaign, { tenantId: ctx.tenantId, agentKey: "marketing" }, tweak);
    setAssetDraft(asset.id, draft);

    return {
      text: JSON.stringify({
        result: `Draft prepared for "${draft.title}" — this is NOT approved yet. Show it to the operator and only call approve_campaign_asset once they approve it (or call draft_campaign_asset again with a tweak for "Go again").`,
        campaignId,
        assetId: asset.id,
        kind: asset.kind,
        title: draft.title,
        body: draft.body,
      }),
    };
  } catch (e) {
    return { text: JSON.stringify({ error: e instanceof Error ? e.message : "Failed to draft this asset." }) };
  }
}

/**
 * WRITE — approve an asset's current draft. Before flipping status, tries to
 * materialise it into its real home (blog_posts / carousel_sets /
 * email_campaigns, as a DRAFT — see @/lib/campaigns/materialise) and records
 * the link via approveAsset's optional externalKind/externalId; offer/
 * ad_copy/video_script have no external home and stay on the asset itself.
 * materialiseAsset never throws (it logs and returns null on any failure —
 * an unparseable stored body, an unresolvable site, an unexpected DB error),
 * so a materialisation hiccup never blocks the approval itself. When every
 * asset in the campaign is approved, the campaign moves to "ready".
 */
export function approveCampaignAssetTool(ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const campaignId = Number(input.campaignId);
  const assetId = Number(input.assetId);
  if (!campaignId) return { text: JSON.stringify({ error: "campaignId is required." }) };
  if (!assetId) return { text: JSON.stringify({ error: "assetId is required." }) };

  const campaign = getCampaign(campaignId);
  if (!campaign) return { text: JSON.stringify({ error: `No campaign with id ${campaignId}.` }) };
  if (isTerminalStatus(campaign.status)) {
    return { text: JSON.stringify({ error: `Campaign "${campaign.name}" is ${campaign.status} — no further changes.` }) };
  }

  const asset = getAsset(assetId);
  if (!asset) return { text: JSON.stringify({ error: `No asset with id ${assetId}.` }) };
  if (asset.campaignId !== campaignId) {
    return { text: JSON.stringify({ error: `Asset ${assetId} does not belong to campaign ${campaignId}.` }) };
  }
  if (asset.status === "pending") {
    return { text: JSON.stringify({ error: `"${asset.title}" hasn't been drafted yet — call draft_campaign_asset first.` }) };
  }

  // Idempotent: never re-materialise an already-approved asset (would duplicate
  // the real record + re-spend AI money on image generation).
  if (asset.status === "approved") {
    // `remaining` is already the FULL CampaignAsset row (same nextPendingAsset
    // call the normal path below uses) — return it verbatim rather than
    // reshaping it down to {id,kind,title}. Task 6 review caught that the
    // earlier narrowed version made this the ONE path where `nextAsset`
    // doesn't match the normal path's shape, forcing every client-side
    // consumer to treat sortOrder/status as possibly-absent. Returning the
    // same shape both paths return removes that footgun at the source (the
    // chat UI's progress-strip model still tolerates a narrow nextAsset
    // defensively — see campaignProgress.ts — but no longer needs to for
    // THIS path).
    const remaining = nextPendingAsset(listAssets(campaignId));
    return {
      text: JSON.stringify({
        result: `"${asset.title}" is already approved — no changes made.`,
        campaignId,
        assetId: asset.id,
        approved: true,
        alreadyApproved: true,
        externalKind: asset.externalKind ?? null,
        externalId: asset.externalId ?? null,
        nextAsset: remaining,
        campaignStatus: campaign.status,
      }),
    };
  }

  const materialised = materialiseAsset(asset, campaign, ctx.tenantId);
  approveAsset(asset.id, materialised ?? undefined);

  const assets = listAssets(campaignId);
  const nextAsset = nextPendingAsset(assets);
  if (!nextAsset) setCampaignStatus(campaignId, "ready");

  const campaignStatus = nextAsset ? campaign.status : "ready";
  const savedNote = materialised ? ` Saved as a draft ${EXTERNAL_KIND_LABEL[materialised.externalKind]}.` : "";

  return {
    text: JSON.stringify({
      result: nextAsset
        ? `Approved "${asset.title}".${savedNote} Next up: "${nextAsset.title}".`
        : `Approved "${asset.title}".${savedNote} Every asset in "${campaign.name}" is now approved. The campaign is ready to launch.`,
      campaignId,
      assetId: asset.id,
      approved: true,
      externalKind: materialised?.externalKind ?? null,
      externalId: materialised?.externalId ?? null,
      nextAsset,
      campaignStatus,
    }),
  };
}

/**
 * WRITE — launch a campaign once every asset is approved (status "ready").
 * Delegates the actual per-asset work to @/lib/campaigns/launch's
 * `launchCampaign` — blog publishes for real (siteId re-derived from the
 * linked blog_posts row), email/social are queued for the operator rather
 * than auto-sent/auto-posted (see that module's header comment for exactly
 * why) — then flips the campaign to "active". The result text reports
 * ONLY what `launchCampaign` actually reports back: never claims a
 * publish/send that didn't happen.
 */
export async function launchCampaignTool(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  void ctx; // no tenant-scoped read needed beyond the campaign row itself (ambient db)
  const campaignId = Number(input.campaignId);
  if (!campaignId) return { text: JSON.stringify({ error: "campaignId is required." }) };

  const campaign = getCampaign(campaignId);
  if (!campaign) return { text: JSON.stringify({ error: `No campaign with id ${campaignId}.` }) };
  if (campaign.status !== "ready") {
    return {
      text: JSON.stringify({
        error: `"${campaign.name}" isn't ready to launch yet (status: ${campaign.status}) — approve every asset first.`,
      }),
    };
  }

  try {
    const { published, queued } = await launchCampaign(campaignId);

    const parts: string[] = [];
    if (published.length) {
      parts.push(`${published.length} published (${published.map((p) => p.title).join(", ")})`);
    }
    if (queued.length) {
      parts.push(`${queued.length} queued for manual follow-up (${queued.map((q) => q.title).join(", ")})`);
    }
    const summary = parts.length > 0 ? parts.join("; ") : "nothing to publish or queue (no asset had a materialised link)";

    return {
      text: JSON.stringify({
        result: `Launched "${campaign.name}": ${summary}.`,
        campaignId,
        status: "active",
        published,
        queued,
      }),
    };
  } catch (e) {
    return { text: JSON.stringify({ error: e instanceof Error ? e.message : "Failed to launch this campaign." }) };
  }
}
