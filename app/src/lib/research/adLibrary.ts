import "server-only";

/**
 * Meta Ad Library (`ads_archive`) client — Task 1 of Market Research P2
 * (competitor ads). This is the FOUNDATION file every later P2 task builds
 * on, same role places.ts played for P1. Mirrors places.ts's house style
 * exactly: raw `fetch`, no SDK, one small self-contained file — its own
 * `errorMessage`/`prop` copies rather than importing places.ts's (neither
 * is exported there anyway), same reasoning as mailgun.ts and falClient.ts
 * each keeping their own: a future provider swap or API-version bump never
 * has to fight a shared abstraction.
 *
 * Fail-soft by design: `adLibraryConfigured()` gates on META_AD_LIBRARY_TOKEN
 * alone, and `searchCompetitorAds` checks it FIRST — before any `fetch` — so
 * an unconfigured deployment returns `{ok:false,error:"not_configured"}`
 * synchronously-fast and never touches the network (see the "missing token"
 * tests in adLibrary.test.ts, which assert zero fetch calls). Everything
 * past that gate is wrapped in try/catch, so a network error, a non-2xx
 * response, or a malformed body all become a typed `{ok:false,error}` too —
 * this module NEVER throws. No retries here, deliberately (per the brief) —
 * a 429 comes back as an ordinary `{ok:false}` for the CALLER to decide
 * whether/how to retry.
 *
 * EU scoping is what makes this endpoint return commercial ads at all: per
 * Meta's DSA-driven Ad Library rules, `ad_type=ALL` (as opposed to the
 * default `POLITICAL_AND_ISSUE_ADS`) only returns non-political/commercial
 * ads once `ad_reached_countries` includes an EU/EEA country — hence "IE" is
 * the hardcoded default (not a global, country-less search). Per Meta's own
 * convention for array-shaped query params on this endpoint,
 * `ad_reached_countries` is a JSON array string (e.g. `["IE"]`), so it's
 * `JSON.stringify`'d then percent-encoded, not sent as a comma list.
 *
 * Error-shape handling deliberately reads DIFFERENTLY than places.ts's
 * res.ok-first checks: Meta can return `{error:{message,...}}` on a 200
 * OR a non-2xx (Google's Geocoding API, by contrast, only ever signals
 * failure via its top-level `status` field on a 200). Response bodies can
 * only be read once, so `readBody` reads the raw text a single time and
 * best-effort JSON.parses it; the caller then checks for a Meta `error`
 * object FIRST (regardless of status), falling back to a plain non-2xx
 * check — exactly the precedence the brief specifies.
 *
 * `imageUrl` is part of the AdLite contract (later tasks depend on it
 * verbatim) but is never populated by this task: the `fields` mask below
 * matches the brief's list exactly, and none of those fields is a raw
 * creative-image URL — Meta's ads_archive doesn't expose one directly, only
 * `ad_snapshot_url` (a Meta-hosted rendered page of the ad, not an image
 * asset). The field stays optional/always-undefined here so a later task
 * (e.g. snapshot scraping) can populate it without a breaking type change.
 * Paging is ignored for v1 — 25 results is plenty per competitor.
 */

const AD_LIBRARY_ENDPOINT = "https://graph.facebook.com/v21.0/ads_archive";

const NOT_CONFIGURED_ERROR = "not_configured";

/** EU/EEA scope default — see the module doc's "EU scoping" note for why this is required, not cosmetic. */
const DEFAULT_COUNTRY = "IE";

/** Meta's own hard ceiling isn't this low, but 25 is plenty per competitor for v1 — see the module doc. */
const RESULT_LIMIT = 25;

/** Exactly the field list the brief specifies — see the module doc's `imageUrl` note for why no image field is in here. */
const AD_FIELDS =
  "id,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,ad_delivery_start_time,ad_delivery_stop_time,publisher_platforms,ad_snapshot_url";

export function adLibraryConfigured(): boolean {
  return !!process.env.META_AD_LIBRARY_TOKEN;
}

/** Mirrors adLibraryConfigured()'s exact truthiness check, so the two can never disagree (one saying "configured" while the other refuses). */
function apiToken(): string | null {
  const token = process.env.META_AD_LIBRARY_TOKEN;
  return token ? token : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- tiny unknown-payload guard (no `any`) — mirrors places.ts/mailgun.ts's prop() ---
function prop(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

/**
 * Reads a Response body exactly ONCE as text (a body can only be consumed
 * once — calling `.json()` then `.text()` on the same Response throws), then
 * best-effort JSON.parses it. Never throws: a non-JSON body (e.g. an
 * upstream gateway's HTML error page) just leaves `data` as `{}`, and the
 * raw `text` is still available for the non-2xx fallback error message.
 */
async function readBody(res: Response): Promise<{ text: string; data: Record<string, unknown> }> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    // leave text as "" — still never throws
  }
  let data: Record<string, unknown> = {};
  try {
    if (text) data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // non-JSON body -- data stays {}
  }
  return { text, data };
}

export type AdLite = {
  adId: string;
  bodies: string[]; // ad copy lines (ad_creative_bodies)
  linkTitle?: string; // ad_creative_link_titles[0]
  linkCaption?: string; // ad_creative_link_captions[0]
  platforms: string[]; // publisher_platforms e.g. ["facebook","instagram"]
  snapshotUrl: string; // ad_snapshot_url (Meta-hosted render of the ad)
  startedAt?: string; // ad_delivery_start_time (ISO)
  stoppedAt?: string; // ad_delivery_stop_time (ISO; absent/future => active)
  imageUrl?: string; // only if a usable creative image URL is present (often absent)
};

/**
 * Maps one ads_archive `data[]` entry to AdLite. Requires `id` +
 * `ad_snapshot_url` to be usable at all (an entry missing either is dropped
 * rather than fabricated — mirrors mapPlaceLite's per-entry defensive
 * mapping in places.ts, so one malformed entry never fails the whole
 * search). Every other field is genuinely optional on Meta's side and
 * tolerated absent: bodies/platforms default to `[]`; link title/caption
 * take the first array element (Meta returns these as per-creative-variant
 * arrays; v1 only surfaces the first); started/stoppedAt pass through
 * Meta's ISO strings verbatim, left undefined when absent (an absent or
 * future stoppedAt means the ad is still active — left for the CALLER to
 * interpret, not encoded here). `imageUrl` is never set — see the module
 * doc.
 */
function mapAdLite(raw: unknown): AdLite | null {
  const adId = prop(raw, "id");
  const snapshotUrl = prop(raw, "ad_snapshot_url");
  if (typeof adId !== "string" || typeof snapshotUrl !== "string") return null;

  const rawBodies = prop(raw, "ad_creative_bodies");
  const bodies = Array.isArray(rawBodies) ? rawBodies.filter((b): b is string => typeof b === "string") : [];

  const rawPlatforms = prop(raw, "publisher_platforms");
  const platforms = Array.isArray(rawPlatforms) ? rawPlatforms.filter((p): p is string => typeof p === "string") : [];

  const ad: AdLite = { adId, bodies, platforms, snapshotUrl };

  const rawTitles = prop(raw, "ad_creative_link_titles");
  const linkTitle = Array.isArray(rawTitles) ? rawTitles[0] : undefined;
  if (typeof linkTitle === "string") ad.linkTitle = linkTitle;

  const rawCaptions = prop(raw, "ad_creative_link_captions");
  const linkCaption = Array.isArray(rawCaptions) ? rawCaptions[0] : undefined;
  if (typeof linkCaption === "string") ad.linkCaption = linkCaption;

  const startedAt = prop(raw, "ad_delivery_start_time");
  if (typeof startedAt === "string") ad.startedAt = startedAt;

  const stoppedAt = prop(raw, "ad_delivery_stop_time");
  if (typeof stoppedAt === "string") ad.stoppedAt = stoppedAt;

  return ad;
}

export async function searchCompetitorAds(
  name: string,
  country?: string,
): Promise<{ ok: true; ads: AdLite[] } | { ok: false; error: string }> {
  const token = apiToken();
  if (!token) return { ok: false, error: NOT_CONFIGURED_ERROR };
  try {
    const reachedCountries = JSON.stringify([country || DEFAULT_COUNTRY]);
    const url =
      `${AD_LIBRARY_ENDPOINT}?` +
      [
        `ad_type=ALL`,
        `ad_reached_countries=${encodeURIComponent(reachedCountries)}`,
        `search_terms=${encodeURIComponent(name)}`,
        `fields=${encodeURIComponent(AD_FIELDS)}`,
        `limit=${RESULT_LIMIT}`,
        `access_token=${encodeURIComponent(token)}`,
      ].join("&");

    const res = await fetch(url);
    const { text, data } = await readBody(res);

    // Meta signals failure via an `error` object that can ride on a 200 OR a
    // non-2xx — check its presence FIRST, regardless of status (see the
    // module doc's "Error-shape handling" note).
    const errorObj = prop(data, "error");
    if (errorObj) {
      const message = prop(errorObj, "message");
      return { ok: false, error: typeof message === "string" && message ? message : `HTTP ${res.status}` };
    }
    if (!res.ok) {
      const detail = (text.trim() || res.statusText || `HTTP ${res.status}`).slice(0, 500);
      return { ok: false, error: `searchCompetitorAds failed (${res.status}): ${detail}` };
    }

    const rawAds = Array.isArray(data.data) ? data.data : [];
    const ads: AdLite[] = [];
    for (const raw of rawAds) {
      const mapped = mapAdLite(raw);
      if (mapped) ads.push(mapped);
    }
    return { ok: true, ads };
  } catch (err) {
    return { ok: false, error: `searchCompetitorAds failed: ${errorMessage(err)}` };
  }
}
