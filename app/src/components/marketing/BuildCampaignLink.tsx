import type { ReactNode } from "react";
import Link from "next/link";
import { Wand2 } from "lucide-react";

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
 * The pre-filled chat starter a seed decodes to — read by the Marketing
 * agent's page (src/app/agents/[key]/page.tsx) so a "Build campaign" click
 * lands with the compose box already primed instead of blank. Pure + total:
 * never throws, and returns null for an effectively-empty seed (e.g. a bare
 * `/agents/marketing` visit with no query at all) so the caller can leave
 * the compose box untouched — non-breaking when the params are absent.
 */
export function campaignSeedStarterMessage(seed: CampaignSeed): string | null {
  const name = seed.seedName?.trim();
  const season = seed.season?.trim();
  const startsOn = seed.startsOn?.trim();
  const endsOn = seed.endsOn?.trim();
  const angle = seed.angle?.trim();
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

/**
 * The seed-carrying CTA — a plain link (no client JS needed) to the
 * Marketing agent chat, pre-loaded with a suggested campaign. Renders
 * wherever a suggested campaign appears in SeasonalCalendar.tsx: the
 * coming-up radar rail, an unbuilt catalog date, and an empty month.
 *
 * `iconOnly` renders just the icon (for dense per-date rows where a full
 * label would clutter the cell) with the label moved to `title`/`aria-label`
 * instead.
 */
export function BuildCampaignLink({
  seedName,
  season,
  startsOn,
  endsOn,
  angle,
  compact = false,
  iconOnly = false,
  children,
}: CampaignSeed & { compact?: boolean; iconOnly?: boolean; children?: ReactNode }) {
  const href = buildCampaignSeedHref({ seedName, season, startsOn, endsOn, angle });
  const label = children ?? "Build campaign";
  const a11yLabel = seedName ? `Build campaign: ${seedName}` : typeof label === "string" ? label : "Build campaign";
  return (
    <Link
      href={href}
      title={iconOnly ? a11yLabel : undefined}
      aria-label={iconOnly ? a11yLabel : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: iconOnly ? 0 : 6,
        fontSize: compact ? 11.5 : 12.5,
        fontWeight: 600,
        color: "var(--accent-ink)",
        background: "var(--accent-soft)",
        border: "1px solid var(--accent)",
        borderRadius: iconOnly ? 999 : "var(--radius)",
        padding: iconOnly ? 4 : compact ? "4px 9px" : "7px 14px",
        textDecoration: "none",
        whiteSpace: "nowrap",
        flexShrink: 0,
        lineHeight: 0,
      }}
    >
      <Wand2 size={iconOnly ? 11 : compact ? 12 : 13} strokeWidth={2} />
      {!iconOnly && <span style={{ lineHeight: 1.4 }}>{label}</span>}
    </Link>
  );
}
