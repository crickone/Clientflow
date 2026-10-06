import "server-only";

import { and, gte, inArray, lt } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { Campaign } from "@/lib/db/schema";
import { gatherCampaignRevenue } from "@/lib/campaigns/scoreboardData";
import { readKey, setKey } from "@/lib/settings";
import { buildCampaignSeedHref } from "@/components/marketing/buildCampaignSeed";
import { getCalendarNotes } from "./calendarNotes";
import { catalogForYear, seasonForMonth, type Season } from "./seasonalCalendar";
import { addDaysIso, schoolDatesForYear, startBy, statusLabel, type StartTone, type StatusTone } from "./calendarRules";

/**
 * Everything the seasonal calendar draws, worked out on the server: for each
 * month on screen, its dates (national, school and the business's own), each
 * date's campaign status or start-by date, the campaigns running, what is
 * scheduled to go out, and the results of campaigns that ran.
 */

// ---- The business's own dates ------------------------------------------

export interface CustomDate {
  id: string;
  name: string;
  iso: string;
}
const CUSTOM_KEY = "marketing_calendar_custom_dates";
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function listCustomDates(): CustomDate[] {
  const raw = readKey<unknown>(CUSTOM_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (d): d is CustomDate =>
        !!d && typeof d === "object" && typeof (d as CustomDate).id === "string" && typeof (d as CustomDate).name === "string" && ISO_RE.test(String((d as CustomDate).iso)),
    )
    .sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
}

export function addCustomDate(name: string, iso: string): CustomDate {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!clean) throw new Error("Give the date a name.");
  if (!ISO_RE.test(iso) || Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) throw new Error("Pick a valid date.");
  const all = listCustomDates();
  if (all.length >= 200) throw new Error("That's the most dates the calendar holds. Remove an old one first.");
  const entry = { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: clean, iso };
  setKey(CUSTOM_KEY, [...all, entry]);
  return entry;
}

export function removeCustomDate(id: string): void {
  setKey(CUSTOM_KEY, listCustomDates().filter((d) => d.id !== id));
}

// ---- The view --------------------------------------------------------------

export type EntryKind = "public-holiday" | "awareness-day" | "school" | "custom";

export interface CalEntry {
  key: string;
  name: string;
  iso: string;
  kind: EntryKind;
  past: boolean;
  /** Where clicking the row goes: the campaign, or Adonis to build one. */
  href: string;
  covered: { label: string; tone: StatusTone; result: string | null } | null;
  start: { iso: string; tone: StartTone } | null;
  /** "Last year: Autumn Reset, 14 leads" when the same occasion had a campaign. */
  lastTime: string | null;
  customId: string | null;
}

export interface MonthView {
  year: number;
  month: number;
  season: Season;
  past: boolean;
  current: boolean;
  entries: CalEntry[];
  campaigns: { id: number; name: string; status: { label: string; tone: StatusTone } | null; result: string | null }[];
  activity: { posts: number; emails: number };
  note: string;
  campaignNotes: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function covering(campaigns: Campaign[], iso: string): Campaign | undefined {
  return campaigns.find((c) => {
    if (c.status === "archived" || !c.startsOn) return false;
    if (c.endsOn) return c.startsOn <= iso && c.endsOn >= iso;
    return c.startsOn === iso;
  });
}

function inMonth(c: Campaign, y: number, m: number): boolean {
  if (c.status === "archived") return false;
  const start = `${y}-${pad(m)}-01`;
  const end = `${y}-${pad(m)}-${pad(lastDay(y, m))}`;
  if (c.startsOn && c.endsOn) return c.startsOn <= end && c.endsOn >= start;
  if (c.startsOn) return c.startsOn >= start && c.startsOn <= end;
  if (c.season) return c.season.toLowerCase() === seasonForMonth(m);
  return false;
}

function resultLine(r: { leads: number; converts: number } | undefined): string | null {
  if (!r || (r.leads === 0 && r.converts === 0)) return null;
  const leads = `${r.leads} lead${r.leads === 1 ? "" : "s"}`;
  return r.converts > 0 ? `${leads}, ${r.converts} converted` : leads;
}

/** Posts and emails going out (or gone out) per "YYYY-MM" in the window. */
function activityByMonth(fromIso: string, toIso: string): Map<string, { posts: number; emails: number }> {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const to = new Date(`${toIso}T00:00:00Z`);
  const out = new Map<string, { posts: number; emails: number }>();
  const bump = (d: Date | null, field: "posts" | "emails") => {
    if (!d) return;
    const k = d.toISOString().slice(0, 7);
    const cur = out.get(k) ?? { posts: 0, emails: 0 };
    cur[field]++;
    out.set(k, cur);
  };
  try {
    for (const p of db
      .select({ at: schema.scheduledPosts.scheduledFor })
      .from(schema.scheduledPosts)
      .where(
        and(
          gte(schema.scheduledPosts.scheduledFor, from),
          lt(schema.scheduledPosts.scheduledFor, to),
          inArray(schema.scheduledPosts.status, ["scheduled", "posting", "posted"]),
        ),
      )
      .all())
      bump(p.at, "posts");
    for (const e of db
      .select({ scheduledAt: schema.emailCampaigns.scheduledAt, sentAt: schema.emailCampaigns.sentAt })
      .from(schema.emailCampaigns)
      .where(inArray(schema.emailCampaigns.status, ["scheduled", "sending", "sent"]))
      .all()) {
      const at = e.sentAt ?? e.scheduledAt;
      if (at && at >= from && at < to) bump(at, "emails");
    }
  } catch (err) {
    console.error("[calendarView] activity counts failed:", err);
  }
  return out;
}

export async function buildCalendarView(
  months: { year: number; month: number }[],
  campaigns: Campaign[],
  todayIso: string,
): Promise<MonthView[]> {
  const years = [...new Set(months.map((m) => m.year))];
  const custom = listCustomDates();

  // Results for every campaign that has run or is running, once each.
  const results = new Map<number, string | null>();
  await Promise.all(
    campaigns
      .filter((c) => c.status === "active" || c.status === "complete")
      .map(async (c) => {
        try {
          const r = await gatherCampaignRevenue(c.name, c.startsOn);
          results.set(c.id, resultLine(r));
        } catch {
          results.set(c.id, null);
        }
      }),
  );

  // Last year's campaign for each recurring occasion, by its stable id.
  const lastYearFor = (id: string, year: number): string | null => {
    const prev =
      catalogForYear(year - 1).dates.find((d) => d.id === id) ?? schoolDatesForYear(year - 1).find((d) => d.id === id);
    if (!prev) return null;
    const c = covering(campaigns, prev.iso);
    if (!c) return null;
    const r = results.get(c.id);
    return `Last year: ${c.name}${r ? `, ${r}` : ""}`;
  };

  const first = months[0];
  const last = months[months.length - 1];
  const activity = activityByMonth(
    `${first.year}-${pad(first.month)}-01`,
    addDaysIso(`${last.year}-${pad(last.month)}-${pad(lastDay(last.year, last.month))}`, 1),
  );
  const notesByYear = new Map(years.map((y) => [y, getCalendarNotes(y)]));
  const todayMonth = todayIso.slice(0, 7);

  return months.map(({ year, month }) => {
    const ym = `${year}-${pad(month)}`;
    const season = seasonForMonth(month);
    const pool: { key: string; id: string | null; name: string; iso: string; kind: EntryKind; angle: string; customId: string | null }[] = [
      ...catalogForYear(year).dates.map((d) => ({ key: d.id, id: d.id, name: d.name, iso: d.iso, kind: d.kind, angle: d.angle, customId: null })),
      ...schoolDatesForYear(year).map((d) => ({ key: d.id, id: d.id, name: d.name, iso: d.iso, kind: "school" as const, angle: d.angle, customId: null })),
      ...custom.map((d) => ({ key: d.id, id: null, name: d.name, iso: d.iso, kind: "custom" as const, angle: "", customId: d.id })),
    ];
    const entries: CalEntry[] = pool
      .filter((d) => d.iso.slice(0, 7) === ym)
      .sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : a.name.localeCompare(b.name)))
      .map((d) => {
        const c = covering(campaigns, d.iso);
        const status = c ? statusLabel(c.status) : null;
        const lastTime = d.id ? lastYearFor(d.id, year) : null;
        return {
          key: `${d.key}-${d.iso}`,
          name: d.name,
          iso: d.iso,
          kind: d.kind,
          past: d.iso < todayIso,
          href: c
            ? `/marketing/campaigns/${c.id}`
            : buildCampaignSeedHref({
                seedName: d.name,
                season,
                startsOn: d.iso,
                angle: [d.angle, lastTime].filter(Boolean).join(". ") || undefined,
              }),
          covered: c && status ? { ...status, result: results.get(c.id) ?? null } : null,
          start: c ? null : startBy(d.iso, todayIso),
          lastTime,
          customId: d.customId,
        };
      });
    const notes = notesByYear.get(year)!;
    return {
      year,
      month,
      season,
      past: ym < todayMonth,
      current: ym === todayMonth,
      entries,
      campaigns: campaigns
        .filter((c) => inMonth(c, year, month) && !entries.some((e) => e.covered && e.href === `/marketing/campaigns/${c.id}`))
        .map((c) => ({ id: c.id, name: c.name, status: statusLabel(c.status), result: results.get(c.id) ?? null })),
      activity: activity.get(ym) ?? { posts: 0, emails: 0 },
      note: notes.months[String(month)] ?? "",
      campaignNotes: notes.campaignNotes[String(month)] ?? [],
    };
  });
}
