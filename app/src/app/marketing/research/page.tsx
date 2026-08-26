import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/db/tenant";
import { formatCentsEur } from "@/lib/campaigns/costEstimate";
import { PageHeader } from "@/components/layout/PageHeader";
import { adLibraryConfigured } from "@/lib/research/adLibrary";
import { getContentGaps } from "@/lib/research/contentScan";
import { getResearchCentre } from "@/lib/research/discovery";
import { placesConfigured } from "@/lib/research/places";
import { getResearchCapCents, researchSpentCents } from "@/lib/research/spend";
import {
  getReviews,
  getSelfCompetitor,
  latestMetric,
  listAds,
  listCompetitors,
  listEvents,
  metricHistory,
  type CompetitorRow,
  type EventRow,
  type Metric,
  type StoredAd,
  type StoredReview,
} from "@/lib/research/store";
import { readKey } from "@/lib/settings";
import { ResearchView, type LandscapeCache, type ResearchState } from "@/components/research/ResearchView";
import {
  rescanNowAction,
  setCompetitorFlagsAction,
  markResearchEventsSeenAction,
  buildCampaignFromCompetitorAction,
  linkCompetitorPageAction,
  unlinkCompetitorPageAction,
  scanContentAction,
  saveResearchKeywordsAction,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * Reads + validates the cached landscape-summary KV value `rescanNowAction`
 * (./actions.ts, Task 11) writes after every scan (`research_landscape`,
 * JSON `{text, at}`); null if absent or malformed. Mirrors
 * lib/research/discovery.ts's `readCachedCentre()` — same "validate the
 * shape, never trust the generic cast" idiom for a KV value this module
 * didn't itself write. Deliberately does NOT call `landscapeSummary()`
 * (lib/research/summary.ts) — that's a metered AI call, and this page must
 * render for free.
 */
function readLandscapeCache(): LandscapeCache | null {
  const raw = readKey<unknown>("research_landscape", null);
  if (!raw || typeof raw !== "object") return null;
  const { text, at } = raw as Record<string, unknown>;
  if (typeof text !== "string" || typeof at !== "string" || text.trim().length === 0) return null;
  return { text, at };
}

/**
 * Market Research P1, Task 10 (view) + Task 11 (the actions wired in below)
 * — the visible dashboard: a ranked competitor list with rating/review
 * trends, a "what changed" feed, and per-competitor detail. Every read below
 * is a plain store/KV select (see the imports — store.ts, discovery.ts's
 * cache-only getResearchCentre, settings.ts's readKey, spend.ts's two pure
 * read-throughs) — NEVER a Google Places call or an AI call. Browsing this
 * page is always free; only a "Rescan now" click (rescanNowAction, ./actions.ts)
 * spends. `placesConfigured()`/`getResearchCentre()` decide which of the 4
 * states ResearchView renders; ResearchView itself just switches on `state`,
 * it never re-derives it. The 4 actions are passed straight down as props —
 * see ResearchView's own doc comment for why (a Server Component handing a
 * Server Action to a Client Component as a prop).
 *
 * P1.1: `competitors` (and `state`, which is derived from its length) is the
 * self-EXCLUDING list — `listCompetitors({trackedOnly:true,
 * excludeSelf:true})` — so ranking/highlights/count/state can never be
 * skewed by the tenant's own gym. `self`/`selfMetric` (`getSelfCompetitor()`
 * + its `latestMetric`) are read separately and handed down for
 * ResearchView's "Your gym" reference row.
 *
 * Market Research P2, Task 6: `adsById` (`listAds(id)`, per competitor — ALL
 * rows, active and stopped) and `adLibraryConfigured` (a sync env-var check,
 * `adLibraryConfigured()` from lib/research/adLibrary.ts) are read the same
 * store-only way and handed down for CompetitorDetail's Ads section +
 * CompetitorRow's "Advertising" pill — NEVER `searchCompetitorAds` (the
 * network call) or `adAngle` (the AI call) from here; the cached ad-angle
 * text lives in `competitor.adAngleJson`, already inside every `CompetitorRow`
 * this page already reads via `listCompetitors`.
 *
 * Exact Page-ID ad matching, Task 2: `isAdmin` is computed below and handed
 * down (same store-only, zero-cost read as everything else on this page) so
 * CompetitorDetail can gate its Link/Unlink controls without tracing back up
 * to this page's own `requireAdminPage()` call — that call already redirects
 * any non-admin away before ANY of this component's JSX renders, so
 * `isAdmin` is always true in practice (same "admin-only by construction" as
 * marketing/campaigns/page.tsx and CapEditor on /agents); it's threaded
 * through explicitly anyway so the gate is legible at the component that
 * actually renders the write controls, matching the two new actions'
 * (./actions.ts) own `requireAdmin()` defence-in-depth.
 *
 * Content-gap analysis: `getContentGaps(tenantId)` (lib/research/contentScan.ts)
 * is one more plain, free read — never crawls, never calls the AI, same
 * "always free to browse" contract as everything else on this page — feeding
 * ResearchView's new ContentGaps section its `gaps`/`contentGapCompetitors`/
 * `researchKeywords` props, plus the two admin-only Server Actions
 * (`scanContentAction`/`saveResearchKeywordsAction`) that section's own forms
 * dispatch. Deliberately NOT gated behind `state` here (unlike the
 * per-competitor loop below, which only makes sense once `competitors` is
 * non-empty) — `getContentGaps` degrades to an all-empty result on its own
 * when nothing's tracked yet, so there's no reason to branch this read too.
 */
export default async function MarketingResearchPage() {
  await requireAdminPage();
  const isAdmin = getCurrentMembership()?.role === "admin";

  const configured = placesConfigured();
  const centre = await getResearchCentre(); // cache-only read — never geocodes (see discovery.ts)
  // excludeSelf (Market Research P1.1): the tenant's own gym must never be
  // ranked/counted/highlighted as a competitor — see getSelfCompetitor()
  // below for the separate "Your gym" reference this page also reads.
  const competitors: CompetitorRow[] = listCompetitors({ trackedOnly: true, excludeSelf: true });
  const self = getSelfCompetitor();
  const selfMetric = self ? latestMetric(self.id) : null;

  let state: ResearchState;
  if (!configured) {
    state = "no-key";
  } else if (!centre && competitors.length === 0) {
    state = "no-centre";
  } else if (competitors.length === 0) {
    state = "empty";
  } else {
    state = "populated";
  }

  // Per-competitor snapshots for every tracked row — Google's Nearby call
  // caps a single scan at 20 places (places.ts's nearbyGyms maxResultCount),
  // so N synchronous store reads here is the same "cheap at this scale" call
  // marketing/campaigns/page.tsx already makes for its own per-row roll-up
  // (see that file's comment on why an N-way Promise.all/loop is fine).
  const metricsById: Record<number, Metric | null> = {};
  const historyById: Record<number, Metric[]> = {};
  const reviewsById: Record<number, StoredReview[]> = {};
  const adsById: Record<number, StoredAd[]> = {};
  for (const c of competitors) {
    metricsById[c.id] = latestMetric(c.id);
    historyById[c.id] = metricHistory(c.id);
    reviewsById[c.id] = getReviews(c.id);
    adsById[c.id] = listAds(c.id);
  }

  const events: EventRow[] = listEvents({ limit: 20 });
  const landscape = readLandscapeCache();

  const tenantId = getCurrentTenant().id;
  const spendLabel = `${formatCentsEur(researchSpentCents(tenantId))} / ${formatCentsEur(getResearchCapCents(tenantId))} this month`;

  // Content-gap analysis — see this function's own doc comment above. Never
  // throws (getContentGaps's own contract); always a free read.
  const { gaps: contentGaps, perCompetitor: contentGapCompetitors, seedKeywords: researchKeywords } =
    await getContentGaps(tenantId);

  // Market Research P2, Task 6 — a sync env-var presence check only (mirrors
  // `configured`/`placesConfigured()` above), never a network call; decides
  // whether a competitor with no ads shows "none found" or a "connect the Ad
  // Library" nudge. Never call adLibrary.ts's `searchCompetitorAds` (or
  // summary.ts's `adAngle`) from this page — it must stay a free read.
  const adsConfigured = adLibraryConfigured();

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Marketing"
        title="Research"
        subtitle="Nearby competitors — ratings, reviews and a weekly change feed. Browsing is always free; only a scan spends."
      />
      <ResearchView
        state={state}
        competitors={competitors}
        metricsById={metricsById}
        historyById={historyById}
        reviewsById={reviewsById}
        adsById={adsById}
        events={events}
        landscape={landscape}
        spendLabel={spendLabel}
        adLibraryConfigured={adsConfigured}
        self={self}
        selfMetric={selfMetric}
        isAdmin={isAdmin}
        onRescan={rescanNowAction}
        onSetFlags={setCompetitorFlagsAction}
        onMarkSeen={markResearchEventsSeenAction}
        onBuildCampaign={buildCampaignFromCompetitorAction}
        onLinkPage={linkCompetitorPageAction}
        onUnlinkPage={unlinkCompetitorPageAction}
        contentGaps={contentGaps}
        contentGapCompetitors={contentGapCompetitors}
        researchKeywords={researchKeywords}
        onScanContent={scanContentAction}
        onSaveResearchKeywords={saveResearchKeywordsAction}
      />
    </div>
  );
}
