"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, ExternalLink, Radar, RefreshCw } from "lucide-react";

import type { ContentGap } from "@/lib/research/gaps";
import type { ContentGapPerCompetitor } from "@/lib/research/contentScan";
import type { ScanContentActionResult } from "@/app/marketing/research/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FieldError, Label, Textarea } from "@/components/ui/Input";
import { BuildCampaignLink } from "@/components/marketing/BuildCampaignLink";
import { relativeTime } from "@/lib/utils";
import { findExampleLink } from "./matchExamplePage";

/**
 * Content-gap analysis's UI section — a new card in the Market Research tab
 * (marketing/research/page.tsx -> ResearchView -> here), rendered EXCLUSIVELY
 * from props: `gaps`/`perCompetitor`/`seedKeywords` are the plain read
 * `getContentGaps(tenantId)` already produced server-side (never re-fetched
 * or re-derived here), and the two mutations (`onScanContent`/
 * `onSaveKeywords`) are Server Actions handed down as props exactly the way
 * ResearchView already hands `onRescan`/`onSetFlags`/etc. to its children —
 * see that file's own doc comment for why (a Server Component may pass a
 * Server Action to a Client Component this way). "use client" is required
 * here regardless of that data-only contract: this file is rendered directly
 * from within ResearchView's own client render tree (not via a Server
 * Component `children` slot), and it owns two genuinely interactive bits of
 * its own — the per-competitor collapsible breakdown, and the two forms'
 * pending/result state (`useFormState`/`useFormStatus`, mirroring
 * src/components/cms/DomainsManager.tsx's exact `<form action={...}>` +
 * `useFormState` + a wrapped `router.refresh()` pattern).
 *
 * `perCompetitor` is the tenant's FULL tracked watchlist INCLUDING the
 * `isSelf` row (unlike ResearchView's own self-excluding `competitors` prop)
 * — see contentScan.ts's `getContentGaps` doc comment for why: content-gap
 * math needs your own site's derived topic set to know what NOT to flag.
 * The self row is never filtered out here either; `CompetitorPagesRow`
 * below renders it distinctly (an accent "Your site" tag) and sorted first,
 * matching ResearchView's own "Your gym" reference-row treatment one level
 * up. `gaps` is already ranked + capped by `computeContentGaps` — rendered
 * in the given order, never re-sorted here.
 */

interface ContentGapsProps {
  gaps: ContentGap[];
  perCompetitor: ContentGapPerCompetitor[];
  seedKeywords: string[];
  /** `getCurrentMembership()?.role === "admin"` (page.tsx) — gates the Scan
   *  + keywords forms below. Always true in practice (marketing/research's
   *  whole page is already `requireAdminPage()`-gated), threaded through
   *  anyway so the gate is legible here, matching CompetitorDetail's own
   *  `isAdmin` prop. Never gates "Draft this" — that's a plain link into
   *  /adonis, staff-visible like the rest of that chat. */
  isAdmin: boolean;
  onScanContent?: () => Promise<ScanContentActionResult>;
  onSaveKeywords?: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
}

// Stable module-level references (NOT recreated per render) — `scanResultLabel`
// below compares the live `useFormState` value against this exact object to
// tell "never submitted" apart from "submitted, nothing went wrong" (whose
// result shape would otherwise be indistinguishable from the initial one).
const SCAN_INITIAL: ScanContentActionResult = { ok: false };
const KEYWORDS_INITIAL: { ok: boolean; error?: string } = { ok: false };

function ScanButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? (
        "Scanning…"
      ) : (
        <>
          <RefreshCw size={14} /> Scan competitor sites
        </>
      )}
    </Button>
  );
}

function SaveKeywordsButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save keywords"}
    </Button>
  );
}

/** Turns a resolved scanContentAction() result into one line of feedback —
 *  null before the first submit (reference-equal to SCAN_INITIAL). */
function scanResultLabel(result: ScanContentActionResult): { text: string; tone: "green" | "red" } | null {
  if (result === SCAN_INITIAL) return null;
  if (!result.ok) {
    return {
      text:
        result.error === "cap_reached"
          ? "This month's research spend cap has been reached — an admin can raise it in Settings."
          : result.error || "Scan failed — please try again.",
      tone: "red",
    };
  }
  const scanned = result.scanned ?? 0;
  const pages = result.pages ?? 0;
  const failures = result.failures ?? 0;
  const failureNote = failures > 0 ? `, ${failures} failed` : "";
  return {
    text: `Scanned ${scanned} site${scanned === 1 ? "" : "s"} — ${pages} page${pages === 1 ? "" : "s"} found${failureNote}.`,
    tone: "green",
  };
}

/** The "Draft this" seed's short hook — real facts only (competitor
 *  count/name straight off the gap), never a fabricated claim. */
function gapAngle(gap: ContentGap): string {
  if (gap.source === "keyword" && !gap.exampleCompetitor) {
    return `A target keyword from your own list that no tracked competitor covers yet.`;
  }
  const who = gap.exampleCompetitor ? ` (e.g. ${gap.exampleCompetitor})` : "";
  return `${gap.competitorCount} of ${gap.totalCompetitors} tracked competitors${who} cover "${gap.topic}" on their site — yours doesn't yet.`;
}

export function ContentGaps({ gaps, perCompetitor, seedKeywords, isAdmin, onScanContent, onSaveKeywords }: ContentGapsProps) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [scanState, scanDispatch] = useFormState(
    async (prev: ScanContentActionResult, _formData: FormData) => (onScanContent ? onScanContent() : prev),
    SCAN_INITIAL,
  );
  const [keywordsState, keywordsDispatch] = useFormState(
    async (prev: { ok: boolean; error?: string }, formData: FormData) => (onSaveKeywords ? onSaveKeywords(formData) : prev),
    KEYWORDS_INITIAL,
  );

  const lastScannedAt = perCompetitor.reduce<number | null>((max, c) => {
    if (c.lastScannedAt == null) return max;
    return max == null || c.lastScannedAt > max ? c.lastScannedAt : max;
  }, null);
  const scanFeedback = scanResultLabel(scanState);
  // Self pinned first — mirrors ResearchView's own "Your gym" reference row
  // sitting above the ranked competitor list one level up. Array#sort is
  // stable (ES2019+), so non-self rows keep their incoming (nearest-first)
  // relative order.
  const orderedCompetitors = [...perCompetitor].sort((a, b) => (b.isSelf ? 1 : 0) - (a.isSelf ? 1 : 0));

  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          padding: "16px 16px 14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <CardLabel style={{ marginBottom: 6 }}>Content gaps</CardLabel>
          <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55, margin: 0 }}>
            Crawls each competitor&apos;s site, reads their pages, and finds topics they cover that yours doesn&apos;t.
          </p>
          <p style={{ fontSize: 11.5, color: "var(--text-tertiary)", margin: "6px 0 0" }}>
            Based on on-page content only — not page-views, opens, or traffic.
          </p>
          <p
            style={{
              fontSize: 11,
              color: "var(--text-tertiary)",
              margin: "8px 0 0",
              fontFamily: "var(--font-mono), ui-monospace, monospace",
            }}
          >
            {lastScannedAt ? `Last scanned ${relativeTime(lastScannedAt)}` : "Never scanned yet"}
          </p>
        </div>
        {isAdmin && onScanContent && (
          <form
            action={async (fd) => {
              const res = await scanDispatch(fd);
              router.refresh();
              return res;
            }}
          >
            <ScanButton />
          </form>
        )}
      </div>
      {scanFeedback && (
        <div style={{ padding: "0 16px 14px" }}>
          <span style={{ fontSize: 12, color: scanFeedback.tone === "red" ? "#f87171" : "#4ade80" }}>{scanFeedback.text}</span>
        </div>
      )}

      {isAdmin && onSaveKeywords && (
        <div style={{ borderTop: "1px solid var(--hairline)", padding: "14px 16px" }}>
          <Label htmlFor="research-keywords">Your target keywords</Label>
          <form
            action={async (fd) => {
              const res = await keywordsDispatch(fd);
              router.refresh();
              return res;
            }}
            style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 560 }}
          >
            <Textarea
              id="research-keywords"
              name="keywords"
              defaultValue={seedKeywords.join("\n")}
              rows={3}
              placeholder="One per line, or comma-separated — e.g. sports massage, deep tissue, injury rehab"
              style={{ fontSize: 13 }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <SaveKeywordsButton />
              {keywordsState !== KEYWORDS_INITIAL &&
                (keywordsState.error ? (
                  <FieldError message={keywordsState.error} />
                ) : (
                  <span style={{ fontSize: 12, color: "#4ade80" }}>Saved.</span>
                ))}
            </div>
          </form>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--hairline)" }}>
        {gaps.length === 0 ? (
          <div style={{ padding: 16 }}>
            <EmptyState
              icon={<Radar size={28} strokeWidth={1.4} />}
              title="No content gaps yet"
              message={
                isAdmin
                  ? "Run a scan (above) to crawl your tracked competitors' sites and see which topics they cover that yours doesn't."
                  : "An admin needs to run the first scan before content gaps show up here."
              }
            />
          </div>
        ) : (
          gaps.map((gap, i) => <GapRow key={`${gap.source}-${gap.topic}-${i}`} gap={gap} perCompetitor={perCompetitor} />)
        )}
      </div>

      {orderedCompetitors.length > 0 && (
        <>
          <div style={{ borderTop: "1px solid var(--hairline)", padding: "14px 16px 4px" }}>
            <CardLabel style={{ marginBottom: 0 }}>Site breakdown</CardLabel>
          </div>
          <div>
            {orderedCompetitors.map((c) => (
              <CompetitorPagesRow
                key={c.competitorId}
                competitor={c}
                expanded={expandedId === c.competitorId}
                onToggle={() => setExpandedId(expandedId === c.competitorId ? null : c.competitorId)}
              />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

/** One ranked content-gap row — topic, coverage/keyword badge, Missing
 *  status, a best-effort example link, and the "Draft this" seed CTA. */
function GapRow({ gap, perCompetitor }: { gap: ContentGap; perCompetitor: ContentGapPerCompetitor[] }) {
  const example = findExampleLink(perCompetitor, gap.exampleCompetitor, gap.topic);

  return (
    <div style={{ padding: "14px 16px", borderTop: "1px solid var(--hairline)", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{gap.topic}</span>
        {!gap.coveredByYou && <Badge tone="red">Missing</Badge>}
        {gap.source === "keyword" && <Badge tone="amber">Your keyword list</Badge>}
        {(gap.source === "competitors" || gap.competitorCount > 0) && (
          <Badge tone="neutral">{`Covered by ${gap.competitorCount} of ${gap.totalCompetitors} competitors`}</Badge>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", minWidth: 0 }}>
          {example ? (
            <a
              href={example.url}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--text-secondary)", display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              {example.isFallback ? `See ${example.competitorName}'s site` : `See ${example.competitorName}'s page`}
              <ExternalLink size={11} />
            </a>
          ) : gap.exampleCompetitor ? (
            `e.g. ${gap.exampleCompetitor}`
          ) : null}
        </div>
        <BuildCampaignLink seedName={gap.topic} angle={gapAngle(gap)}>
          Draft this
        </BuildCampaignLink>
      </div>
    </div>
  );
}

/** One competitor's collapsible crawl breakdown — status summary line
 *  (page/topic counts + last scan, or why it hasn't been scanned) plus, when
 *  expanded, its derived topic set and each crawled page's on-page SEO read.
 *  Mirrors CompetitorRow/CompetitorDetail's own row+chevron expand pattern
 *  one level up in this same tab. */
function CompetitorPagesRow({
  competitor,
  expanded,
  onToggle,
}: {
  competitor: ContentGapPerCompetitor;
  expanded: boolean;
  onToggle: () => void;
}) {
  const statusLabel = !competitor.websiteUri
    ? "No website on file"
    : competitor.lastScannedAt == null
      ? "Not scanned yet"
      : `${competitor.pages.length} page${competitor.pages.length === 1 ? "" : "s"} · ${competitor.topics.length} topic${competitor.topics.length === 1 ? "" : "s"} · scanned ${relativeTime(competitor.lastScannedAt)}`;

  return (
    <div style={{ borderTop: "1px solid var(--hairline)" }}>
      <div
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
        style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", cursor: "pointer", flexWrap: "wrap" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 200px", minWidth: 0 }}>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 500,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {competitor.competitorName}
          </span>
          {competitor.isSelf && (
            <Badge colour="#ff8a5c" style={{ flexShrink: 0 }}>
              Your site
            </Badge>
          )}
        </div>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)", flexShrink: 0 }}>{statusLabel}</span>
        {expanded ? (
          <ChevronDown size={15} color="var(--text-tertiary)" aria-hidden />
        ) : (
          <ChevronRight size={15} color="var(--text-tertiary)" aria-hidden />
        )}
      </div>

      {expanded && (
        <div style={{ padding: "0 16px 16px" }}>
          {competitor.topics.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {competitor.topics.map((t) => (
                <Badge key={t} tone="neutral">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          {competitor.pages.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: 0 }}>
              {competitor.websiteUri
                ? "No pages captured on the last scan."
                : "Add a website for this competitor (Places discovery, or set one manually) to include it in a scan."}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {competitor.pages.map((p) => (
                <div key={p.id} style={{ padding: "8px 0", borderTop: "1px solid var(--hairline)" }}>
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12.5, color: "var(--text-primary)", textDecoration: "none", wordBreak: "break-word" }}
                  >
                    {p.title || p.path}
                  </a>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                    {p.metaDescription ? "Meta ✓" : "Meta ✗"} · H1: {p.h1 || "—"} · {p.wordCount.toLocaleString("en-IE")} words
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
