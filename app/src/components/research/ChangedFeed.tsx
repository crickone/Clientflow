"use client";

import { Activity as ActivityIcon, Flame, MapPinPlus, TrendingDown, TrendingUp } from "lucide-react";

import type { EventRow } from "@/lib/research/store";
import { Card, CardLabel } from "@/components/ui/Card";
import { relativeTime } from "@/lib/utils";

/**
 * The "what changed" feed — Market Research P1, Task 10. Renders
 * `EventRow[]` exactly as given (caller decides ordering/limit — see
 * page.tsx's `listEvents({limit:20})`), newest-first per the store's own
 * contract. Reused twice: the tenant-wide feed on `/marketing/research`
 * (bordered, its own Card) and, embedded, a single competitor's own events
 * inside CompetitorDetail (`bordered={false}`, no nested Card-in-Card).
 *
 * Mark-seen is a T11 action (`markEventsSeen` in lib/research/store.ts) —
 * this component only renders the unseen state (a dot + hover affordance)
 * and calls the optional `onMarkSeen` seam; with no handler wired yet, both
 * the per-row click and "Mark N seen" are inert, never a fake local mutation.
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
}

const EVENT_ICON: Record<string, { Icon: typeof TrendingUp; color: string }> = {
  rating_up: { Icon: TrendingUp, color: "#4ade80" },
  rating_down: { Icon: TrendingDown, color: "#f87171" },
  review_spike: { Icon: Flame, color: "#fbbf24" },
  new_competitor: { Icon: MapPinPlus, color: "var(--accent)" },
};

export function ChangedFeed({
  events,
  title = "What changed",
  emptyMessage = "Nothing's changed yet — check back after your next scan.",
  onMarkSeen,
  bordered = true,
}: ChangedFeedProps) {
  const unseenIds = events.filter((e) => !e.seen).map((e) => e.id);

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
      ) : (
        <div>
          {events.map((event, i) => {
            const meta = EVENT_ICON[event.type];
            const Icon = meta?.Icon ?? ActivityIcon;
            const color = meta?.color ?? "var(--text-tertiary)";
            return (
              <div
                key={event.id}
                onClick={!event.seen ? () => onMarkSeen?.([event.id]) : undefined}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "11px 16px",
                  borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
                  cursor: !event.seen && onMarkSeen ? "pointer" : "default",
                }}
              >
                <Icon size={15} color={color} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.4, wordBreak: "break-word" }}>
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
                {!event.seen && (
                  <span
                    aria-label="Unseen"
                    title="Unseen"
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: "var(--accent)",
                      flexShrink: 0,
                      marginTop: 6,
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  return bordered ? <Card style={{ padding: 0, overflow: "hidden" }}>{body}</Card> : <div>{body}</div>;
}
