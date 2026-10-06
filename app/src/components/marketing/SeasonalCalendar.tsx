import Link from "next/link";
import { Megaphone, Radar } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { MonthNote } from "@/components/marketing/PlanNotes";
import type { RadarSuggestion } from "@/lib/marketing/campaignRadar";
import { startBy } from "@/lib/marketing/calendarRules";
import type { CalEntry, MonthView } from "@/lib/marketing/calendarView";
import { seasonForMonth, type Season } from "@/lib/marketing/seasonalCalendar";
import { BuildCampaignLink } from "./BuildCampaignLink";
import { AddCalendarDate, RemoveCalendarDate } from "./CalendarDates";

interface Props {
  /** A calendar year, or null for the next twelve months from today. */
  year: number | null;
  todayIso: string;
  view: MonthView[];
  radar: RadarSuggestion[];
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SEASON_LABEL: Record<Season, string> = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };
// Inline tint recipe (bg alpha ~0.1 over the dark surface, a bright fg ink,
// a slightly stronger border alpha for the cell outline). Defined here, once,
// for this component only: no season token exists in globals.css.
const SEASON_TINT: Record<Season, { bg: string; border: string; fg: string }> = {
  spring: { bg: "rgba(134, 239, 172, 0.09)", border: "rgba(134, 239, 172, 0.28)", fg: "#86efac" },
  summer: { bg: "rgba(253, 224, 71, 0.09)", border: "rgba(253, 224, 71, 0.28)", fg: "#fde047" },
  autumn: { bg: "rgba(251, 146, 60, 0.09)", border: "rgba(251, 146, 60, 0.28)", fg: "#fb923c" },
  winter: { bg: "rgba(125, 211, 252, 0.09)", border: "rgba(125, 211, 252, 0.28)", fg: "#7dd3fc" },
};

const pad = (n: number) => String(n).padStart(2, "0");

/** TZ-safe ISO ("YYYY-MM-DD") -> "16 Feb": string-split, never through `new Date(iso)` + locale formatting. */
function fmtIso(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${MONTH_SHORT[Number(m) - 1] ?? m}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function daysAwayLabel(daysAway: number): string {
  if (daysAway <= 0) return "today";
  if (daysAway === 1) return "tomorrow";
  return `in ${daysAway} days`;
}

const KIND_LABEL: Record<CalEntry["kind"], string> = {
  "public-holiday": "Bank holiday",
  "awareness-day": "Awareness day",
  school: "School date",
  custom: "Your date",
};

/**
 * The seasonal calendar: the radar's "coming up" panel above twelve month
 * cards. By default the twelve months start at this one; ?year= shows a
 * calendar year. Each date says whether a campaign covers it (and how that
 * went), or when one would need to start. Clicking a date opens its campaign,
 * or Adonis with the campaign brief filled in.
 */
export function SeasonalCalendar({ year, todayIso, view, radar }: Props) {
  const thisYear = Number(todayIso.slice(0, 4));
  return (
    <div>
      <ComingUpRail radar={radar} todayIso={todayIso} />

      <div className="szn-bar">
        <nav className="szn-views" aria-label="Which months">
          <Link href="/marketing/calendar" className={year === null ? "is-on" : undefined} aria-current={year === null ? "page" : undefined}>
            Next 12 months
          </Link>
          {[thisYear, thisYear + 1].map((y) => (
            <Link key={y} href={`/marketing/calendar?year=${y}`} className={year === y ? "is-on" : undefined} aria-current={year === y ? "page" : undefined}>
              {y}
            </Link>
          ))}
          {year !== null && year !== thisYear && year !== thisYear + 1 && <span className="is-on">{year}</span>}
        </nav>
        <AddCalendarDate />
      </div>

      <div className="szn-key">
        <span><i className="szn-dot k-public-holiday" aria-hidden /> Bank holiday</span>
        <span><i className="szn-dot k-awareness-day" aria-hidden /> Awareness day</span>
        <span><i className="szn-dot k-school" aria-hidden /> School date (typical, check your local schools)</span>
        <span><i className="szn-dot k-custom" aria-hidden /> Your date</span>
        <span className="szn-key-gap" />
        {(["spring", "summer", "autumn", "winter"] as Season[]).map((s) => (
          <span key={s}>
            <i className="szn-swatch" style={{ background: SEASON_TINT[s].fg }} aria-hidden /> {SEASON_LABEL[s]}
          </span>
        ))}
      </div>

      <div className="szn-grid">
        {view.map((m) => (
          <MonthCard key={`${m.year}-${m.month}`} m={m} showYear={m.year !== thisYear || m.month === 1} />
        ))}
      </div>
    </div>
  );
}

function MonthCard({ m, showYear }: { m: MonthView; showYear: boolean }) {
  const tint = SEASON_TINT[m.season];
  const { posts, emails } = m.activity;
  const sent = m.past;
  const activity =
    posts + emails > 0
      ? `${posts ? `${posts} post${posts === 1 ? "" : "s"}` : ""}${posts && emails ? " and " : ""}${emails ? `${emails} email${emails === 1 ? "" : "s"}` : ""} ${sent ? "sent" : "scheduled"}`
      : m.past
        ? null
        : "Nothing scheduled yet";
  return (
    <section
      className={`szn-month${m.past ? " is-past" : ""}${m.current ? " is-now" : ""}`}
      style={{ background: tint.bg, borderColor: m.current ? tint.fg : tint.border }}
      aria-label={`${MONTH_NAMES[m.month - 1]} ${m.year}`}
    >
      <header className="szn-month-head">
        <h3 style={{ color: tint.fg }}>
          {MONTH_NAMES[m.month - 1]}
          {showYear && <span className="szn-month-year"> {m.year}</span>}
        </h3>
        {m.current && <span className="szn-now">This month</span>}
      </header>

      {m.entries.length === 0 && m.campaigns.length === 0 ? (
        <div className="szn-empty">
          <span>No dates this month.</span>
          {!m.past && (
            <BuildCampaignLink season={m.season} startsOn={`${m.year}-${pad(m.month)}-01`} compact>
              Plan something
            </BuildCampaignLink>
          )}
        </div>
      ) : (
        <ul className="szn-list">
          {m.entries.map((e) => (
            <EntryRow key={e.key} e={e} />
          ))}
          {m.campaigns.map((c) => (
            <li key={`c${c.id}`} className="szn-row">
              <Link href={`/marketing/campaigns/${c.id}`} className="szn-row-link">
                <Megaphone size={12} className="szn-row-icon" aria-hidden />
                <span className="szn-row-main">
                  <span className="szn-row-name">{c.name}</span>
                  {c.result && <span className="szn-row-sub">{c.result}</span>}
                </span>
                {c.status && <span className={`szn-status t-${c.status.tone}`}>{c.status.label}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {m.campaignNotes.map((line, i) => (
        <div key={i} className="szncal-auto-note" title="Recorded when this campaign was created">
          <Megaphone size={10} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{line}</span>
        </div>
      ))}

      <footer className="szn-month-foot">
        {activity && <span className={posts + emails > 0 ? "szn-activity" : "szn-activity is-quiet"}>{activity}</span>}
        <MonthNote year={m.year} month={m.month} initialNote={m.note} />
      </footer>
    </section>
  );
}

function EntryRow({ e }: { e: CalEntry }) {
  const note = e.covered?.result ?? e.lastTime;
  return (
    <li className={`szn-row k-${e.kind}${e.past ? " is-past" : ""}`}>
      <Link href={e.href} className="szn-row-link" title={KIND_LABEL[e.kind]}>
        <i className={`szn-dot k-${e.kind}`} aria-hidden />
        <span className="szn-row-main">
          <span className="szn-row-name">{e.name}</span>
          {e.start && !e.covered ? (
            <span className={`szn-row-sub szn-start t-${e.start.tone}`}>
              {e.start.tone === "late" ? "Start now" : `Start by ${fmtIso(e.start.iso)}`}
              {note ? ` · ${note}` : ""}
            </span>
          ) : (
            note && <span className="szn-row-sub">{note}</span>
          )}
        </span>
        <span className="szn-row-end">
          {e.covered && <span className={`szn-status t-${e.covered.tone}`}>{e.covered.label}</span>}
          <span className="szn-row-day">{fmtIso(e.iso)}</span>
          {!e.covered && !e.past && <span className="szn-build">Build</span>}
        </span>
      </Link>
      {e.customId && <RemoveCalendarDate id={e.customId} name={e.name} />}
    </li>
  );
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** ISO + n days, in UTC, same TZ discipline as fmtIso and seasonalCalendar.ts. */
function isoAddDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

/** "Mon 26 Oct" — the weekday matters when you are planning around a date. */
function fmtIsoLong(iso: string): string {
  const wd = WEEKDAY_SHORT[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  return `${wd} ${fmtIso(iso)}`;
}

const RUNWAY_DAYS = 60;

/** The next 60 days cut into month-long pieces, each sized by how many of
 *  its days fall inside the window. Months, not arbitrary ticks: they are
 *  the unit the year grid below is built from, so the two read together. */
function runwaySegments(todayIso: string): { month: number; days: number; season: Season }[] {
  const out: { month: number; days: number; season: Season }[] = [];
  let cursor = 0;
  while (cursor <= RUNWAY_DAYS) {
    const iso = isoAddDays(todayIso, cursor);
    const year = Number(iso.slice(0, 4));
    const month = Number(iso.slice(5, 7));
    const lastIso = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
    const lastOffset = Math.min(RUNWAY_DAYS, daysBetweenIso(todayIso, lastIso));
    out.push({ month, days: lastOffset - cursor + 1, season: seasonForMonth(month) });
    cursor = lastOffset + 1;
  }
  return out;
}

/**
 * The runway: the next 60 days as a strip, today at the left edge, each
 * occasion pinned where it actually falls.
 *
 * This is the one thing a list of rows cannot say. The useful fact about the
 * radar is not what is on it, it is the SHAPE of it — five clear weeks and
 * then two things a fortnight apart is a different month's work from three
 * dates stacked in one week, and you can only see that if position means
 * time. It also retires a caption: a strip that starts at TODAY does not
 * need a sentence explaining that paging the year below will not move it.
 *
 * Tinted by season, per month, from the same four tints the year grid uses,
 * so an occasion keeps one colour all the way down the page: its pin here,
 * its countdown below, its month card in the grid.
 */
function Runway({ todayIso, radar }: { todayIso: string; radar: RadarSuggestion[] }) {
  const segments = runwaySegments(todayIso);
  return (
    <div style={{ margin: "18px 0 26px" }}>
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", gap: 3, height: 26 }}>
          {segments.map((seg, i) => {
            const tint = SEASON_TINT[seg.season];
            return (
              <div
                key={`${seg.month}-${i}`}
                style={{
                  flexGrow: seg.days,
                  flexBasis: 0,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  borderRadius: 5,
                  background: tint.bg,
                  border: `1px solid ${tint.border}`,
                  fontSize: 11.5,
                  color: "var(--text-tertiary)",
                  whiteSpace: "nowrap",
                }}
              >
                {MONTH_SHORT[seg.month - 1]}
              </div>
            );
          })}
        </div>

        {radar.map((r) => {
          const tint = SEASON_TINT[seasonForMonth(Number(r.dateIso.slice(5, 7)))];
          // Clamped so a date sitting exactly on day 60 still draws inside
          // the strip rather than half outside its right edge.
          const pct = Math.min(99, Math.max(0.6, (r.daysAway / RUNWAY_DAYS) * 100));
          return (
            <div
              key={r.dateId}
              aria-hidden
              style={{ position: "absolute", top: -4, left: `${pct}%`, transform: "translateX(-50%)" }}
            >
              <div style={{ width: 7, height: 7, borderRadius: 999, background: tint.fg, margin: "0 auto" }} />
              <div style={{ width: 1.5, height: 30, background: tint.fg, opacity: 0.65, margin: "0 auto" }} />
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 8,
          fontSize: 11.5,
          color: "var(--text-tertiary)",
        }}
      >
        <span>Today</span>
        <span>In 60 days</span>
      </div>
    </div>
  );
}

/**
 * The countdown, in the page's display face. Words for the two days where a
 * numeral would be silly, because "1 DAY" is how a spreadsheet says it.
 *
 * Plain ink, NOT the season tint. The first version coloured it, and for an
 * autumn date that tint lands a shade off the brand orange — so the number,
 * the pin and the button were all orange and the button stopped being the
 * only thing to press. The season colour stays where it means something:
 * on the runway, saying which month a date sits in.
 */
function Countdown({ daysAway }: { daysAway: number }) {
  const colour = "var(--text-primary)";
  const word = daysAway <= 0 ? "Today" : daysAway === 1 ? "Tomorrow" : null;
  return (
    <div style={{ flexShrink: 0, width: 92, textAlign: "center" }}>
      {word ? (
        <div
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: 20,
            letterSpacing: "-0.01em",
            color: colour,
            lineHeight: 1,
            padding: "8px 0",
          }}
        >
          {word}
        </div>
      ) : (
        <>
          <div
            style={{
              fontFamily: "var(--font-heading), sans-serif",
              fontSize: 42,
              lineHeight: 0.9,
              letterSpacing: "-0.02em",
              color: colour,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {daysAway}
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--text-tertiary)",
              marginTop: 7,
            }}
          >
            days away
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The next 60 days, and what to do about them.
 *
 * Three versions in: a run-on sentence, then a tidy list of rows, and the
 * list was the real problem. The radar holds at most five dates and usually
 * ONE, so a list UI spends its whole life rendering a single row — which is
 * why it read as unfinished no matter how the row was spaced.
 *
 * So it is not a list. It is a runway with the nearest occasion written out
 * underneath it: the countdown is the number you actually came here for, in
 * the display face the page titles use, and anything further out is a quiet
 * line below rather than a second row of equal weight. Hierarchy by
 * urgency, which is the only ordering a radar has.
 */
function ComingUpRail({ radar, todayIso: pageToday }: { radar: RadarSuggestion[]; todayIso: string }) {
  if (radar.length === 0) {
    return (
      <Card style={{ marginBottom: 28 }}>
        <h2 className="szn-rail-title">
          <Radar size={15} aria-hidden /> Coming up
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: "12px 0 0", lineHeight: 1.5 }}>
          Nothing on the radar in the next 60 days. Browse the year below for what&apos;s further out.
        </p>
      </Card>
    );
  }

  const [lead, ...rest] = radar;
  // Derived from the lead rather than read off the clock: daysAway was
  // measured against the radar's own "today", and two sources of now can
  // disagree by a day at a midnight boundary.
  const todayIso = isoAddDays(lead.dateIso, -lead.daysAway);

  return (
    <Card style={{ marginBottom: 28 }}>
      <h2 className="szn-rail-title">
        <Radar size={15} aria-hidden /> Coming up
      </h2>

      <Runway todayIso={todayIso} radar={radar} />

      <div style={{ display: "flex", alignItems: "flex-start", gap: 20, flexWrap: "wrap" }}>
        <Countdown daysAway={lead.daysAway} />

        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-tertiary)",
              marginBottom: 7,
            }}
          >
            {lead.dateName}
            <span style={{ color: "var(--text-tertiary)", opacity: 0.5 }}>{" / "}</span>
            {fmtIsoLong(lead.dateIso)}
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.25 }}>
            {lead.suggestionName}
          </div>
          <p
            style={{
              margin: "6px 0 0",
              fontSize: 13,
              color: "var(--text-secondary)",
              lineHeight: 1.55,
              maxWidth: "68ch",
            }}
          >
            {lead.suggestionHook}
          </p>
          <LeadStart dateIso={lead.dateIso} todayIso={pageToday} />
        </div>

        <div style={{ flexShrink: 0 }}>
          <BuildCampaignLink seedName={lead.suggestionName} startsOn={lead.dateIso} angle={lead.suggestionHook} />
        </div>
      </div>

      {rest.length > 0 && (
        <div style={{ marginTop: 20, borderTop: "1px solid var(--hairline)", paddingTop: 14 }}>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--text-tertiary)",
              marginBottom: 10,
            }}
          >
            After that
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {rest.map((r) => {
              const tint = SEASON_TINT[seasonForMonth(Number(r.dateIso.slice(5, 7)))];
              return (
                <div key={r.dateId} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span
                    style={{
                      flexShrink: 0,
                      width: 92,
                      textAlign: "center",
                      fontSize: 11,
                      color: tint.fg,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmtIso(r.dateIso)}
                  </span>
                  <span style={{ flex: "1 1 240px", minWidth: 0, fontSize: 13, color: "var(--text-secondary)" }}>
                    <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{r.suggestionName}</span>
                    <span style={{ color: "var(--text-tertiary)" }}>
                      {" · "}
                      {r.dateName} · {daysAwayLabel(r.daysAway)}
                    </span>
                  </span>
                  <BuildCampaignLink
                    seedName={r.suggestionName}
                    startsOn={r.dateIso}
                    angle={r.suggestionHook}
                    compact
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

/** When the lead occasion's campaign has to start, in words. */
function LeadStart({ dateIso, todayIso }: { dateIso: string; todayIso: string }) {
  const s = startBy(dateIso, todayIso);
  if (!s) return null;
  const text =
    s.tone === "late"
      ? `Start now: the three-week run-up began on ${fmtIsoLong(s.iso)}.`
      : `Start by ${fmtIsoLong(s.iso)} to give it a three-week run-up.`;
  return <p className={`szn-lead-start t-${s.tone}`}>{text}</p>;
}
