"use client";

import { ChevronDown, ChevronRight, Megaphone, Minus, TrendingDown, TrendingUp } from "lucide-react";

import type { CompetitorRow as CompetitorRowData, Metric } from "@/lib/research/store";
import { Badge } from "@/components/ui/Badge";
import { Sparkline } from "./Sparkline";

/**
 * One ranked row — Market Research P1, Task 10, since restyled (layout
 * redesign #2): a rank index, a distance chip beside the name, the rating
 * as a badge/pill, and an inline-SVG review-volume bar (width ∝ this
 * competitor's reviewCount / the busiest tracked competitor's) standing in
 * for the sparkline while there's fewer than 2 rated history points — a
 * 1-point sparkline has no shape to show. Once ≥2 rated captures exist, the
 * real Sparkline renders alongside it. The whole row is still the
 * expand/collapse toggle for CompetitorDetail (rendered by the parent,
 * ResearchView, immediately below when `expanded`); this component only
 * renders the row itself. Market Research P2, Task 6 added an optional
 * "Advertising" pill beside the distance chip, shown when `activeAdCount` > 0.
 */

interface Props {
  competitor: CompetitorRowData;
  /** 1-based position in the parent's already nearest-first list — display only. */
  rank: number;
  /** This competitor's `latestMetric(id)` — null for a never-refreshed competitor. */
  metric: Metric | null;
  /** This competitor's `metricHistory(id)`, newest-first (store's own contract). */
  history: Metric[];
  /** The highest reviewCount among ALL tracked competitors (computed once by
   *  the parent) — the denominator the review-volume bar's width scales against. */
  maxReviewCount: number;
  /** How many of this competitor's stored ads are currently `active` (Market
   *  Research P2, Task 6) — the parent computes this once from `adsById`.
   *  Defaults to 0 (no pill), so a caller that doesn't have ads on hand yet
   *  degrades to today's row exactly. */
  activeAdCount?: number;
  expanded: boolean;
  onToggle: () => void;
}

type Trend = "up" | "down" | "flat" | "none";

/**
 * "compare latestMetric vs the previous point in metricHistory" (brief,
 * literally): `history[0]` is the SAME capture as `latest` (both query
 * competitor_metrics with the identical `desc(capturedAt), desc(id)`
 * ordering — see store.ts's metricHistory doc comment, "matches
 * latestMetric()'s ordering"), so `history[1]` is that previous point.
 * Missing/unrated data on either side (a brand-new competitor with 0-1
 * captures, or a capture Google returned with no rating) -> "none", never a
 * guessed direction.
 */
function computeTrend(latest: Metric | null, history: Metric[]): Trend {
  if (!latest || latest.ratingMilli == null) return "none";
  const prev = history[1];
  if (!prev || prev.ratingMilli == null) return "none";
  if (latest.ratingMilli > prev.ratingMilli) return "up";
  if (latest.ratingMilli < prev.ratingMilli) return "down";
  return "flat";
}

/** Same "previous point" as computeTrend, for the review-count delta ("velocity"). */
function computeVelocity(latest: Metric | null, history: Metric[]): number | null {
  if (!latest || latest.reviewCount == null) return null;
  const prev = history[1];
  if (!prev || prev.reviewCount == null) return null;
  return latest.reviewCount - prev.reviewCount;
}

const TREND_META: Record<Trend, { Icon: typeof TrendingUp; color: string }> = {
  up: { Icon: TrendingUp, color: "#4ade80" },
  down: { Icon: TrendingDown, color: "#f87171" },
  flat: { Icon: Minus, color: "var(--text-tertiary)" },
  none: { Icon: Minus, color: "var(--text-tertiary)" },
};

/**
 * Thin inline-SVG horizontal bar — width ∝ reviewCount / maxReviewCount.
 * `null`/zero-max cases render nothing (no fabricated width). A non-zero
 * count is floored at a 4% sliver so a competitor with very few reviews
 * next to a busy one still shows a visible mark rather than nothing.
 */
function ReviewVolumeBar({ reviewCount, maxReviewCount }: { reviewCount: number; maxReviewCount: number }) {
  if (maxReviewCount <= 0) return null;
  const pct = reviewCount <= 0 ? 0 : Math.max((reviewCount / maxReviewCount) * 100, 4);
  return (
    <svg
      width="100%"
      height={5}
      viewBox="0 0 100 5"
      preserveAspectRatio="none"
      style={{ display: "block" }}
      role="img"
      aria-label={`${reviewCount.toLocaleString("en-IE")} reviews — ${Math.round((reviewCount / maxReviewCount) * 100)}% of the busiest competitor tracked`}
    >
      <rect x={0} y={0} width={100} height={5} rx={2.5} fill="var(--surface-3)" />
      {pct > 0 && <rect x={0} y={0} width={pct} height={5} rx={2.5} fill="var(--accent)" opacity={0.85} />}
    </svg>
  );
}

export function CompetitorRow({
  competitor,
  rank,
  metric,
  history,
  maxReviewCount,
  activeAdCount = 0,
  expanded,
  onToggle,
}: Props) {
  const trend = computeTrend(metric, history);
  const velocity = computeVelocity(metric, history);
  const { Icon: TrendIcon, color: trendColor } = TREND_META[trend];

  const ratingLabel = metric?.ratingMilli != null ? (metric.ratingMilli / 1000).toFixed(1) : "—";
  const reviewLabel = metric?.reviewCount != null ? metric.reviewCount.toLocaleString("en-IE") : "—";
  const velocityLabel =
    velocity == null ? null : velocity === 0 ? "no change" : `${velocity > 0 ? "+" : ""}${velocity} this week`;
  // A 1-point (or 0-point) sparkline has no shape to draw — the review-volume
  // bar already fills that slot meaningfully; the real trend line only earns
  // its place once there's something to actually trend.
  const ratedCount = history.reduce((n, m) => (m.ratingMilli != null ? n + 1 : n), 0);

  return (
    <div
      className="mres-row"
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="mres-row-rank" aria-hidden>
        <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 11, color: "var(--text-tertiary)" }}>
          {String(rank).padStart(2, "0")}
        </span>
      </div>

      <div className="mres-row-name">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{competitor.name}</span>
          <Badge tone="neutral" style={{ flexShrink: 0 }}>
            {`${competitor.distanceKm.toFixed(1)}km`}
          </Badge>
          {activeAdCount > 0 && (
            <Badge tone="neutral" style={{ flexShrink: 0 }}>
              <Megaphone size={10} /> Advertising
            </Badge>
          )}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--text-tertiary)",
            marginTop: 3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {competitor.address}
        </div>
      </div>

      <div className="mres-row-rating">
        <Badge tone="neutral">{`★ ${ratingLabel}`}</Badge>
        <TrendIcon size={14} color={trendColor} aria-hidden />
      </div>

      <div className="mres-row-reviews">
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{reviewLabel} reviews</div>
        {metric?.reviewCount != null && (
          <div style={{ marginTop: 5, marginBottom: velocityLabel ? 3 : 0 }}>
            <ReviewVolumeBar reviewCount={metric.reviewCount} maxReviewCount={maxReviewCount} />
          </div>
        )}
        {velocityLabel && (
          <div style={{ fontSize: 10.5, color: velocity != null && velocity > 0 ? "#4ade80" : "var(--text-tertiary)" }}>
            {velocityLabel}
          </div>
        )}
      </div>

      {ratedCount >= 2 && (
        <div className="mres-row-spark">
          <Sparkline history={history} width={60} height={20} />
        </div>
      )}

      <div className="mres-row-chevron">
        {expanded ? (
          <ChevronDown size={16} color="var(--text-tertiary)" aria-hidden />
        ) : (
          <ChevronRight size={16} color="var(--text-tertiary)" aria-hidden />
        )}
      </div>
    </div>
  );
}
