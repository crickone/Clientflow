"use client";

import { EyeOff, Key, Megaphone, Pin, Play, Star, Unlink } from "lucide-react";

import type { HydratedCompetitor, Metric, StoredAd } from "@/lib/research/store";
import { parseStoredAdAngle } from "@/lib/research/adAngleJson";
import { parseStoredThemes } from "@/lib/research/themesJson";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CardLabel } from "@/components/ui/Card";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { formatDate } from "@/lib/utils";
import { Sparkline } from "./Sparkline";

/**
 * The inline expand panel under a ranked row — Market Research P1, Task 10
 * (view) + Task 11 (the mute button + real onBuildCampaign handler
 * ResearchView now passes down); Market Research P2, Task 6 added
 * the "Ads" section below the reviews/themes grid. Renders ONLY from what
 * the parent (ResearchView, in turn fed by page.tsx) already has in hand:
 * this competitor's metric history, cached review sample, cached AI themes,
 * and its stored ads (`listAds`, ALL of them — active and stopped — see the
 * Ads section below) + cached AI ad-angle.
 * No fetch, no AI call, no Google/Meta call — every callback prop here is a
 * plain, synchronous-looking function; ResearchView owns the actual Server
 * Action calls behind them.
 */

interface Props {
  /** This competitor bundled with its metric history, review sample, and
   *  stored ads — `hydrateCompetitors()` (lib/research/store.ts), the same
   *  bundle ResearchView iterates to hand down to each expanded row.
   *  Replaces the four separate `competitor`/`history`/`reviews`/`ads` props
   *  this component used to take:
   *   - `history`: this competitor's `metricHistory(id)`, newest-first.
   *   - `reviews`: this competitor's `getReviews(id)`, Google's own relevance order.
   *   - `ads`: this competitor's stored ads (`listAds(id)`, Market Research P2
   *     Task 6) — ALL rows, active and stopped, newest-started-first per the
   *     store's own contract; the Ads section below decides how to present
   *     each. Empty when this competitor has none tracked (or the Ad Library
   *     was never configured — see `adLibraryConfigured`, which
   *     disambiguates the two for the empty-state copy). */
  data: HydratedCompetitor;
  /** `adLibraryConfigured()` (lib/research/adLibrary.ts), read server-side
   *  in page.tsx — true once META_AD_LIBRARY_TOKEN is set. Governs which
   *  empty-ads message the Ads section shows: "no ads found" (configured,
   *  genuinely none) vs. a quiet "connect the Ad Library" nudge
   *  (unconfigured) — never an error either way. */
  adLibraryConfigured: boolean;
  /** `getCurrentMembership()?.role === "admin"` (page.tsx) — gates the
   *  Link/Unlink controls in the Ads section below. The page this component
   *  is always mounted from is already `requireAdminPage()`-gated, so this
   *  is always true in practice; the prop makes that gate explicit at the
   *  component that actually renders the write controls (see ResearchView's
   *  doc comment) — the two Server Actions behind them ALSO `requireAdmin()`
   *  themselves, so this is defence in depth, not the only thing standing
   *  between a non-admin and a write. */
  isAdmin: boolean;
  onBuildCampaign?: (competitorId: number) => void;
  /** T11: curation (`setCompetitorFlagsAction(id,{muted:true})` upstream) —
   *  stop tracking this competitor. No confirmation UI to un-mute exists yet
   *  (P1.5), so this component confirms before firing it — see the button. */
  onMute?: (competitorId: number) => void;
  /** Exact Page-ID ad matching, Task 2 — pins this competitor to a specific
   *  Meta Page (`linkCompetitorPageAction` upstream). Called from an
   *  individual `AdCard`'s "these are theirs" button with THAT ad's own
   *  pageId/pageName, only rendered when `isAdmin` and the competitor isn't
   *  already linked (see the Ads section below). */
  onLinkPage?: (competitorId: number, pageId: string, pageName: string) => void;
  /** Undoes onLinkPage (`unlinkCompetitorPageAction` upstream) — shown next
   *  to the "showing only X's ads" header once a competitor is linked. */
  onUnlinkPage?: (competitorId: number) => void;
  /** True while ResearchView's shared curation transition is in flight (a
   *  mark-seen / mute / build-campaign / link / unlink click anywhere on the
   *  page) — disables the buttons below so a double-click can't fire
   *  `onMute` (no undo yet), `onBuildCampaign`, `onLinkPage`, or
   *  `onUnlinkPage` twice. */
  pending?: boolean;
}

const MAX_REVIEWS_SHOWN = 5;
// A "gallery" reads as compact, not a wall — mirrors MAX_REVIEWS_SHOWN's
// role above (both cap what's otherwise an unbounded-over-time store read;
// `ads` can keep accumulating stopped rows long after MAX_ADS_FOR_ANGLE
// (summary.ts) stopped feeding the model any of them).
const MAX_ADS_SHOWN = 6;

/** Meta's `publisher_platforms` values are lowercase, underscore-separated
 *  machine names (adLibrary.ts's AdLite.platforms, e.g. "facebook",
 *  "audience_network") — map the ones Meta actually returns to a readable
 *  label; an unrecognised value (a future platform Meta adds) still renders
 *  sensibly via a plain capitalised fallback rather than showing the raw
 *  machine name verbatim. */
const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  audience_network: "Audience Network",
  messenger: "Messenger",
  whatsapp: "WhatsApp",
};

function formatPlatform(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1).replace(/_/g, " ");
}

/** The card's primary copy: bodies joined (an ad can carry multiple creative
 *  variants — see adLibrary.ts's AdLite doc comment), falling back to the
 *  link title/caption Meta returned when there's no body text at all, and
 *  finally a plain placeholder for the rare row with neither — never blank. */
function adCopyText(ad: StoredAd): string {
  const body = ad.bodies.filter((b) => b.trim().length > 0).join("\n\n");
  if (body) return body;
  if (ad.linkTitle) return ad.linkTitle;
  if (ad.linkCaption) return ad.linkCaption;
  return "No ad copy captured for this ad.";
}

/** formatDate, but null (not the literal "Invalid Date") when the string
 *  doesn't parse — so adRunDates degrades to "unknown"/"active" rather than
 *  surfacing a broken date if Meta ever hands back a non-ISO value. */
function safeFormatDate(iso: string): string | null {
  return Number.isNaN(new Date(iso).getTime()) ? null : formatDate(iso);
}

/** "12 Jan 2026 → 3 Feb 2026" once stopped, "12 Jan 2026 → active" while
 *  running — degrades sensibly when Meta didn't supply (or supplied a bad)
 *  date on one side or the other rather than fabricating one. */
function adRunDates(ad: StoredAd): string {
  const start = ad.startedAt ? safeFormatDate(ad.startedAt) : null;
  const end = ad.stoppedAt ? safeFormatDate(ad.stoppedAt) : null;
  if (start) return `${start} → ${end ?? "active"}`;
  return end ? `Stopped ${end}` : "Run dates unknown";
}

/** One compact card in the Ads gallery below. A stopped ad (still shown —
 *  `ads` is the competitor's full set, not just active ones) dims slightly
 *  rather than disappearing or getting a second "stopped" label — its run
 *  dates already say so.
 *
 *  Exact Page-ID ad matching, Task 2: when this competitor ISN'T linked yet
 *  (`linked` false), an admin with a non-empty `ad.pageId` gets a "these are
 *  theirs" button that pins the competitor to THIS ad's own page — the
 *  mechanism for resolving an ambiguous/franchise name match (several cards
 *  can carry different pageIds; the admin picks the right one). Hidden once
 *  linked (`linked` true) — the ad set shown at that point is already the
 *  exact, unfiltered set for the linked page, so there's nothing left to
 *  disambiguate — and hidden entirely for non-admins. */
function AdCard({
  ad,
  competitorName,
  competitorId,
  linked,
  isAdmin,
  pending,
  onLinkPage,
}: {
  ad: StoredAd;
  competitorName: string;
  competitorId: number;
  linked: boolean;
  isAdmin: boolean;
  pending: boolean;
  onLinkPage?: (competitorId: number, pageId: string, pageName: string) => void;
}) {
  const canLink = isAdmin && !linked && !!ad.pageId;
  return (
    <div className="mres-ad-card" style={{ opacity: ad.active ? 1 : 0.65 }}>
      {ad.imageUrl && <img src={ad.imageUrl} alt={`${competitorName} ad creative`} className="mres-ad-thumb" />}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {ad.platforms.length > 0 ? (
          ad.platforms.map((p) => (
            <Badge key={p} tone="neutral">
              {formatPlatform(p)}
            </Badge>
          ))
        ) : (
          <Badge tone="neutral">Meta</Badge>
        )}
      </div>
      {/* The advertiser page Meta actually attributed this ad to
          (adLibrary.ts's AdLite.pageName, threaded through
          refresh.ts's adPageMatchesCompetitor filter before this ad was
          ever stored) — shown so the operator can verify at a glance that
          this really is the competitor's own ad, not a false-positive
          text match. Only rendered when non-empty: a pre-existing row from
          before the page_name column existed reads back as "" (see
          store.ts's toStoredAd) and just shows no byline rather than "by ". */}
      {ad.pageName && <p className="mres-ad-advertiser">by {ad.pageName}</p>}
      <p className="mres-ad-copy">{adCopyText(ad)}</p>
      <div className="mres-ad-footer">
        <span
          style={{
            fontSize: 10.5,
            color: "var(--text-tertiary)",
            fontFamily: "var(--font-mono), ui-monospace, monospace",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {adRunDates(ad)}
        </span>
        <div className="mres-ad-actions">
          {canLink && (
            <Tooltip label={`Pin ${competitorName} to this Facebook Page — future scans fetch only ${ad.pageName || "this page"}'s ads, no name matching`}>
              <button
                type="button"
                className="mres-ad-link-btn"
                disabled={pending}
                onClick={() => onLinkPage?.(competitorId, ad.pageId, ad.pageName)}
              >
                <Pin size={11} /> These are theirs
              </button>
            </Tooltip>
          )}
          <Tooltip label="Opens Meta's Ad Library, where the ad's full creative (image or video) plays">
            <a href={ad.snapshotUrl} target="_blank" rel="noreferrer" className="mres-ad-watch">
              <Play size={11} fill="currentColor" /> Watch on Meta
            </a>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

export function CompetitorDetail({
  data,
  adLibraryConfigured,
  isAdmin,
  onBuildCampaign,
  onMute,
  onLinkPage,
  onUnlinkPage,
  pending = false,
}: Props) {
  const confirm = useConfirm();
  // This competitor bundled with its metric history, review sample, and
  // stored ads (hydrateCompetitors, lib/research/store.ts) — destructured
  // once here so the rest of this component reads exactly as it did with
  // four separate props; see the `data` prop's own doc comment above for
  // each field's contract.
  const { competitor, history, reviews, ads } = data;
  // Parsing lives in the shared, zero-import lib/research/themesJson.ts (T11)
  // rather than a local copy: lib/research/campaignGap.ts (the "Build a
  // campaign from this gap" seed builder) now needs the identical parse, and
  // this component itself can never import lib/research/summary.ts (the
  // writer of this JSON shape) — that module is `server-only`, so a CLIENT
  // component reading its cache back out needs a shared, framework-free home.
  const parsedThemes = parseStoredThemes(competitor.themesJson);
  // Same reasoning, one column pair over — lib/research/adAngleJson.ts (T6).
  const parsedAdAngle = parseStoredAdAngle(competitor.adAngleJson);
  // history[0] is the same capture latestMetric() would return (see
  // CompetitorRow's computeTrend comment) — "current" for this panel's chart caption.
  const latest = history[0] ?? null;
  const ratedChronological = history
    .filter((m): m is Metric & { ratingMilli: number } => m.ratingMilli != null)
    .slice()
    .reverse();

  return (
    <div className="mres-detail">
      <div className="mres-detail-grid">
        <div>
          <CardLabel style={{ marginTop: 0 }}>Rating trend</CardLabel>
          <div className="mres-chart-box">
            <Sparkline
              history={history}
              responsive
              width={400}
              height={92}
              color="var(--accent)"
              strokeWidth={2}
              showArea
              showEndDot
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginTop: 10,
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  fontFamily: "var(--font-mono), ui-monospace, monospace",
                }}
              >
                {ratedChronological.length >= 2
                  ? `${formatDate(ratedChronological[0].capturedAt)} – ${formatDate(ratedChronological[ratedChronological.length - 1].capturedAt)}`
                  : "No ratings captured yet — check back after the next scan."}
              </span>
              {latest?.ratingMilli != null && (
                <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>
                  <Star size={12} fill="currentColor" style={{ display: "inline", verticalAlign: -1, marginRight: 3 }} />
                  {(latest.ratingMilli / 1000).toFixed(1)} now
                </span>
              )}
            </div>
          </div>

          <CardLabel style={{ marginTop: 20 }}>Themes from reviews</CardLabel>
          {parsedThemes ? (
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
              {parsedThemes.themes.map((t, i) => (
                <li key={i} style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  {t}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: 0 }}>Themes generate on your next scan.</p>
          )}
        </div>

        <div>
          <CardLabel style={{ marginTop: 0 }}>Recent reviews</CardLabel>
          {reviews.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: 0 }}>No reviews captured yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {reviews.slice(0, MAX_REVIEWS_SHOWN).map((r) => (
                <div key={r.externalReviewId} className="mres-review">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" }}>
                      {r.author || "Anonymous"}
                    </span>
                    {r.ratingMilli != null && (
                      <Badge tone="neutral" style={{ flexShrink: 0 }}>
                        <Star size={10} fill="currentColor" />
                        {(r.ratingMilli / 1000).toFixed(1)}
                      </Badge>
                    )}
                  </div>
                  <p
                    style={{
                      fontSize: 12.5,
                      color: "var(--text-secondary)",
                      lineHeight: 1.5,
                      margin: 0,
                      wordBreak: "break-word",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {r.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <CardLabel style={{ marginTop: 0 }}>Ads</CardLabel>
        {ads.length > 0 ? (
          <>
            <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55, margin: "0 0 14px" }}>
              {parsedAdAngle ? parsedAdAngle.angle : "Their ad angle appears after the next scan."}
            </p>
            {/* Exact Page-ID ad matching, Task 2: once linked, `ads` above is
                already the exact, unfiltered search_page_ids set (Task 1) —
                this header just makes that explicit, with an admin-only way
                to undo it. No per-card link button renders in this branch
                (see AdCard's `linked` prop). */}
            {competitor.facebookPageName && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    fontSize: 11.5,
                    color: "var(--text-tertiary)",
                    fontFamily: "var(--font-mono), ui-monospace, monospace",
                  }}
                >
                  {`Showing only ${competitor.facebookPageName}'s ads`}
                </span>
                {isAdmin && (
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => onUnlinkPage?.(competitor.id)}>
                    <Unlink size={12} /> Unlink
                  </Button>
                )}
              </div>
            )}
            <div className="mres-ad-grid">
              {ads.slice(0, MAX_ADS_SHOWN).map((ad) => (
                <AdCard
                  key={ad.id}
                  ad={ad}
                  competitorName={competitor.name}
                  competitorId={competitor.id}
                  linked={!!competitor.facebookPageName}
                  isAdmin={isAdmin}
                  pending={pending}
                  onLinkPage={onLinkPage}
                />
              ))}
            </div>
          </>
        ) : adLibraryConfigured ? (
          <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: 0 }}>No active ads found for this competitor.</p>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <Key size={13} color="var(--text-tertiary)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
            <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.5 }}>
              Connect the Meta Ad Library (<code style={{ fontFamily: "var(--font-mono), ui-monospace, monospace" }}>META_AD_LIBRARY_TOKEN</code>) to see competitors&apos; Facebook & Instagram ads.
            </p>
          </div>
        )}
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => onBuildCampaign?.(competitor.id)}>
          <Megaphone size={14} /> Build a campaign from this gap
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={async () => {
            if (
              await confirm({
                title: "Stop tracking this competitor?",
                body: `${competitor.name} will drop off this list. There's no un-track control yet, so this can't be easily undone.`,
                confirmLabel: "Stop tracking",
                destructive: true,
              })
            ) {
              onMute?.(competitor.id);
            }
          }}
        >
          <EyeOff size={14} /> Stop tracking
        </Button>
      </div>
    </div>
  );
}
