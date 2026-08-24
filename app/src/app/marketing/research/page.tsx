import { requireAdminPage } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/db/tenant";
import { formatCentsEur } from "@/lib/campaigns/costEstimate";
import { PageHeader } from "@/components/layout/PageHeader";
import { getResearchCentre } from "@/lib/research/discovery";
import { placesConfigured } from "@/lib/research/places";
import { getResearchCapCents, researchSpentCents } from "@/lib/research/spend";
import {
  getReviews,
  latestMetric,
  listCompetitors,
  listEvents,
  metricHistory,
  type CompetitorRow,
  type EventRow,
  type Metric,
  type StoredReview,
} from "@/lib/research/store";
import { readKey } from "@/lib/settings";
import { ResearchView, type LandscapeCache, type ResearchState } from "@/components/research/ResearchView";

export const dynamic = "force-dynamic";

/**
 * Reads + validates the cached landscape-summary KV value a later task's
 * "Rescan now" action writes (`research_landscape`, JSON `{text, at}`);
 * null if absent or malformed. Mirrors lib/research/discovery.ts's
 * `readCachedCentre()` — same "validate the shape, never trust the
 * generic cast" idiom for a KV value this module didn't itself write.
 * Deliberately does NOT call `landscapeSummary()` (lib/research/summary.ts)
 * — that's a metered AI call, and this page must render for free.
 */
function readLandscapeCache(): LandscapeCache | null {
  const raw = readKey<unknown>("research_landscape", null);
  if (!raw || typeof raw !== "object") return null;
  const { text, at } = raw as Record<string, unknown>;
  if (typeof text !== "string" || typeof at !== "string" || text.trim().length === 0) return null;
  return { text, at };
}

/**
 * Market Research P1, Task 10 — the visible dashboard: a ranked competitor
 * list with rating/review trends, a "what changed" feed, and per-competitor
 * detail. Every read below is a plain store/KV select (see the imports —
 * store.ts, discovery.ts's cache-only getResearchCentre, settings.ts's
 * readKey, spend.ts's two pure read-throughs) — NEVER a Google Places call
 * or an AI call. Browsing this page is always free; only a future "Rescan
 * now" (Task 11) spends. `placesConfigured()`/`getResearchCentre()` decide
 * which of the 4 states ResearchView renders; ResearchView itself just
 * switches on `state`, it never re-derives it.
 */
export default async function MarketingResearchPage() {
  await requireAdminPage();

  const configured = placesConfigured();
  const centre = await getResearchCentre(); // cache-only read — never geocodes (see discovery.ts)
  const competitors: CompetitorRow[] = listCompetitors({ trackedOnly: true });

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
  for (const c of competitors) {
    metricsById[c.id] = latestMetric(c.id);
    historyById[c.id] = metricHistory(c.id);
    reviewsById[c.id] = getReviews(c.id);
  }

  const events: EventRow[] = listEvents({ limit: 20 });
  const landscape = readLandscapeCache();

  const tenantId = getCurrentTenant().id;
  const spendLabel = `${formatCentsEur(researchSpentCents(tenantId))} / ${formatCentsEur(getResearchCapCents(tenantId))} this month`;

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
        events={events}
        landscape={landscape}
        spendLabel={spendLabel}
      />
    </div>
  );
}
