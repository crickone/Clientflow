"use client";

import { type ReactNode, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Building2, Crown, Key, MapPin, MessageSquareText, RefreshCw, Search, Star, Users } from "lucide-react";
import { toast } from "sonner";

import type { CompetitorRow as CompetitorRowData, Metric, StoredAd, StoredReview } from "@/lib/research/store";
import type { RescanResult } from "@/app/marketing/research/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { DUR, EASE } from "@/lib/motion";
import { relativeTime } from "@/lib/utils";
import { CompetitorDetail } from "./CompetitorDetail";
import { CompetitorRow } from "./CompetitorRow";
import { ScanningProgress } from "./ScanningProgress";

/**
 * The market-research dashboard shell — Market Research P1, Task 10 (view)
 * + Task 11 (wiring), since upgraded with two presentation-only redesigns:
 * an animated step-by-step ScanningProgress panel in place of the plain
 * button spinner, and a richer landscape/feed/competitor layout (stat
 * strip, highlight chips, review-volume bars). Renders EXCLUSIVELY from the
 * props page.tsx hands it (the store + a cached KV landscape summary):
 * zero AI calls, zero Google calls on RENDER — see page.tsx's own doc
 * comment for the full cost-safety contract. Spending only ever happens
 * inside `handleRescan` below, and only when an admin clicks the button.
 * The two derived-stats helpers at the bottom of this file (competitor
 * ranking/rating/review roll-ups) are pure presentation math over props
 * already in hand — never a new fetch, never touching lib/research/*.
 *
 * `state` is decided by the server page (see that file's comment) and
 * simply switched on here — this component never re-derives it.
 *
 * `onRescan`/`onSetFlags`/`onBuildCampaign` are real Server
 * Actions (marketing/research/actions.ts), passed straight down from
 * page.tsx as props — a Server Component may hand a Server Action to a
 * Client Component this way; Next.js serialises it into a callable
 * reference. Still optional (never a hard requirement to render) so this
 * component degrades to inert buttons rather than crashing if ever mounted
 * without them. This component owns the useTransition/toast/router.refresh
 * plumbing around each call and hands its CHILD (CompetitorDetail) the same
 * plain, synchronous-looking callback shapes T10 already built it against —
 * nothing below this component needs to know a Server Action is involved at all.
 *
 * P1.1 self-detection: `competitors` (and everything derived from it —
 * `computeCompetitorStats`, the Landscape stat tiles, the highlight badges)
 * is ALREADY the self-EXCLUDING list (page.tsx calls
 * `listCompetitors({trackedOnly:true, excludeSelf:true})`) — this component
 * never filters self out itself. `self`/`selfMetric` are the tenant's own
 * gym, fetched separately, rendered as a distinct "Your gym" reference row
 * above the ranked list — never numbered among competitors.
 *
 * Market Research P2, Task 6: `adsById` (page.tsx's `listAds(id)` per
 * competitor, ALL rows) and `adLibraryConfigured` (a sync env-var check, no
 * network) are plumbed the same store-only way and forwarded per-row — an
 * active count to CompetitorRow's "Advertising" pill, the full list +
 * configured flag to CompetitorDetail's Ads section. Same zero-spend
 * contract as everything else here.
 *
 * Exact Page-ID ad matching, Task 2: `isAdmin` (page.tsx) and the two new
 * `onLinkPage`/`onUnlinkPage` Server Actions are forwarded to every
 * CompetitorDetail exactly like `onSetFlags` above — this component owns the
 * shared `curating` transition + toast + `router.refresh()` around both
 * (`handleLinkPage`/`handleUnlinkPage` below), so CompetitorDetail's Ads
 * section only ever sees plain, synchronous-looking callbacks, same as
 * `onMute`/`onBuildCampaign`.
 */

export type ResearchState = "no-key" | "no-centre" | "empty" | "populated";

export interface LandscapeCache {
  text: string;
  at: string;
}

interface ResearchViewProps {
  state: ResearchState;
  /** Ranked nearest-first, EXCLUDING the tenant's own gym (page.tsx's `listCompetitors({trackedOnly:true, excludeSelf:true})`) — see `self` below for that reference. */
  competitors: CompetitorRowData[];
  metricsById: Record<number, Metric | null>;
  historyById: Record<number, Metric[]>;
  reviewsById: Record<number, StoredReview[]>;
  /** Each competitor's stored ads (`listAds(id)`, Market Research P2 Task 6)
   *  — ALL rows, active and stopped. Feeds both CompetitorRow's "Advertising"
   *  pill (active count) and CompetitorDetail's Ads gallery (the full list). */
  adsById: Record<number, StoredAd[]>;
  landscape: LandscapeCache | null;
  /** Pre-formatted ("€0.03 / €10.00 this month") — computed server-side so this
   *  client component never needs to import the AI-cost formatter (which
   *  transitively pulls in a server-only module; see page.tsx). */
  spendLabel: string | null;
  /** `adLibraryConfigured()` (lib/research/adLibrary.ts), read server-side in
   *  page.tsx — whether META_AD_LIBRARY_TOKEN is set. Passed straight through
   *  to every CompetitorDetail's Ads section (see that component). */
  adLibraryConfigured: boolean;
  /** The tenant's own gym (P1.1's isSelf match), if discovery has found one — `getSelfCompetitor()`. Null renders no "Your gym" reference at all (best-effort, current pre-P1.1 behaviour). */
  self: CompetitorRowData | null;
  /** `self`'s `latestMetric(id)` — null for a self match that hasn't been refreshed yet. Ignored when `self` is null. */
  selfMetric: Metric | null;
  /** `getCurrentMembership()?.role === "admin"`, read server-side in page.tsx
   *  — page.tsx is already fully `requireAdminPage()`-gated so this is always
   *  true in practice (see that file's doc comment); passed through anyway so
   *  CompetitorDetail's Link/Unlink controls carry their own explicit gate. */
  isAdmin: boolean;
  onRescan?: () => Promise<RescanResult>;
  onSetFlags?: (id: number, flags: { tracked?: boolean; muted?: boolean }) => Promise<{ ok: boolean }>;
  onBuildCampaign?: (competitorId: number) => Promise<{ ok: boolean; href?: string; error?: string }>;
  /** Exact Page-ID ad matching, Task 2 — links a competitor to a specific Meta Page (marketing/research/actions.ts's linkCompetitorPageAction). */
  onLinkPage?: (competitorId: number, pageId: string, pageName: string) => Promise<{ ok: boolean; error?: string }>;
  /** Undoes onLinkPage (unlinkCompetitorPageAction). */
  onUnlinkPage?: (competitorId: number) => Promise<{ ok: boolean; error?: string }>;
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
  adsById,
  landscape,
  spendLabel,
  adLibraryConfigured,
  self,
  selfMetric,
  isAdmin,
  onRescan,
  onSetFlags,
  onBuildCampaign,
  onLinkPage,
  onUnlinkPage,
}: ResearchViewProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const router = useRouter();
  const reduceMotion = !!useReducedMotion();
  // Rescan gets its OWN transition so its buttons' pending state (the brief's
  // "disable during a rescan") never gets tangled up with an unrelated
  // curation click (mute / mark-seen / build-campaign) elsewhere on the page.
  const [rescanning, startRescan] = useTransition();
  const [curating, startCuration] = useTransition();
  // Drives the ScanningProgress panel. `scanPanelOpen` is deliberately its
  // OWN flag rather than reusing `rescanning` directly: ScanningProgress
  // needs to keep rendering a little LONGER than `rescanning` stays true (a
  // brief "done" beat once the scan actually resolves) — see that
  // component's own doc comment for the full handshake. `scanResult` is the
  // resolved action's return value, handed down so the panel can show a
  // real "N competitors refreshed" count instead of a generic spinner.
  const [scanPanelOpen, setScanPanelOpen] = useState(false);
  const [scanResult, setScanResult] = useState<RescanResult | null>(null);

  function handleRescan() {
    if (!onRescan) return;
    setScanResult(null);
    setScanPanelOpen(true);
    startRescan(async () => {
      const result = await onRescan();
      setScanResult(result);
      if (!result.ok) {
        toast.error(
          result.error === "cap_reached"
            ? "This month's research spend cap has been reached — an admin can raise it in Settings."
            : "Rescan failed — please try again.",
        );
        return;
      }
      if (result.skipped) {
        toast.info("Already scanned in the last few minutes — try again shortly.");
        return;
      }
      const n = result.refreshed ?? 0;
      toast.success(`Rescan complete — ${n} competitor${n === 1 ? "" : "s"} refreshed.`);
      router.refresh();
    });
  }

  function handleMute(id: number) {
    if (!onSetFlags) return;
    startCuration(async () => {
      const result = await onSetFlags(id, { muted: true });
      if (!result.ok) {
        toast.error("Couldn't update that competitor — please try again.");
        return;
      }
      toast.success("Stopped tracking that competitor.");
      router.refresh();
    });
  }

  function handleLinkPage(id: number, pageId: string, pageName: string) {
    if (!onLinkPage) return;
    startCuration(async () => {
      const result = await onLinkPage(id, pageId, pageName);
      if (!result.ok) {
        toast.error("Couldn't link that page — please try again.");
        return;
      }
      toast.success(pageName ? `Now showing only ${pageName}'s ads.` : "Linked to this Facebook Page.");
      router.refresh();
    });
  }

  function handleUnlinkPage(id: number) {
    if (!onUnlinkPage) return;
    startCuration(async () => {
      const result = await onUnlinkPage(id);
      if (!result.ok) {
        toast.error("Couldn't unlink that page — please try again.");
        return;
      }
      toast.success("Unlinked — back to filtered ad matching.");
      router.refresh();
    });
  }

  function handleBuildCampaign(id: number) {
    if (!onBuildCampaign) return;
    startCuration(async () => {
      const result = await onBuildCampaign(id);
      if (!result.ok || !result.href) {
        toast.error("Couldn't build a campaign from this yet — please try again.");
        return;
      }
      router.push(result.href);
    });
  }

  const rescanButtonLabel = rescanning ? "Scanning…" : "Rescan now";

  if (state === "no-key") {
    return (
      <EmptyState
        icon={<Key size={32} strokeWidth={1.4} />}
        title="Connect Google Places"
        message="Set the GOOGLE_PLACES_API_KEY environment variable to start tracking nearby competitors — ratings, reviews and a weekly change feed."
      />
    );
  }

  if (state === "no-centre" || state === "empty") {
    return (
      <AnimatePresence mode="wait" initial={false}>
        {scanPanelOpen ? (
          <SwapPane key="scanning" reduceMotion={reduceMotion}>
            <ScanningProgress
              active={rescanning}
              result={scanResult}
              trackedCount={competitors.length}
              onFinished={() => setScanPanelOpen(false)}
            />
          </SwapPane>
        ) : (
          <SwapPane key="empty" reduceMotion={reduceMotion}>
            {state === "no-centre" ? (
              <EmptyState
                icon={<MapPin size={32} strokeWidth={1.4} />}
                title="Set your location"
                message="We geocode your business profile's address the first time you scan, then cache it — every scan after that skips the lookup."
                action={
                  <Button onClick={handleRescan} loading={rescanning}>
                    {rescanning ? rescanButtonLabel : <><RefreshCw size={15} /> {rescanButtonLabel}</>}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Search size={32} strokeWidth={1.4} />}
                title="No gyms found yet"
                message={`Run a scan to find gyms within ${RESEARCH_RADIUS_KM}km of your business.`}
                action={
                  <Button onClick={handleRescan} loading={rescanning}>
                    {rescanning ? rescanButtonLabel : <><RefreshCw size={15} /> {rescanButtonLabel}</>}
                  </Button>
                }
              />
            )}
          </SwapPane>
        )}
      </AnimatePresence>
    );
  }

  const stats = computeCompetitorStats(competitors, metricsById);

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
          <Button size="sm" onClick={handleRescan} loading={rescanning}>
            {rescanning ? rescanButtonLabel : <><RefreshCw size={14} /> {rescanButtonLabel}</>}
          </Button>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {scanPanelOpen ? (
          <SwapPane key="scanning" reduceMotion={reduceMotion}>
            <ScanningProgress
              active={rescanning}
              result={scanResult}
              trackedCount={competitors.length}
              onFinished={() => setScanPanelOpen(false)}
            />
          </SwapPane>
        ) : (
          <SwapPane key="content" reduceMotion={reduceMotion}>
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <Card>
                <CardLabel style={{ marginBottom: 8 }}>Landscape</CardLabel>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
                  <StatTile icon={<Users size={14} strokeWidth={1.8} />} label="Competitors" value={String(stats.count)} />
                  <StatTile
                    icon={<Star size={14} strokeWidth={1.8} />}
                    label="Avg rating"
                    value={stats.avgRating != null ? `★ ${stats.avgRating.toFixed(1)}` : "—"}
                  />
                  <StatTile
                    icon={<Crown size={14} strokeWidth={1.8} />}
                    label="Top rated"
                    value={stats.topRated ? `★ ${stats.topRated.rating.toFixed(1)}` : "—"}
                    sub={stats.topRated?.competitor.name}
                  />
                  <StatTile
                    icon={<MessageSquareText size={14} strokeWidth={1.8} />}
                    label="Most reviewed"
                    value={stats.mostReviewed ? stats.mostReviewed.count.toLocaleString("en-IE") : "—"}
                    sub={stats.mostReviewed?.competitor.name}
                  />
                </div>

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

              <Card style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "16px 16px 4px" }}>
                  <CardLabel style={{ marginBottom: 0 }}>Competitors</CardLabel>
                </div>
                {self && (
                  <div style={{ padding: "0 16px 14px" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "11px 14px",
                        background: "var(--surface-2)",
                        border: "1px solid var(--hairline)",
                        borderLeft: "3px solid var(--accent)",
                        borderRadius: "var(--radius)",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <Building2 size={15} color="var(--accent-ink)" aria-hidden />
                        <span
                          style={{
                            fontFamily: "var(--font-mono), ui-monospace, monospace",
                            fontSize: 10,
                            letterSpacing: "0.1em",
                            textTransform: "uppercase",
                            color: "var(--accent-ink)",
                          }}
                        >
                          Your gym
                        </span>
                      </div>
                      <div
                        style={{
                          flex: "1 1 160px",
                          minWidth: 0,
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--text-primary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {self.name}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
                        <Badge tone="neutral">{`★ ${selfMetric?.ratingMilli != null ? (selfMetric.ratingMilli / 1000).toFixed(1) : "—"}`}</Badge>
                        <span style={{ fontSize: 13, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                          {selfMetric?.reviewCount != null ? selfMetric.reviewCount.toLocaleString("en-IE") : "—"} reviews
                        </span>
                      </div>
                    </div>
                  </div>
                )}
                {(stats.topRated || stats.mostReviewed || stats.closest) && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "0 16px 14px" }}>
                    {stats.topRated && (
                      <Badge tone="neutral">
                        <Crown size={11} />
                        {`Top rated · ${stats.topRated.competitor.name} · ★${stats.topRated.rating.toFixed(1)}`}
                      </Badge>
                    )}
                    {stats.mostReviewed && (
                      <Badge tone="neutral">
                        <MessageSquareText size={11} />
                        {`Most reviewed · ${stats.mostReviewed.competitor.name} · ${stats.mostReviewed.count.toLocaleString("en-IE")}`}
                      </Badge>
                    )}
                    {stats.closest && (
                      <Badge tone="neutral">
                        <MapPin size={11} />
                        {`Closest · ${stats.closest.name} · ${stats.closest.distanceKm.toFixed(1)}km`}
                      </Badge>
                    )}
                  </div>
                )}
                <div>
                  {competitors.map((c, i) => {
                    const expanded = expandedId === c.id;
                    const ads = adsById[c.id] ?? [];
                    return (
                      <div key={c.id} style={{ borderTop: "1px solid var(--hairline)" }}>
                        <CompetitorRow
                          rank={i + 1}
                          competitor={c}
                          metric={metricsById[c.id] ?? null}
                          history={historyById[c.id] ?? []}
                          maxReviewCount={stats.maxReviewCount}
                          activeAdCount={ads.filter((a) => a.active).length}
                          expanded={expanded}
                          onToggle={() => setExpandedId(expanded ? null : c.id)}
                        />
                        {expanded && (
                          <CompetitorDetail
                            competitor={c}
                            history={historyById[c.id] ?? []}
                            reviews={reviewsById[c.id] ?? []}
                            ads={ads}
                            adLibraryConfigured={adLibraryConfigured}
                            isAdmin={isAdmin}
                            onBuildCampaign={handleBuildCampaign}
                            onMute={handleMute}
                            onLinkPage={handleLinkPage}
                            onUnlinkPage={handleUnlinkPage}
                            pending={curating}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          </SwapPane>
        )}
      </AnimatePresence>

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
            .mres-row-rank { flex: 0 0 auto; width: 20px; }
            .mres-row-name { flex: 1 1 200px; min-width: 0; }
            .mres-row-rating { flex: 0 0 auto; display: flex; align-items: center; gap: 7px; }
            .mres-row-reviews { flex: 0 0 auto; width: 138px; }
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
            .mres-ad-grid {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
              gap: 12px;
            }
            .mres-ad-card {
              display: flex;
              flex-direction: column;
              min-width: 0;
              overflow: hidden;
              background: var(--surface-1);
              border: 1px solid var(--hairline);
              border-radius: var(--radius);
              padding: 14px;
              box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);
              transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
            }
            .mres-ad-card:hover {
              transform: translateY(-3px);
              box-shadow: 0 12px 28px rgba(0, 0, 0, 0.32);
              border-color: var(--accent-ink);
            }
            .mres-ad-thumb {
              display: block;
              width: 100%;
              aspect-ratio: 16 / 9;
              object-fit: cover;
              border-radius: calc(var(--radius) - 3px);
              margin-bottom: 10px;
              background: var(--surface-2);
            }
            .mres-ad-advertiser {
              font-size: 10.5px;
              color: var(--text-tertiary);
              font-family: var(--font-mono), ui-monospace, monospace;
              margin: 0 0 6px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .mres-ad-copy {
              font-size: 12.5px;
              color: var(--text-secondary);
              line-height: 1.5;
              margin: 0 0 10px;
              display: -webkit-box;
              -webkit-line-clamp: 4;
              -webkit-box-orient: vertical;
              overflow: hidden;
              word-break: break-word;
              flex: 1;
            }
            .mres-ad-footer {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 8px;
              row-gap: 8px;
              flex-wrap: wrap;
              margin-top: auto;
              padding-top: 10px;
              border-top: 1px solid var(--hairline);
            }
            .mres-ad-watch {
              display: inline-flex;
              align-items: center;
              gap: 5px;
              font-size: 11.5px;
              font-weight: 600;
              color: var(--text-primary);
              background: var(--surface-2);
              border: 1px solid var(--hairline);
              border-radius: 999px;
              padding: 5px 11px;
              text-decoration: none;
              white-space: nowrap;
              flex-shrink: 0;
              transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
            }
            .mres-ad-watch svg { flex-shrink: 0; color: var(--accent-ink); }
            .mres-ad-watch:hover { background: var(--surface-3); border-color: var(--accent-ink); transform: translateY(-1px); }
            .mres-ad-actions {
              display: flex;
              align-items: center;
              gap: 6px;
              flex-shrink: 0;
            }
            .mres-ad-link-btn {
              display: inline-flex;
              align-items: center;
              gap: 5px;
              font-size: 10.5px;
              font-weight: 600;
              color: var(--text-tertiary);
              background: transparent;
              border: 1px solid var(--hairline);
              border-radius: 999px;
              padding: 5px 10px;
              white-space: nowrap;
              flex-shrink: 0;
              cursor: pointer;
              transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
            }
            .mres-ad-link-btn svg { flex-shrink: 0; }
            .mres-ad-link-btn:hover:not(:disabled) { background: var(--surface-2); border-color: var(--accent-ink); color: var(--text-primary); }
            .mres-ad-link-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            @media (max-width: 640px) {
              .mres-row-spark { display: none; }
              .mres-row-rank { display: none; }
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

/**
 * Cross-fades one pane out and the next in — used both for the
 * ScanningProgress ⟷ real-content swap (all three populated-ish states) so
 * neither transition is an abrupt cut. `mode="wait"` (set by the caller's
 * AnimatePresence) matters here specifically because the two panes are
 * different heights (a ~400px scanning panel vs. a full dashboard) —
 * without it the entering pane would overlap the exiting one mid-swap.
 * Reduced motion drops the `y` rise (a transform) but keeps the opacity
 * cross-fade, matching this component's explicit-gate convention.
 */
function SwapPane({ children, reduceMotion }: { children: ReactNode; reduceMotion: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 0, transition: { duration: DUR.fast, ease: [...EASE] } }}
      transition={{ duration: reduceMotion ? 0 : DUR.base, ease: [...EASE] }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A stat tile for the Landscape card's stat strip. The eyebrow (icon +
 * label) stays small/mono up top; the VALUE is the hero — heading font,
 * substantially larger than the eyebrow (28-34px range) so a glance lands on
 * the number first, matching the same big-number recipe Card.tsx's
 * CardValue and AttendanceDashboard's own stat strip already use elsewhere
 * in the app (font-heading, ~30px, tight line-height).
 */
function StatTile({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--surface-2)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        flex: "1 1 160px",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--text-tertiary)" }}>
        {icon}
        <span
          style={{
            fontFamily: "var(--font-mono), ui-monospace, monospace",
            fontSize: 9.5,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          fontFamily: "var(--font-heading), sans-serif",
          fontSize: 30,
          lineHeight: 1.15,
          color: "var(--text-primary)",
          marginTop: 6,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

interface CompetitorStats {
  count: number;
  avgRating: number | null;
  topRated: { competitor: CompetitorRowData; rating: number } | null;
  mostReviewed: { competitor: CompetitorRowData; count: number } | null;
  /** `competitors[0]` — the store's own listCompetitors() is already
   *  nearest-first (see that contract note on ResearchViewProps above), so
   *  this needs no distance comparison of its own. */
  closest: CompetitorRowData | null;
  /** The highest tracked reviewCount — the denominator CompetitorRow's
   *  review-volume bar scales every row's width against. */
  maxReviewCount: number;
}

/**
 * Pure roll-up over props already in hand (competitors + their latest
 * metric) — the Landscape stat strip and the Competitors highlight chips
 * both read from one pass rather than each re-deriving their own. Never
 * reads history/reviews, never touches lib/research: this is display math
 * over data page.tsx already fetched for free.
 */
function computeCompetitorStats(
  competitors: CompetitorRowData[],
  metricsById: Record<number, Metric | null>,
): CompetitorStats {
  let ratingSum = 0;
  let ratingCount = 0;
  let topRated: CompetitorStats["topRated"] = null;
  let mostReviewed: CompetitorStats["mostReviewed"] = null;
  let maxReviewCount = 0;

  for (const competitor of competitors) {
    const metric = metricsById[competitor.id];
    if (metric?.ratingMilli != null) {
      const rating = metric.ratingMilli / 1000;
      ratingSum += rating;
      ratingCount += 1;
      if (!topRated || rating > topRated.rating) topRated = { competitor, rating };
    }
    if (metric?.reviewCount != null) {
      if (metric.reviewCount > maxReviewCount) maxReviewCount = metric.reviewCount;
      if (!mostReviewed || metric.reviewCount > mostReviewed.count) mostReviewed = { competitor, count: metric.reviewCount };
    }
  }

  return {
    count: competitors.length,
    avgRating: ratingCount > 0 ? ratingSum / ratingCount : null,
    topRated,
    mostReviewed,
    closest: competitors[0] ?? null,
    maxReviewCount,
  };
}
