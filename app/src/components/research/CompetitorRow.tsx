"use client";

import { ChevronDown, ChevronRight, Minus, TrendingDown, TrendingUp } from "lucide-react";

import type { CompetitorRow as CompetitorRowData, Metric } from "@/lib/research/store";
import { Sparkline } from "./Sparkline";

/**
 * One ranked row — Market Research P1, Task 10. The whole row is the
 * expand/collapse toggle for CompetitorDetail (rendered by the parent,
 * ResearchView, immediately below when `expanded`); this component only
 * renders the row itself.
 */

interface Props {
  competitor: CompetitorRowData;
  /** This competitor's `latestMetric(id)` — null for a never-refreshed competitor. */
  metric: Metric | null;
  /** This competitor's `metricHistory(id)`, newest-first (store's own contract). */
  history: Metric[];
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

export function CompetitorRow({ competitor, metric, history, expanded, onToggle }: Props) {
  const trend = computeTrend(metric, history);
  const velocity = computeVelocity(metric, history);
  const { Icon: TrendIcon, color: trendColor } = TREND_META[trend];

  const ratingLabel = metric?.ratingMilli != null ? (metric.ratingMilli / 1000).toFixed(1) : "—";
  const reviewLabel = metric?.reviewCount != null ? metric.reviewCount.toLocaleString("en-IE") : "—";
  const velocityLabel =
    velocity == null ? null : velocity === 0 ? "no change" : `${velocity > 0 ? "+" : ""}${velocity} this week`;

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
      <div className="mres-row-name">
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{competitor.name}</div>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--text-tertiary)",
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {competitor.distanceKm.toFixed(1)} km · {competitor.address}
        </div>
      </div>

      <div className="mres-row-rating">
        <span style={{ fontSize: 14, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
          ★ {ratingLabel}
        </span>
        <TrendIcon size={14} color={trendColor} aria-hidden />
      </div>

      <div className="mres-row-reviews">
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{reviewLabel} reviews</div>
        {velocityLabel && (
          <div
            style={{
              fontSize: 11,
              color: velocity != null && velocity > 0 ? "#4ade80" : "var(--text-tertiary)",
              marginTop: 1,
            }}
          >
            {velocityLabel}
          </div>
        )}
      </div>

      <div className="mres-row-spark">
        <Sparkline history={history} width={60} height={20} />
      </div>

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
