"use client";

import { useState } from "react";
import { Key, MapPin, RefreshCw, Search } from "lucide-react";

import type { CompetitorRow as CompetitorRowData, EventRow, Metric, StoredReview } from "@/lib/research/store";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { relativeTime } from "@/lib/utils";
import { ChangedFeed } from "./ChangedFeed";
import { CompetitorDetail } from "./CompetitorDetail";
import { CompetitorRow } from "./CompetitorRow";

/**
 * The market-research dashboard shell — Market Research P1, Task 10.
 * Renders EXCLUSIVELY from the props page.tsx hands it (the store + a
 * cached KV landscape summary): zero AI calls, zero Google calls on view —
 * see page.tsx's own doc comment for the full cost-safety contract.
 *
 * `state` is decided by the server page (see that file's comment) and
 * simply switched on here — this component never re-derives it.
 *
 * `onRescan`/`onMarkSeen`/`onBuildCampaign` are T11 seams: optional so this
 * page renders correctly today (every call site guards with `?.()`, a true
 * no-op, never a faked local mutation) and needs no change when T11 lands —
 * page.tsx will just start passing real Server Actions as these same props.
 */

export type ResearchState = "no-key" | "no-centre" | "empty" | "populated";

export interface LandscapeCache {
  text: string;
  at: string;
}

interface ResearchViewProps {
  state: ResearchState;
  /** Ranked nearest-first (store's own ordering — see listCompetitors). */
  competitors: CompetitorRowData[];
  metricsById: Record<number, Metric | null>;
  historyById: Record<number, Metric[]>;
  reviewsById: Record<number, StoredReview[]>;
  /** Tenant-wide, newest-first, already capped (page.tsx calls listEvents({limit:20})). */
  events: EventRow[];
  landscape: LandscapeCache | null;
  /** Pre-formatted ("€0.03 / €10.00 this month") — computed server-side so this
   *  client component never needs to import the AI-cost formatter (which
   *  transitively pulls in a server-only module; see page.tsx). */
  spendLabel: string | null;
  onRescan?: () => void;
  onMarkSeen?: (ids: number[]) => void;
  onBuildCampaign?: (competitorId: number) => void;
}

// Mirrors lib/research/discovery.ts's DEFAULT_RADIUS_KM. Not imported: that
// constant isn't exported (T10 consumes the committed engine, it doesn't
// modify it just to add a display label) — display-only here; T11's Rescan
// action remains the source of truth for the radius an actual scan uses.
const RESEARCH_RADIUS_KM = 20;

export function ResearchView({
  state,
  competitors,
  metricsById,
  historyById,
  reviewsById,
  events,
  landscape,
  spendLabel,
  onRescan,
  onMarkSeen,
  onBuildCampaign,
}: ResearchViewProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (state === "no-key") {
    return (
      <EmptyState
        icon={<Key size={32} strokeWidth={1.4} />}
        title="Connect Google Places"
        message="Set the GOOGLE_PLACES_API_KEY environment variable to start tracking nearby competitors — ratings, reviews and a weekly change feed."
      />
    );
  }

  if (state === "no-centre") {
    return (
      <EmptyState
        icon={<MapPin size={32} strokeWidth={1.4} />}
        title="Set your location"
        message="We geocode your business profile's address the first time you scan, then cache it — every scan after that skips the lookup."
        action={
          <Button onClick={() => onRescan?.()}>
            <RefreshCw size={15} /> Rescan now
          </Button>
        }
      />
    );
  }

  if (state === "empty") {
    return (
      <EmptyState
        icon={<Search size={32} strokeWidth={1.4} />}
        title="No gyms found yet"
        message={`Run a scan to find gyms within ${RESEARCH_RADIUS_KM}km of your business.`}
        action={
          <Button onClick={() => onRescan?.()}>
            <RefreshCw size={15} /> Rescan now
          </Button>
        }
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: 20,
            color: "var(--text-primary)",
            textTransform: "uppercase",
          }}
        >
          {competitors.length} competitor{competitors.length === 1 ? "" : "s"} within {RESEARCH_RADIUS_KM}km
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {spendLabel && (
            <span
              style={{
                fontSize: 11.5,
                color: "var(--text-tertiary)",
                fontFamily: "var(--font-mono), ui-monospace, monospace",
              }}
            >
              Research spend {spendLabel}
            </span>
          )}
          <Button size="sm" onClick={() => onRescan?.()}>
            <RefreshCw size={14} /> Rescan now
          </Button>
        </div>
      </div>

      <Card>
        <CardLabel style={{ marginBottom: 8 }}>Landscape</CardLabel>
        {landscape ? (
          <>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.55, margin: 0 }}>{landscape.text}</p>
            <p
              style={{
                fontSize: 11,
                color: "var(--text-tertiary)",
                marginTop: 10,
                marginBottom: 0,
                fontFamily: "var(--font-mono), ui-monospace, monospace",
              }}
            >
              As of {relativeTime(landscape.at)}
            </p>
          </>
        ) : (
          <p style={{ fontSize: 13.5, color: "var(--text-tertiary)", margin: 0 }}>Run a scan to generate a landscape summary.</p>
        )}
      </Card>

      <ChangedFeed events={events} onMarkSeen={onMarkSeen} />

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 16px 4px" }}>
          <CardLabel style={{ marginBottom: 0 }}>Competitors</CardLabel>
        </div>
        <div>
          {competitors.map((c) => {
            const expanded = expandedId === c.id;
            return (
              <div key={c.id} style={{ borderTop: "1px solid var(--hairline)" }}>
                <CompetitorRow
                  competitor={c}
                  metric={metricsById[c.id] ?? null}
                  history={historyById[c.id] ?? []}
                  expanded={expanded}
                  onToggle={() => setExpandedId(expanded ? null : c.id)}
                />
                {expanded && (
                  <CompetitorDetail
                    competitor={c}
                    history={historyById[c.id] ?? []}
                    reviews={reviewsById[c.id] ?? []}
                    events={events.filter((e) => e.competitorId === c.id)}
                    onMarkSeen={onMarkSeen}
                    onBuildCampaign={onBuildCampaign}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .mres-row {
              display: flex;
              align-items: center;
              gap: 16px;
              padding: 14px 16px;
              cursor: pointer;
              flex-wrap: wrap;
            }
            .mres-row:hover { background: var(--surface-2); }
            .mres-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
            .mres-row-name { flex: 1 1 220px; min-width: 0; }
            .mres-row-rating { flex: 0 0 auto; width: 74px; display: flex; align-items: center; gap: 6px; }
            .mres-row-reviews { flex: 0 0 auto; width: 130px; }
            .mres-row-spark { flex: 0 0 auto; }
            .mres-row-chevron { flex: 0 0 auto; display: flex; }
            .mres-detail {
              padding: 4px 16px 22px;
              background: var(--surface-2);
            }
            .mres-detail-grid {
              display: grid;
              grid-template-columns: minmax(240px, 1.3fr) minmax(200px, 1fr);
              gap: 28px;
              padding-top: 16px;
            }
            .mres-chart-box {
              background: var(--surface-1);
              border: 1px solid var(--hairline);
              border-radius: var(--radius);
              padding: 14px 16px;
            }
            .mres-review {
              background: var(--surface-1);
              border: 1px solid var(--hairline);
              border-radius: var(--radius);
              padding: 10px 12px;
            }
            @media (max-width: 640px) {
              .mres-row-spark { display: none; }
            }
            @media (max-width: 620px) {
              .mres-detail-grid { grid-template-columns: 1fr; gap: 20px; }
            }
          `,
        }}
      />
    </div>
  );
}
