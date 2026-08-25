import type { ReactNode } from "react";
import Link from "next/link";
import { Wand2 } from "lucide-react";

import { buildCampaignSeedHref, type CampaignSeed } from "./buildCampaignSeed";

/**
 * The seed contract (the `CampaignSeed` type + `buildCampaignSeedHref` +
 * `campaignSeedStarterMessage`) now lives in the zero-import sibling
 * `./buildCampaignSeed` — see that file's header comment for why (in short:
 * it needs to load under the plain-tsx test runner, which this file's
 * `next/link`/`lucide-react` imports can't). Re-exported here verbatim so
 * every existing consumer — notably src/app/agents/[key]/page.tsx's
 * `import { campaignSeedStarterMessage } from "@/components/marketing/BuildCampaignLink"`
 * — keeps working unchanged.
 */
export type { CampaignSeed } from "./buildCampaignSeed";
export { buildCampaignSeedHref, campaignSeedStarterMessage } from "./buildCampaignSeed";

/**
 * The seed-carrying CTA — a plain link (no client JS needed) to Adonis's
 * chat, pre-loaded with a suggested campaign. Renders wherever a suggested
 * campaign appears in SeasonalCalendar.tsx: the coming-up radar rail, an
 * unbuilt catalog date, and an empty month.
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
