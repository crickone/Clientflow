"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { buildCampaignSeedHref } from "@/components/marketing/buildCampaignSeed";
import { buildCompetitorGapSeed } from "@/lib/research/campaignGap";
import { mostRecentRefreshAt, wasRecentlyScanned } from "@/lib/research/debounce";
import { refreshTenant } from "@/lib/research/refresh";
import { competitorThemes, landscapeSummary } from "@/lib/research/summary";
import {
  latestMetric,
  listCompetitors,
  markEventsSeen,
  setCompetitorFlags,
} from "@/lib/research/store";
import { ResearchCapError } from "@/lib/research/spend";
import { AiCapError } from "@/lib/ai/usage";
import { setKey } from "@/lib/settings";

/**
 * Market Research P1, Task 11 — the server actions behind `/marketing/
 * research` (T10's dashboard). This is the ONLY place in the feature that
 * spends: browsing the page is always a free read (page.tsx's own doc
 * comment); every action here re-checks `requireAdmin()` FIRST, same as
 * every other actions.ts in this codebase (e.g. marketing/campaigns/
 * actions.ts) — a server action is its own reachable POST endpoint
 * regardless of what rendered the button that normally points at it, so the
 * page's own `requireAdminPage()` render gate can't be the only thing
 * standing between a direct/tampered POST and a write.
 *
 * Metering already lives inside discoverCompetitors/refreshTenant/
 * competitorThemes/landscapeSummary (their own modules' contracts: never
 * throw, cap errors resolve to a fail-soft `{ok:false,error}` or a partial
 * result) — this file never calls assertUnderResearchCap/recordResearchSpend
 * or the AI cap equivalents itself, it only calls the already-metered
 * primitives. The `ResearchCapError`/`AiCapError` catches below are
 * unreachable via any path currently in those modules (both fully swallow
 * their own cap errors internally) — kept anyway as an explicit, visible
 * contract matching lib/research/discovery.ts's own `{ok:false,
 * error:"cap_reached"}` shape, so a future change to either module that
 * lets a cap error propagate degrades to a friendly toast instead of a 500.
 */

const RESEARCH_PATH = "/marketing/research";
const RESEARCH_LANDSCAPE_KEY = "research_landscape"; // must match page.tsx's readLandscapeCache()

export type RescanResult = {
  ok: boolean;
  refreshed?: number;
  events?: number;
  error?: string;
  /** True when this call was a no-op because the watchlist was scanned only
   *  moments ago (the debounce below) — distinct from a legitimate
   *  `refreshed: 0` (e.g. an empty watchlist), so the UI can show "already
   *  scanned" rather than a misleading "0 refreshed". */
  skipped?: boolean;
};

/**
 * Rescan now: debounce → refresh (which itself re-discovers + snapshots
 * every tracked competitor) → pre-warm the AI the page reads for free on
 * every render → revalidate.
 *
 * Debounce (the manual-path cost guard T7/T9 flagged): if the most recently
 * refreshed TRACKED competitor was touched within the last ~5 minutes, this
 * is a no-op — `{ok:true, refreshed:0, skipped:true}` — rather than another
 * live Places/AI spend for a click that's almost certainly a double-click or
 * an impatient re-click on a scan still settling.
 *
 * Deliberately calls `refreshTenant()` ALONE, not `discoverCompetitors()`
 * first and then `refreshTenant()`: refreshTenant already performs
 * opportunistic re-discovery as its own first step by design — see that
 * module's doc comment, which names this exact action ("the one call ... an
 * operator's 'Rescan now' action (Task 11) actually makes"). Calling
 * discoverCompetitors() again here would silently double-charge the Places
 * Nearby/Geocoding spend on every single manual rescan.
 */
export async function rescanNowAction(): Promise<RescanResult> {
  await requireAdmin();

  try {
    const tracked = listCompetitors({ trackedOnly: true });
    if (wasRecentlyScanned(mostRecentRefreshAt(tracked), new Date())) {
      return { ok: true, refreshed: 0, events: 0, skipped: true };
    }

    const refreshResult = await refreshTenant();
    if (!refreshResult.ok) {
      return { ok: false, error: refreshResult.error };
    }

    // Pre-warm: per-tracked-competitor themes (cached onto the competitor
    // row) + the landscape summary (cached to the research_landscape KV
    // page.tsx reads for free). Re-queries the watchlist so a competitor
    // discovered by THIS cycle's refresh also gets its themes warmed.
    // competitorThemes/landscapeSummary already never throw internally
    // (lib/research/summary.ts's own contract) — this try/catch is defense
    // in depth only, so a genuinely unexpected failure here (e.g. a KV
    // write error) can never erase an otherwise-successful refresh count.
    try {
      for (const comp of listCompetitors({ trackedOnly: true })) {
        await competitorThemes(comp.id);
      }
      const text = await landscapeSummary();
      setKey(RESEARCH_LANDSCAPE_KEY, { text, at: new Date().toISOString() });
    } catch (err) {
      console.error("[marketing/research actions] AI pre-warm failed (refresh counts still returned):", err);
    }

    revalidatePath(RESEARCH_PATH);
    return { ok: true, refreshed: refreshResult.refreshed, events: refreshResult.events };
  } catch (err) {
    if (err instanceof ResearchCapError || err instanceof AiCapError) {
      return { ok: false, error: "cap_reached" };
    }
    console.error("[marketing/research actions] rescanNowAction failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Competitor curation: pin (`tracked:true`) / mute (`muted:true`). */
export async function setCompetitorFlagsAction(
  id: number,
  flags: { tracked?: boolean; muted?: boolean },
): Promise<{ ok: boolean }> {
  await requireAdmin();
  try {
    setCompetitorFlags(id, flags);
  } catch (err) {
    console.error("[marketing/research actions] setCompetitorFlagsAction failed:", err);
    return { ok: false };
  }
  revalidatePath(RESEARCH_PATH);
  return { ok: true };
}

export async function markResearchEventsSeenAction(ids: number[]): Promise<{ ok: boolean }> {
  await requireAdmin();
  try {
    markEventsSeen(ids);
  } catch (err) {
    console.error("[marketing/research actions] markResearchEventsSeenAction failed:", err);
    return { ok: false };
  }
  revalidatePath(RESEARCH_PATH);
  return { ok: true };
}

/**
 * "Build a campaign from this gap": a free, read-only action (no Google/AI
 * call — see the module doc comment) that turns a competitor's already-
 * CACHED data into a deep link to the Marketing agent's chat, pre-filled via
 * the same seed contract Campaign Engine Slice 3's seasonal calendar already
 * uses (components/marketing/buildCampaignSeed.ts — `CampaignSeed` +
 * `buildCampaignSeedHref`, decoded on the other end by
 * `campaignSeedStarterMessage` in src/app/agents/[key]/page.tsx). The
 * client is expected to navigate to `href` on success; nothing is sent —
 * the compose box just arrives pre-filled, same as every other
 * BuildCampaignLink in the app, and the campaign builder's own
 * write-approval flow governs from there.
 *
 * Looks the competitor up via `listCompetitors({trackedOnly:true})` — the
 * same scope "Build a campaign from this gap" is only ever rendered from
 * (CompetitorDetail, under a trackedOnly row) — rather than the unfiltered
 * list, so a stale client or a direct/tampered POST can't mint a seed for a
 * competitor an admin already muted/untracked.
 */
export async function buildCampaignFromCompetitorAction(
  id: number,
): Promise<{ ok: boolean; href?: string; error?: string }> {
  await requireAdmin();
  try {
    const competitor = listCompetitors({ trackedOnly: true }).find((c) => c.id === id);
    if (!competitor) return { ok: false, error: "not_found" };

    const metric = latestMetric(id);
    const seed = buildCompetitorGapSeed({
      name: competitor.name,
      ratingStars: metric?.ratingMilli != null ? metric.ratingMilli / 1000 : null,
      reviewCount: metric?.reviewCount ?? null,
      themesJson: competitor.themesJson,
    });

    return { ok: true, href: buildCampaignSeedHref(seed) };
  } catch (err) {
    console.error("[marketing/research actions] buildCampaignFromCompetitorAction failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
