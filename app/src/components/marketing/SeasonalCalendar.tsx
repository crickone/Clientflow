import Link from "next/link";
import { Radar, Megaphone } from "lucide-react";

import { Card, CardLabel } from "@/components/ui/Card";
import type { Campaign } from "@/lib/campaigns/store";
import type { CalendarNotes } from "@/lib/marketing/calendarNotes";
import { MonthNote } from "@/components/marketing/PlanNotes";
import type { RadarSuggestion } from "@/lib/marketing/campaignRadar";
import { seasonForMonth, type CalDate, type Season, type SeasonBand } from "@/lib/marketing/seasonalCalendar";
import { BuildCampaignLink } from "./BuildCampaignLink";

interface Props {
  year: number;
  dates: CalDate[];
  seasons: SeasonBand[];
  campaigns: Campaign[];
  radar: RadarSuggestion[];
  notes: CalendarNotes;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SEASON_LABEL: Record<Season, string> = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };
// Inline tint recipe (bg alpha ~0.1 over the dark surface, a bright fg ink,
// a slightly stronger border alpha for the cell outline) mirrors Badge.tsx's
// "inks brightened for the dark surface" tone map — there's no dedicated
// season token in globals.css (the existing --accent-hbot/-ir/-pemf trio is
// Renova-therapy-specific, not something a multi-tenant page should key
// off), so these 4 are defined here, once, for this component only.
const SEASON_TINT: Record<Season, { bg: string; border: string; fg: string }> = {
  spring: { bg: "rgba(134, 239, 172, 0.09)", border: "rgba(134, 239, 172, 0.28)", fg: "#86efac" },
  summer: { bg: "rgba(253, 224, 71, 0.09)", border: "rgba(253, 224, 71, 0.28)", fg: "#fde047" },
  autumn: { bg: "rgba(251, 146, 60, 0.09)", border: "rgba(251, 146, 60, 0.28)", fg: "#fb923c" },
  winter: { bg: "rgba(125, 211, 252, 0.09)", border: "rgba(125, 211, 252, 0.28)", fg: "#7dd3fc" },
};

const pad = (n: number) => String(n).padStart(2, "0");

/** TZ-safe ISO ("YYYY-MM-DD") -> "16 Feb": string-split, never routes through
 *  `new Date(iso)` + locale formatting, which can roll a date-only string
 *  back a day when the server's local timezone is behind UTC — the same
 *  reason seasonalCalendar.ts does all its own math in explicit UTC. */
function fmtIso(iso: string): string {
  const [, m, d] = iso.split("-");
  const mi = Number(m) - 1;
  return `${Number(d)} ${MONTH_SHORT[mi] ?? m}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthRange(year: number, month: number): { start: string; end: string } {
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(daysInMonth(year, month))}` };
}

/** Catalog dates that fall in this month, chronological. */
function datesInMonth(dates: CalDate[], month: number): CalDate[] {
  return dates
    .filter((d) => Number(d.iso.slice(5, 7)) === month)
    .sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
}

/** Campaigns whose explicit startsOn..endsOn range overlaps this month, or —
 *  for a campaign with no dates at all — whose `season` matches the month's
 *  season. ISO "YYYY-MM-DD" strings compare lexically = chronologically, so
 *  plain string comparison is enough (no Date parsing, no TZ risk). */
function campaignsInMonth(campaigns: Campaign[], year: number, month: number): Campaign[] {
  const { start, end } = monthRange(year, month);
  const season = seasonForMonth(month);
  return campaigns.filter((c) => {
    if (c.startsOn && c.endsOn) return c.startsOn <= end && c.endsOn >= start;
    if (c.startsOn) return c.startsOn >= start && c.startsOn <= end;
    if (c.season) return c.season.toLowerCase() === season;
    return false;
  });
}

/** Whether some campaign already targets this exact catalog date (an exact
 *  startsOn match, or falling inside a startsOn..endsOn range) — gates the
 *  per-date "Build campaign" affordance so an occasion that already has a
 *  campaign doesn't also prompt to build another one. Deliberately does NOT
 *  count a season-only campaign (no dates) as "covering" a specific date —
 *  that match is too loose to suppress a date-specific suggestion. */
function dateHasCampaign(campaigns: Campaign[], iso: string): boolean {
  return campaigns.some((c) => {
    if (!c.startsOn) return false;
    if (c.endsOn) return c.startsOn <= iso && c.endsOn >= iso;
    return c.startsOn === iso;
  });
}

function daysAwayLabel(daysAway: number): string {
  if (daysAway <= 0) return "today";
  if (daysAway === 1) return "tomorrow";
  return `in ${daysAway} days`;
}

/**
 * Campaign Engine Slice 3 (Task 3): the visible seasonal calendar — a
 * radar-driven "coming up" rail above a 12-month year grid of Irish
 * holidays/awareness days/seasons overlaid with the tenant's real campaigns.
 * Presentational + server-rendered (no client JS): every interactive bit is
 * a plain `<Link>`, either into an existing campaign
 * (/marketing/campaigns/[id]) or into the Marketing agent chat pre-seeded
 * via BuildCampaignLink.
 */
export function SeasonalCalendar({ year, dates, seasons, campaigns, radar, notes }: Props) {
  return (
    <div>
      <ComingUpRail radar={radar} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <YearNavLink year={year - 1} label="Previous year">
            ‹
          </YearNavLink>
          <span
            style={{
              fontFamily: "var(--font-heading), sans-serif",
              fontSize: 20,
              color: "var(--text-primary)",
              textTransform: "uppercase",
              minWidth: 68,
              textAlign: "center",
            }}
          >
            {year}
          </span>
          <YearNavLink year={year + 1} label="Next year">
            ›
          </YearNavLink>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {seasons.map((s) => (
            <span key={s.season} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-tertiary)" }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: SEASON_TINT[s.season].fg, flexShrink: 0 }} aria-hidden />
              {SEASON_LABEL[s.season]}
            </span>
          ))}
        </div>
      </div>

      <div className="szncal-scroll">
        <div className="szncal-grid">
          {MONTH_NAMES.map((name, i) => {
            const month = i + 1;
            const season = seasonForMonth(month);
            const tint = SEASON_TINT[season];
            const monthDates = datesInMonth(dates, month);
            const monthCampaigns = campaignsInMonth(campaigns, year, month);
            const empty = monthDates.length === 0 && monthCampaigns.length === 0;

            return (
              <div key={month} className="szncal-month" style={{ background: tint.bg, borderColor: tint.border }}>
                <div className="szncal-month-head" style={{ color: tint.fg }}>
                  {name}
                </div>

                {empty ? (
                  <div className="szncal-empty">
                    <span>No dates this month.</span>
                    <BuildCampaignLink season={season} startsOn={`${year}-${pad(month)}-01`} compact>
                      + Build
                    </BuildCampaignLink>
                  </div>
                ) : (
                  <div className="szncal-month-body">
                    {monthDates.map((d) => {
                      const covered = dateHasCampaign(campaigns, d.iso);
                      return (
                        <div
                          key={d.id}
                          className={`szncal-date ${d.kind === "public-holiday" ? "szncal-date--holiday" : "szncal-date--awareness"}`}
                        >
                          <span className="szncal-date-dot" aria-hidden />
                          <span className="szncal-date-name">{d.name}</span>
                          <span className="szncal-date-day">{fmtIso(d.iso)}</span>
                          {!covered && (
                            <BuildCampaignLink seedName={d.name} season={season} startsOn={d.iso} angle={d.angle} iconOnly compact />
                          )}
                        </div>
                      );
                    })}
                    {monthCampaigns.map((c) => (
                      <Link key={c.id} href={`/marketing/campaigns/${c.id}`} className="szncal-chip">
                        {c.name}
                      </Link>
                    ))}
                  </div>
                )}
                {(notes.campaignNotes[String(month)] ?? []).map((line, i) => (
                  <div key={i} className="szncal-auto-note" title="Recorded when this campaign was created">
                    <Megaphone size={10} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>{line}</span>
                  </div>
                ))}
                <MonthNote
                  year={year}
                  month={month}
                  initialNote={notes.months[String(month)] ?? ""}
                />
              </div>
            );
          })}
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .szncal-scroll { overflow-x: auto; padding-bottom: 6px; }
            .szncal-note,
            .szncal-note-add {
              display: flex;
              align-items: flex-start;
              gap: 6px;
              width: 100%;
              margin-top: 8px;
              padding: 7px 9px;
              border-radius: var(--radius-sm);
              border: 1px dashed var(--hairline);
              background: rgba(255, 255, 255, 0.03);
              color: var(--text-secondary);
              font-family: inherit;
              font-size: 11.5px;
              line-height: 1.45;
              text-align: left;
              cursor: pointer;
              transition: border-color 0.15s var(--ease), color 0.15s var(--ease);
            }
            .szncal-note:hover,
            .szncal-note-add:hover {
              border-color: var(--hairline-strong);
              color: var(--text-primary);
            }
            .szncal-note-add { align-items: center; color: var(--text-tertiary); font-size: 11px; }
            /* Campaign lines the app recorded — read-only, so they read as a
               record rather than an editable note. */
            .szncal-auto-note {
              display: flex;
              align-items: flex-start;
              gap: 6px;
              margin-top: 8px;
              padding: 6px 9px;
              border-radius: var(--radius-sm);
              border: 1px solid var(--grid);
              background: var(--surface-2);
              color: var(--text-secondary);
              font-size: 11px;
              line-height: 1.4;
            }
            .szncal-grid {
              display: grid;
              grid-template-columns: repeat(4, minmax(210px, 1fr));
              gap: 12px;
              min-width: 880px;
            }
            .szncal-month {
              border: 1px solid var(--hairline);
              border-radius: var(--radius);
              padding: 14px;
              display: flex;
              flex-direction: column;
              gap: 10px;
              min-height: 108px;
            }
            .szncal-month-head {
              font-family: var(--font-mono), ui-monospace, monospace;
              font-size: 11px;
              font-weight: 600;
              letter-spacing: 0.08em;
              text-transform: uppercase;
            }
            .szncal-month-body { display: flex; flex-direction: column; gap: 7px; }
            .szncal-empty {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 10px;
              flex: 1;
              font-size: 12px;
              color: var(--text-tertiary);
            }
            .szncal-date {
              display: flex;
              align-items: center;
              gap: 7px;
              font-size: 12.5px;
              color: var(--text-secondary);
            }
            .szncal-date-dot { width: 7px; height: 7px; border-radius: 999px; flex-shrink: 0; }
            .szncal-date--holiday .szncal-date-dot { background: var(--text-primary); }
            .szncal-date--holiday .szncal-date-name { font-weight: 600; color: var(--text-primary); }
            .szncal-date--awareness .szncal-date-dot { background: transparent; border: 1.5px solid var(--text-tertiary); }
            .szncal-date-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .szncal-date-day {
              font-family: var(--font-mono), ui-monospace, monospace;
              color: var(--text-tertiary);
              font-size: 10.5px;
              flex-shrink: 0;
            }
            .szncal-chip {
              display: inline-flex;
              align-items: center;
              align-self: flex-start;
              font-size: 11.5px;
              font-weight: 600;
              color: var(--accent-ink);
              background: var(--accent-soft);
              border: 1px solid var(--accent);
              border-radius: var(--radius);
              padding: 4px 9px;
              text-decoration: none;
              max-width: 100%;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }
            @media (max-width: 760px) {
              .szncal-grid { grid-template-columns: 1fr; min-width: 0; }
            }
          `,
        }}
      />
    </div>
  );
}

function YearNavLink({ year, label, children }: { year: number; label: string; children: string }) {
  return (
    <Link
      href={`/marketing/calendar?year=${year}`}
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: "var(--radius)",
        border: "1px solid var(--hairline)",
        color: "var(--text-secondary)",
        textDecoration: "none",
        fontSize: 16,
      }}
    >
      {children}
    </Link>
  );
}

function ComingUpRail({ radar }: { radar: RadarSuggestion[] }) {
  return (
    <Card style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <CardLabel>
          <Radar size={11} style={{ display: "inline", verticalAlign: -1, marginRight: 6 }} />
          Coming up
        </CardLabel>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 10 }}>
          Next 60 days, from today — independent of the year browsed below
        </span>
      </div>

      {radar.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: "12px 0 0", lineHeight: 1.5 }}>
          Nothing on the radar in the next 60 days. Browse the year below for what&apos;s further out.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {radar.map((r, i) => (
            <div
              key={r.dateId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "12px 0",
                borderTop: i === 0 ? "none" : "1px solid var(--hairline)",
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 128 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>{r.dateName}</div>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-mono), ui-monospace, monospace" }}>
                  {fmtIso(r.dateIso)} · {daysAwayLabel(r.daysAway)}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 220, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                <strong style={{ color: "var(--text-primary)", fontWeight: 600 }}>{r.suggestionName}</strong>
                {" — "}
                {r.suggestionHook}
              </div>
              <BuildCampaignLink seedName={r.suggestionName} startsOn={r.dateIso} angle={r.suggestionHook} compact />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
