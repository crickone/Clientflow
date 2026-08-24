"use client";

import { EyeOff, Megaphone } from "lucide-react";

import type { CompetitorRow as CompetitorRowData, EventRow, Metric, StoredReview } from "@/lib/research/store";
import { parseStoredThemes } from "@/lib/research/themesJson";
import { Button } from "@/components/ui/Button";
import { CardLabel } from "@/components/ui/Card";
import { formatDate } from "@/lib/utils";
import { ChangedFeed } from "./ChangedFeed";
import { Sparkline } from "./Sparkline";

/**
 * The inline expand panel under a ranked row — Market Research P1, Task 10
 * (view) + Task 11 (the mute button + real onMarkSeen/onBuildCampaign
 * handlers ResearchView now passes down). Renders ONLY from what the parent
 * (ResearchView, in turn fed by page.tsx) already has in hand: this
 * competitor's metric history, cached review sample, cached AI themes, and
 * its own slice of the event feed. No fetch, no AI call, no Google call —
 * every callback prop here is a plain, synchronous-looking function;
 * ResearchView owns the actual Server Action calls behind them.
 */

interface Props {
  competitor: CompetitorRowData;
  /** This competitor's `metricHistory(id)`, newest-first. */
  history: Metric[];
  /** This competitor's `getReviews(id)`, Google's own relevance order. */
  reviews: StoredReview[];
  /** This competitor's own events (pre-filtered by the caller from the tenant-wide feed). */
  events: EventRow[];
  onBuildCampaign?: (competitorId: number) => void;
  onMarkSeen?: (ids: number[]) => void;
  /** T11: curation (`setCompetitorFlagsAction(id,{muted:true})` upstream) —
   *  stop tracking this competitor. No confirmation UI to un-mute exists yet
   *  (P1.5), so this component confirms before firing it — see the button. */
  onMute?: (competitorId: number) => void;
  /** True while ResearchView's shared curation transition is in flight (a
   *  mark-seen / mute / build-campaign click anywhere on the page) — disables
   *  both buttons below so a double-click can't fire `onMute` (no undo yet)
   *  or `onBuildCampaign` twice. */
  pending?: boolean;
}

const MAX_REVIEWS_SHOWN = 5;

export function CompetitorDetail({ competitor, history, reviews, events, onBuildCampaign, onMarkSeen, onMute, pending = false }: Props) {
  // Parsing lives in the shared, zero-import lib/research/themesJson.ts (T11)
  // rather than a local copy: lib/research/campaignGap.ts (the "Build a
  // campaign from this gap" seed builder) now needs the identical parse, and
  // this component itself can never import lib/research/summary.ts (the
  // writer of this JSON shape) — that module is `server-only`, so a CLIENT
  // component reading its cache back out needs a shared, framework-free home.
  const parsedThemes = parseStoredThemes(competitor.themesJson);
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
                  {(latest.ratingMilli / 1000).toFixed(1)}★ now
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
                      <span style={{ fontSize: 12, color: "var(--text-tertiary)", flexShrink: 0 }}>
                        ★ {(r.ratingMilli / 1000).toFixed(1)}
                      </span>
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
        <ChangedFeed
          events={events}
          title="Activity"
          bordered={false}
          emptyMessage="No changes recorded for this competitor yet."
          onMarkSeen={onMarkSeen}
        />
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => onBuildCampaign?.(competitor.id)}>
          <Megaphone size={14} /> Build a campaign from this gap
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (
              window.confirm(
                `Stop tracking ${competitor.name}? It'll drop off this list — there's no un-track control yet, so this can't be easily undone.`,
              )
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
