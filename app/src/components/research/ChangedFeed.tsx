"use client";

import { type CSSProperties, useState } from "react";
import {
  Activity as ActivityIcon,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Flame,
  MapPinPlus,
  Rocket,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import type { EventRow } from "@/lib/research/store";
import { isForwardLookingFeed } from "@/lib/research/feedState";
import { Card, CardLabel } from "@/components/ui/Card";
import { relativeTime } from "@/lib/utils";

/**
 * The "what changed" feed — Market Research P1, Task 10, since restyled
 * (layout redesign #2 — "de-noise the first-scan wall"). Renders `EventRow[]`
 * exactly as given (caller decides ordering/limit — see page.tsx's
 * `listEvents({limit:20})`), newest-first per the store's own contract; this
 * component only REGROUPS how that same array is presented, it never
 * re-fetches or re-orders across a boundary the caller didn't already set.
 * Reused twice: the tenant-wide feed on `/marketing/research` (bordered, its
 * own Card) and, embedded, a single competitor's own events inside
 * CompetitorDetail (`bordered={false}`, no nested Card-in-Card) — see that
 * split below, "grouping" section.
 *
 * Grouping: `new_competitor` events always carry `competitorId: null` (raised
 * by discovery, not tied to one row — see discovery.ts), so CompetitorDetail's
 * own per-competitor slice of the feed never contains any; the collapse logic
 * below is therefore inert there and only ever fires on the tenant-wide feed.
 * The real change types (`rating_up`/`rating_down`/`review_spike`/`new_ad`/
 * `ad_stopped` — the last two Market Research P2, Task 6 — and, future-
 * proofed, anything else the engine ever adds) always render as distinct,
 * coloured rows since that's the feed's actual week-to-week value;
 * `new_competitor` events render individually too UNLESS there are enough of
 * them to be the "monotonous wall" the brief called out (a first scan's ~20
 * near-identical "New gym nearby" rows), in which case they collapse into one
 * expandable summary row.
 *
 * Mark-seen is a T11 action (`markEventsSeen` in lib/research/store.ts) —
 * this component only renders the unseen state (a dot + hover affordance)
 * and calls the optional `onMarkSeen` seam; with no handler wired yet, both
 * the per-row click and "Mark N seen" are inert, never a fake local mutation.
 *
 * Forward-looking empty state (Market Research P1.1, UI refinement B): on a
 * first scan the ONLY events are the initial `new_competitor` discovery
 * batch, so rendering them all (or the collapsed "N discovered" summary
 * above) as the feed's whole content reads as redundant — nothing has
 * actually CHANGED yet. When `isForwardLookingFeed` (lib/research/
 * feedState.ts) says so, this component swaps the events list for a single
 * slim, muted line instead — see that module's own doc comment for the
 * exact rule. This ONLY replaces the non-empty "it's just the seed"
 * rendering; a genuinely empty `events` array still renders `emptyMessage`
 * as before (unaffected — this keeps CompetitorDetail's embedded, per-
 * competitor usage, which never sees `new_competitor` events at all,
 * identical to today).
 */

interface ChangedFeedProps {
  events: EventRow[];
  title?: string;
  emptyMessage?: string;
  onMarkSeen?: (ids: number[]) => void;
  /** Wrap the list in its own bordered Card — on for the tenant-wide feed;
   *  off when embedded inside a panel that already provides its own chrome
   *  (CompetitorDetail's per-competitor "Activity" section). */
  bordered?: boolean;
  /** True once any tracked competitor has a SECOND metric capture — i.e. a
   *  refresh cycle beyond the very first has run. Feeds isForwardLookingFeed
   *  (see its own doc comment); defaults to false, which is also correct/
   *  inert for CompetitorDetail's embedded per-competitor usage (its event
   *  slice never contains `new_competitor`, so this flag can't change its
   *  outcome either way — see the module doc above). */
  hasSubsequentScan?: boolean;
}

/** At or above this many `new_competitor` events, they collapse into one
 *  expandable summary row instead of repeating near-identical rows. */
const DISCOVERY_COLLAPSE_THRESHOLD = 3;

const CHANGE_EVENT_META: Record<string, { Icon: typeof TrendingUp; ink: string; tint: string; ring: string }> = {
  rating_up: { Icon: TrendingUp, ink: "#4ade80", tint: "rgba(74, 222, 128, 0.1)", ring: "rgba(74, 222, 128, 0.4)" },
  rating_down: { Icon: TrendingDown, ink: "#f87171", tint: "rgba(248, 113, 113, 0.1)", ring: "rgba(248, 113, 113, 0.4)" },
  review_spike: { Icon: Flame, ink: "#fbbf24", tint: "rgba(251, 191, 36, 0.1)", ring: "rgba(251, 191, 36, 0.4)" },
  // Market Research P2, Task 6 — raised by adDiff.ts's diffAds (Task 2). Icon
  // choice echoes its own summary copy verbatim ("launched a new ad" /
  // "stopped an ad"): a rocket for a launch, a stop glyph for a stop.
  new_ad: { Icon: Rocket, ink: "#818cf8", tint: "rgba(129, 140, 248, 0.1)", ring: "rgba(129, 140, 248, 0.4)" },
  ad_stopped: { Icon: CircleStop, ink: "#94a3b8", tint: "rgba(148, 163, 184, 0.1)", ring: "rgba(148, 163, 184, 0.4)" },
};
const FALLBACK_CHANGE_META = { Icon: ActivityIcon, ink: "var(--text-secondary)", tint: "var(--surface-2)", ring: "var(--hairline)" };

function UnseenDot({ style }: { style?: CSSProperties }) {
  return (
    <span
      aria-label="Unseen"
      title="Unseen"
      style={{ width: 7, height: 7, borderRadius: 999, background: "var(--accent)", flexShrink: 0, ...style }}
    />
  );
}

/** A real, individually-meaningful change — rating move / review spike / any
 *  future type — gets the prominent treatment: a coloured icon chip, a
 *  tinted row, and a left accent stripe, so it visibly stands apart from
 *  routine discovery noise. */
function ChangeEventRow({ event, onMarkSeen }: { event: EventRow; onMarkSeen?: (ids: number[]) => void }) {
  const meta = CHANGE_EVENT_META[event.type] ?? FALLBACK_CHANGE_META;
  const { Icon, ink, tint, ring } = meta;
  return (
    <div
      onClick={!event.seen ? () => onMarkSeen?.([event.id]) : undefined}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 16px 12px 13px",
        borderLeft: `3px solid ${ink}`,
        background: tint,
        cursor: !event.seen && onMarkSeen ? "pointer" : "default",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--surface-1)",
          border: `1px solid ${ring}`,
          color: ink,
        }}
      >
        <Icon size={13.5} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)", lineHeight: 1.4, wordBreak: "break-word" }}>
          {event.summary}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            marginTop: 3,
            fontFamily: "var(--font-mono), ui-monospace, monospace",
          }}
        >
          {relativeTime(event.occurredAt)}
        </div>
      </div>
      {!event.seen && <UnseenDot style={{ marginTop: 6 }} />}
    </div>
  );
}

/** The original, quieter row style — used for a `new_competitor` event when
 *  there aren't enough of them to bother collapsing, and for each item once
 *  a collapsed group is expanded. */
function PlainEventRow({ event, onMarkSeen, indent = false }: { event: EventRow; onMarkSeen?: (ids: number[]) => void; indent?: boolean }) {
  return (
    <div
      onClick={!event.seen ? () => onMarkSeen?.([event.id]) : undefined}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: indent ? "9px 16px 9px 44px" : "11px 16px",
        cursor: !event.seen && onMarkSeen ? "pointer" : "default",
      }}
    >
      <MapPinPlus size={14} color="var(--accent)" style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.4, wordBreak: "break-word" }}>{event.summary}</div>
        <div
          style={{
            fontSize: 10.5,
            color: "var(--text-tertiary)",
            marginTop: 2,
            fontFamily: "var(--font-mono), ui-monospace, monospace",
          }}
        >
          {relativeTime(event.occurredAt)}
        </div>
      </div>
      {!event.seen && <UnseenDot style={{ marginTop: 5 }} />}
    </div>
  );
}

/** The collapsed "N competitors discovered nearby" row — expands in place
 *  to the individual (plain-styled) discovery rows it's standing in for. */
function DiscoverySummaryRow({ events, onMarkSeen }: { events: EventRow[]; onMarkSeen?: (ids: number[]) => void }) {
  const [expanded, setExpanded] = useState(false);
  const unseenCount = events.filter((e) => !e.seen).length;
  // `events` arrives as a slice of the caller's already newest-first array,
  // so the first element is the most recently discovered in this group.
  const mostRecent = events[0];

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "11px 16px",
          cursor: "pointer",
        }}
      >
        <MapPinPlus size={15} color="var(--accent)" style={{ flexShrink: 0 }} aria-hidden />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{events.length} competitors discovered nearby</div>
          {mostRecent && (
            <div
              style={{
                fontSize: 11,
                color: "var(--text-tertiary)",
                marginTop: 2,
                fontFamily: "var(--font-mono), ui-monospace, monospace",
              }}
            >
              Most recent {relativeTime(mostRecent.occurredAt)}
            </div>
          )}
        </div>
        {unseenCount > 0 && <UnseenDot />}
        {expanded ? (
          <ChevronDown size={14} color="var(--text-tertiary)" aria-hidden />
        ) : (
          <ChevronRight size={14} color="var(--text-tertiary)" aria-hidden />
        )}
      </div>
      {expanded && (
        <div style={{ background: "var(--surface-2)" }}>
          {events.map((event, i) => (
            <div key={event.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--hairline)" }}>
              <PlainEventRow event={event} onMarkSeen={onMarkSeen} indent />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChangedFeed({
  events,
  title = "What changed",
  emptyMessage = "Nothing's changed yet — check back after your next scan.",
  onMarkSeen,
  bordered = true,
  hasSubsequentScan = false,
}: ChangedFeedProps) {
  const unseenIds = events.filter((e) => !e.seen).map((e) => e.id);
  // The real, individually-meaningful changes always lead — "that's the
  // feed's real value week-to-week" — with routine discovery noise trailing
  // (collapsed into one row once there's enough of it to be a wall).
  const changeEvents = events.filter((e) => e.type !== "new_competitor");
  const discoveryEvents = events.filter((e) => e.type === "new_competitor");
  const collapseDiscovery = discoveryEvents.length >= DISCOVERY_COLLAPSE_THRESHOLD;
  // Only meaningful when `events` is non-empty — the `events.length === 0`
  // branch below always renders `emptyMessage` regardless, same as today.
  const forwardLooking = isForwardLookingFeed(events, hasSubsequentScan);

  const body = (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          padding: "16px 16px 8px",
        }}
      >
        <CardLabel style={{ marginBottom: 0 }}>{title}</CardLabel>
        {unseenIds.length > 0 && (
          <button
            type="button"
            onClick={() => onMarkSeen?.(unseenIds)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "var(--accent-ink)",
              fontSize: 11.5,
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              cursor: "pointer",
            }}
          >
            Mark {unseenIds.length} seen
          </button>
        )}
      </div>

      {events.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: 0, padding: "0 16px 18px" }}>{emptyMessage}</p>
      ) : forwardLooking ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 16px 18px" }}>
          <ActivityIcon size={14} color="var(--text-tertiary)" style={{ flexShrink: 0 }} aria-hidden />
          <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.5 }}>
            Watching for changes — rating moves, review spikes and new gyms opening will show up here.
          </p>
        </div>
      ) : (
        <div style={{ paddingBottom: 2 }}>
          {changeEvents.map((event, i) => (
            <div key={event.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--hairline)" }}>
              <ChangeEventRow event={event} onMarkSeen={onMarkSeen} />
            </div>
          ))}

          {discoveryEvents.length > 0 && (
            <div style={{ borderTop: changeEvents.length > 0 ? "1px solid var(--hairline)" : "none" }}>
              {collapseDiscovery ? (
                <DiscoverySummaryRow events={discoveryEvents} onMarkSeen={onMarkSeen} />
              ) : (
                discoveryEvents.map((event, i) => (
                  <div key={event.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--hairline)" }}>
                    <PlainEventRow event={event} onMarkSeen={onMarkSeen} />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </>
  );

  return bordered ? <Card style={{ padding: 0, overflow: "hidden" }}>{body}</Card> : <div>{body}</div>;
}
