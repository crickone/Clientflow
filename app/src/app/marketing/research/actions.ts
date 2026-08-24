"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { buildCampaignSeedHref } from "@/components/marketing/buildCampaignSeed";
import { buildCompetitorGapSeed } from "@/lib/research/campaignGap";
import { mostRecentRefreshAt, wasRecentlyScanned } from "@/lib/research/debounce";
import { refreshTenant } from "@/lib/research/refresh";
import { competitorThemes, landscapeSummary, adAngle } from "@/lib/research/summary";
import { adLibraryConfigured } from "@/lib/research/adLibrary";
import {
  clearCompetitorFacebookPage,
  latestMetric,
  listCompetitors,
  markEventsSeen,
  setCompetitorFacebookPage,
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
 * competitorThemes/landscapeSummary/adAngle (their own modules' contracts:
 * never throw, cap errors resolve to a fail-soft `{ok:false,error}` or a
 * partial result) — this file never calls assertUnderResearchCap/
 * recordResearchSpend or the AI cap equivalents itself, it only calls the
 * already-metered primitives. The `ResearchCapError`/`AiCapError` catches
 * below are unreachable via any path currently in those modules (both fully
 * swallow their own cap errors internally) — kept anyway as an explicit,
 * visible contract matching lib/research/discovery.ts's own `{ok:false,
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
 *
 * Market Research P2, Task 7: the pre-warm loop below also warms each
 * competitor's cached AI ad-angle (`adAngle`, Task 5) alongside its themes —
 * gated on `adLibraryConfigured()` so an unconfigured deployment (no
 * META_AD_LIBRARY_TOKEN) skips the ad-angle work entirely rather than call
 * `adAngle` for every competitor just to have it re-discover there's nothing
 * to read (refreshTenant's own ad-fetch step, above, already no-ops the same
 * way — see refresh.ts — so every competitor genuinely has zero stored ads
 * in that case). `adAngle` itself is already metered + never-throws +
 * short-circuits to "No active ads found." with no model call when a
 * competitor has none, so this gate is a courtesy skip, not a safety one.
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

    // Pre-warm: per-tracked-competitor themes + ad-angle (both cached onto
    // the competitor row) + the landscape summary (cached to the
    // research_landscape KV page.tsx reads for free). Re-queries the
    // watchlist so a competitor discovered by THIS cycle's refresh also gets
    // warmed. competitorThemes/adAngle/landscapeSummary already never throw
    // internally (lib/research/summary.ts's own contract) — this try/catch
    // is defense in depth only, so a genuinely unexpected failure here (e.g.
    // a KV write error) can never erase an otherwise-successful refresh
    // count.
    try {
      // excludeSelf (P1.1): themes/ad-angle are never displayed for the
      // tenant's own gym (it doesn't render as a competitor row at all — see
      // ResearchView), so warming them would just be a wasted metered call.
      // warmAdAngle (P2 T7): only attempt the ad-angle read when the Ad
      // Library is actually configured — see this function's own doc
      // comment above.
      const warmAdAngle = adLibraryConfigured();
      for (const comp of listCompetitors({ trackedOnly: true, excludeSelf: true })) {
        await competitorThemes(comp.id);
        if (warmAdAngle) await adAngle(comp.id);
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

/** competitor ids are DB autoincrement rows (>=1) — `Number.isInteger` alone still accepts 0/negatives. */
function isPositiveInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

/**
 * Exact Page-ID ad matching, Task 2: pin a competitor to a specific Meta
 * Page. The intended (and only) caller is an admin clicking "these are
 * theirs" on an ad card in CompetitorDetail — `pageId`/`pageName` come
 * straight off that ad's own `StoredAd.pageId`/`pageName` (Task 1's store),
 * never typed in by hand. Once linked, refresh.ts's ad-fetch step switches
 * THIS competitor from the search_terms + adPageMatchesCompetitor
 * name-filter path to searchCompetitorAdsByPageId (search_page_ids) —
 * exact, no name-text matching — see store.ts's module doc for the full
 * contract.
 *
 * Validates competitorId/pageId shape here rather than trusting the caller:
 * a Server Action is its own reachable POST regardless of what rendered the
 * button that normally calls it (this file's own top doc comment), so a
 * malformed id or a blank pageId must never reach setCompetitorFacebookPage
 * — that would "link" a competitor to an empty page id and silently break
 * the exact-match fetch refresh.ts performs off it. Both strings are
 * trimmed before storage: facebookPageId is later sent verbatim as Meta's
 * search_page_ids parameter, so stray whitespace would break the exact
 * match this whole feature exists to provide. `typeof` guards (rather than
 * trusting the TS parameter types) cover a crafted/malformed POST body the
 * same way — TS types give no runtime protection against a direct call.
 */
export async function linkCompetitorPageAction(
  competitorId: number,
  pageId: string,
  pageName: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (!isPositiveInt(competitorId)) return { ok: false, error: "invalid_competitor" };
  const trimmedPageId = typeof pageId === "string" ? pageId.trim() : "";
  if (!trimmedPageId) return { ok: false, error: "invalid_page" };
  try {
    setCompetitorFacebookPage(competitorId, trimmedPageId, typeof pageName === "string" ? pageName.trim() : "");
  } catch (err) {
    console.error("[marketing/research actions] linkCompetitorPageAction failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath(RESEARCH_PATH);
  return { ok: true };
}

/**
 * Undoes linkCompetitorPageAction — reverts this competitor to the
 * search_terms + adPageMatchesCompetitor filtered path (CompetitorDetail's
 * admin-only "Unlink" button, shown once a competitor is linked).
 */
export async function unlinkCompetitorPageAction(competitorId: number): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  if (!isPositiveInt(competitorId)) return { ok: false, error: "invalid_competitor" };
  try {
    clearCompetitorFacebookPage(competitorId);
  } catch (err) {
    console.error("[marketing/research actions] unlinkCompetitorPageAction failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
 * Looks the competitor up via `listCompetitors({trackedOnly:true,
 * excludeSelf:true})` — the same scope "Build a campaign from this gap" is
 * only ever rendered from (CompetitorDetail, under a trackedOnly,
 * non-self row — the tenant's own gym never renders as a competitor row at
 * all, see ResearchView) — rather than the unfiltered list, so a stale
 * client or a direct/tampered POST can't mint a seed for a competitor an
 * admin already muted/untracked, or for the tenant's own business.
 *
 * Market Research P2, Task 7: also passes the competitor's cached
 * `adAngleJson` through to `buildCompetitorGapSeed`, which folds it into the
 * seed's `angle` as a counter-the-ads clause WHEN present (parsed via
 * lib/research/adAngleJson.ts's `parseStoredAdAngle`) — same no-fabrication
 * house rule as the rating/review/theme facts already there: a competitor
 * with no cached ad angle yet (or an Ad Library not configured at all) still
 * gets a seed, just without that clause, never a fabricated one.
 */
export async function buildCampaignFromCompetitorAction(
  id: number,
): Promise<{ ok: boolean; href?: string; error?: string }> {
  await requireAdmin();
  try {
    const competitor = listCompetitors({ trackedOnly: true, excludeSelf: true }).find((c) => c.id === id);
    if (!competitor) return { ok: false, error: "not_found" };

    const metric = latestMetric(id);
    const seed = buildCompetitorGapSeed({
      name: competitor.name,
      ratingStars: metric?.ratingMilli != null ? metric.ratingMilli / 1000 : null,
      reviewCount: metric?.reviewCount ?? null,
      themesJson: competitor.themesJson,
      adAngleJson: competitor.adAngleJson,
    });

    return { ok: true, href: buildCampaignSeedHref(seed) };
  } catch (err) {
    console.error("[marketing/research actions] buildCampaignFromCompetitorAction failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
