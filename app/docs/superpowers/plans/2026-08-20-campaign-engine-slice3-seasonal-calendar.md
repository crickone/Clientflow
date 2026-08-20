# Campaign Engine Slice 3 — Seasonal Calendar + Campaign Radar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/marketing/calendar` year-map of Irish marketing dates + seasons overlaid with the tenant's real campaigns, plus an AI "campaign radar" that surfaces the nearest upcoming dates + a suggested campaign in both the calendar and the daily dashboard brief; each suggestion launches the existing Campaign Kit pre-seeded.

**Architecture:** Two new pure-ish libs (`seasonalCalendar.ts` = curated dated catalog + season bands; `campaignRadar.ts` = day-memoised, metered AI framing of the nearest dates with a static fallback), one new server route (`/marketing/calendar`), and a one-call-reuse hook into the existing dashboard brief. No schema change; campaigns already carry `season`/`startsOn`/`endsOn`.

**Tech Stack:** Next.js 14 App Router (server components, `force-dynamic`), TypeScript, better-sqlite3 via the ambient `db` proxy, `meteredCreate` AI chokepoint, `node scripts/test.mjs` pure-test runner.

## Global Constraints

- **No schema change / no migration.** Campaigns already have `season`, `startsOn` (ISO date str), `endsOn`. The radar cache is an **in-process module-level memo** keyed `` `${tenantId}:${yyyymmdd}` `` (a `Map`) — NOT a table, NOT a KV row. (Refines the spec's "settings KV": the settings store is a structured blob with no generic KV, and a daily memo is simpler + makes "don't cache the fallback" trivial.)
- **Region = Ireland only.** Catalog is structured so a second region is a later drop-in; only IE ships.
- **Seasons = Irish/Celtic convention:** Spring = Feb–Apr, Summer = May–Jul, Autumn = Aug–Oct, Winter = Nov–Jan.
- **Radar = ≤1 metered AI call per tenant per day**, via the sanctioned `meteredCreate` chokepoint with `agentKey: "marketing"`. On cap/error it falls back to the catalog's static `angle` and does **not** memoise the fallback (retries next call). House rules already live in `getBusinessContext()` — the radar prompt includes it, adds no price/guarantee/fabrication.
- **`/marketing/calendar` is distinct** from the existing `/calendar` meetings module — do not touch `/calendar`.
- **"Build campaign" introduces no new generation path** — it links to the campaigns "new campaign" entry with the seed as query params (`?seedName&season&startsOn&endsOn&angle`).
- **Tests are pure + DB-free** (`node scripts/test.mjs` — the runner cannot open a tenant DB). Date math, `upcomingDates`, season assignment, and the radar's cache/fallback decision (AI + `getBusinessContext` stubbed via injected deps) are the tested surface. UI + the live AI call are not unit-tested; reason about them in the report.
- **Gate (all must pass, from `app/`):** `npm run typecheck` · `npm test` · `npx next build`.
- **Reuse-first:** `meteredCreate` (`@/lib/ai/metered`), `getBusinessContext` (`@/lib/ai/businessContext`), `listCampaigns` + `Campaign` (`@/lib/campaigns/store`), the dashboard brief route (`src/app/api/assistant/brief/route.ts`), the `/marketing/campaigns` hub + its nav registration.

---

### Task 1: The seasonal date catalog (pure)

**Files:**
- Create: `src/lib/marketing/seasonalCalendar.ts`
- Test: `src/lib/marketing/seasonalCalendar.test.ts`

**Interfaces:**
- Produces:
  - `type CalKind = "public-holiday" | "awareness-day" | "season"`
  - `type Season = "spring" | "summer" | "autumn" | "winter"`
  - `interface CalDate { id: string; name: string; kind: Exclude<CalKind,"season">; iso: string; angle: string }` (`iso` = `YYYY-MM-DD`)
  - `interface SeasonBand { season: Season; months: number[]; startIso: string }` (`months` 1-based; `startIso` = first day of the season in the given year)
  - `function catalogForYear(year: number): { dates: CalDate[]; seasons: SeasonBand[] }`
  - `function seasonForMonth(month1to12: number): Season`
  - `function upcomingDates(fromIso: string, days: number, year?: number): CalDate[]` — catalog dates within `[from, from+days]`, sorted ascending, wrapping into next year when the window crosses Dec 31.
  - `function easterSunday(year: number): { month: number; day: number }` (exported for tests)

- [ ] **Step 1: Write failing tests for the date math**

```ts
// src/lib/marketing/seasonalCalendar.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogForYear, seasonForMonth, upcomingDates, easterSunday } from "./seasonalCalendar";

test("easterSunday: known Gregorian values", () => {
  assert.deepEqual(easterSunday(2025), { month: 4, day: 20 });
  assert.deepEqual(easterSunday(2026), { month: 4, day: 5 });
  assert.deepEqual(easterSunday(2027), { month: 3, day: 28 });
});

test("catalog: fixed + computed IE holidays land on the right dates (2026)", () => {
  const { dates } = catalogForYear(2026);
  const by = (id: string) => dates.find((d) => d.id === id)?.iso;
  assert.equal(by("new-year"), "2026-01-01");
  assert.equal(by("st-patricks"), "2026-03-17");
  assert.equal(by("easter-monday"), "2026-04-06");      // Easter Sun 2026-04-05 + 1
  assert.equal(by("may-day"), "2026-05-04");             // first Mon May
  assert.equal(by("june-bh"), "2026-06-01");            // first Mon Jun
  assert.equal(by("august-bh"), "2026-08-03");          // first Mon Aug
  assert.equal(by("october-bh"), "2026-10-26");         // last Mon Oct
  assert.equal(by("st-brigids"), "2026-02-02");         // first Mon Feb
  assert.equal(by("christmas"), "2026-12-25");
  assert.equal(by("st-stephens"), "2026-12-26");
});

test("catalog: awareness days (2026)", () => {
  const { dates } = catalogForYear(2026);
  const by = (id: string) => dates.find((d) => d.id === id)?.iso;
  assert.equal(by("valentines"), "2026-02-14");
  assert.equal(by("intl-womens-day"), "2026-03-08");
  assert.equal(by("intl-mens-day"), "2026-11-19");
  assert.equal(by("mothers-day-ie"), "2026-03-15");     // Easter 04-05 − 21 days
  assert.equal(by("fathers-day"), "2026-06-21");        // 3rd Sun Jun
  assert.equal(by("black-friday"), "2026-11-27");       // day after 4th Thu Nov
});

test("every catalog date carries a non-empty angle + valid iso", () => {
  const { dates } = catalogForYear(2026);
  assert.ok(dates.length >= 12);
  for (const d of dates) {
    assert.match(d.iso, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(d.angle.trim().length > 0, `${d.id} has an angle`);
  }
});

test("seasonForMonth: Irish/Celtic bands", () => {
  assert.equal(seasonForMonth(2), "spring");
  assert.equal(seasonForMonth(4), "spring");
  assert.equal(seasonForMonth(5), "summer");
  assert.equal(seasonForMonth(8), "autumn");
  assert.equal(seasonForMonth(11), "winter");
  assert.equal(seasonForMonth(1), "winter");
});

test("catalogForYear: four season bands with correct starts", () => {
  const { seasons } = catalogForYear(2026);
  assert.equal(seasons.length, 4);
  const spring = seasons.find((s) => s.season === "spring")!;
  assert.deepEqual(spring.months, [2, 3, 4]);
  assert.equal(spring.startIso, "2026-02-01");
});

test("upcomingDates: ascending, within window, wraps year-end", () => {
  const u = upcomingDates("2026-03-01", 30, 2026);
  assert.ok(u.length >= 2);
  assert.ok(u.every((d, i) => i === 0 || d.iso >= u[i - 1].iso), "ascending");
  assert.ok(u.every((d) => d.iso >= "2026-03-01" && d.iso <= "2026-03-31"));
  // Wrap: a window starting mid-December reaches into next January
  const wrap = upcomingDates("2026-12-20", 20, 2026);
  assert.ok(wrap.some((d) => d.id === "christmas"));
  assert.ok(wrap.some((d) => d.id === "new-year" && d.iso.startsWith("2027")), "wraps into next year");
});
```

- [ ] **Step 2: Run tests — verify they fail** — `cd app && node scripts/test.mjs 2>&1 | grep seasonalCalendar` → FAIL (module not found).

- [ ] **Step 3: Implement `seasonalCalendar.ts`**

```ts
// src/lib/marketing/seasonalCalendar.ts
// Curated marketing-relevant dates for Ireland + Irish/Celtic season bands.
// Pure: no AI, no DB, no I/O. Region is IE-only this slice.

export type CalKind = "public-holiday" | "awareness-day" | "season";
export type Season = "spring" | "summer" | "autumn" | "winter";

export interface CalDate {
  id: string;
  name: string;
  kind: Exclude<CalKind, "season">;
  iso: string; // YYYY-MM-DD
  angle: string; // generic, wellness-leaning hint used to seed the Kit + prime the radar
}
export interface SeasonBand { season: Season; months: number[]; startIso: string }

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** JS Date in UTC to avoid TZ drift; day-of-week 0=Sun..6=Sat. */
function dow(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** nth (1-based) given weekday (0=Sun..6=Sat) in month m. */
function nthWeekday(y: number, m: number, weekday: number, nth: number): number {
  const first = dow(y, m, 1);
  const offset = (weekday - first + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}
function lastWeekday(y: number, m: number, weekday: number): number {
  const last = daysInMonth(y, m);
  const lastDow = dow(y, m, last);
  return last - ((lastDow - weekday + 7) % 7);
}
/** Add `add` days to a UTC date, return {year,month,day}. */
function addDays(y: number, m: number, d: number, add: number) {
  const t = new Date(Date.UTC(y, m - 1, d + add));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Anonymous Gregorian ("Meeus/Jones/Butcher") algorithm. */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * mm + 114) / 31);
  const day = ((h + l - 7 * mm + 114) % 31) + 1;
  return { month, day };
}

export function seasonForMonth(m: number): Season {
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "autumn";
  return "winter"; // Nov, Dec, Jan
}

export function catalogForYear(year: number): { dates: CalDate[]; seasons: SeasonBand[] } {
  const easter = easterSunday(year);
  const easterMon = addDays(year, easter.month, easter.day, 1);
  const mothers = addDays(year, easter.month, easter.day, -21); // 4th Sun of Lent (IE/UK)

  const dates: CalDate[] = [
    // public holidays (IE)
    { id: "new-year", name: "New Year's Day", kind: "public-holiday", iso: iso(year, 1, 1), angle: "New-year transformation challenge / fresh-start kickstart" },
    { id: "st-brigids", name: "St Brigid's Day", kind: "public-holiday", iso: iso(year, 2, nthWeekday(year, 2, 1, 1)), angle: "Start-of-spring reset" },
    { id: "st-patricks", name: "St Patrick's Day", kind: "public-holiday", iso: iso(year, 3, 17), angle: "Short 'Lucky' kickstart week" },
    { id: "easter-monday", name: "Easter Monday", kind: "public-holiday", iso: iso(easterMon.year, easterMon.month, easterMon.day), angle: "Spring-into-summer prep" },
    { id: "may-day", name: "May Bank Holiday", kind: "public-holiday", iso: iso(year, 5, nthWeekday(year, 5, 1, 1)), angle: "Summer-countdown program launch" },
    { id: "june-bh", name: "June Bank Holiday", kind: "public-holiday", iso: iso(year, 6, nthWeekday(year, 6, 1, 1)), angle: "Mid-year momentum push" },
    { id: "august-bh", name: "August Bank Holiday", kind: "public-holiday", iso: iso(year, 8, nthWeekday(year, 8, 1, 1)), angle: "End-of-summer last-push" },
    { id: "october-bh", name: "October Bank Holiday", kind: "public-holiday", iso: iso(year, 10, lastWeekday(year, 10, 1)), angle: "Autumn re-commit" },
    { id: "christmas", name: "Christmas Day", kind: "public-holiday", iso: iso(year, 12, 25), angle: "Pre-Christmas / New-Year-waitlist build" },
    { id: "st-stephens", name: "St Stephen's Day", kind: "public-holiday", iso: iso(year, 12, 26), angle: "Post-Christmas reset waitlist" },
    // awareness / marketing days
    { id: "valentines", name: "Valentine's Day", kind: "awareness-day", iso: iso(year, 2, 14), angle: "Partner / bring-a-friend offer" },
    { id: "intl-womens-day", name: "International Women's Day", kind: "awareness-day", iso: iso(year, 3, 8), angle: "Women's strength / community focus" },
    { id: "mothers-day-ie", name: "Mother's Day", kind: "awareness-day", iso: iso(mothers.year, mothers.month, mothers.day), angle: "Gift-a-membership / mums' program" },
    { id: "fathers-day", name: "Father's Day", kind: "awareness-day", iso: iso(year, 6, nthWeekday(year, 6, 0, 3)), angle: "Gift-a-membership / dads' program" },
    { id: "intl-mens-day", name: "International Men's Day", kind: "awareness-day", iso: iso(year, 11, 19), angle: "Men's health / strength focus" },
    { id: "back-to-school", name: "Back to School / Routine", kind: "awareness-day", iso: iso(year, 9, 1), angle: "Back-to-routine reset program" },
    { id: "black-friday", name: "Black Friday", kind: "awareness-day", iso: iso(year, 11, addDays(year, 11, nthWeekday(year, 11, 4, 4), 1).day), angle: "Best-offer-of-the-year membership deal" },
  ];

  const seasons: SeasonBand[] = [
    { season: "spring", months: [2, 3, 4], startIso: iso(year, 2, 1) },
    { season: "summer", months: [5, 6, 7], startIso: iso(year, 5, 1) },
    { season: "autumn", months: [8, 9, 10], startIso: iso(year, 8, 1) },
    { season: "winter", months: [11, 12, 1], startIso: iso(year, 11, 1) },
  ];

  return { dates, seasons };
}

export function upcomingDates(fromIso: string, days: number, year?: number): CalDate[] {
  const from = new Date(`${fromIso}T00:00:00Z`);
  const y = year ?? from.getUTCFullYear();
  const end = new Date(from.getTime() + days * 86400000);
  // include this year's and (for year-end wrap) next year's catalog
  const pool = [...catalogForYear(y).dates, ...catalogForYear(y + 1).dates];
  return pool
    .filter((d) => {
      const dt = new Date(`${d.iso}T00:00:00Z`);
      return dt >= from && dt <= end;
    })
    .sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
}
```

- [ ] **Step 4: Run tests — verify pass** — `cd app && node scripts/test.mjs 2>&1 | grep -E "seasonalCalendar|pass|fail"` → all pass. If `black-friday`/`october-bh` mismatch, re-derive against the asserted 2026 values before touching the test.

- [ ] **Step 5: Commit** — `git add src/lib/marketing/seasonalCalendar.ts src/lib/marketing/seasonalCalendar.test.ts && git commit -m "feat(calendar): seasonal date catalog (IE holidays, awareness days, seasons)"`

---

### Task 2: The campaign radar (day-memoised, metered, with fallback)

**Files:**
- Create: `src/lib/marketing/campaignRadar.ts`
- Test: `src/lib/marketing/campaignRadar.test.ts`

**Interfaces:**
- Consumes: `upcomingDates`, `CalDate` (Task 1); `meteredCreate` (`@/lib/ai/metered`); `getBusinessContext` (`@/lib/ai/businessContext`).
- Produces:
  - `interface RadarSuggestion { dateId: string; dateName: string; dateIso: string; daysAway: number; suggestionName: string; suggestionHook: string }`
  - `async function getCampaignRadar(tenantId: number, opts?: { todayIso?: string }): Promise<RadarSuggestion[]>` — nearest ≤5 upcoming dates, AI-framed, memoised per `tenantId:yyyymmdd`; static-angle fallback on failure (not memoised).
  - `function buildRadarFromFraming(upcoming: CalDate[], todayIso: string, framed: Record<string,{name:string;hook:string}> | null): RadarSuggestion[]` — **pure**, exported for tests: merges the framing (or falls back to each date's `angle`) into `RadarSuggestion[]`; `daysAway` computed from `todayIso`.

**Design notes for the implementer:**
- Read `src/app/api/assistant/brief/route.ts` for the exact `meteredCreate` call shape: `await meteredCreate({ tenantId, agentKey }, () => ({ model, max_tokens, system, messages }))` returning a message whose `.content` is `Array<{type:string; text?:string}>`. Use `agentKey: "marketing"`, a small `max_tokens`, `model: CONTENT_MODEL` (`@/lib/ai/client`).
- The memo is a module-level `const memo = new Map<string, RadarSuggestion[]>()`. Key = `` `${tenantId}:${yyyymmdd(todayIso)}` ``. Only store the AI-framed result; on fallback, return without storing.
- Prompt the model to return **strict JSON**: `{"<dateId>": {"name": "...", "hook": "..."}}` for the given upcoming dates, grounded in `getBusinessContext()`, obeying its house rules (the context already carries them — no price, no guarantees, no fabricated results). Parse tolerantly; if parse fails or the call throws (incl. `AiCapError`), return the static fallback.
- Keep the live AI call OUT of the unit test — test `buildRadarFromFraming` (pure) only.

- [ ] **Step 1: Write failing tests for the pure merge/fallback**

```ts
// src/lib/marketing/campaignRadar.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRadarFromFraming } from "./campaignRadar";
import { upcomingDates } from "./seasonalCalendar";

const upcoming = upcomingDates("2026-03-01", 60, 2026).slice(0, 5);

test("buildRadarFromFraming: uses AI framing when present", () => {
  const framed = { "st-patricks": { name: "Lucky 7 Kickstart", hook: "Seven days to a fresh start." } };
  const out = buildRadarFromFraming(upcoming, "2026-03-01", framed);
  const stp = out.find((r) => r.dateId === "st-patricks")!;
  assert.equal(stp.suggestionName, "Lucky 7 Kickstart");
  assert.equal(stp.suggestionHook, "Seven days to a fresh start.");
  assert.ok(stp.daysAway >= 0);
});

test("buildRadarFromFraming: falls back to the catalog angle when framing is null/missing", () => {
  const out = buildRadarFromFraming(upcoming, "2026-03-01", null);
  assert.equal(out.length, upcoming.length);
  for (const r of out) {
    assert.ok(r.suggestionHook.trim().length > 0, "hook falls back to the date angle");
    assert.ok(r.suggestionName.trim().length > 0);
  }
});

test("buildRadarFromFraming: daysAway is correct + non-negative", () => {
  const out = buildRadarFromFraming(upcoming, "2026-03-01", null);
  const stp = out.find((r) => r.dateId === "st-patricks")!; // 2026-03-17
  assert.equal(stp.daysAway, 16);
});
```

- [ ] **Step 2: Run tests — verify fail** — `node scripts/test.mjs 2>&1 | grep campaignRadar` → FAIL.

- [ ] **Step 3: Implement `campaignRadar.ts`** — the pure `buildRadarFromFraming` (make the tests pass) plus the async `getCampaignRadar` wrapper:

```ts
// src/lib/marketing/campaignRadar.ts
import { upcomingDates, type CalDate } from "./seasonalCalendar";
import { getBusinessContext } from "@/lib/ai/businessContext";
import { meteredCreate } from "@/lib/ai/metered";
import { CONTENT_MODEL } from "@/lib/ai/client";

export interface RadarSuggestion {
  dateId: string; dateName: string; dateIso: string; daysAway: number;
  suggestionName: string; suggestionHook: string;
}

const memo = new Map<string, RadarSuggestion[]>();
const yyyymmdd = (isoDate: string) => isoDate.replaceAll("-", "");

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86400000));
}

export function buildRadarFromFraming(
  upcoming: CalDate[],
  todayIso: string,
  framed: Record<string, { name: string; hook: string }> | null,
): RadarSuggestion[] {
  return upcoming.map((d) => {
    const f = framed?.[d.id];
    return {
      dateId: d.id, dateName: d.name, dateIso: d.iso,
      daysAway: daysBetween(todayIso, d.iso),
      suggestionName: f?.name?.trim() || d.name,
      suggestionHook: f?.hook?.trim() || d.angle,
    };
  });
}

export async function getCampaignRadar(
  tenantId: number,
  opts?: { todayIso?: string },
): Promise<RadarSuggestion[]> {
  const todayIso = opts?.todayIso ?? new Date().toISOString().slice(0, 10);
  const key = `${tenantId}:${yyyymmdd(todayIso)}`;
  const hit = memo.get(key);
  if (hit) return hit;

  const upcoming = upcomingDates(todayIso, 60).slice(0, 5);
  if (upcoming.length === 0) return [];

  let framed: Record<string, { name: string; hook: string }> | null = null;
  try {
    const ctx = getBusinessContext();
    const list = upcoming.map((d) => `- ${d.id} · ${d.name} (${d.iso}) — angle: ${d.angle}`).join("\n");
    const res = await meteredCreate({ tenantId, agentKey: "marketing" }, () => ({
      model: CONTENT_MODEL,
      max_tokens: 500,
      system:
        "You are a marketing strategist for this business. Using ONLY the business context, " +
        "suggest a short seasonal campaign for each upcoming date. Obey every rule in the context " +
        "(no prices, no guarantees, no invented results). Reply with STRICT JSON only: " +
        '{"<dateId>":{"name":"<=6 words","hook":"one sentence"}}. No prose.',
      messages: [{ role: "user", content: `BUSINESS CONTEXT:\n${ctx}\n\nUPCOMING DATES:\n${list}` }],
    }));
    const text = res.content.map((b: { type: string; text?: string }) => (b.type === "text" ? b.text ?? "" : "")).join("").trim();
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      framed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    }
  } catch {
    framed = null; // capped / errored / unparseable → static fallback, don't memoise
  }

  const result = buildRadarFromFraming(upcoming, todayIso, framed);
  if (framed) memo.set(key, result); // only cache real framing
  return result;
}
```

- [ ] **Step 4: Run tests — verify pass** — `node scripts/test.mjs 2>&1 | grep -E "campaignRadar|pass|fail"` → pass. Then `npm run typecheck` to confirm the `meteredCreate`/`getBusinessContext` imports line up (fix import paths against the real modules if tsc complains).

- [ ] **Step 5: Commit** — `git add src/lib/marketing/campaignRadar.ts src/lib/marketing/campaignRadar.test.ts && git commit -m "feat(calendar): campaign radar — day-memoised metered framing + static fallback"`

---

### Task 3: The `/marketing/calendar` page + nav

**Files:**
- Create: `src/app/marketing/calendar/page.tsx` (server component, `export const dynamic = "force-dynamic"`)
- Create: `src/components/marketing/SeasonalCalendar.tsx` (server component — the year grid + coming-up rail; presentational)
- Create: `src/components/marketing/BuildCampaignLink.tsx` (client OR server `<a>` — the seed link)
- Modify: the Marketing nav registration (find it — grep for the string `"/marketing/campaigns"` and the label `Email campaigns` in `src/**`; add a `Seasonal calendar` entry pointing to `/marketing/calendar`)
- Modify: `src/app/marketing/campaigns/…` new-campaign entry — accept the seed query params (see Interfaces)

**Interfaces:**
- Consumes: `getCampaignRadar` + `RadarSuggestion` (Task 2), `catalogForYear` + `seasonForMonth` + `Season` (Task 1), `listCampaigns` + `Campaign` (`@/lib/campaigns/store`).
- The **Build-campaign seed** is a query string on the campaigns new-campaign route: `?seedName=<string>&season=<Season|"">&startsOn=<ISO|"">&endsOn=<ISO|"">&angle=<string>`. The campaigns entry reads these and pre-fills the `plan_campaign` seed (name/season/dates/offer-hint). Keep the param names EXACTLY these five.

**Steps:**
- [ ] **Step 1: Read the patterns first.** Read `src/app/marketing/campaigns/page.tsx` (tenant-context + admin/staff gating + how it lists via the store + the page chrome/layout idiom) and the nav file you located. Mirror the gating + chrome exactly. Confirm how `listCampaigns()` returns dates (`startsOn`/`endsOn` may be null).
- [ ] **Step 2: Build `SeasonalCalendar.tsx`** — a presentational server component taking `{ year: number; dates: CalDate[]; seasons: SeasonBand[]; campaigns: Campaign[]; radar: RadarSuggestion[] }`. Render:
  - **Coming-up rail**: `radar.map(...)` → each row = `dateName` · `dateIso` · `in {daysAway} days` · `suggestionHook` + a `<BuildCampaignLink seedName={r.suggestionName} startsOn={r.dateIso} angle={r.suggestionHook} />`.
  - **Year grid**: 12 month cells, each tinted by `seasonForMonth(m)` (define 4 accent tints inline from the theme tokens), showing that month's `dates` as markers (holiday vs awareness styled distinctly) and any `campaigns` whose `startsOn..endsOn` (or `season`) intersect the month as chips linking to `/marketing/campaigns/${c.id}`. Empty-day click → a `BuildCampaignLink` seeded with that date. Mobile: the grid is `overflow-x:auto` / collapses to a single-column month list under a width breakpoint (use the app's inline-style idiom + a media query, matching how other admin pages go responsive).
  - No raw JSON anywhere; reason in the report about empty states (no campaigns, radar fallback, year with nothing upcoming).
- [ ] **Step 3: Build `page.tsx`** — gate + tenant-context like the campaigns hub; read `const year = Number(searchParams.year) || <currentYear>` (get the current year from `new Date().getUTCFullYear()` at request time — allowed in a route, not in the pure lib); `const { dates, seasons } = catalogForYear(year)`; `const campaigns = listCampaigns()`; `const radar = await getCampaignRadar(tenantId)`; render `<SeasonalCalendar .../>` with a `◀ year ▶` switcher (links to `?year=`). `export const dynamic = "force-dynamic"`.
- [ ] **Step 4: Wire the seed into the campaigns new-campaign entry** — read the five query params, pre-fill the plan seed (name→campaign name, season, startsOn/endsOn, angle→offer hint). If the entry is the agent flow, pre-fill the compose box / `plan_campaign` args; keep it minimal and non-breaking when the params are absent.
- [ ] **Step 5: Add the nav entry** — `Seasonal calendar` → `/marketing/calendar`, beside `Email campaigns`/`Campaigns` under Marketing.
- [ ] **Step 6: Gate** — `npm run typecheck && npm test && npx next build` (build compiles the new route). Manually reason about the responsive + empty states in the report.
- [ ] **Step 7: Commit** — `git commit -m "feat(calendar): /marketing/calendar year view + coming-up radar rail + build-campaign seeding"`

---

### Task 4: Daily-brief integration (reuse the cached radar)

**Files:**
- Modify: `src/app/api/assistant/brief/route.ts`

**Interfaces:**
- Consumes: `getCampaignRadar(tenantId)` (Task 2).

**Steps:**
- [ ] **Step 1: Read** `src/app/api/assistant/brief/route.ts` fully — note where `tenantId` is resolved and how the `meteredCreate` prompt/context is assembled (it builds the brief from live data, then calls the model once).
- [ ] **Step 2: Fold the radar into the brief's prompt context** — before the brief's `meteredCreate` call, `const radar = await getCampaignRadar(tenantId).catch(() => [])` and, if non-empty, add the top 2–3 to the prompt context as an "Upcoming marketing opportunities" block (e.g. `` `${r.dateName} (in ${r.daysAway} days): ${r.suggestionName} — ${r.suggestionHook}` ``) so the brief's single string naturally mentions them. This REUSES the cached radar (no extra AI framing call — `getCampaignRadar` either hits the memo or makes the one daily call that the calendar would also use). Do NOT change the response shape (`{ brief }`) or `DailyBrief.tsx`.
- [ ] **Step 3: Gate** — `npm run typecheck && npm test && npx next build`.
- [ ] **Step 4: Commit** — `git commit -m "feat(calendar): daily brief surfaces upcoming campaign radar suggestions"`

---

## Post-plan (controller)

- **Final whole-branch review** (opus): the radar's metering (≤1 call/tenant/day, memo correct, fallback not cached, `AiCapError` handled), house-rule adherence in the radar copy, tenancy on `/marketing/calendar` + the brief (radar reads only the caller's tenant), the date-math correctness, the Build-seed round-trip (params → prefilled Kit) introduces no new generation/auth path, and no disruption to the existing brief or `/marketing/campaigns`.
- Deploy `railway up` from `app/`. No env, no migration. Manual QA: open `/marketing/calendar`, confirm the year renders with holidays/seasons + any real campaigns, the Coming-up rail shows suggestions (or static angles on first load), "Build campaign" opens the Kit pre-seeded, and the dashboard brief mentions an upcoming date.

## Self-review notes
- **Coverage:** catalog (T1), radar (T2), page+nav+seed (T3), brief (T4), review (post). Every spec §Architecture item maps to a task.
- **Reuse-first:** meteredCreate, getBusinessContext, listCampaigns, the brief route, the campaigns hub/nav — all existing. New: two libs, one page + two components, one brief tweak. No schema change.
- **Cache decision:** in-process daily memo (not a table/KV) — matches "no migration", makes "don't cache the fallback" a one-liner, acceptable because the call is cheap + daily and recomputing after a deploy is fine.
- **Type consistency:** `CalDate`/`Season`/`SeasonBand` (T1) consumed verbatim by T2/T3; `RadarSuggestion` (T2) consumed by T3/T4; the five seed params are identical in T3 Step 4 and the `BuildCampaignLink`.
