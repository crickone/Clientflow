/**
 * The Build-campaign seed contract (Campaign Engine Slice 3, Task 3): the
 * exact 5 query params any "Build campaign" affordance in the app hands
 * off, plus the two pure helpers that encode (this file) and decode (read
 * by src/app/agents/[key]/page.tsx) them.
 *
 * Campaign creation has no form — /marketing/campaigns/page.tsx's
 * "+ New campaign" (and its empty state) link straight to /agents/marketing,
 * so the ONLY way a campaign gets created is through the Marketing agent's
 * chat. That makes the natural seed destination that chat itself, and the
 * payload a pre-filled compose STARTER (never auto-sent — the operator still
 * reviews/edits/hits send, consistent with the write-approval gate) rather
 * than form field values.
 *
 * Deliberately zero React/Next/DOM imports (unlike its sibling
 * BuildCampaignLink.tsx, which re-exports everything below verbatim so
 * existing consumers — src/app/agents/[key]/page.tsx — don't need to change
 * their import path). That's not just tidiness: the project's test runner
 * (scripts/test.mjs) runs every *.test.ts under plain tsx with
 * `NODE_OPTIONS=--conditions=react-server`, and under that condition
 * `require("react")` resolves to react's react-server export
 * (react.shared-subset.js), which throws by design outside a real RSC
 * bundler — so any module that transitively imports "next/link" or
 * "lucide-react" (both pull in react) crashes the moment a test file
 * imports it, regardless of which export the test actually uses. Same
 * pattern, same reason, as src/components/messaging/campaignProgress.ts
 * (see its header comment) — keeping the pure seed-contract logic here is
 * what makes BuildCampaignLink.test.ts able to load at all.
 */
export interface CampaignSeed {
  seedName?: string;
  season?: string;
  startsOn?: string;
  endsOn?: string;
  angle?: string;
}

/**
 * `/agents/marketing` plus the non-empty fields of `seed`, using the exact 5
 * query param names the seed contract promises. Absent/empty fields are
 * simply omitted (never sent as `foo=`), so a link built from a partial seed
 * (e.g. the coming-up rail only ever supplies seedName/startsOn/angle) stays
 * a clean URL.
 */
export function buildCampaignSeedHref(seed: CampaignSeed): string {
  const qp = new URLSearchParams();
  if (seed.seedName) qp.set("seedName", seed.seedName);
  if (seed.season) qp.set("season", seed.season);
  if (seed.startsOn) qp.set("startsOn", seed.startsOn);
  if (seed.endsOn) qp.set("endsOn", seed.endsOn);
  if (seed.angle) qp.set("angle", seed.angle);
  const qs = qp.toString();
  return `/agents/marketing${qs ? `?${qs}` : ""}`;
}

/**
 * Coerces an arbitrary runtime value to a trimmed string, or "" for anything
 * that isn't a string. Exists because Next.js App Router's `searchParams` is
 * typed `string | string[] | undefined` at runtime (a duplicated query key,
 * e.g. `?seedName=a&seedName=b`, produces an array) even though this file's
 * own `CampaignSeed` declares each field as plain `string | undefined` — the
 * type system can't see that mismatch, only a runtime guard can.
 */
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * The pre-filled chat starter a seed decodes to — read by the Marketing
 * agent's page (src/app/agents/[key]/page.tsx) so a "Build campaign" click
 * lands with the compose box already primed instead of blank. Pure + total:
 * genuinely never throws (every field is coerced through `str()` before use,
 * so a non-string runtime value — e.g. the `string[]` a duplicated query key
 * produces — degrades to "" instead of throwing on a bare `.trim()`), and
 * returns null for an effectively-empty seed (e.g. a bare `/agents/marketing`
 * visit with no query at all) so the caller can leave the compose box
 * untouched — non-breaking when the params are absent.
 */
export function campaignSeedStarterMessage(seed: CampaignSeed): string | null {
  const name = str(seed.seedName);
  const season = str(seed.season);
  const startsOn = str(seed.startsOn);
  const endsOn = str(seed.endsOn);
  const angle = str(seed.angle);
  // endsOn is deliberately NOT part of the emptiness test: it's only ever
  // shown alongside startsOn (never alone), so an endsOn-only seed carries no
  // usable content and should be treated as empty (null) rather than emit a
  // bare "Create a campaign."
  if (!name && !season && !startsOn && !angle) return null;

  const subject = name ? `a "${name}" campaign` : "a campaign";
  let when = "";
  if (startsOn && endsOn && endsOn !== startsOn) {
    when = ` for ${season ? `${season} ` : ""}(${startsOn}–${endsOn})`;
  } else if (startsOn) {
    when = ` around ${startsOn}${season ? ` (${season})` : ""}`;
  } else if (season) {
    when = ` for ${season}`;
  }
  const anglePart = angle ? ` Angle: ${angle}.` : "";
  return `Create ${subject}${when}.${anglePart}`;
}
