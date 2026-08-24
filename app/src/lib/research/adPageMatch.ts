// Pure advertiser-page matcher — the fix for the live bug where the
// competitor "Ads" gallery showed ads that don't belong to the gym at all
// (Fitbit, Garmin, a Taekwon-Do class). Root cause: adLibrary.ts's
// `searchCompetitorAds` queries Meta's Ad Library with `search_terms=<name>`,
// a FULL-TEXT search over ad COPY, not the advertiser — so a gym named
// "…Inspire…" matched every ad whose text happens to contain "Inspire"
// (Fitbit **Inspire** 3, etc.). This module is the filter: given the
// advertiser page name Meta actually returned for one ad (`page_name`) and
// the competitor we searched for, decide whether that ad is plausibly this
// competitor's OWN ad. No I/O, no DB, no network — same "pure decision,
// unit-tested in isolation" shape as changeDetect.ts/adDiff.ts; refresh.ts
// (the only caller) applies this BEFORE diffAds so the stored set, the
// AI ad-angle, and the gallery only ever see ads that passed this gate.
//
// This is a heuristic, not exact identity — Meta's Ad Library doesn't let us
// search by page id directly (search_page_ids requires already knowing the
// page id, which is exactly what this task doesn't have yet: see the module
// doc's "later, separate task" note). A deliberately simple token-overlap
// score over the DISTINCTIVE (non-generic) words in the competitor's name is
// good enough to kill the reported false positives (an unrelated product's
// page shares zero distinctive words with the gym's name) while still
// passing genuine matches through, including reasonable spelling/formatting
// noise ("Inspire Health & Fitness" vs "inspire   health and fitness").

/**
 * Generic, non-distinctive words that show up in lots of unrelated local
 * businesses' names. These must NEVER by themselves make two different
 * businesses "match" — two gyms both being, well, gyms tells you nothing
 * about whether they're the SAME gym. Only words that survive this filter
 * (a business's actual distinctive name, e.g. "Inspire", "Iron", "F45") are
 * allowed to drive a match.
 */
const STOPWORDS = new Set([
  "the",
  "and",
  "of",
  "a",
  "gym",
  "gyms",
  "fitness",
  "health",
  "club",
  "clubs",
  "studio",
  "studios",
  "centre",
  "center",
  "personal",
  "training",
  "trainer",
  "pt",
  "wellness",
  "leisure",
  "sports",
  "sport",
  "ltd",
  "limited",
  "co",
  "company",
]);

/** At least half of the competitor's distinctive tokens must show up on the advertiser's page name — see `adPageMatchesCompetitor`'s doc for why 0.5, not exact equality. */
const MATCH_THRESHOLD = 0.5;

/** lowercase, every non-alphanumeric run -> one space, trim, split -> non-empty tokens. Shared normalization for BOTH names, so casing/punctuation/whitespace differences (Meta's page names are freeform) never affect the comparison. */
function normalizeTokens(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 0);
}

/**
 * True when `pageName` (the advertiser page Meta actually returned for one
 * ad — `AdLite.pageName`) plausibly IS `competitorName` (the gym on the
 * watchlist we searched for).
 *
 * Algorithm:
 *  1. Blank/empty `pageName` is never a match (nothing to compare) — checked
 *     first, so this holds regardless of which branch below would otherwise
 *     run.
 *  2. Normalize both names into token arrays (see `normalizeTokens`), then
 *     strip STOPWORDS from the COMPETITOR's tokens only -> `compDistinct`.
 *     The page's tokens are kept as-is (unfiltered) — the page name is what
 *     we're testing membership AGAINST, stripping it would only make
 *     matching harder for no benefit.
 *  3. `compDistinct` empty (the competitor's name was entirely generic
 *     words, e.g. "The Fitness Studio" — nothing distinctive to score
 *     against) -> fall back to a loose substring check: does the full
 *     normalized competitor string appear inside the full normalized page
 *     string, or vice versa (handles the page name being LONGER, e.g. "...
 *     Clonmel" appended, or shorter/abbreviated).
 *  4. Otherwise, score = (distinctive competitor tokens that appear
 *     anywhere in the page's tokens) / (total distinctive competitor
 *     tokens); match iff score >= 0.5 — i.e. at least half of what makes
 *     this competitor's name distinctive shows up on the advertiser's page.
 *     This is why "Fitbit" scores 0 against "Inspire Health and Fitness"
 *     (its only distinctive token, "inspire", never appears in "fitbit")
 *     while a real page match, even with extra words, easily clears 0.5.
 *
 * Known, accepted trade-off (documented, not a bug): two DIFFERENT
 * same-brand franchise locations (e.g. "F45 Training Cahir" page vs a
 * tracked "F45 Training Clonmel" competitor) can still clear the 0.5 bar,
 * since "f45" alone is half of that competitor's 2 distinctive tokens. A
 * later, separate task adds exact `search_page_ids` matching once a page id
 * is on file (see adLibrary.ts's `AdLite.pageId`, stored now for exactly
 * that); this heuristic's job today is killing the reported unrelated-
 * product false positives, not resolving every multi-location franchise
 * edge case.
 */
export function adPageMatchesCompetitor(pageName: string, competitorName: string): boolean {
  const pageTokens = normalizeTokens(pageName);
  if (pageTokens.length === 0) return false;

  const compTokens = normalizeTokens(competitorName);
  const compDistinct = [...new Set(compTokens.filter((t) => !STOPWORDS.has(t)))];

  if (compDistinct.length === 0) {
    const normPage = pageTokens.join(" ");
    const normComp = compTokens.join(" ");
    if (!normComp) return false;
    return normPage.includes(normComp) || normComp.includes(normPage);
  }

  const pageTokenSet = new Set(pageTokens);
  const overlap = compDistinct.filter((t) => pageTokenSet.has(t)).length;
  return overlap / compDistinct.length >= MATCH_THRESHOLD;
}
