/**
 * Pure, DOM-free model for the campaign-build "progress strip" AssistantChat
 * renders while the Marketing agent (directly, or via Orchestrator
 * delegation — the pending write's NAME is what matters here, not which
 * endpoint/agent this chat instance is bound to) walks an operator through
 * building a campaign kit (Campaign Engine Slice 1, Task 6). Fed entirely by
 * signal ALREADY flowing through the existing SSE + Approve-card + `/api/
 * assistant/execute` plumbing — no new fetch, no new endpoint:
 *
 *  - a "plan" event, captured the moment a `create_campaign` write is
 *    PROPOSED (the `confirm` SSE frame's `PendingAction.input` — before any
 *    approval). This is the ONLY point the full ordered asset list
 *    (kind/title/sortOrder) is ever visible client-side: createCampaignTool
 *    (@/lib/agents/tools.campaign.ts) never echoes the asset list back in
 *    its own execute RESULT, only `nextAsset` (the single next-to-draft
 *    one).
 *  - a "progress" event, captured every time create_campaign,
 *    approve_campaign_asset or launch_campaign is actually approved and
 *    executed — the JSON `text` of /api/assistant/execute's per-action
 *    result (the exact same string AssistantChat's approve() already
 *    appends to the chat bubble) carries `nextAsset` (which asset is now
 *    current, or null once every asset is approved).
 *
 * nextAsset shape drift (Task 4 review carry-in, tools.campaign.ts): the
 * idempotent already-approved no-op path in approveCampaignAssetTool used to
 * return a narrowed `{id, kind, title}` for `nextAsset` while its normal path
 * returned the FULL CampaignAsset row — fixed at the source as part of this
 * task (both paths now return the same full row). Every function below still
 * reads AT MOST id/kind/title off a `nextAsset` and never touches
 * `status`/`sortOrder`, though, as defence in depth: this module has no way
 * to know whether every producer of a "progress" event agrees with today's
 * server shape (a rolling deploy, an older cached/localStorage
 * `campaignEvents` entry, or a future regression could all still deliver the
 * narrow shape) — see deriveCampaignProgress's own doc comment.
 */

import { DEFAULT_ASSET_PLAN } from "@/lib/campaigns/plan";

export type CampaignAssetStatus = "done" | "current" | "pending";

export type CampaignProgressAsset = {
  kind: string;
  title: string;
  status: CampaignAssetStatus;
};

export type CampaignProgress = {
  campaignId: number | null;
  name: string;
  assets: CampaignProgressAsset[];
};

type PlannedAsset = { kind: string; title: string };

/**
 * `nextAsset` as it actually arrives off the wire — see this file's header
 * re: shape drift. Deliberately loose (`unknown` fields) since it's parsed
 * from untyped JSON text, not a typed API response.
 */
export type NextAssetLite = { id?: unknown; kind?: unknown; title?: unknown } | null;

export type CampaignProgressEvent =
  | { type: "plan"; name: string; assets: PlannedAsset[] }
  | { type: "progress"; campaignId: number; nextAsset: NextAssetLite };

/** Structural subset of AssistantChat's own PendingAction — avoids importing its private type into this pure module. */
type ActionLike = { name: string; input: Record<string, unknown> };

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function normalizePlannedAssets(raw: unknown[]): PlannedAsset[] {
  const withOrder: (PlannedAsset & { sortOrder: number })[] = [];
  raw.forEach((entry, i) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const kind = typeof item.kind === "string" ? item.kind : "";
    if (!kind) return; // unrecognisable entry — drop it rather than show a broken chip
    const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : kind;
    const sortOrder = typeof item.sortOrder === "number" && Number.isFinite(item.sortOrder) ? item.sortOrder : i;
    withOrder.push({ kind, title, sortOrder });
  });
  withOrder.sort((a, b) => a.sortOrder - b.sortOrder);
  return withOrder.map(({ kind, title }) => ({ kind, title }));
}

/**
 * Seed (or replace) the tracked plan from a PROPOSED create_campaign call.
 * Returns null when `actions` doesn't include one (every other write in the
 * app, including every OTHER campaign tool). Falls back to the same
 * DEFAULT_ASSET_PLAN createCampaignTool itself defaults to
 * (@/lib/agents/tools.campaign.ts) when the model's call omits `assets` (or
 * sends an empty array) — matching the server's own fallback condition
 * exactly, so this always reflects what will actually get created.
 */
export function campaignPlanEventFromActions(actions: ActionLike[]): CampaignProgressEvent | null {
  const action = actions.find((a) => a.name === "create_campaign");
  if (!action) return null;

  const name =
    typeof action.input.name === "string" && action.input.name.trim() ? action.input.name.trim() : "Campaign";
  const rawAssets =
    Array.isArray(action.input.assets) && action.input.assets.length > 0 ? action.input.assets : DEFAULT_ASSET_PLAN;

  const assets = normalizePlannedAssets(rawAssets);
  if (assets.length === 0) return null;
  return { type: "plan", name, assets };
}

/**
 * Build a "progress" event from an approved campaign write's raw JSON result
 * text. Returns null for any non-campaign write, or text that isn't valid
 * JSON with a numeric campaignId — never throws.
 */
export function campaignProgressEventFromResult(name: string, resultText: string): CampaignProgressEvent | null {
  if (name !== "create_campaign" && name !== "approve_campaign_asset" && name !== "launch_campaign") return null;

  let data: unknown;
  try {
    data = JSON.parse(resultText);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  const campaignId = asFiniteNumber(obj.campaignId);
  if (campaignId == null) return null;

  // launch_campaign carries no per-asset nextAsset — by the time it's even
  // callable every asset is already approved (launchCampaignTool requires
  // status "ready") — so treat it as "nothing left pending" rather than
  // leaving the strip on its last pre-launch snapshot.
  const nextAsset = name === "launch_campaign" ? null : ((obj.nextAsset ?? null) as NextAssetLite);

  return { type: "progress", campaignId, nextAsset };
}

/**
 * The literal chat message "Go again" sends — the chosen wiring reuses the
 * EXISTING send() path with zero new endpoint (see AssistantChat's own
 * header comment on why). Always contains the words "Go again", which the
 * Marketing agent's playbook (specialists/marketing.ts's basePlaybook)
 * already anchors on for both the plan step and the per-asset step, so the
 * model reliably maps this to a fresh plan_campaign (plan case) or
 * draft_campaign_asset (asset case) call — using whatever name/assetTitle
 * the pending action itself already carries, so the model doesn't have to
 * guess which campaign/asset "that" refers to.
 */
export function campaignGoAgainMessage(action: ActionLike, tweak: string): string {
  const cleanTweak = tweak.trim();
  const suffix = cleanTweak ? ` — ${cleanTweak}` : "";

  if (action.name === "create_campaign") {
    const name = typeof action.input.name === "string" ? action.input.name.trim() : "";
    return `Go again on the campaign plan${name ? ` for "${name}"` : ""}${suffix}.`;
  }

  const rawTitle = typeof action.input.assetTitle === "string" ? action.input.assetTitle.trim() : "";
  const campaignId = action.input.campaignId ?? "";
  const assetId = action.input.assetId ?? "";
  const ids = campaignId && assetId ? ` (campaign ${campaignId}, asset ${assetId})` : "";
  return rawTitle ? `Go again on "${rawTitle}"${ids}${suffix}.` : `Go again on that asset${ids}${suffix}.`;
}

/**
 * Fold a chronological event list (as captured by AssistantChat's
 * send()/approve()/resumeRun()) into the strip's current render model. Pure
 * + total — never throws, degrades gracefully on anything it can't place
 * rather than corrupting or dropping the whole strip.
 *
 * A later "plan" event fully REPLACES the tracked state (a fresh
 * create_campaign proposal — e.g. after "Go again" on the plan itself, or a
 * second campaign built later in the same conversation — starts a new
 * build). A "progress" event before any "plan" event, or naming a different
 * campaignId than the one already tracked, is ignored rather than
 * corrupting what's already known. `nextAsset` is matched into the tracked
 * asset list by `title` first (unique per campaign in practice), falling
 * back to the first not-yet-done asset of the same `kind` (kinds like
 * "social"/"email" repeat 3x, so this is only a fallback, never the primary
 * match) — deliberately never reads `nextAsset.sortOrder`/`.status`; see this
 * file's header comment on why that's still worth doing even after fixing
 * the one server path that used to omit them.
 */
export function deriveCampaignProgress(events: CampaignProgressEvent[]): CampaignProgress | null {
  let state: CampaignProgress | null = null;

  for (const event of events) {
    if (event.type === "plan") {
      state = {
        campaignId: null,
        name: event.name,
        assets: event.assets.map((a) => ({ ...a, status: "pending" as const })),
      };
      continue;
    }

    // event.type === "progress"
    if (!state) continue; // no plan on record — nothing to attach this progress to
    if (state.campaignId != null && state.campaignId !== event.campaignId) continue; // a different campaign — ignore
    state = { ...state, campaignId: event.campaignId };

    if (event.nextAsset == null) {
      state = { ...state, assets: state.assets.map((a) => ({ ...a, status: "done" as const })) };
      continue;
    }

    const title = typeof event.nextAsset.title === "string" ? event.nextAsset.title.trim() : "";
    const kind = typeof event.nextAsset.kind === "string" ? event.nextAsset.kind : "";
    const trackedAssets: CampaignProgressAsset[] = state.assets;
    let idx: number = title ? trackedAssets.findIndex((a) => a.title === title && a.status !== "done") : -1;
    if (idx < 0 && kind) idx = trackedAssets.findIndex((a) => a.kind === kind && a.status !== "done");
    if (idx < 0) continue; // can't place it — leave prior progress exactly as it was rather than guess

    const currentIdx: number = idx;
    state = {
      ...state,
      assets: trackedAssets.map((a, i) => ({
        ...a,
        status: (i < currentIdx ? "done" : i === currentIdx ? "current" : "pending") as CampaignAssetStatus,
      })),
    };
  }

  return state;
}
