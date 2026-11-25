# Lead Flows to Replace GoHighLevel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything Optimal Health's GoHighLevel lead workflows did, done natively in AdonisAgent for every business: per-business sending hours, lead assignment and alerts, column-started follow-up flows that stop each other and finish by moving the card, undelivered-WhatsApp fallback to email, a triage-read reply check in the Thinking-about-it flow, Log a call / Schedule a call, and the six agreed flows with their copy, all shipped OFF.

**Architecture:** A new `app/src/lib/leadFlows/` folder holds the engine, split into pure modules (sending window, settings model, flow model and decisions, call planning, copy presets) and server modules (definitions, runs, column entry, dispatch, transport seam, consent, undelivered, alerts, replies, calls, clock seam). The existing `lib/automations/nurture.ts` becomes a thin facade over it so every current caller keeps working. Runs are recorded in a new `lead_flow_runs` table; every timed thing (a message, a finish "move to column", a call-back check, a reply check, a staff alert) is a row in the existing `automation_queue`, sent by the existing minute dispatch ticker. Board columns get a stable `system_key` so follow-up columns are found by meaning, on every board, whatever the operator renames them to.

**Tech Stack:** Next.js 15 App Router, TypeScript, better-sqlite3 + drizzle-orm (per-tenant SQLite), zod, lucide-react, plain `node:assert` test scripts run by `npm test -- <path>` (tsx).

## Global Constraints

- No emojis anywhere: UI, code, comments, log lines, commit messages, docs. Use `lucide-react` icons where a glyph is needed.
- Plain copy: short factual sentences. Generated or stored copy: no money-back guarantees, no free consults.
- Controls never cramped (selects get the global chevron padding from globals.css; buttons at least 12px side padding small, 16px default).
- Every new flow and trigger ships OFF. Every flow is OFF until a person switches it on.
- Nothing may send a real WhatsApp, email or push during tests; use the fake transport (`lib/leadFlows/testing/harness.ts`). No paid AI calls in tests (triage is faked by calling the triage hook with a literal result).
- Never put a real phone number, email address or other personal data in code, tests, fixtures, docs or commits. Fakes only (for example `+353870000000`, `aoife@example.com`). The business phone is never typed into copy: copy uses `[BUSINESS_PHONE]`, filled from the business profile. DJ's alert number is entered by the operator in Settings, never in code.
- Respect tenant isolation: background paths bind their tenant with `runWithTenant` and never rely on `getCurrentTenant()` (it ignores `runWithTenant`); use `flowTenant()` (`lib/leadFlows/tenant.ts`) or `boundTenantId()`.
- Respect the write-approval gate: no new agent tools; agent stage moves keep going through `setStageToId(..., "agent")` after approval.
- Sending hours: per business, days of the week + start and end time, Europe/Dublin. Optimal Health will set Monday to Saturday, 09:00-18:00. Default for others (no setting saved): today's behaviour, WhatsApp 09:00-21:00 every day and email at any time. Once a business saves hours, they apply to every follow-up message on every channel. A step due outside the window is sent at the start of the next sending window (never dropped).
- Alert text, exactly: `New lead: {name}, {source}. {phone}. Open: {link}` and `Hot lead: {name} replied: "{first 120 chars}". Open: {link}`.
- New default columns (names editable): No answer, Call back later, Thinking about it, Long-term nurture, Message undelivered.
- Every flow stops on: a reply, a booking, a purchase, an unsubscribe, or the lead being moved to another column by a person. Starting any flow stops every other flow the lead is in. Re-entering a column restarts its flow.
- Tests: `npm test -- <path>` from `app/`; `npm run typecheck`; `npx next build`. Install no new packages.
- Commits: never `git add -A`; add files by path. Every commit message ends with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Work only on the current worktree branch. Do not push, deploy or run `railway`.

---

## Decisions where the design left things open

1. **Which roles the new columns use.** None. `pipeline_stages.role` is unique per board and all nine roles are taken by the default columns, so the five new columns are role-less and carry a new stable `system_key` (`no_answer`, `call_back`, `thinking`, `nurture`, `undelivered`), unique per board like `role`. Reason: flows and the finish "move to column" step must find "Long-term nurture" on every board (campaign boards are cloned from the default board) whatever the operator renames it to. `shouldAdvance` gains one rule: a lead in a follow-up column is pulled out by any forward funnel event except a move to the entry column, exactly like `lapsed`, so a reply still makes them a Hot lead and a booking still moves them to booked.
2. **How a flow is tied to a column.** Each flow has an optional start column and an optional finish column stored on `automation_triggers` as a column reference string: `role:<role>`, `key:<system_key>` or `stage:<id>`. Defaults live in code (`FLOW_DEFAULTS`), so nothing is stored until an operator edits a flow. `lead_booked` and `lead_no_show` become ordinary column-started flows (`role:booked`, `role:no_show`) instead of the hardcode in `writeStageId`.
3. **Delays.** The editor keeps today's meaning ("counted from when the sequence starts"). The engine schedules each step from the previous step's actual (window-adjusted) time plus the difference in offsets, so a step held overnight pushes the later steps back instead of bunching them. The design's "+2 days, +2 days, +1 day" tables are stored as offsets 0, 2, 4, 5, 7 days. The finish move is an offset too (New lead 14 days, No answer 4, Call back later 6, Thinking about it 17).
4. **Long-term nurture weeks.** Week N goes (N - 1) x 7 days after entering the column: weeks 1, 2, 3, 6, 8, 10, 12 = days 0, 7, 14, 35, 49, 63, 77.
5. **Treatment versions.** A message can carry "Only for leads interested in" keywords (comma-separated, matched against the lead's `therapy_interest`), or the word `other`. Among the versions due at the same offset, the first keyword match is sent, else the `other` version. Messages without keywords always go.
6. **Marketing consent for leads.** No lead intake records consent today. New columns `leads.marketing_consent_at` and `leads.marketing_consent_source`. Recorded by: the inbound lead API field `marketingConsent` (truthy), and a staff toggle on the lead page. Consenting adds the address to Email campaigns > Contacts (tag `leads`), which is what "after week 12 they stay in normal campaigns" needs and what the signed unsubscribe token (tenant id + contact id) requires. Only Long-term nurture checks consent. An unsubscribe (link, complaint or manual suppression) clears consent and stops every flow except a booked call's messages; a bounce only cancels queued emails to that address. A staff tick never lifts an earlier unsubscribe; a fresh yes from the person (API/form) does, like the member consent.
7. **"Hot lead" alerts and the reply check.** The hot alert fires when a reply moves a lead into the engaged column (not on every reply). In the Thinking-about-it flow (column `key:thinking`, flow switched on), a reply stops the flow's remaining messages and queues a reply check for 15 minutes. The inbox triage result resolves it: `booking`, or `high` priority on anything other than `sensitive`/`spam`, means "wants to book or asks to talk" (Hot lead + alert); anything else queues the move to Long-term nurture 7 days later. If triage never answers (AI cap, error, an email reply, which is not triaged), the check fires after 15 minutes and is treated as positive: a person looks rather than the lead waiting a week. "Unless a person acts" means a person moves the lead or logs or schedules a call (both move the card, which cancels the queued move).
8. **Undelivered.** Only a provider failure on a connected WhatsApp counts (the bridge throwing on send, or a `failed` delivery status from the webhook for that message). WhatsApp not connected is a business-side failure and stays a visible failed row, never a column move.
9. **Alerts are not windowed.** Staff alerts go when they happen. The call-back reminder goes at the start of sending hours on the picked day ("that morning"), 09:00 when no hours are set. The assignee's in-app alert is a personal notification (new `notifications.for_user_id`); the business-wide bell and push for new leads and messages still fire as today.
10. **Call booked flow timing.** Message 1 goes at booking (within sending hours); later messages are counted back from the call ("1 hour before") and are dropped if sending hours would push them to or past the call time. The staff alert goes 10 minutes before the call (in-app, to the assignee, else to whoever scheduled it). The call is a 15-minute diary entry (`calendar_events`). When the lead has no phone, the call messages go by email instead (`Your call with {business}`).
11. **"Spoke to them"** moves the lead to the engaged ("Hot lead") column, which has no flow: a person is handling them. "Booked a treatment" moves to the booked column (`lead_booked` flow if on).
12. **"When a call is made through Adonis, the same choice pops up after it".** Not built: the only call Adonis places today is the voice agent, which already moves the card itself from its webhook (`onAnsweredStageRole`). There is no staff-placed in-app call to hang a prompt on. Reported as a follow-up.
13. **Optimal Health copy.** Kept in code as a preset keyed by tenant slug (`lib/leadFlows/presets.ts`, the same pattern as `lib/design/presets.ts` and `lib/cms/enquiry.ts`). It is what the editor and the engine use until the operator saves their own messages; other businesses get neutral defaults. The editor gets a "Use the default wording" button so an earlier save can be replaced with the preset.
14. **Fake clock.** `lib/leadFlows/clock.ts` (`flowNow()`, `setFlowClockForTests`) so every enrolment, check and dispatch in the end-to-end test runs on a fixed date.

---

## File Structure

New, pure (no `server-only`, no DB; load under plain tsx):
- `app/src/lib/leadFlows/sendingWindow.ts` - window maths in Europe/Dublin: next send time, morning of a day, end of a day, DST-safe local-to-UTC.
- `app/src/lib/leadFlows/settingsModel.ts` - the per-business settings shape, lenient parse, strict validation.
- `app/src/lib/pipeline/followUpColumns.ts` - the five follow-up column keys, names, colours, and the planner that inserts missing ones into a board.
- `app/src/lib/leadFlows/flowModel.ts` - flow keys, column references, flow defaults, which triggers are on by default, queue payload parsing.
- `app/src/lib/leadFlows/flowPlan.ts` - the column-entry decision, treatment versions, step cascade, finish time, reply classification.
- `app/src/lib/leadFlows/callPlan.ts` - call outcomes, call-back day picks, call message timing, call day/time wording.
- `app/src/lib/leadFlows/presets.ts` - Optimal Health's agreed copy and `defaultMessagesFor(triggerKey, tenantSlug)`.
- `app/src/lib/leadFlows/alertText.ts` - the two alert strings.

New, server:
- `app/src/lib/leadFlows/clock.ts` - `flowNow()` and the test seam.
- `app/src/lib/leadFlows/tenant.ts` - `flowTenant()`: the bound or request tenant with its slug.
- `app/src/lib/leadFlows/settings.ts` - read/save the settings key.
- `app/src/lib/leadFlows/definitions.ts` - a flow's effective definition (saved or default) and which flow a column starts.
- `app/src/lib/leadFlows/runs.ts` - start a flow, stop flows, cancel call rows.
- `app/src/lib/leadFlows/columnEntry.ts` - what entering a column does to flows.
- `app/src/lib/leadFlows/transport.ts` - the send seam (real Whapi/email, or a test fake).
- `app/src/lib/leadFlows/dispatch.ts` - send what is due: messages, moves, checks, alerts.
- `app/src/lib/leadFlows/consent.ts` - marketing consent for leads, contacts, suppression hook.
- `app/src/lib/leadFlows/undelivered.ts` - first-WhatsApp failure handling.
- `app/src/lib/leadFlows/assignment.ts` - assignable staff and assigning a lead.
- `app/src/lib/leadFlows/alerts.ts` - new-lead and hot-lead alerts, staff alert rows.
- `app/src/lib/leadFlows/replies.ts` - the Thinking-about-it reply check rows.
- `app/src/lib/leadFlows/calls.ts` - Log a call, Schedule a call, the call history.
- `app/src/lib/leadFlows/testing/stubs.ts`, `app/src/lib/leadFlows/testing/harness.ts` - test support (not `*.test.ts`).

New, UI:
- `app/src/app/settings/lead-follow-ups/page.tsx`, `actions.ts`; `app/src/components/settings/LeadFollowUpsForm.tsx`.
- `app/src/app/leads/callActions.ts` - server actions for calls, assignment, consent.
- `app/src/components/leads/CallDialog.tsx` - Log a call / Schedule a call.

Modified: `lib/automationModel.ts`, `lib/automations/nurture.ts`, `lib/automations.ts`, `lib/pipeline/{roles.ts,stage.ts,stageRepo.ts,pipelineRepo.ts}`, `lib/db/{schema.ts,tenant.ts}`, `lib/db/migrations/index.ts`, `lib/leads.ts`, `lib/marketing/suppress.ts`, `lib/notifications/{notify.ts,store.ts}`, `lib/inbox/triagePipeline.ts`, `lib/gmail.ts`, `lib/imapEmail.ts`, `lib/dispatch/ticker.ts`, `app/api/whatsapp/webhook/route.ts`, `app/api/integrations/meta/webhook/route.ts`, `app/api/leads/inbound/route.ts`, `app/automations/actions.ts`, `components/automations/TriggerEditor.tsx`, `components/leads/LeadDetail.tsx`, `app/leads/[id]/page.tsx`, `components/pipeline/{LeadCard.tsx,PipelineBoard.tsx}`, `app/settings/page.tsx`, and the tests named in each task.

---

### Task 1: Sending window maths

**Files:**
- Create: `app/src/lib/leadFlows/sendingWindow.ts`
- Test: `app/src/lib/leadFlows/sendingWindow.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `FLOW_TIME_ZONE = "Europe/Dublin"`
  - `interface SendingWindow { days: number[]; start: string; end: string }` (days 0 = Sunday .. 6 = Saturday; times `"HH:mm"`, end exclusive)
  - `LEGACY_WHATSAPP_WINDOW: SendingWindow` (every day 09:00-21:00)
  - `isHhmm(s: unknown): s is string`, `hhmmToMinutes(s: string): number`
  - `localParts(at: number, tz?: string): { date: string; weekday: number; minutes: number }`
  - `zonedTimeToUtc(date: string, hhmm: string, tz?: string): number`
  - `addDays(date: string, n: number): string`, `weekdayOf(date: string): number`
  - `nextSendTime(at: number, w: SendingWindow, tz?: string): number`
  - `fitToWindow(at: number, channel: string, w: SendingWindow | null, tz?: string): number`
  - `morningOf(date: string, w: SendingWindow | null, tz?: string): number`
  - `endOfLocalDay(date: string, tz?: string): number`
  - `todayIn(at: number, tz?: string): string`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/leadFlows/sendingWindow.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/sendingWindow.test.ts
//
// Sending-window maths, Irish time: Mon-Sat 09:00-18:00 (Optimal Health),
// the next window start for anything outside it, both clock changes, and
// today's behaviour when a business has saved no hours.
import assert from "node:assert/strict";

import {
  addDays,
  endOfLocalDay,
  fitToWindow,
  morningOf,
  nextSendTime,
  todayIn,
  weekdayOf,
  zonedTimeToUtc,
  type SendingWindow,
} from "./sendingWindow";

let n = 0;
function eq(actual: number | string, expected: number | string, name: string) {
  assert.equal(actual, expected, name);
  n++;
}
const iso = (s: string) => Date.parse(s);
const OH: SendingWindow = { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" };

// Winter (Irish time = UTC). 2026-11-25 is a Wednesday.
eq(nextSendTime(iso("2026-11-25T10:00:00Z"), OH), iso("2026-11-25T10:00:00Z"), "inside the window: now");
eq(nextSendTime(iso("2026-11-25T08:15:00Z"), OH), iso("2026-11-25T09:00:00Z"), "before 9: that morning at 9");
eq(nextSendTime(iso("2026-11-25T18:00:00Z"), OH), iso("2026-11-26T09:00:00Z"), "the end time is exclusive");
eq(nextSendTime(iso("2026-11-25T19:00:00Z"), OH), iso("2026-11-26T09:00:00Z"), "evening: next morning");
eq(nextSendTime(iso("2026-11-28T18:30:00Z"), OH), iso("2026-11-30T09:00:00Z"), "Saturday evening: Monday at 9");
eq(nextSendTime(iso("2026-11-29T12:00:00Z"), OH), iso("2026-11-30T09:00:00Z"), "Sunday: Monday at 9");

// Summer (Irish time = UTC+1).
eq(nextSendTime(iso("2026-07-01T07:30:00Z"), OH), iso("2026-07-01T08:00:00Z"), "summer 08:30 Irish waits for 09:00 Irish");
eq(zonedTimeToUtc("2026-07-01", "09:00"), iso("2026-07-01T08:00:00Z"), "09:00 Irish in summer is 08:00 UTC");

// Clocks go forward Sunday 2026-03-29; back Sunday 2026-10-25.
eq(nextSendTime(iso("2026-03-28T19:00:00Z"), OH), iso("2026-03-30T08:00:00Z"), "across the spring change: Monday 09:00 summer time");
eq(nextSendTime(iso("2026-10-24T17:30:00Z"), OH), iso("2026-10-26T09:00:00Z"), "across the autumn change: Monday 09:00 winter time");

// No hours saved yet: today's behaviour.
eq(fitToWindow(iso("2026-11-11T02:30:00Z"), "email", null), iso("2026-11-11T02:30:00Z"), "no hours set: email goes any time");
eq(fitToWindow(iso("2026-11-11T02:30:00Z"), "whatsapp", null), iso("2026-11-11T09:00:00Z"), "no hours set: WhatsApp waits for 9");
eq(fitToWindow(iso("2026-11-11T22:15:00Z"), "whatsapp", null), iso("2026-11-12T09:00:00Z"), "no hours set: WhatsApp after 9pm waits for next day");
eq(fitToWindow(iso("2026-11-29T12:00:00Z"), "whatsapp", null), iso("2026-11-29T12:00:00Z"), "no hours set: Sunday is a sending day");
// Hours saved: every channel.
eq(fitToWindow(iso("2026-11-25T19:00:00Z"), "email", OH), iso("2026-11-26T09:00:00Z"), "hours set: email waits too");

// Helpers.
eq(morningOf("2026-12-02", OH), iso("2026-12-02T09:00:00Z"), "the morning of a day is its start time");
eq(morningOf("2026-12-02", null), iso("2026-12-02T09:00:00Z"), "no hours set: 9am");
eq(endOfLocalDay("2026-07-01"), iso("2026-07-01T22:59:59.999Z"), "end of an Irish summer day");
eq(addDays("2026-11-30", 1), "2026-12-01", "adding a day crosses a month");
eq(weekdayOf("2026-11-29"), 0, "2026-11-29 is a Sunday");
eq(todayIn(iso("2026-07-01T23:30:00Z")), "2026-07-02", "half eleven UTC in summer is the next Irish day");
eq(nextSendTime(iso("2026-11-25T19:00:00Z"), { days: [], start: "09:00", end: "18:00" }), iso("2026-11-25T19:00:00Z"), "no days at all never drops a message");

console.log(`sendingWindow: ${n} checks passed.`);
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `app/`): `npm test -- src/lib/leadFlows/sendingWindow.test.ts`
Expected: FAIL, "Cannot find module './sendingWindow'".

- [ ] **Step 3: Write the implementation**

Create `app/src/lib/leadFlows/sendingWindow.ts`:

```ts
/**
 * When lead follow-ups may go out. Pure: no DB, no server-only, so it loads
 * under the plain-tsx test runner.
 *
 * A business sets one window for every flow: days of the week plus a start
 * and an end time, in Irish time. A message due outside it goes at the start
 * of the next window; nothing is dropped. A business that has saved no hours
 * keeps the behaviour from before the setting existed: WhatsApp between 09:00
 * and 21:00 every day, email at any time (see fitToWindow).
 */

export const FLOW_TIME_ZONE = "Europe/Dublin";

export interface SendingWindow {
  /** Days messages may go: 0 = Sunday ... 6 = Saturday. */
  days: number[];
  /** "HH:mm", local time. */
  start: string;
  /** "HH:mm", local time, exclusive. Later than start. */
  end: string;
}

/** Before a business saves its own hours: WhatsApp 09:00-21:00 every day. */
export const LEGACY_WHATSAPP_WINDOW: SendingWindow = { days: [0, 1, 2, 3, 4, 5, 6], start: "09:00", end: "21:00" };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isHhmm(s: unknown): s is string {
  return typeof s === "string" && HHMM.test(s);
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  return f;
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function parts(at: number, tz: string): Record<string, string> {
  return Object.fromEntries(formatter(tz).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
}

/** The local date ("YYYY-MM-DD"), weekday and minute of the day at an instant. */
export function localParts(at: number, tz: string = FLOW_TIME_ZONE): { date: string; weekday: number; minutes: number } {
  const p = parts(at, tz);
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: WEEKDAY[p.weekday], minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** How far local time is ahead of UTC at an instant, in ms. */
function offsetAt(at: number, tz: string): number {
  const p = parts(at, tz);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/**
 * The instant a local wall-clock time happens on a date. The second pass
 * settles a first guess that landed on the other side of a clock change.
 */
export function zonedTimeToUtc(date: string, hhmm: string, tz: string = FLOW_TIME_ZONE): number {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetAt(guess, tz);
  return guess - offsetAt(first, tz);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The first moment at or after `at` inside the window. A window with no days never holds anything back. */
export function nextSendTime(at: number, w: SendingWindow, tz: string = FLOW_TIME_ZONE): number {
  if (w.days.length === 0) return at;
  const { date } = localParts(at, tz);
  for (let i = 0; i <= 7; i++) {
    const day = addDays(date, i);
    if (!w.days.includes(weekdayOf(day))) continue;
    const open = zonedTimeToUtc(day, w.start, tz);
    const close = zonedTimeToUtc(day, w.end, tz);
    if (at < open) return open;
    if (at < close) return at;
  }
  return at;
}

/**
 * When a follow-up on `channel` may go, at or after `at`. With hours saved,
 * they hold every channel. With none saved: WhatsApp 09:00-21:00 every day,
 * email straight away (the behaviour before the setting existed).
 */
export function fitToWindow(at: number, channel: string, w: SendingWindow | null, tz: string = FLOW_TIME_ZONE): number {
  if (w) return nextSendTime(at, w, tz);
  return channel === "whatsapp" ? nextSendTime(at, LEGACY_WHATSAPP_WINDOW, tz) : at;
}

/** The start of sending hours on a date ("that morning"), whatever the weekday; 09:00 with no hours saved. */
export function morningOf(date: string, w: SendingWindow | null, tz: string = FLOW_TIME_ZONE): number {
  return zonedTimeToUtc(date, w?.start ?? "09:00", tz);
}

/** The last millisecond of a local date. */
export function endOfLocalDay(date: string, tz: string = FLOW_TIME_ZONE): number {
  return zonedTimeToUtc(addDays(date, 1), "00:00", tz) - 1;
}

/** Today's local date at an instant. */
export function todayIn(at: number, tz: string = FLOW_TIME_ZONE): string {
  return localParts(at, tz).date;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/leadFlows/sendingWindow.test.ts`
Expected: PASS, "sendingWindow: 22 checks passed."

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/leadFlows/sendingWindow.ts app/src/lib/leadFlows/sendingWindow.test.ts
git commit -m "feat(lead-flows): sending window maths in Irish time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Lead follow-up settings (model and store)

**Files:**
- Create: `app/src/lib/leadFlows/settingsModel.ts`
- Create: `app/src/lib/leadFlows/settings.ts`
- Test: `app/src/lib/leadFlows/settingsModel.test.ts`

**Interfaces:**
- Consumes: `SendingWindow`, `isHhmm`, `hhmmToMinutes` (Task 1); `normalizePhone` from `@/lib/whatsapp/phone`; `readKey`, `readKeyForTenant`, `setKey` from `@/lib/settings`.
- Produces:
  - `interface LeadFlowSettings { window: SendingWindow | null; defaultAssigneeUserId: number | null; alertWhatsAppTo: string | null }`
  - `LEAD_FLOW_SETTINGS_KEY = "lead_flow_settings"`, `DEFAULT_LEAD_FLOW_SETTINGS`
  - `parseLeadFlowSettings(raw: unknown): LeadFlowSettings`
  - `interface LeadFlowSettingsInput { window: { days: number[]; start: string; end: string } | null; defaultAssigneeUserId: number | null; alertWhatsAppTo: string | null }`
  - `validateLeadFlowSettings(input: LeadFlowSettingsInput): { ok: true; value: LeadFlowSettings } | { ok: false; error: string }`
  - server: `getLeadFlowSettings(): LeadFlowSettings`, `getLeadFlowSettingsForTenant(tenantId: number): LeadFlowSettings`, `saveLeadFlowSettings(value: LeadFlowSettings): void`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/leadFlows/settingsModel.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/settingsModel.test.ts
//
// The lead follow-up settings: what an unreadable stored value falls back
// to, and what a save refuses, in plain words.
import assert from "node:assert/strict";

import { DEFAULT_LEAD_FLOW_SETTINGS, parseLeadFlowSettings, validateLeadFlowSettings } from "./settingsModel";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};

// Reading what is stored.
assert.deepEqual(parseLeadFlowSettings(null), DEFAULT_LEAD_FLOW_SETTINGS);
n++;
ok(parseLeadFlowSettings("nonsense").window === null, "garbage reads as no hours set");
const read = parseLeadFlowSettings({ window: { days: [6, 1, 1, 9], start: "09:00", end: "18:00" }, defaultAssigneeUserId: 7, alertWhatsAppTo: " +353870000000 " });
assert.deepEqual(read.window, { days: [1, 6], start: "09:00", end: "18:00" }, "days are de-duplicated, sorted, out-of-range dropped");
n++;
ok(read.defaultAssigneeUserId === 7, "assignee kept");
ok(read.alertWhatsAppTo === "+353870000000", "alert number trimmed");
ok(parseLeadFlowSettings({ window: { days: [1], start: "18:00", end: "09:00" } }).window === null, "an end before the start reads as no hours set");
ok(parseLeadFlowSettings({ defaultAssigneeUserId: -3 }).defaultAssigneeUserId === null, "a bad assignee reads as nobody");

// Saving.
const good = validateLeadFlowSettings({ window: { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" }, defaultAssigneeUserId: 3, alertWhatsAppTo: "087 000 0000" });
ok(good.ok && good.value.window?.days.length === 6 && good.value.alertWhatsAppTo === "087 000 0000", "a full save is accepted");
ok(validateLeadFlowSettings({ window: null, defaultAssigneeUserId: null, alertWhatsAppTo: "" }).ok, "nothing set is a valid save");
const blankAlert = validateLeadFlowSettings({ window: null, defaultAssigneeUserId: null, alertWhatsAppTo: "   " });
ok(blankAlert.ok && blankAlert.value.alertWhatsAppTo === null, "a blank alert number is stored as none");
const noDays = validateLeadFlowSettings({ window: { days: [], start: "09:00", end: "18:00" }, defaultAssigneeUserId: null, alertWhatsAppTo: null });
ok(!noDays.ok && noDays.error === "Pick at least one day.", "no days refused");
const badTime = validateLeadFlowSettings({ window: { days: [1], start: "9am", end: "18:00" }, defaultAssigneeUserId: null, alertWhatsAppTo: null });
ok(!badTime.ok && badTime.error === "Use a time like 09:00.", "a bad time refused");
const backwards = validateLeadFlowSettings({ window: { days: [1], start: "18:00", end: "09:00" }, defaultAssigneeUserId: null, alertWhatsAppTo: null });
ok(!backwards.ok && backwards.error === "The end time must be after the start time.", "end before start refused");
const shortPhone = validateLeadFlowSettings({ window: null, defaultAssigneeUserId: null, alertWhatsAppTo: "0870" });
ok(!shortPhone.ok && /area code/.test(shortPhone.error), "a too-short number refused");
const badUser = validateLeadFlowSettings({ window: null, defaultAssigneeUserId: 0, alertWhatsAppTo: null });
ok(!badUser.ok, "a non-positive assignee refused");

console.log(`settingsModel: ${n} checks passed.`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/leadFlows/settingsModel.test.ts`
Expected: FAIL, "Cannot find module './settingsModel'".

- [ ] **Step 3: Write the implementation**

Create `app/src/lib/leadFlows/settingsModel.ts`:

```ts
/**
 * A business's lead follow-up settings. Pure: the shape, a lenient read of
 * what is stored, and a strict check for a save. Stored as one JSON value
 * under LEAD_FLOW_SETTINGS_KEY in the tenant's settings table.
 */
import { normalizePhone } from "@/lib/whatsapp/phone";

import { hhmmToMinutes, isHhmm, type SendingWindow } from "./sendingWindow";

export interface LeadFlowSettings {
  /** null = no hours saved: WhatsApp 09:00-21:00 every day, email any time. */
  window: SendingWindow | null;
  /** Who new leads are assigned to, a control-plane user id; null = nobody. */
  defaultAssigneeUserId: number | null;
  /** The number staff alerts go to by WhatsApp, from the business WhatsApp; null = none. */
  alertWhatsAppTo: string | null;
}

export interface LeadFlowSettingsInput {
  window: { days: number[]; start: string; end: string } | null;
  defaultAssigneeUserId: number | null;
  alertWhatsAppTo: string | null;
}

export const LEAD_FLOW_SETTINGS_KEY = "lead_flow_settings";

export const DEFAULT_LEAD_FLOW_SETTINGS: LeadFlowSettings = { window: null, defaultAssigneeUserId: null, alertWhatsAppTo: null };

function cleanDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
}

function readWindow(raw: unknown): SendingWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const days = cleanDays(r.days);
  if (days.length === 0 || !isHhmm(r.start) || !isHhmm(r.end)) return null;
  if (hhmmToMinutes(r.end) <= hhmmToMinutes(r.start)) return null;
  return { days, start: r.start, end: r.end };
}

function readUserId(raw: unknown): number | null {
  return Number.isInteger(raw) && (raw as number) > 0 ? (raw as number) : null;
}

/** What is stored, read leniently: a field that does not make sense falls back to its default. */
export function parseLeadFlowSettings(raw: unknown): LeadFlowSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_LEAD_FLOW_SETTINGS };
  const r = raw as Record<string, unknown>;
  const alert = typeof r.alertWhatsAppTo === "string" ? r.alertWhatsAppTo.trim() : "";
  return {
    window: readWindow(r.window),
    defaultAssigneeUserId: readUserId(r.defaultAssigneeUserId),
    alertWhatsAppTo: alert || null,
  };
}

/** A save, checked strictly. The error says what to change. */
export function validateLeadFlowSettings(
  input: LeadFlowSettingsInput,
): { ok: true; value: LeadFlowSettings } | { ok: false; error: string } {
  let window: SendingWindow | null = null;
  if (input.window) {
    const days = cleanDays(input.window.days);
    if (days.length === 0) return { ok: false, error: "Pick at least one day." };
    if (!isHhmm(input.window.start) || !isHhmm(input.window.end)) return { ok: false, error: "Use a time like 09:00." };
    if (hhmmToMinutes(input.window.end) <= hhmmToMinutes(input.window.start)) {
      return { ok: false, error: "The end time must be after the start time." };
    }
    window = { days, start: input.window.start, end: input.window.end };
  }
  if (input.defaultAssigneeUserId !== null && readUserId(input.defaultAssigneeUserId) === null) {
    return { ok: false, error: "Pick someone from the list, or nobody." };
  }
  const alert = (input.alertWhatsAppTo ?? "").trim();
  if (alert) {
    const digits = normalizePhone(alert);
    if (digits.length < 8 || digits.length > 15) {
      return { ok: false, error: "Enter the WhatsApp number with its area code, for example 087 000 0000." };
    }
  }
  return { ok: true, value: { window, defaultAssigneeUserId: input.defaultAssigneeUserId, alertWhatsAppTo: alert || null } };
}
```

Create `app/src/lib/leadFlows/settings.ts`:

```ts
import "server-only";

import { readKey, readKeyForTenant, setKey } from "@/lib/settings";

import { LEAD_FLOW_SETTINGS_KEY, parseLeadFlowSettings, type LeadFlowSettings } from "./settingsModel";

/** The current tenant's lead follow-up settings (ambient tenant: request or runWithTenant). */
export function getLeadFlowSettings(): LeadFlowSettings {
  return parseLeadFlowSettings(readKey<unknown>(LEAD_FLOW_SETTINGS_KEY, null));
}

/** The same, for an explicit tenant (background jobs). */
export function getLeadFlowSettingsForTenant(tenantId: number): LeadFlowSettings {
  return parseLeadFlowSettings(readKeyForTenant<unknown>(tenantId, LEAD_FLOW_SETTINGS_KEY, null));
}

/** Save a value already checked by validateLeadFlowSettings. */
export function saveLeadFlowSettings(value: LeadFlowSettings): void {
  setKey(LEAD_FLOW_SETTINGS_KEY, value);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/leadFlows/settingsModel.test.ts`
Expected: PASS, "settingsModel: 15 checks passed."

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/leadFlows/settingsModel.ts app/src/lib/leadFlows/settings.ts app/src/lib/leadFlows/settingsModel.test.ts
git commit -m "feat(lead-flows): per-business follow-up settings model and store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Follow-up columns on every board

**Files:**
- Create: `app/src/lib/pipeline/followUpColumns.ts`
- Modify: `app/src/lib/pipeline/roles.ts` (types `StageRecord`, `StageLike`; `shouldAdvance`)
- Modify: `app/src/lib/pipeline/stageRepo.ts` (`SELECT`, `normalize`)
- Modify: `app/src/lib/pipeline/pipelineRepo.ts` (`createPipeline` clones `systemKey`; `deletePipeline` matches it)
- Modify: `app/src/lib/db/schema.ts` (`pipelineStages.systemKey` + unique index)
- Modify: `app/src/lib/db/tenant.ts` (guarded ALTER + index at the end of `ensureTenantTables`)
- Modify: `app/src/lib/db/migrations/index.ts` (migration `0011-follow-up-columns`)
- Modify: `app/src/lib/pipeline/pipelines.test.ts` (column counts 9 -> 14)
- Test: `app/src/lib/pipeline/followUpColumns.test.ts` (pure), `app/src/lib/pipeline/followUpColumns.db.test.ts` (scratch tenant)

**Interfaces:**
- Consumes: `OUT_OF_BAND`, `StageRole` (roles.ts).
- Produces:
  - `type FollowUpKey = "no_answer" | "call_back" | "thinking" | "nurture" | "undelivered"`
  - `FOLLOW_UP_KEYS: readonly FollowUpKey[]`, `isFollowUpKey(v: unknown): v is FollowUpKey`
  - `FOLLOW_UP_COLUMNS: Record<FollowUpKey, { name: string; colour: string }>`
  - `planFollowUpColumns(stages: ColumnSlot[]): FollowUpPlan` where `ColumnSlot = { id: number; position: number; role: StageRole | null; systemKey: FollowUpKey | null }` and `FollowUpPlan = { inserts: { key: FollowUpKey; name: string; colour: string; position: number }[]; moves: { id: number; position: number }[] }`
  - `StageRecord.systemKey?: FollowUpKey | null` and `StageLike.systemKey?: FollowUpKey | null` (optional so bare fixtures stay valid); `listStages`/`listStagesOnConn`/`listAllStagesOnConn` now return it.
  - schema `pipelineStages.systemKey` (column `system_key`).

- [ ] **Step 1: Write the failing pure test**

Create `app/src/lib/pipeline/followUpColumns.test.ts`:

```ts
// Run: npm test -- src/lib/pipeline/followUpColumns.test.ts
//
// Where the five follow-up columns go on a board, and the one advancement
// rule they add: a lead in one is pulled out by any forward funnel event.
import assert from "node:assert/strict";

import { DEFAULT_STAGES, shouldAdvance, type StageRole } from "./roles";
import { FOLLOW_UP_KEYS, isFollowUpKey, planFollowUpColumns, type ColumnSlot } from "./followUpColumns";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};

const defaults: ColumnSlot[] = DEFAULT_STAGES.map((s, i) => ({ id: i + 1, position: s.position, role: s.role, systemKey: null }));
const plan = planFollowUpColumns(defaults);
ok(plan.inserts.length === 5, "a default board gets all five");
const order = [
  ...defaults.map((s) => ({ name: DEFAULT_STAGES[s.id - 1].name, position: plan.moves.find((m) => m.id === s.id)?.position ?? s.position })),
  ...plan.inserts.map((i) => ({ name: i.name, position: i.position })),
]
  .sort((a, b) => a.position - b.position)
  .map((x) => x.name);
assert.deepEqual(order, [
  "New lead",
  "Hot lead",
  "No answer",
  "Call back later",
  "Thinking about it",
  "Consultation booked",
  "No-show",
  "Attended",
  "Sale",
  "Repeat customer",
  "Long-term nurture",
  "Message undelivered",
  "Lapsed",
  "Lost",
]);
n++;
const positions = [...plan.inserts.map((i) => i.position), ...defaults.map((s) => plan.moves.find((m) => m.id === s.id)?.position ?? s.position)].sort((a, b) => a - b);
assert.deepEqual(positions, [...Array(14).keys()], "positions are 0..13 with no gaps or clashes");
n++;

const full: ColumnSlot[] = [...defaults, ...FOLLOW_UP_KEYS.map((k, i) => ({ id: 100 + i, position: 20 + i, role: null, systemKey: k }))];
const none = planFollowUpColumns(full);
ok(none.inserts.length === 0 && none.moves.length === 0, "a board that has them all is left alone");

const partial = planFollowUpColumns([...defaults, { id: 50, position: 9, role: null, systemKey: "nurture" }]);
ok(partial.inserts.length === 4 && !partial.inserts.some((i) => i.key === "nurture"), "only the missing ones are added");

const bare = planFollowUpColumns([
  { id: 1, position: 0, role: null, systemKey: null },
  { id: 2, position: 1, role: null, systemKey: null },
]);
ok(bare.inserts.find((i) => i.key === "no_answer")?.position === 0, "no new or engaged column: the early ones go first");
ok(bare.inserts.find((i) => i.key === "undelivered")?.position === 6, "no lapsed or lost column: the late ones go last");

ok(isFollowUpKey("thinking") && !isFollowUpKey("booked"), "isFollowUpKey");

// Advancement out of a follow-up column.
const at = (position: number, role: StageRole | null, systemKey: (typeof FOLLOW_UP_KEYS)[number] | null = null) => ({ position, role, systemKey });
ok(shouldAdvance(at(3, null, "no_answer"), at(1, "engaged")), "a reply pulls a lead out of No answer into Hot lead, even though Hot lead sits left of it");
ok(shouldAdvance(at(10, null, "nurture"), at(5, "booked")), "a booking pulls a lead out of Long-term nurture");
ok(!shouldAdvance(at(3, null, "no_answer"), at(0, "new")), "never back to the entry column");
ok(!shouldAdvance(at(3, null), at(1, "engaged")), "a plain manual column still never auto-advances");
ok(!shouldAdvance(at(3, null, "thinking"), at(12, "lapsed")), "never into an out-of-band column");

console.log(`followUpColumns: ${n} checks passed.`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/pipeline/followUpColumns.test.ts`
Expected: FAIL, "Cannot find module './followUpColumns'".

- [ ] **Step 3: Write `followUpColumns.ts` and the roles change**

Create `app/src/lib/pipeline/followUpColumns.ts`:

```ts
/**
 * The five follow-up columns the lead flows move cards between. Pure: no DB.
 *
 * They have no role (every role is taken by the nine default columns, and a
 * role is unique per board), so each carries a stable `system_key` instead.
 * Flows find "Long-term nurture" by that key on whichever board the lead is
 * on, whatever the operator has renamed the column to.
 */
import { OUT_OF_BAND, type StageRole } from "./roles";

export type FollowUpKey = "no_answer" | "call_back" | "thinking" | "nurture" | "undelivered";

export const FOLLOW_UP_KEYS: readonly FollowUpKey[] = ["no_answer", "call_back", "thinking", "nurture", "undelivered"];

export function isFollowUpKey(v: unknown): v is FollowUpKey {
  return typeof v === "string" && (FOLLOW_UP_KEYS as readonly string[]).includes(v);
}

export const FOLLOW_UP_COLUMNS: Record<FollowUpKey, { name: string; colour: string }> = {
  no_answer: { name: "No answer", colour: "#a371f7" },
  call_back: { name: "Call back later", colour: "#58a6ff" },
  thinking: { name: "Thinking about it", colour: "#e3b341" },
  nurture: { name: "Long-term nurture", colour: "#56d4dd" },
  undelivered: { name: "Message undelivered", colour: "#f85149" },
};

/** Worked straight after the first contact: next to Hot lead. */
const EARLY: FollowUpKey[] = ["no_answer", "call_back", "thinking"];
/** Where flows end up: before Lapsed and Lost. */
const LATE: FollowUpKey[] = ["nurture", "undelivered"];

export interface ColumnSlot {
  id: number;
  position: number;
  role: StageRole | null;
  systemKey: FollowUpKey | null;
}

export interface FollowUpPlan {
  inserts: { key: FollowUpKey; name: string; colour: string; position: number }[];
  /** Existing columns whose position changes so the new ones fit. Relative order is kept. */
  moves: { id: number; position: number }[];
}

type Slot = { kind: "stage"; s: ColumnSlot } | { kind: "new"; key: FollowUpKey };

/**
 * Where the missing follow-up columns go on one board: No answer, Call back
 * later and Thinking about it right after Hot lead (or after New lead, or
 * first); Long-term nurture and Message undelivered right before the first
 * Lapsed or Lost column (or last). Positions come out as 0..n-1.
 */
export function planFollowUpColumns(stages: ColumnSlot[]): FollowUpPlan {
  const have = new Set(stages.map((s) => s.systemKey).filter((k): k is FollowUpKey => k != null));
  const early = EARLY.filter((k) => !have.has(k));
  const late = LATE.filter((k) => !have.has(k));
  if (early.length === 0 && late.length === 0) return { inserts: [], moves: [] };

  const ordered: Slot[] = [...stages]
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((s) => ({ kind: "stage", s }));

  let after = ordered.findIndex((x) => x.kind === "stage" && x.s.role === "engaged");
  if (after < 0) after = ordered.findIndex((x) => x.kind === "stage" && x.s.role === "new");
  ordered.splice(after + 1, 0, ...early.map((key): Slot => ({ kind: "new", key })));

  let before = ordered.findIndex((x) => x.kind === "stage" && x.s.role != null && OUT_OF_BAND.has(x.s.role));
  if (before < 0) before = ordered.length;
  ordered.splice(before, 0, ...late.map((key): Slot => ({ kind: "new", key })));

  const plan: FollowUpPlan = { inserts: [], moves: [] };
  ordered.forEach((x, position) => {
    if (x.kind === "new") plan.inserts.push({ key: x.key, ...FOLLOW_UP_COLUMNS[x.key], position });
    else if (x.s.position !== position) plan.moves.push({ id: x.s.id, position });
  });
  return plan;
}
```

In `app/src/lib/pipeline/roles.ts`:

Add after the header comment, before `export type StageRole`:

```ts
import type { FollowUpKey } from "./followUpColumns";
```

Replace the `StageLike` interface with:

```ts
export interface StageLike {
  position: number;
  role: StageRole | null;
  /** Set on the five follow-up columns (lib/pipeline/followUpColumns.ts). */
  systemKey?: FollowUpKey | null;
}
```

Replace `shouldAdvance` (keep its doc comment, add the last bullet) with:

```ts
/**
 * PURE forward-only decision, role-aware. Mirrors today's rank semantics:
 *  - a `lost` current stage is frozen (no auto event moves it);
 *  - a `lapsed` current stage is pulled out by ANY forward funnel event
 *    (candidate must be a FUNNEL — non-out-of-band — role);
 *  - among funnel stages, advance only if candidate.position > current.position;
 *  - a candidate that is itself out-of-band (lapsed/lost) is never reached via
 *    this fn (the lapse job / manual override set those directly);
 *  - a null-role stage (manual-only) never auto-advances in or out, EXCEPT a
 *    follow-up column (No answer, Call back later, Thinking about it,
 *    Long-term nurture, Message undelivered): like `lapsed`, any forward
 *    funnel event pulls the lead out of one, except a move back to `new`.
 */
export function shouldAdvance(current: StageLike, candidate: StageLike): boolean {
  if (candidate.role == null || OUT_OF_BAND.has(candidate.role)) return false;
  if (current.role === "lost") return false;
  if (current.role === "lapsed") return true; // pull-out to any funnel stage
  if (current.role == null) return current.systemKey != null && candidate.role !== "new";
  return candidate.position > current.position;
}
```

In the `StageRecord` interface add the field after `role`:

```ts
  /** Set on the five follow-up columns; absent on bare test fixtures. */
  systemKey?: FollowUpKey | null;
```

- [ ] **Step 4: Run the pure test**

Run: `npm test -- src/lib/pipeline/followUpColumns.test.ts`
Expected: PASS, "followUpColumns: 13 checks passed."

- [ ] **Step 5: Schema, DDL, repo reads, cloning**

In `app/src/lib/db/schema.ts`, replace the `pipelineStages` table with:

```ts
export const pipelineStages = sqliteTable(
  "pipeline_stages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pipelineId: integer("pipeline_id").notNull().default(1),
    name: text("name").notNull(),
    colour: text("colour").notNull(),
    position: integer("position").notNull(),
    role: text("role"), // StageRole | null; app-enforced unique-where-set PER PIPELINE
    /** FollowUpKey | null (lib/pipeline/followUpColumns.ts); unique per pipeline where set. */
    systemKey: text("system_key"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    byPipelineRole: uniqueIndex("idx_pipeline_stages_pipeline_role").on(t.pipelineId, t.role),
    byPipelineKey: uniqueIndex("idx_pipeline_stages_pipeline_key").on(t.pipelineId, t.systemKey),
  }),
);
```

In `app/src/lib/db/tenant.ts`, at the very end of `ensureTenantTables` (after the `site_visitor_hashes` purge block, before the closing brace), add:

```ts
  // Lead follow-up flows (lib/leadFlows): the follow-up columns carry a stable
  // key so flows find them on every board whatever they are renamed to.
  // Additive. NOT swallowed: drizzle selects every schema column, so a
  // connection cached without this column would fail every stage read.
  {
    const cols = sqlite.prepare("PRAGMA table_info(pipeline_stages)").all() as Array<{ name: string }>;
    if (cols.length && !cols.some((c) => c.name === "system_key")) sqlite.exec("ALTER TABLE pipeline_stages ADD COLUMN system_key TEXT");
    sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline_key ON pipeline_stages(pipeline_id, system_key)");
  }
```

In `app/src/lib/pipeline/stageRepo.ts`:

Add to the imports:

```ts
import { isFollowUpKey } from "./followUpColumns";
```

Replace `SELECT` and `normalize` with:

```ts
const SELECT = {
  id: schema.pipelineStages.id,
  pipelineId: schema.pipelineStages.pipelineId,
  name: schema.pipelineStages.name,
  colour: schema.pipelineStages.colour,
  position: schema.pipelineStages.position,
  role: schema.pipelineStages.role,
  systemKey: schema.pipelineStages.systemKey,
} as const;

function normalize(
  rows: Array<{ id: number; pipelineId: number; name: string; colour: string; position: number; role: string | null; systemKey: string | null }>,
): StageRecord[] {
  return rows.map((r) => ({ ...r, role: r.role as StageRole | null, systemKey: isFollowUpKey(r.systemKey) ? r.systemKey : null }));
}
```

In `app/src/lib/pipeline/pipelineRepo.ts`, in `createPipeline`, add `systemKey: schema.pipelineStages.systemKey,` to the `source` select object, and replace the insert loop with:

```ts
    for (const s of template) {
      tx.insert(schema.pipelineStages)
        .values({
          pipelineId: row.id,
          name: s.name,
          colour: s.colour,
          position: s.position,
          role: s.role,
          systemKey: "systemKey" in s ? (s.systemKey ?? null) : null,
        })
        .run();
    }
```

In `deletePipeline`, add `systemKey: schema.pipelineStages.systemKey` to both the `mainStages` and `stages` selects, and replace the `to` line with:

```ts
      const to =
        (st.role && mainStages.find((m) => m.role === st.role)?.id) ||
        (st.systemKey && mainStages.find((m) => m.systemKey === st.systemKey)?.id) ||
        first;
```

- [ ] **Step 6: The migration that adds the columns**

In `app/src/lib/db/migrations/index.ts`, add to the imports:

```ts
import { isFollowUpKey, planFollowUpColumns, type ColumnSlot } from "@/lib/pipeline/followUpColumns";
import type { StageRole } from "@/lib/pipeline/roles";
```

Append to `TENANT_MIGRATIONS` (after `0010-appointment-cancelled-at-backfill`):

```ts
  {
    id: "0011-follow-up-columns",
    description:
      "Lead follow-up flows: add the five follow-up columns (No answer, Call back later, Thinking about it, Long-term nurture, Message undelivered) to every board that lacks them, each tagged with its system_key so flows find it whatever it is renamed to. Create-only: a board that already has a column with that key is left alone. Existing columns keep their relative order; positions are renumbered 0..n-1 so the new ones sit after Hot lead and before Lapsed. No lead moves.",
    up: (sqlite) => {
      const boards = sqlite.prepare("SELECT DISTINCT pipeline_id AS id FROM pipeline_stages").all() as { id: number }[];
      const read = sqlite.prepare("SELECT id, position, role, system_key FROM pipeline_stages WHERE pipeline_id = ?");
      const move = sqlite.prepare("UPDATE pipeline_stages SET position = ? WHERE id = ?");
      const insert = sqlite.prepare(
        "INSERT INTO pipeline_stages (pipeline_id, name, colour, position, role, system_key, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
      );
      const now = Date.now();
      for (const b of boards) {
        const rows = read.all(b.id) as { id: number; position: number; role: string | null; system_key: string | null }[];
        const slots: ColumnSlot[] = rows.map((r) => ({
          id: r.id,
          position: r.position,
          role: r.role as StageRole | null,
          systemKey: isFollowUpKey(r.system_key) ? r.system_key : null,
        }));
        const plan = planFollowUpColumns(slots);
        for (const m of plan.moves) move.run(m.position, m.id);
        for (const i of plan.inserts) insert.run(b.id, i.name, i.colour, i.position, i.key, now);
      }
    },
  },
```

- [ ] **Step 7: Write the scratch-tenant test**

Create `app/src/lib/pipeline/followUpColumns.db.test.ts`:

```ts
// Run: npm test -- src/lib/pipeline/followUpColumns.db.test.ts
//
// Against a real scratch tenant: a fresh business gets the five follow-up
// columns with their keys, a new campaign board copies them, and a lead in
// No answer who replies is moved to Hot lead.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { listStages, resolveStageIdByRole } = requireLocal("./stageRepo") as typeof import("./stageRepo");
  const { createPipeline } = requireLocal("./pipelineRepo") as typeof import("./pipelineRepo");
  const stage = requireLocal("./stage") as typeof import("./stage");
  const { upsertLead, getLead } = requireLocal("../leads") as typeof import("../leads");

  globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;

  const slug = "follow-up-columns-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Follow Up Columns Test", `tenants/${slug}/${slug}.db`) as { id: number }).id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
  };

  try {
    await runWithTenant(tid, async () => {
      const cols = listStages();
      assert.equal(cols.length, 14, "nine default columns plus five follow-up columns");
      const keys = cols.filter((c) => c.systemKey).map((c) => c.systemKey);
      assert.deepEqual(keys, ["no_answer", "call_back", "thinking", "nurture", "undelivered"], "in board order, with their keys");
      assert.ok(cols.filter((c) => c.systemKey).every((c) => c.role === null), "follow-up columns have no role");

      const board = createPipeline({ name: "Summer" });
      const copied = listStages(board.id);
      assert.equal(copied.filter((c) => c.systemKey).length, 5, "a new board copies the follow-up columns and their keys");

      const { lead } = upsertLead({ source: "website", sourceLeadId: "website:fu@example.com", fullName: "Follow Up", email: "fu@example.com" });
      const noAnswer = cols.find((c) => c.systemKey === "no_answer")!;
      stage.setStageToId(lead.id, noAnswer.id);
      stage.onInboundFromLead(lead.id);
      assert.equal(getLead(lead.id)!.stageId, resolveStageIdByRole("engaged"), "a reply moves a No answer lead to Hot lead");
    });
    console.log("followUpColumns.db: seeded, cloned, pulled out on reply; 5 checks passed.");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 8: Update the board-count expectations in `pipelines.test.ts`**

In `app/src/lib/pipeline/pipelines.test.ts`, the four column-count assertions (lines asserting `9` for `defaultStages.length`, `summerStages.length`, `listStages().length`, `listStages(board!.id).length`) become `14`, and their messages say "the fourteen default columns" / "a copy of every default column" as they did for nine. Change nothing else in that file.

- [ ] **Step 9: Run the tests**

Run: `npm test -- src/lib/pipeline/followUpColumns.db.test.ts`
Expected: PASS, "followUpColumns.db: seeded, cloned, pulled out on reply; 5 checks passed."

Run the full suite once: `npm test`
Expected: every file passes except the pre-existing `src/lib/programs/memberPrograms.test.ts` failure (it fails on a clean checkout too: "the library has a hammer curl"). If another test asserts a column count of 9 for a fresh board, change that number to 14 the same way and list it in the report.

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add app/src/lib/pipeline/followUpColumns.ts app/src/lib/pipeline/followUpColumns.test.ts app/src/lib/pipeline/followUpColumns.db.test.ts app/src/lib/pipeline/roles.ts app/src/lib/pipeline/stageRepo.ts app/src/lib/pipeline/pipelineRepo.ts app/src/lib/pipeline/pipelines.test.ts app/src/lib/db/schema.ts app/src/lib/db/tenant.ts app/src/lib/db/migrations/index.ts
git commit -m "feat(pipeline): five follow-up columns with stable keys on every board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Flow catalog, column references and the agreed copy

**Files:**
- Modify: `app/src/lib/automationModel.ts`
- Modify: `app/src/lib/automations/nurture.ts` (re-export `isTriggerEnabled`/`DEFAULT_ENABLED_TRIGGERS` from flowModel)
- Modify: `app/src/lib/automationModel.test.ts` (catalog size 17 -> 22, active set 10 -> 15)
- Create: `app/src/lib/leadFlows/flowModel.ts`
- Create: `app/src/lib/leadFlows/presets.ts`
- Test: `app/src/lib/leadFlows/flowModel.test.ts`, `app/src/lib/leadFlows/presets.test.ts`

**Interfaces:**
- Consumes: `FollowUpKey`, `isFollowUpKey` (Task 3); `ALL_ROLES`, `StageRole` (roles.ts).
- Produces (automationModel.ts):
  - five new catalog entries, all `status: "active"`: `lead_no_answer` ("No answer"), `lead_call_back` ("Call back later"), `lead_call_booked` ("Call booked"), `lead_thinking` ("Thinking about it"), `lead_nurture` ("Long-term nurture")
  - `LEAD_SEQUENCE_KEYS` = `["new_lead","lead_no_answer","lead_call_back","lead_call_booked","lead_thinking","lead_nurture","lead_booked","lead_no_show","campaign_signup","checkout_abandoned"]`
  - `KEEP_ON_REPLY` and `KEEP_ON_BOOKING` = `["lead_booked","lead_call_booked"]`; `STOP_ON_REPLY`, `STOP_ON_BOOKED` derived (every lead flow except the keep list); `STOP_ON_NO_SHOW = KEEP_ON_BOOKING`
  - `SHORTCODES` gains `[BUSINESS_PHONE]`, `[CALL_DAY]`, `[CALL_TIME]`; `applyShortcodes` vars gain `businessPhone?`, `callDay?`, `callTime?`
  - `MessageInput.matchInterest?: string | null`; `TriggerInput` gains optional `startColumn`, `finishColumn`, `finishAfterValue`, `finishAfterUnit`
  - neutral `DEFAULT_MESSAGES` for the five new flows
- Produces (flowModel.ts):
  - `LEAD_FLOW_KEYS`, `LEAD_FLOW_KEY_SET`, `NEW_LEAD_FLOW`, `NO_ANSWER_FLOW`, `CALL_BACK_FLOW`, `CALL_BOOKED_FLOW`, `THINKING_FLOW`, `NURTURE_FLOW`, `STAFF_ALERT_KEY = "alert"`, `CALL_ALERT_KEY = "call_alert"`
  - `DEFAULT_ENABLED_TRIGGERS`, `isTriggerEnabled(key, state)`
  - `type ColumnRef = string`, `interface ColumnLike { id: number; role: StageRole | null; systemKey?: FollowUpKey | null }`, `columnRefFor(c)`, `isColumnRef(v)`, `columnMatches(ref, c)`, `resolveColumn(ref, columns)`
  - `interface FlowDefaults { startColumn: ColumnRef | null; finishColumn: ColumnRef | null; finishAfter: { value: number; unit: IntervalUnit } | null }`, `FLOW_DEFAULTS`, `flowDefaults(key)`, `isColumnStartedFlow(key)`, `hasFinishStep(key)`
  - `type QueueKind = "message" | "move" | "callback_check" | "reply_check" | "staff_alert"`, `interface QueuePayload`, `parsePayload(raw)`
- Produces (presets.ts): `FLOW_PRESETS`, `defaultMessagesFor(triggerKey: string, tenantSlug: string | null | undefined): MessageInput[]`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/leadFlows/flowModel.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/flowModel.test.ts
//
// Column references (how a flow names a column on any board), the flow
// defaults, and the queue payload reader.
import assert from "node:assert/strict";

import { TRIGGER_CATALOG, ACTIVE_TRIGGER_KEYS, LEAD_SEQUENCE_KEYS, STOP_ON_REPLY, STOP_ON_BOOKED, applyShortcodes, supportsDelays } from "../automationModel";
import {
  FLOW_DEFAULTS,
  LEAD_FLOW_KEYS,
  columnMatches,
  columnRefFor,
  hasFinishStep,
  isColumnRef,
  isColumnStartedFlow,
  isTriggerEnabled,
  parsePayload,
  resolveColumn,
} from "./flowModel";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};

const hot = { id: 2, role: "engaged" as const, systemKey: null };
const noAnswer = { id: 11, role: null, systemKey: "no_answer" as const };
const custom = { id: 40, role: null, systemKey: null };

ok(columnRefFor(hot) === "role:engaged", "a role column is named by its role");
ok(columnRefFor(noAnswer) === "key:no_answer", "a follow-up column by its key");
ok(columnRefFor(custom) === "stage:40", "any other column by its id");
ok(columnMatches("key:no_answer", { ...noAnswer, id: 99 }), "a key matches the same column on another board");
ok(!columnMatches("key:no_answer", hot) && !columnMatches("stage:40", { ...custom, id: 41 }), "and nothing else");
ok(resolveColumn("role:engaged", [custom, noAnswer, hot]) === hot, "resolveColumn finds it");
ok(resolveColumn("key:nurture", [custom, hot]) === null, "or says there is none");
ok(isColumnRef("role:booked") && isColumnRef("key:thinking") && isColumnRef("stage:3"), "valid refs");
ok(!isColumnRef("role:nope") && !isColumnRef("key:booked") && !isColumnRef("stage:0") && !isColumnRef("stage:x") && !isColumnRef(""), "invalid refs");

// Defaults.
for (const key of LEAD_FLOW_KEYS) ok(key in FLOW_DEFAULTS, `${key} has defaults`);
for (const [key, d] of Object.entries(FLOW_DEFAULTS)) {
  ok(d.startColumn === null || isColumnRef(d.startColumn), `${key} start column is a valid ref`);
  ok(d.finishColumn === null || isColumnRef(d.finishColumn), `${key} finish column is a valid ref`);
}
ok(FLOW_DEFAULTS.new_lead.finishColumn === "key:nurture" && FLOW_DEFAULTS.new_lead.finishAfter?.value === 14, "New lead ends in Long-term nurture after 14 days");
ok(FLOW_DEFAULTS.lead_no_answer.startColumn === "key:no_answer" && FLOW_DEFAULTS.lead_no_answer.finishAfter?.value === 4, "No answer: column-started, 4 days to the move");
ok(FLOW_DEFAULTS.lead_call_back.finishAfter?.value === 6 && FLOW_DEFAULTS.lead_thinking.finishAfter?.value === 17, "Call back later 6 days, Thinking about it 17");
ok(FLOW_DEFAULTS.lead_booked.startColumn === "role:booked" && FLOW_DEFAULTS.lead_no_show.startColumn === "role:no_show", "the booked and no-show flows are column-started");
ok(isColumnStartedFlow("lead_nurture") && !isColumnStartedFlow("new_lead") && !isColumnStartedFlow("lead_call_booked"), "isColumnStartedFlow");
ok(hasFinishStep("new_lead") && !hasFinishStep("lead_call_booked") && !hasFinishStep("client_birthday"), "hasFinishStep");

// Catalog.
for (const key of ["lead_no_answer", "lead_call_back", "lead_call_booked", "lead_thinking", "lead_nurture"]) {
  ok(TRIGGER_CATALOG.some((t) => t.key === key) && ACTIVE_TRIGGER_KEYS.has(key) && supportsDelays(key), `${key} is in the catalog, active and delayed`);
}
ok(LEAD_SEQUENCE_KEYS.length === 10, "ten lead flows");
ok(!STOP_ON_REPLY.includes("lead_call_booked") && STOP_ON_REPLY.includes("lead_nurture"), "a reply stops nurture but not a booked call's reminder");
ok(!STOP_ON_BOOKED.includes("lead_booked") && STOP_ON_BOOKED.includes("lead_thinking"), "booking stops Thinking about it");
ok(!isTriggerEnabled("lead_nurture", undefined) && isTriggerEnabled("campaign_signup", undefined), "new flows are off until switched on");
ok(isTriggerEnabled("lead_nurture", { enabled: true }), "and on when switched on");

// Shortcodes.
ok(
  applyShortcodes("Ring [BUSINESS_PHONE] on [CALL_DAY] at [CALL_TIME]", { businessPhone: "087 000 0000", callDay: "Wednesday 2 December", callTime: "10:30" }) ===
    "Ring 087 000 0000 on Wednesday 2 December at 10:30",
  "the new shortcodes fill in",
);
ok(applyShortcodes("[CALL_DAY]", {}) === "[CALL_DAY]", "a call code outside a call stays as typed");

// Payload.
assert.deepEqual(parsePayload('{"column":"key:nurture"}'), { column: "key:nurture" });
n++;
assert.deepEqual(parsePayload("not json"), {});
n++;
assert.deepEqual(parsePayload(null), {});
n++;

console.log(`flowModel: ${n} checks passed.`);
```

Create `app/src/lib/leadFlows/presets.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/presets.test.ts
//
// The agreed Optimal Health copy: there for that business only, no phone
// number typed in, no emojis, no free consultation or money-back promise,
// and the long-term nurture weeks and treatment versions as agreed.
import assert from "node:assert/strict";

import { DEFAULT_MESSAGES, delayToMs } from "../automationModel";
import { defaultMessagesFor, FLOW_PRESETS } from "./presets";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};

const oh = FLOW_PRESETS["optimal-health"];
ok(!!oh, "Optimal Health has a preset");
const flows = ["new_lead", "lead_no_answer", "lead_call_back", "lead_call_booked", "lead_thinking", "lead_nurture"];
for (const f of flows) ok((oh[f] ?? []).length > 0, `${f} has Optimal Health copy`);

const all = Object.values(oh).flat();
for (const m of all) {
  const text = `${m.subject ?? ""} ${m.template}`;
  ok(!/\p{Extended_Pictographic}/u.test(text), "no emojis");
  ok(!/\d{3}\s?\d{3}\s?\d{4}/.test(text), "no phone number typed in");
  ok(!/free consult|money.back|guarantee/i.test(text), "no free consultation or guarantee");
}
ok(all.filter((m) => /ring|call us/i.test(m.template) && /\[BUSINESS_PHONE\]/.test(m.template)).length >= 5, "the phone comes from the business profile");

// New lead: WhatsApp and email at once, then four WhatsApps at 2, 4, 5, 7 days.
const nl = oh.new_lead;
assert.deepEqual(nl.map((m) => [m.channel, delayToMs(m.delayValue, m.delayUnit) / 86_400_000]), [
  ["whatsapp", 0],
  ["email", 0],
  ["whatsapp", 2],
  ["whatsapp", 4],
  ["whatsapp", 5],
  ["whatsapp", 7],
]);
n++;
ok(nl[0].template.startsWith("Hi [FIRST_NAME], thanks for getting in touch with Optimal Health."), "the first WhatsApp as agreed");

// Call booked: at booking, then 1 hour (before the call).
assert.deepEqual(oh.lead_call_booked.map((m) => delayToMs(m.delayValue, m.delayUnit)), [0, 3_600_000]);
n++;
ok(/\[CALL_DAY\] at \[CALL_TIME\]/.test(oh.lead_call_booked[0].template), "the confirmation names the day and time");

// Long-term nurture: weeks 1, 2, 3, 6, 8, 10, 12; five versions of weeks 2 and 3.
const nurture = oh.lead_nurture;
const days = [...new Set(nurture.map((m) => delayToMs(m.delayValue, m.delayUnit) / 86_400_000))];
assert.deepEqual(days, [0, 7, 14, 35, 49, 63, 77]);
n++;
const week2 = nurture.filter((m) => delayToMs(m.delayValue, m.delayUnit) === 7 * 86_400_000);
const week3 = nurture.filter((m) => delayToMs(m.delayValue, m.delayUnit) === 14 * 86_400_000);
ok(week2.length === 5 && week2.every((m) => m.channel === "email") && week2.some((m) => m.matchInterest === "other"), "week 2: five email versions including the general one");
ok(week3.length === 5 && week3.every((m) => m.channel === "whatsapp") && week3.some((m) => m.matchInterest === "other"), "week 3: five WhatsApp versions");
ok(nurture.filter((m) => !m.matchInterest).length === 5, "weeks 1, 6, 8, 10 and 12 go to everyone");

// Other businesses get the neutral defaults.
assert.deepEqual(defaultMessagesFor("new_lead", "some-gym"), DEFAULT_MESSAGES.new_lead);
n++;
assert.deepEqual(defaultMessagesFor("lead_nurture", null), DEFAULT_MESSAGES.lead_nurture);
n++;
ok(defaultMessagesFor("lead_nurture", "optimal-health") !== oh.lead_nurture, "a copy, never the preset itself");
ok(defaultMessagesFor("client_birthday", "optimal-health").length === DEFAULT_MESSAGES.client_birthday.length, "no preset for a trigger falls back to the default");

console.log(`presets: ${n} checks passed.`);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/lib/leadFlows/flowModel.test.ts` and `npm test -- src/lib/leadFlows/presets.test.ts`
Expected: FAIL, "Cannot find module './flowModel'" / "./presets".

- [ ] **Step 3: Extend `automationModel.ts`**

In `TRIGGER_CATALOG`, insert directly after the `new_lead` entry:

```ts
  {
    key: "lead_no_answer",
    label: "No answer",
    description:
      "When a lead enters the No answer column, or you log a call they did not answer. Stops when they reply, book, buy or unsubscribe, or a person moves them.",
    status: "active",
  },
  {
    key: "lead_call_back",
    label: "Call back later",
    description:
      "When a lead enters the Call back later column. When you schedule a call for a day, it starts the morning after that day if they still have not been reached.",
    status: "active",
  },
  {
    key: "lead_call_booked",
    label: "Call booked",
    description:
      "When you schedule a call at a time: a confirmation straight away and a reminder before the call. [CALL_DAY] and [CALL_TIME] work in these messages; the later messages are counted back from the call.",
    status: "active",
  },
  {
    key: "lead_thinking",
    label: "Thinking about it",
    description:
      "When a lead enters the Thinking about it column. A reply is read by the inbox AI: wanting to book or talk makes them a hot lead; anything else moves them to Long-term nurture 7 days later.",
    status: "active",
  },
  {
    key: "lead_nurture",
    label: "Long-term nurture",
    description:
      "When a lead enters the Long-term nurture column. Only for leads who agreed to marketing. Every email carries an unsubscribe link.",
    status: "active",
  },
```

Replace `DELAYED_TRIGGER_KEYS`, `LEAD_SEQUENCE_KEYS` and the three `STOP_ON_*` constants with:

```ts
export const DELAYED_TRIGGER_KEYS: ReadonlySet<string> = new Set([
  "campaign_signup",
  "new_lead",
  "lead_no_answer",
  "lead_call_back",
  "lead_call_booked",
  "lead_thinking",
  "lead_nurture",
  "lead_booked",
  "lead_no_show",
  "checkout_abandoned",
]);

/**
 * The lead follow-up flows (lib/leadFlows): queued per lead, sent by the
 * ticker, by email or WhatsApp. They replaced GoHighLevel's lead workflows
 * (2026-11-11, extended 2026-11-25). The order is the order a column's flow
 * is looked for in (lib/leadFlows/definitions.ts flowForStage).
 */
export const LEAD_SEQUENCE_KEYS = [
  "new_lead",
  "lead_no_answer",
  "lead_call_back",
  "lead_call_booked",
  "lead_thinking",
  "lead_nurture",
  "lead_booked",
  "lead_no_show",
  "campaign_signup",
  "checkout_abandoned",
] as const;

/** Flows a reply does NOT stop: "ok thanks" to a booking confirmation must not cancel the reminder. */
export const KEEP_ON_REPLY: readonly string[] = ["lead_booked", "lead_call_booked"];
/** Flows a booking does NOT stop: they are about the booking. */
export const KEEP_ON_BOOKING: readonly string[] = ["lead_booked", "lead_call_booked"];

/** Sequences a lead's reply stops: a person has taken over the conversation. */
export const STOP_ON_REPLY: readonly string[] = LEAD_SEQUENCE_KEYS.filter((k) => !KEEP_ON_REPLY.includes(k));
/** Sequences booking in stops: no more "come and book" nudges. */
export const STOP_ON_BOOKED: readonly string[] = LEAD_SEQUENCE_KEYS.filter((k) => !KEEP_ON_BOOKING.includes(k));
/** Sequences a no-show stops: the booking they were about is gone. */
export const STOP_ON_NO_SHOW: readonly string[] = KEEP_ON_BOOKING;
```

Replace `SHORTCODES` and `applyShortcodes` with:

```ts
/** Personalisation short-codes available in message templates. */
export const SHORTCODES = ["[FIRST_NAME]", "[LAST_NAME]", "[BUSINESS_NAME]", "[BUSINESS_PHONE]", "[CALL_DAY]", "[CALL_TIME]"];

/**
 * Replace short-codes with real values. Case-insensitive, so [first_name],
 * [FIRST_NAME] and [First_Name] all work. Unknown codes are left as-is, and
 * so are the call codes outside a scheduled call.
 */
export function applyShortcodes(
  template: string,
  vars: {
    firstName?: string | null;
    lastName?: string | null;
    businessName?: string | null;
    businessPhone?: string | null;
    offerName?: string | null;
    offerLink?: string | null;
    callDay?: string | null;
    callTime?: string | null;
  },
): string {
  const map: Record<string, string> = {
    first_name: (vars.firstName ?? "").trim(),
    last_name: (vars.lastName ?? "").trim(),
    business_name: (vars.businessName ?? "").trim(),
    // The business phone, from the business profile: never typed into copy.
    ...(vars.businessPhone != null ? { business_phone: vars.businessPhone.trim() } : {}),
    // Only for the checkout sequence (left as typed elsewhere).
    ...(vars.offerName != null ? { offer_name: vars.offerName.trim() } : {}),
    ...(vars.offerLink != null ? { offer_link: vars.offerLink.trim() } : {}),
    // Only for a scheduled call (lib/leadFlows/callPlan.ts formats them).
    ...(vars.callDay != null ? { call_day: vars.callDay.trim() } : {}),
    ...(vars.callTime != null ? { call_time: vars.callTime.trim() } : {}),
  };
  return template.replace(/\[([a-z_]+)\]/gi, (whole, key: string) => {
    const v = map[key.toLowerCase()];
    return v !== undefined ? v : whole;
  });
}
```

Replace `MessageInput` and `TriggerInput` with:

```ts
export interface MessageInput {
  id?: number;
  channel: Channel;
  subject: string | null;
  template: string;
  attachmentFilename: string | null;
  attachmentOriginal: string | null;
  delayValue: number;
  delayUnit: IntervalUnit;
  /**
   * Lead flows only: comma-separated words matched against the lead's
   * interest ("hbot, hyperbaric"), or "other" for everyone the other
   * versions at the same time do not match. Null = everyone.
   */
  matchInterest?: string | null;
}

export interface TriggerInput {
  key: string;
  enabled: boolean;
  externalEnabled: boolean;
  messages: MessageInput[];
  /** Lead flows: the column that starts it, as a column ref; "" = none; undefined/null = the default. */
  startColumn?: string | null;
  /** Lead flows: where the card goes when the flow ends with no reply; "" = stays put; undefined/null = the default. */
  finishColumn?: string | null;
  finishAfterValue?: number | null;
  finishAfterUnit?: IntervalUnit | null;
}
```

In `DEFAULT_MESSAGES`, add after `lead_no_show`:

```ts
  // The column-started lead flows (2026-11-25). Neutral wording for every
  // business; Optimal Health's agreed copy is in lib/leadFlows/presets.ts.
  lead_no_answer: [
    msg("whatsapp", null, "Hi [FIRST_NAME], we tried to ring you about your enquiry with [BUSINESS_NAME] but couldn't get through. When's a good time to call you back?"),
    { ...msg("whatsapp", null, "Hi [FIRST_NAME], happy to talk whenever suits you. Tell us a day and time and we'll ring you then. [BUSINESS_NAME]"), delayValue: 2, delayUnit: "days" },
  ],
  lead_call_back: [
    { ...msg("whatsapp", null, "Hi [FIRST_NAME], following up from our chat the other day. Would you be free for a call today?"), delayValue: 2, delayUnit: "days" },
    { ...msg("whatsapp", null, "Hi [FIRST_NAME], happy to talk whenever suits you. Tell us a day and time and we'll ring you then. [BUSINESS_NAME]"), delayValue: 4, delayUnit: "days" },
  ],
  lead_call_booked: [
    msg("whatsapp", null, "Hi [FIRST_NAME], you're booked for a call with [BUSINESS_NAME] on [CALL_DAY] at [CALL_TIME]. We'll ring you on this number. If you need to change it, reply here."),
    { ...msg("whatsapp", null, "Hi [FIRST_NAME], a reminder that we'll ring you at [CALL_TIME] today. [BUSINESS_NAME]"), delayValue: 1, delayUnit: "hours" },
  ],
  lead_thinking: [
    { ...msg("whatsapp", null, "Hi [FIRST_NAME], following up from our chat. No rush. Have you any questions, or would you like to book in?"), delayValue: 5, delayUnit: "days" },
    { ...msg("whatsapp", null, "Hi [FIRST_NAME], one last check: would you like to book in? If now isn't the time, message us whenever suits. [BUSINESS_NAME]"), delayValue: 10, delayUnit: "days" },
  ],
  lead_nurture: [
    msg("email", "Thanks again from [BUSINESS_NAME]", "Hi [FIRST_NAME],\n\nThanks again for getting in touch with [BUSINESS_NAME]. If you have a question, reply to this email and we'll answer it.\n\n[BUSINESS_NAME]"),
    { ...msg("whatsapp", null, "Hi [FIRST_NAME], any questions? Ask here and we'll answer. [BUSINESS_NAME]"), delayValue: 14, delayUnit: "days" },
    { ...msg("email", "Still thinking about it?", "Hi [FIRST_NAME],\n\nThis is the last email in this series. When you'd like to book, reply here and we'll find a time.\n\n[BUSINESS_NAME]"), delayValue: 42, delayUnit: "days" },
  ],
```

In `app/src/lib/automationModel.test.ts`: add `"lead_no_answer", "lead_call_back", "lead_call_booked", "lead_thinking", "lead_nurture"` to `EXPECTED_ACTIVE`; change the catalog-size check to `TRIGGER_CATALOG.length === 22` with the message "TRIGGER_CATALOG has exactly 22 entries (the fixed Kahunas trigger list, the campaign sign-up sequence, eight lead flows and the unfinished-checkout sequence)"; change the active-set message to "the 15 verified-active triggers". Change nothing else.

- [ ] **Step 4: Create `flowModel.ts`**

Create `app/src/lib/leadFlows/flowModel.ts`:

```ts
/**
 * The lead flows' vocabulary. Pure: no DB, no server-only.
 *
 * A flow is one of the lead entries of the automations catalog
 * (automationModel LEAD_SEQUENCE_KEYS). Some start when a lead enters a
 * column; some end by moving the card to another column. A column is named
 * by a column reference so the same flow works on every board:
 *   role:<role>       a column by its role ("role:booked")
 *   key:<system key>  a follow-up column ("key:nurture")
 *   stage:<id>        any other column, on its own board only
 */
import { LEAD_SEQUENCE_KEYS, type IntervalUnit } from "@/lib/automationModel";
import { isFollowUpKey, type FollowUpKey } from "@/lib/pipeline/followUpColumns";
import { ALL_ROLES, type StageRole } from "@/lib/pipeline/roles";

export const LEAD_FLOW_KEYS: readonly string[] = LEAD_SEQUENCE_KEYS;
export const LEAD_FLOW_KEY_SET: ReadonlySet<string> = new Set(LEAD_FLOW_KEYS);

export const NEW_LEAD_FLOW = "new_lead";
export const NO_ANSWER_FLOW = "lead_no_answer";
export const CALL_BACK_FLOW = "lead_call_back";
export const CALL_BOOKED_FLOW = "lead_call_booked";
export const THINKING_FLOW = "lead_thinking";
export const NURTURE_FLOW = "lead_nurture";

/** Queue rows for staff alerts sent as they happen (new lead, hot lead). No flow ever stops them. */
export const STAFF_ALERT_KEY = "alert";
/** Queue rows that belong to a scheduled call: its staff alerts and the call-back check. */
export const CALL_ALERT_KEY = "call_alert";

/** Triggers that are on by default (no automation_triggers row yet). Every new flow is off. */
export const DEFAULT_ENABLED_TRIGGERS: ReadonlySet<string> = new Set(["campaign_signup"]);

export function isTriggerEnabled(key: string, state: { enabled: boolean } | undefined | null): boolean {
  if (state) return state.enabled;
  return DEFAULT_ENABLED_TRIGGERS.has(key);
}

export type ColumnRef = string;

export interface ColumnLike {
  id: number;
  role: StageRole | null;
  systemKey?: FollowUpKey | null;
}

/** The reference a flow stores for a column: its role, else its follow-up key, else its id. */
export function columnRefFor(c: ColumnLike): ColumnRef {
  if (c.role) return `role:${c.role}`;
  if (c.systemKey) return `key:${c.systemKey}`;
  return `stage:${c.id}`;
}

function splitRef(ref: string): [string, string] | null {
  const i = ref.indexOf(":");
  if (i <= 0) return null;
  return [ref.slice(0, i), ref.slice(i + 1)];
}

export function isColumnRef(v: unknown): v is ColumnRef {
  if (typeof v !== "string") return false;
  const p = splitRef(v);
  if (!p) return false;
  const [kind, value] = p;
  if (kind === "role") return (ALL_ROLES as string[]).includes(value);
  if (kind === "key") return isFollowUpKey(value);
  if (kind === "stage") return /^[1-9]\d*$/.test(value);
  return false;
}

export function columnMatches(ref: ColumnRef, c: ColumnLike): boolean {
  const p = splitRef(ref);
  if (!p) return false;
  const [kind, value] = p;
  if (kind === "role") return c.role === value;
  if (kind === "key") return (c.systemKey ?? null) === value;
  if (kind === "stage") return String(c.id) === value;
  return false;
}

/** The column a reference names among one board's columns, or null when that board has none. */
export function resolveColumn<T extends ColumnLike>(ref: ColumnRef, columns: T[]): T | null {
  return columns.find((c) => columnMatches(ref, c)) ?? null;
}

export interface FlowDefaults {
  /** The column whose entry starts the flow; null = started by its fixed trigger. */
  startColumn: ColumnRef | null;
  /** Where the card goes when the flow ends with no reply; null = it stays put. */
  finishColumn: ColumnRef | null;
  /** When that move happens, counted from the start like the message delays. */
  finishAfter: { value: number; unit: IntervalUnit } | null;
}

const NONE: FlowDefaults = { startColumn: null, finishColumn: null, finishAfter: null };

/** What a flow does before an operator changes it in /automations. */
export const FLOW_DEFAULTS: Record<string, FlowDefaults> = {
  new_lead: { startColumn: null, finishColumn: "key:nurture", finishAfter: { value: 14, unit: "days" } },
  lead_no_answer: { startColumn: "key:no_answer", finishColumn: "key:nurture", finishAfter: { value: 4, unit: "days" } },
  lead_call_back: { startColumn: "key:call_back", finishColumn: "key:nurture", finishAfter: { value: 6, unit: "days" } },
  lead_call_booked: NONE,
  lead_thinking: { startColumn: "key:thinking", finishColumn: "key:nurture", finishAfter: { value: 17, unit: "days" } },
  lead_nurture: { startColumn: "key:nurture", finishColumn: null, finishAfter: null },
  lead_booked: { startColumn: "role:booked", finishColumn: null, finishAfter: null },
  lead_no_show: { startColumn: "role:no_show", finishColumn: null, finishAfter: null },
  campaign_signup: NONE,
  checkout_abandoned: NONE,
};

export function flowDefaults(key: string): FlowDefaults {
  return FLOW_DEFAULTS[key] ?? NONE;
}

/** Flows an operator points at a column (the editor shows "Starts when a lead enters"). */
export function isColumnStartedFlow(key: string): boolean {
  return flowDefaults(key).startColumn !== null;
}

/** Flows that can end by moving the card. A booked call ends at the call. */
export function hasFinishStep(key: string): boolean {
  return LEAD_FLOW_KEY_SET.has(key) && key !== CALL_BOOKED_FLOW;
}

/** What one automation_queue row is. Messages are the only kind a lead receives. */
export type QueueKind = "message" | "move" | "callback_check" | "reply_check" | "staff_alert";

/** The JSON a non-message queue row carries (automation_queue.payload). Every field optional. */
export interface QueuePayload {
  /** move: where to. */
  column?: ColumnRef;
  /** message: a call reminder is dropped rather than sent at or after this time. */
  notAfter?: number;
  /** callback_check: the picked day, "YYYY-MM-DD". */
  day?: string;
  /** reply_check: what they said, and which inbound message it was. */
  text?: string;
  messageId?: number;
  /** staff_alert: an in-app alert for one person, and/or a WhatsApp to the alert number. */
  userId?: number | null;
  title?: string;
  body?: string;
  href?: string;
  whatsappText?: string;
}

export function parsePayload(raw: string | null | undefined): QueuePayload {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as QueuePayload) : {};
  } catch {
    return {};
  }
}
```

In `app/src/lib/automations/nurture.ts`, delete the `DEFAULT_ENABLED_TRIGGERS` constant and the `isTriggerEnabled` function and put in their place:

```ts
// Which triggers are on with no saved row lives with the flow vocabulary now.
export { DEFAULT_ENABLED_TRIGGERS, isTriggerEnabled } from "@/lib/leadFlows/flowModel";
```

and add `import { isTriggerEnabled } from "@/lib/leadFlows/flowModel";` to its imports (`sequenceEnabled` still uses it). `NURTURE_TRIGGER_KEY` stays where it is.

- [ ] **Step 5: Create `presets.ts`**

Create `app/src/lib/leadFlows/presets.ts`. The copy is the agreed wording from `docs/superpowers/specs/2026-11-25-lead-flows-ghl-replacement-design.md` section 7 and `docs/optimal-health/long-term-nurture-drafts.md`; `{first name}` is `[FIRST_NAME]` and the clinic's phone number is `[BUSINESS_PHONE]`. Bold markers from the drafts are dropped (the emails are plain text):

```ts
/**
 * Ready-made flow copy for one business, keyed by tenant slug, the same way
 * lib/design/presets.ts and lib/cms/enquiry.ts keep per-business sets. Pure.
 *
 * This is what the /automations editor shows and what the engine sends
 * until the business saves its own messages. Every other business gets the
 * neutral DEFAULT_MESSAGES. The business phone is never typed in: it is
 * [BUSINESS_PHONE], filled from the business profile when a lead enrols.
 */
import { DEFAULT_MESSAGES, type Channel, type IntervalUnit, type MessageInput } from "@/lib/automationModel";

function m(
  channel: Channel,
  subject: string | null,
  template: string,
  delayValue = 0,
  delayUnit: IntervalUnit = "days",
  matchInterest: string | null = null,
): MessageInput {
  return { channel, subject, template, attachmentFilename: null, attachmentOriginal: null, delayValue, delayUnit, matchInterest };
}

const HBOT = "hbot, hyperbaric, oxygen";
const INFRARED = "infrared, red light";
const HIFEM = "hifem, pemf";
const MASSAGE = "massage, reflexology, lava";
const GENERAL = "other";

const OPTIMAL_HEALTH: Record<string, MessageInput[]> = {
  new_lead: [
    m(
      "whatsapp",
      null,
      "Hi [FIRST_NAME], thanks for getting in touch with Optimal Health. We offer hyperbaric oxygen (HBOT), infrared, PEMF and massage at Ard Gaoithe Business Park, Clonmel, with free parking. What would you like help with? Reply with a good time and we'll ring you, or call us on [BUSINESS_PHONE].",
    ),
    m(
      "email",
      "Thanks for getting in touch with Optimal Health",
      "Hi [FIRST_NAME],\n\nThanks for your enquiry. We'll be in touch by WhatsApp or phone to talk about what you're looking for and which therapy suits. If you'd rather talk now, ring [BUSINESS_PHONE].\n\nOptimal Health",
    ),
    m("whatsapp", null, "Hi [FIRST_NAME], just checking you saw our message. Is there a good time to give you a call?", 2),
    m("whatsapp", null, "If you have any questions about the therapies, how a session works or what to bring, ask here and we'll answer.", 4),
    m("whatsapp", null, "We have sessions free this week. Tell us a day that suits and we'll book you in.", 5),
    m("whatsapp", null, "We'll leave it there for now. If you'd like to book later, message here or ring [BUSINESS_PHONE]. Optimal Health", 7),
  ],
  lead_no_answer: [
    m("whatsapp", null, "Hi [FIRST_NAME], we tried to ring you about your enquiry with Optimal Health but couldn't get through. When's a good time to call you back?"),
    m("whatsapp", null, "Hi [FIRST_NAME], happy to talk whenever suits you. Tell us a day and time and we'll ring you then. Optimal Health", 2),
  ],
  lead_call_back: [
    m("whatsapp", null, "Hi [FIRST_NAME], following up from our chat the other day. Would you be free for a call today?", 2),
    m("whatsapp", null, "Hi [FIRST_NAME], happy to talk whenever suits you. Tell us a day and time and we'll ring you then. Optimal Health", 4),
  ],
  lead_call_booked: [
    m(
      "whatsapp",
      null,
      "Hi [FIRST_NAME], you're booked for a call with Optimal Health on [CALL_DAY] at [CALL_TIME]. We'll ring you on this number. If you need to change it, reply here.",
    ),
    m("whatsapp", null, "Hi [FIRST_NAME], a reminder that we'll ring you at [CALL_TIME] today. Optimal Health", 1, "hours"),
  ],
  lead_thinking: [
    m("whatsapp", null, "Hi [FIRST_NAME], following up from our chat. No rush. Have you any questions, or would you like to book a session?", 5),
    m("whatsapp", null, "Hi [FIRST_NAME], one last check: would you like to book in for a session? If now isn't the time, message us whenever suits. Optimal Health", 10),
  ],
  lead_nurture: [
    // Week 1
    m(
      "email",
      "What we do at Optimal Health",
      [
        "Hi [FIRST_NAME],",
        "Thanks again for getting in touch. Here is what we do, in short.",
        "We are a recovery clinic inside Inspire at Ard Gaoithe Business Park, Clonmel, with free parking on site. We have four therapies under one roof:",
        "- Hyperbaric oxygen (HBOT): you rest in a pressurised chamber for 60 minutes.\n- Infrared: 12 minutes on a full-body infrared bed. No UV, so no tanning.\n- HIFEM: 30 minutes in a PEMF chair. You stay fully dressed.\n- Massage: Swedish, deep tissue, sports, reflexology and more, from 30 minutes.",
        "Every session is guided. Someone shows you in, sets you up and stays available the whole time.",
        "You don't need to know which therapy you want. Ring us on [BUSINESS_PHONE], tell us what you'd like help with, and we'll recommend one.",
        "Optimal Health",
      ].join("\n\n"),
    ),
    // Week 2, one version per treatment
    m(
      "email",
      "What a hyperbaric oxygen session is like",
      [
        "Hi [FIRST_NAME],",
        "You asked about hyperbaric oxygen, so here is what a session involves.",
        "You sit or lie in the chamber in comfortable everyday clothes. The pressure rises slowly and you breathe oxygen for 60 minutes. You can bring a book. Phones and other electronics stay outside.",
        "A few things help: arrive well hydrated, and skip oily lotions, hairspray and perfume beforehand. If you have a cold, we'll move your session, because congestion makes it hard to clear your ears.",
        "If you're worried about feeling closed in, we can arrange a trial sit-in first, with no pressure. You can talk to us at any point, and we can pause.",
        "A single session is €80. Ring [BUSINESS_PHONE] to book, or reply here with any questions.",
        "Optimal Health",
      ].join("\n\n"),
      7,
      "days",
      HBOT,
    ),
    m(
      "email",
      "What an infrared session is like",
      [
        "Hi [FIRST_NAME],",
        "You asked about infrared, so here is what a session involves.",
        "You lie on a full-body infrared bed for 12 minutes, on your own in the room. It is not a sunbed: there is no UV, so no tanning or burning. The less you wear, the more of your skin the light reaches, and underwear is fine.",
        "Most people fit it into a lunch break or before training. You go straight back to your day afterwards.",
        "If you have a heart condition, heat intolerance, light sensitivity, or take medication that makes you sensitive to light, check with your GP first and tell us when you book.",
        "A single session is €50. Ring [BUSINESS_PHONE] to book, or reply here with any questions.",
        "Optimal Health",
      ].join("\n\n"),
      7,
      "days",
      INFRARED,
    ),
    m(
      "email",
      "What a HIFEM session is like",
      [
        "Hi [FIRST_NAME],",
        "You asked about HIFEM, so here is what a session involves.",
        "You sit fully dressed in the HIFEM chair for 30 minutes. The chair uses a pulsed electromagnetic field (PEMF). You feel it working, and you can read or rest while it runs.",
        "There is nothing to prepare. Anyone with a pacemaker or another implanted electronic device must not use HIFEM, so tell us about any implants when you book.",
        "A single session is €70. Ring [BUSINESS_PHONE] to book, or reply here with any questions.",
        "Optimal Health",
      ].join("\n\n"),
      7,
      "days",
      HIFEM,
    ),
    m(
      "email",
      "Which massage to book",
      [
        "Hi [FIRST_NAME],",
        "You asked about massage, so here is a quick guide to what we offer.",
        "- Swedish: long strokes at a steady, moderate pressure. A good first booking if you're not sure.\n- Deep tissue: firmer pressure, agreed with you before and during the session.\n- Sports: firmer massage and stretching on the areas your training works hardest.\n- Reflexology: pressure on the feet. Only your shoes and socks come off.\n- Hot lava shells: massage using warmed shells as well as hands, so you get heat and pressure together.",
        "Most are 60 minutes, and Swedish, deep tissue and sports also come as 30-minute sessions from €50.",
        "Irish Life and Laya may pay back part of a massage, and VHI part of reflexology, depending on your plan. We'll give you a receipt.",
        "Ring [BUSINESS_PHONE] to book, or reply here and tell us what you'd like help with.",
        "Optimal Health",
      ].join("\n\n"),
      7,
      "days",
      MASSAGE,
    ),
    m(
      "email",
      "How to choose a therapy",
      [
        "Hi [FIRST_NAME],",
        "If you're not sure which therapy suits you, that's normal. Most people aren't when they first get in touch.",
        "The quickest way is to ring us on [BUSINESS_PHONE] and tell us what you'd like help with: sleep, recovery from training, aches that won't settle, or simply feeling better. We'll recommend one, and if we don't think a therapy suits you, we'll say so.",
        "Every therapy has a single-session price, so you can try one before you commit. Many people combine therapies, and we can help you space them out around your week.",
        "Reply here if you'd rather ask by email.",
        "Optimal Health",
      ].join("\n\n"),
      7,
      "days",
      GENERAL,
    ),
    // Week 3, one version per treatment
    m("whatsapp", null, "Hi [FIRST_NAME], any questions about hyperbaric oxygen? Ask here and we'll answer. Optimal Health", 14, "days", HBOT),
    m("whatsapp", null, "Hi [FIRST_NAME], any questions about infrared? Ask here and we'll answer. Optimal Health", 14, "days", INFRARED),
    m("whatsapp", null, "Hi [FIRST_NAME], any questions about HIFEM? Ask here and we'll answer. Optimal Health", 14, "days", HIFEM),
    m("whatsapp", null, "Hi [FIRST_NAME], any questions about massage? Ask here and we'll answer. Optimal Health", 14, "days", MASSAGE),
    m("whatsapp", null, "Hi [FIRST_NAME], any questions about our therapies? Ask here and we'll answer. Optimal Health", 14, "days", GENERAL),
    // Week 6
    m(
      "email",
      "What happens on your first visit",
      [
        "Hi [FIRST_NAME],",
        "If you've never been to a place like ours, here is what your first visit looks like.",
        "1. You park free on site at Ard Gaoithe Business Park and come into Optimal Health, inside Inspire.\n2. We ask a few health questions to make sure the therapy suits you. If you have any conditions, tell us here.\n3. We show you to the room and set you up. You are never left to work out the equipment yourself.\n4. Your session runs: 12 minutes for infrared, 30 for HIFEM, 60 for HBOT, 30 to 90 for massage.\n5. You go straight back to your day. There is nothing to recover from.",
        "We're open Monday, Tuesday and Thursday 9am to 7pm, Wednesday and Friday 9am to 5pm, and Saturday 9am to 2pm.",
        "Ring [BUSINESS_PHONE] to book your first session.",
        "Optimal Health",
      ].join("\n\n"),
      35,
    ),
    // Week 8
    m(
      "email",
      "Questions people ask us",
      [
        "Hi [FIRST_NAME],",
        "The questions we're asked most, answered.",
        "Is it a medical treatment?\nNo. These are wellness sessions. We don't diagnose or treat medical conditions. If you're under a doctor's care, follow their advice and tell us before you book.",
        "What do I wear?\nEveryday clothes for HBOT and HIFEM. Underwear is fine for infrared. For massage you lie under towels.",
        "Can I try one session first?\nYes. Every therapy has a single-session price. Blocks cost less per session.",
        "Can I bring someone?\nRing us and we'll arrange it.",
        "Can I combine therapies or train the same day?\nYes, many people do. We'll help you space them out.",
        "Who should check with a GP first?\nAnyone pregnant, and anyone with ear, sinus, heart or breathing conditions, implanted devices or recent surgery. Tell us when you book.",
        "Anything else, reply here or ring [BUSINESS_PHONE].",
        "Optimal Health",
      ].join("\n\n"),
      49,
    ),
    // Week 10
    m("whatsapp", null, "Hi [FIRST_NAME], we have a few sessions free next week. Would you like one? Tell us a day that suits and we'll book you in. Optimal Health", 63),
    // Week 12
    m(
      "email",
      "Still thinking about it?",
      [
        "Hi [FIRST_NAME],",
        "This is the last email in this series, so no more of these after today.",
        "If you've been putting it off, that's fine. If something has been bothering you for a while, a first session is a simple way to see if we can help: one therapy, one visit, no block to buy.",
        "Ring [BUSINESS_PHONE] or reply to this email with a day that suits, and we'll take it from there.",
        "We'll still send the occasional offer and news. You can unsubscribe at any time with the link below.",
        "Optimal Health",
      ].join("\n\n"),
      77,
    ),
  ],
};

export const FLOW_PRESETS: Record<string, Record<string, MessageInput[]>> = {
  "optimal-health": OPTIMAL_HEALTH,
};

/** The starter messages for a trigger in this business: its preset, else the neutral default. Always a copy. */
export function defaultMessagesFor(triggerKey: string, tenantSlug: string | null | undefined): MessageInput[] {
  const preset = tenantSlug ? FLOW_PRESETS[tenantSlug]?.[triggerKey] : undefined;
  return (preset ?? DEFAULT_MESSAGES[triggerKey] ?? []).map((x) => ({ ...x }));
}
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- src/lib/leadFlows/flowModel.test.ts`
Expected: PASS ("flowModel: N checks passed.").
Run: `npm test -- src/lib/leadFlows/presets.test.ts`
Expected: PASS ("presets: N checks passed.").
Run: `npm test -- src/lib/automationModel.test.ts`
Expected: PASS.
Run: `npm test -- src/lib/automations/leadSequences.test.ts`
Expected: PASS (behaviour unchanged so far).
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/automationModel.ts app/src/lib/automationModel.test.ts app/src/lib/automations/nurture.ts app/src/lib/leadFlows/flowModel.ts app/src/lib/leadFlows/flowModel.test.ts app/src/lib/leadFlows/presets.ts app/src/lib/leadFlows/presets.test.ts
git commit -m "feat(lead-flows): flow catalog, column references and the agreed copy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Flow decisions and call planning (pure)

**Files:**
- Create: `app/src/lib/leadFlows/flowPlan.ts`
- Create: `app/src/lib/leadFlows/callPlan.ts`
- Test: `app/src/lib/leadFlows/flowPlan.test.ts`, `app/src/lib/leadFlows/callPlan.test.ts`

**Interfaces:**
- Consumes: `INACTIVE_ROLES`, `StageRole` (roles.ts); `KEEP_ON_BOOKING` (automationModel, Task 4); `addDays`, `FLOW_TIME_ZONE` (Task 1); `ColumnRef` (Task 4).
- Produces (flowPlan.ts):
  - `type FlowScope = "all" | { except: readonly string[] } | { only: readonly string[] }`
  - `interface ColumnEntryEffect { stop: FlowScope | "none"; start: string | null; cancelCallRows: boolean }`
  - `columnEntryEffect(input: { actor: string; role: StageRole | null; flowKey: string | null; startFlow: boolean }): ColumnEntryEffect`
  - `OTHER_INTEREST = "other"`, `interestMatches(keywords: string, interest: string | null | undefined): boolean`
  - `pickForInterest<T extends { delayMs: number; matchInterest: string | null }>(messages: T[], interest: string | null | undefined): T[]`
  - `cascadeDueTimes(startAt: number, delaysMs: number[], fit: (at: number, index: number) => number, firstAt?: number): number[]`
  - `finishDueAt(startAt: number, dues: (number | null)[], delaysMs: number[], afterMs: number): number`
  - `isPositiveReply(t: { category: string; priority?: string | null }): boolean`
- Produces (callPlan.ts):
  - `type CallOutcome = "no_answer" | "call_back" | "spoke" | "thinking" | "booked"`, `CALL_OUTCOMES: { key: CallOutcome; label: string; column: ColumnRef }[]`, `isCallOutcome(v)`, `outcomeColumn(o)`
  - `type CallbackPick = "tomorrow" | "in_2_days" | "next_week"`, `CALLBACK_PICKS`, `callbackDay(pick, today): string`, `isIsoDate(s)`
  - `CALL_STAFF_ALERT_MS = 600_000`, `CALL_LENGTH_MINUTES = 15`
  - `scheduleCallMessages(input: { now: number; callAt: number; delaysMs: number[]; fit: (at: number, index: number) => number }): (number | null)[]`
  - `staffCallAlertAt(now: number, callAt: number): number`
  - `formatCallDay(at: number, tz?: string): string` ("Wednesday 2 December"), `formatCallTime(at: number, tz?: string): string` ("10:30")
  - `callTimeError(callAt: number, now: number): string | null`, `callbackDayError(day: string, today: string): string | null`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/leadFlows/flowPlan.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/flowPlan.test.ts
//
// The decisions the engine makes: what entering a column does, which
// treatment version a lead gets, when each step goes, when the finish move
// happens, and which replies count as wanting to book or talk.
import assert from "node:assert/strict";

import { cascadeDueTimes, columnEntryEffect, finishDueAt, interestMatches, isPositiveReply, pickForInterest } from "./flowPlan";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};
const DAY = 86_400_000;

// Column entry.
assert.deepEqual(columnEntryEffect({ actor: "user", role: null, flowKey: "lead_no_answer", startFlow: true }), { stop: "all", start: "lead_no_answer", cancelCallRows: true });
n++;
assert.deepEqual(columnEntryEffect({ actor: "user", role: null, flowKey: null, startFlow: true }), { stop: "all", start: null, cancelCallRows: true }, "a person moving a lead stops everything, even into a column with no flow");
n++;
assert.deepEqual(columnEntryEffect({ actor: "agent", role: "booked", flowKey: "lead_booked", startFlow: false }), { stop: "all", start: null, cancelCallRows: true }, "startFlow false: stops but starts nothing");
n++;
assert.deepEqual(columnEntryEffect({ actor: "automation", role: null, flowKey: "lead_nurture", startFlow: true }), { stop: "all", start: "lead_nurture", cancelCallRows: false }, "an automatic move into a flow column starts it");
n++;
const booked = columnEntryEffect({ actor: "automation", role: "booked", flowKey: null, startFlow: true });
ok(typeof booked.stop === "object" && "except" in booked.stop && booked.stop.except.includes("lead_call_booked") && booked.start === null, "a booking with its flow off still stops the nudges");
const noShow = columnEntryEffect({ actor: "automation", role: "no_show", flowKey: null, startFlow: true });
ok(typeof noShow.stop === "object" && "only" in noShow.stop && noShow.stop.only.includes("lead_booked") && noShow.cancelCallRows, "a no-show stops the booking messages");
assert.deepEqual(columnEntryEffect({ actor: "system", role: "won", flowKey: "lead_x", startFlow: true }), { stop: "all", start: null, cancelCallRows: true }, "a sale stops everything and starts nothing");
n++;
assert.deepEqual(columnEntryEffect({ actor: "automation", role: null, flowKey: null, startFlow: true }), { stop: "none", start: null, cancelCallRows: false }, "an automatic move into Message undelivered leaves the flow running");
n++;
assert.deepEqual(columnEntryEffect({ actor: "automation", role: "engaged", flowKey: null, startFlow: true }), { stop: "none", start: null, cancelCallRows: false }, "the reply path stops flows itself");
n++;

// Treatment versions.
ok(interestMatches("hbot, hyperbaric, oxygen", "Hyperbaric oxygen"), "keywords match the interest text, any case");
ok(!interestMatches("hbot, hyperbaric", "Massage and bodywork") && !interestMatches("hbot", null) && !interestMatches(" , ", "hbot"), "and only then");
const msgs = [
  { id: "w1", delayMs: 0, matchInterest: null },
  { id: "w2-hbot", delayMs: 7 * DAY, matchInterest: "hbot, hyperbaric" },
  { id: "w2-massage", delayMs: 7 * DAY, matchInterest: "massage" },
  { id: "w2-general", delayMs: 7 * DAY, matchInterest: "other" },
  { id: "w6", delayMs: 35 * DAY, matchInterest: null },
];
assert.deepEqual(pickForInterest(msgs, "HBOT").map((m) => m.id), ["w1", "w2-hbot", "w6"]);
n++;
assert.deepEqual(pickForInterest(msgs, "Not sure yet").map((m) => m.id), ["w1", "w2-general", "w6"], "no match: the general version");
n++;
assert.deepEqual(pickForInterest(msgs, null).map((m) => m.id), ["w1", "w2-general", "w6"], "no interest at all: the general version");
n++;
assert.deepEqual(pickForInterest(msgs, "hyperbaric and massage").map((m) => m.id), ["w1", "w2-hbot", "w6"], "two matches: the first version only");
n++;

// Step times: each step from the previous step's real time.
const id = (t: number) => t;
assert.deepEqual(cascadeDueTimes(1000, [0, 0, 2 * DAY, 4 * DAY], id), [1000, 1000, 1000 + 2 * DAY, 1000 + 4 * DAY]);
n++;
const heldOvernight = (t: number, i: number) => (i === 0 ? t + 10 * 3_600_000 : t);
assert.deepEqual(cascadeDueTimes(0, [0, 2 * DAY], heldOvernight), [10 * 3_600_000, 10 * 3_600_000 + 2 * DAY], "a held first step pushes the next one back");
n++;
assert.deepEqual(cascadeDueTimes(0, [2 * DAY, 4 * DAY], id, 5 * DAY), [5 * DAY, 7 * DAY], "a fixed first time (the morning after a picked day) replaces the first delay");
n++;
assert.deepEqual(cascadeDueTimes(0, [5 * DAY, 2 * DAY], id), [5 * DAY, 5 * DAY], "a delay shorter than the one before never goes backwards");
n++;

// Finish move.
ok(finishDueAt(0, [0, 2 * DAY + 3_600_000], [0, 2 * DAY], 4 * DAY) === 4 * DAY + 3_600_000, "counted on from the last step's real time");
ok(finishDueAt(500, [], [], 4 * DAY) === 500 + 4 * DAY, "no messages: from the start");
ok(finishDueAt(0, [0, null], [0, 2 * DAY], 4 * DAY) === 4 * DAY, "a dropped last step: from the one before");

// Replies.
ok(isPositiveReply({ category: "booking", priority: "normal" }), "wants to book");
ok(isPositiveReply({ category: "new_lead", priority: "high" }), "a hot, urgent message");
ok(!isPositiveReply({ category: "faq", priority: "normal" }), "a question is not a yes");
ok(!isPositiveReply({ category: "sensitive", priority: "high" }), "sensitive is never a yes");
ok(!isPositiveReply({ category: "spam", priority: "high" }), "nor spam");

console.log(`flowPlan: ${n} checks passed.`);
```

Create `app/src/lib/leadFlows/callPlan.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/callPlan.test.ts
//
// Log a call outcomes, the call-back day picks, when a booked call's
// messages and staff alert go, and how the call is worded.
import assert from "node:assert/strict";

import {
  CALL_OUTCOMES,
  callbackDay,
  callbackDayError,
  callTimeError,
  formatCallDay,
  formatCallTime,
  isCallOutcome,
  outcomeColumn,
  scheduleCallMessages,
  staffCallAlertAt,
} from "./callPlan";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};
const H = 3_600_000;

assert.deepEqual(CALL_OUTCOMES.map((o) => o.label), ["No answer", "Call back later", "Spoke to them", "Thinking about it", "Booked a treatment"]);
n++;
ok(outcomeColumn("no_answer") === "key:no_answer" && outcomeColumn("spoke") === "role:engaged" && outcomeColumn("booked") === "role:booked", "each outcome has its column");
ok(isCallOutcome("thinking") && !isCallOutcome("maybe"), "isCallOutcome");

ok(callbackDay("tomorrow", "2026-11-30") === "2026-12-01", "Tomorrow");
ok(callbackDay("in_2_days", "2026-11-30") === "2026-12-02", "In 2 days");
ok(callbackDay("next_week", "2026-11-30") === "2026-12-07", "Next week is seven days on");
ok(callbackDayError("2026-11-29", "2026-11-30") === "Pick today or a later day.", "a past day refused");
ok(callbackDayError("2026-11-30", "2026-11-30") === null && callbackDayError("nope", "2026-11-30") === "Pick a day.", "today is fine, garbage is not");

const now = Date.parse("2026-12-01T10:00:00Z");
const callAt = Date.parse("2026-12-02T10:30:00Z");
ok(callTimeError(callAt, now) === null && callTimeError(now - 1, now) === "Pick a time that has not passed yet.", "callTimeError");
const id = (t: number) => t;
assert.deepEqual(scheduleCallMessages({ now, callAt, delaysMs: [0, H], fit: id }), [now, callAt - H], "confirmation now, reminder an hour before");
n++;
const nineAm = Date.parse("2026-12-02T09:00:00Z");
const toNine = (t: number) => Math.max(t, nineAm);
assert.deepEqual(scheduleCallMessages({ now, callAt: nineAm, delaysMs: [0, H], fit: toNine }), [null, null], "a reminder pushed to the call time is dropped, and so is a confirmation that would land on it");
n++;
assert.deepEqual(scheduleCallMessages({ now: callAt - 30 * 60_000, callAt, delaysMs: [0, H], fit: id }), [callAt - 30 * 60_000, null], "booked 30 minutes ahead: no 1-hour reminder");
n++;
ok(staffCallAlertAt(now, callAt) === callAt - 10 * 60_000, "staff alert 10 minutes before");
ok(staffCallAlertAt(callAt - 5 * 60_000, callAt) === callAt - 5 * 60_000, "or straight away when that has passed");

ok(formatCallDay(callAt) === "Wednesday 2 December", "the day as people say it");
ok(formatCallTime(callAt) === "10:30", "24-hour time, Irish");
ok(formatCallTime(Date.parse("2026-07-01T08:05:00Z")) === "09:05", "summer time is respected");

console.log(`callPlan: ${n} checks passed.`);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/lib/leadFlows/flowPlan.test.ts` and `npm test -- src/lib/leadFlows/callPlan.test.ts`
Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Write the implementations**

Create `app/src/lib/leadFlows/flowPlan.ts`:

```ts
/**
 * The decisions the lead-flow engine makes, as pure functions.
 */
import { KEEP_ON_BOOKING } from "@/lib/automationModel";
import { INACTIVE_ROLES, type StageRole } from "@/lib/pipeline/roles";

/** Which of a lead's flows to stop. */
export type FlowScope = "all" | { except: readonly string[] } | { only: readonly string[] };

export interface ColumnEntryEffect {
  stop: FlowScope | "none";
  /** The flow to start (its own start stops every other flow). */
  start: string | null;
  /** Also drop a scheduled call's staff alerts and call-back check. */
  cancelCallRows: boolean;
}

/**
 * What a lead entering a column does to its flows.
 *  - a sale or a write-off (won, repeat, lost) stops everything;
 *  - a person (staff, or Adonis after approval) moving the card stops
 *    everything, then starts the column's flow when it has one;
 *  - an automatic move into a column with a flow switched on starts it,
 *    which stops every other flow;
 *  - a booking stops every flow but the booking ones; a no-show stops the
 *    booking ones;
 *  - any other automatic move leaves the flows alone (a reply stops flows
 *    on its own path; Message undelivered keeps the flow going by email).
 * `startFlow: false` is for Schedule a call, which starts its own flow.
 */
export function columnEntryEffect(input: { actor: string; role: StageRole | null; flowKey: string | null; startFlow: boolean }): ColumnEntryEffect {
  const start = input.startFlow ? input.flowKey : null;
  if (input.role && INACTIVE_ROLES.has(input.role)) return { stop: "all", start: null, cancelCallRows: true };
  if (input.actor === "user" || input.actor === "agent") return { stop: "all", start, cancelCallRows: true };
  if (start) return { stop: "all", start, cancelCallRows: false };
  if (input.role === "booked") return { stop: { except: KEEP_ON_BOOKING }, start: null, cancelCallRows: false };
  if (input.role === "no_show") return { stop: { only: KEEP_ON_BOOKING }, start: null, cancelCallRows: true };
  return { stop: "none", start: null, cancelCallRows: false };
}

/** The "everyone else" version of a step. */
export const OTHER_INTEREST = "other";

/** Whether any comma-separated keyword appears in the lead's interest text. */
export function interestMatches(keywords: string, interest: string | null | undefined): boolean {
  const text = (interest ?? "").toLowerCase();
  if (!text.trim()) return false;
  return keywords
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
    .some((k) => text.includes(k));
}

/**
 * The messages one lead gets. Versions of a step share its send time: the
 * first version whose keywords match the lead's interest goes, else the
 * "other" version. A message with no keywords always goes.
 */
export function pickForInterest<T extends { delayMs: number; matchInterest: string | null }>(messages: T[], interest: string | null | undefined): T[] {
  const chosen = new Map<number, T>();
  for (const m of messages) {
    const kw = m.matchInterest?.trim();
    if (!kw || kw.toLowerCase() === OTHER_INTEREST) continue;
    if (!chosen.has(m.delayMs) && interestMatches(kw, interest)) chosen.set(m.delayMs, m);
  }
  return messages.filter((m) => {
    const kw = m.matchInterest?.trim();
    if (!kw) return true;
    if (kw.toLowerCase() === OTHER_INTEREST) return !chosen.has(m.delayMs);
    return chosen.get(m.delayMs) === m;
  });
}

/**
 * When each step goes. Delays are offsets from the start (as the editor
 * shows them); each step is scheduled from the previous step's real time
 * plus the difference, so a step the sending hours hold back pushes the
 * later ones back with it. `fit` applies the sending hours. `firstAt`
 * replaces the first step's time (the morning after a picked call-back day).
 */
export function cascadeDueTimes(startAt: number, delaysMs: number[], fit: (at: number, index: number) => number, firstAt?: number): number[] {
  const out: number[] = [];
  delaysMs.forEach((d, i) => {
    if (i === 0) {
      out.push(fit(firstAt ?? startAt + d, 0));
      return;
    }
    out.push(fit(out[i - 1] + Math.max(0, d - delaysMs[i - 1]), i));
  });
  return out;
}

/** When the finish move happens: counted on from the last step that goes, else from the start. */
export function finishDueAt(startAt: number, dues: (number | null)[], delaysMs: number[], afterMs: number): number {
  for (let i = dues.length - 1; i >= 0; i--) {
    const due = dues[i];
    if (due != null) return due + Math.max(0, afterMs - delaysMs[i]);
  }
  return startAt + afterMs;
}

/**
 * The inbox triage read of a reply in the Thinking about it flow: wants to
 * book (category "booking") or asks to talk (high priority, which the
 * triage prompt keeps for hot, urgent messages) counts as a yes. Sensitive
 * and spam never do.
 */
export function isPositiveReply(t: { category: string; priority?: string | null }): boolean {
  if (t.category === "booking") return true;
  if (t.category === "sensitive" || t.category === "spam") return false;
  return t.priority === "high";
}
```

Create `app/src/lib/leadFlows/callPlan.ts`:

```ts
/**
 * Log a call and Schedule a call, as pure rules.
 */
import type { ColumnRef } from "./flowModel";
import { addDays, FLOW_TIME_ZONE } from "./sendingWindow";

export type CallOutcome = "no_answer" | "call_back" | "spoke" | "thinking" | "booked";

/** Log a call outcomes, in the order the dialog shows them, with the column each moves the lead to. */
export const CALL_OUTCOMES: { key: CallOutcome; label: string; column: ColumnRef }[] = [
  { key: "no_answer", label: "No answer", column: "key:no_answer" },
  { key: "call_back", label: "Call back later", column: "key:call_back" },
  // A person is handling them: Hot lead, which runs no flow.
  { key: "spoke", label: "Spoke to them", column: "role:engaged" },
  { key: "thinking", label: "Thinking about it", column: "key:thinking" },
  { key: "booked", label: "Booked a treatment", column: "role:booked" },
];

export function isCallOutcome(v: unknown): v is CallOutcome {
  return typeof v === "string" && CALL_OUTCOMES.some((o) => o.key === v);
}

export function outcomeColumn(o: CallOutcome): ColumnRef {
  return CALL_OUTCOMES.find((x) => x.key === o)!.column;
}

export type CallbackPick = "tomorrow" | "in_2_days" | "next_week";

export const CALLBACK_PICKS: { key: CallbackPick; label: string; days: number }[] = [
  { key: "tomorrow", label: "Tomorrow", days: 1 },
  { key: "in_2_days", label: "In 2 days", days: 2 },
  { key: "next_week", label: "Next week", days: 7 },
];

export function callbackDay(pick: CallbackPick, today: string): string {
  return addDays(today, CALLBACK_PICKS.find((p) => p.key === pick)!.days);
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function callbackDayError(day: string, today: string): string | null {
  if (!isIsoDate(day)) return "Pick a day.";
  if (day < today) return "Pick today or a later day.";
  return null;
}

export function callTimeError(callAt: number, now: number): string | null {
  if (!Number.isFinite(callAt)) return "Pick a time.";
  if (callAt <= now) return "Pick a time that has not passed yet.";
  return null;
}

/** The assignee's in-app alert goes this long before a scheduled call. */
export const CALL_STAFF_ALERT_MS = 10 * 60_000;
/** A scheduled call's length in the diary. */
export const CALL_LENGTH_MINUTES = 15;

/**
 * When a booked call's messages go. The first goes at booking; later ones
 * are counted back from the call (a delay of 1 hour = an hour before). Any
 * message the sending hours (`fit`) would push to or past the call time is
 * dropped (null), as is a reminder whose time has already passed.
 */
export function scheduleCallMessages(input: { now: number; callAt: number; delaysMs: number[]; fit: (at: number, index: number) => number }): (number | null)[] {
  return input.delaysMs.map((d, i) => {
    const wanted = i === 0 ? input.now : input.callAt - d;
    if (i > 0 && wanted <= input.now) return null;
    const at = input.fit(wanted, i);
    return at < input.callAt ? at : null;
  });
}

export function staffCallAlertAt(now: number, callAt: number): number {
  return Math.max(now, callAt - CALL_STAFF_ALERT_MS);
}

/** "Wednesday 2 December". */
export function formatCallDay(at: number, tz: string = FLOW_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(at));
}

/** "10:30". */
export function formatCallTime(at: number, tz: string = FLOW_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- src/lib/leadFlows/flowPlan.test.ts`
Expected: PASS ("flowPlan: 27 checks passed.").
Run: `npm test -- src/lib/leadFlows/callPlan.test.ts`
Expected: PASS ("callPlan: 17 checks passed.").

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/leadFlows/flowPlan.ts app/src/lib/leadFlows/flowPlan.test.ts app/src/lib/leadFlows/callPlan.ts app/src/lib/leadFlows/callPlan.test.ts
git commit -m "feat(lead-flows): pure flow decisions and call planning

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Flow runs (schema, definitions, start and stop)

**Files:**
- Modify: `app/src/lib/db/schema.ts` (`leadFlowRuns` table; new columns on `automationQueue`, `automationTriggers`, `automationMessages`)
- Modify: `app/src/lib/db/tenant.ts` (the "lead-flows block" at the end of `ensureTenantTables`)
- Create: `app/src/lib/leadFlows/clock.ts`, `app/src/lib/leadFlows/tenant.ts`, `app/src/lib/leadFlows/definitions.ts`, `app/src/lib/leadFlows/runs.ts`
- Create: `app/src/lib/leadFlows/testing/stubs.ts`, `app/src/lib/leadFlows/testing/harness.ts`
- Modify: `app/src/lib/automations/nurture.ts` (becomes a facade over runs.ts; the old dispatch stays here until Task 8 and only reads message rows)
- Modify: `app/src/lib/automations/leadSequences.test.ts` (count message rows only)
- Test: `app/src/lib/leadFlows/runs.test.ts`

**Interfaces:**
- Consumes: Tasks 1-5 (`fitToWindow`, `getLeadFlowSettings`, `FLOW_DEFAULTS`/`flowDefaults`, `columnMatches`, `isTriggerEnabled`, `LEAD_FLOW_KEYS`, `CALL_BOOKED_FLOW`, `CALL_ALERT_KEY`, `defaultMessagesFor`, `pickForInterest`, `cascadeDueTimes`, `finishDueAt`, `FlowScope`, `scheduleCallMessages`, `formatCallDay`, `formatCallTime`).
- Produces:
  - schema: `leadFlowRuns` (`id, leadId, triggerKey, status: "active"|"finished"|"stopped", stopReason, startedAt, endedAt`), type `LeadFlowRun`; `automationQueue.runId, step, kind ("message"|"move"|"callback_check"|"reply_check"|"staff_alert", default "message"), payload, providerMessageId`; `automationTriggers.startColumn, finishColumn, finishAfterValue, finishAfterUnit`; `automationMessages.matchInterest`
  - `clock.ts`: `flowNow(): number`, `setFlowClockForTests(fn: (() => number) | undefined): void`
  - `tenant.ts`: `flowTenant(): { id: number; slug: string } | null`
  - `definitions.ts`: `interface FlowMessage { channel: Channel; subject: string | null; template: string; delayMs: number; matchInterest: string | null }`, `interface FlowDefinition { key: string; label: string; enabled: boolean; messages: FlowMessage[]; startColumn: ColumnRef | null; finish: { column: ColumnRef; afterMs: number } | null }`, `getFlowDefinition(key: string): FlowDefinition`, `flowStartColumn(key, state)`, `flowFinish(key, state)`, `flowForStage(stage: { id: number; role: StageRole | null; systemKey?: FollowUpKey | null }): string | null`
  - `runs.ts`: `interface StartFlowOptions { ifNotActive?: boolean; firstAt?: number; callAt?: number; extra?: { offerName?: string | null; offerLink?: string | null }; now?: number }`, `interface StartFlowResult { runId: number | null; queued: number; skipped: string | null }`, `startFlow(leadId: number, triggerKey: string, opts?: StartFlowOptions): StartFlowResult`, `stopFlows(leadId: number, reason: string, scope?: FlowScope): number`, `cancelCallRows(leadId: number, reason: string): number`, `activeRun(leadId: number, triggerKey: string): LeadFlowRun | null`, `leadFlowStatus(leadId: number): { flow: string | null; next: { channel: string; dueAt: number }[] }`
  - `testing/harness.ts`: `makeScratchTenant(slug: string): { tid: number; slug: string; cleanup(): void }`, `setFlowEnabled(tid: number, key: string, enabled: boolean): void`, `fakeClock(start: number): { now(): number; set(t: number): void; advance(ms: number): void }`
  - `nurture.ts` keeps every export it had: `NURTURE_TRIGGER_KEY`, `DEFAULT_ENABLED_TRIGGERS`, `isTriggerEnabled`, `sequenceEnabled`, `enrolLeadInSequence`, `enrolLeadInNurture`, `cancelSequences`, `cancelNurtureForLead`, `listQueuedForLead`, `dispatchDueAutomationQueue`

- [ ] **Step 1: Schema**

In `app/src/lib/db/schema.ts`:

Add to `automationTriggers` (after `externalEnabled`):

```ts
  /** Lead flows: the column (a column ref) that starts it. null = the default in lib/leadFlows/flowModel FLOW_DEFAULTS; "" = none. */
  startColumn: text("start_column"),
  /** Lead flows: where the card goes when the flow ends with no reply. null = the default; "" = it stays put. */
  finishColumn: text("finish_column"),
  finishAfterValue: integer("finish_after_value"),
  finishAfterUnit: text("finish_after_unit", { enum: ["minutes", "hours", "days"] }),
```

Add to `automationMessages` (after `delayUnit`):

```ts
    /** Lead flows: comma-separated interest keywords, or "other"; null = everyone (lib/leadFlows/flowPlan pickForInterest). */
    matchInterest: text("match_interest"),
```

Replace the `automationQueue` table with:

```ts
export const automationQueue = sqliteTable(
  "automation_queue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    triggerKey: text("trigger_key").notNull(),
    leadId: integer("lead_id"),
    clientId: integer("client_id"),
    channel: text("channel", { enum: ["email", "whatsapp", "push", "chat"] }).notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    sendTo: text("send_to"),
    dueAt: integer("due_at", { mode: "timestamp_ms" }).notNull(),
    status: text("status", { enum: ["queued", "sent", "failed", "cancelled"] }).notNull().default("queued"),
    error: text("error"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    /** The lead_flow_runs row this belongs to; null for rows queued before runs existed. */
    runId: integer("run_id"),
    /** The message's position in its flow (the first WhatsApp of a run is its lowest WhatsApp step). */
    step: integer("step"),
    /** What the row is: a message to the lead, or a timed step of the flow itself (lib/leadFlows/flowModel QueueKind). */
    kind: text("kind", { enum: ["message", "move", "callback_check", "reply_check", "staff_alert"] }).notNull().default("message"),
    /** JSON for the non-message kinds (lib/leadFlows/flowModel QueuePayload). */
    payload: text("payload"),
    /** The WhatsApp provider's id once sent, so a failed delivery status finds its row. */
    providerMessageId: text("provider_message_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    due: index("idx_automation_queue_due").on(t.status, t.dueAt),
    byLead: index("idx_automation_queue_lead").on(t.leadId, t.status),
    byProvider: index("idx_automation_queue_provider").on(t.providerMessageId),
  }),
);
export type AutomationQueueRow = typeof automationQueue.$inferSelect;

/**
 * One lead going through one follow-up flow (lib/leadFlows/runs.ts). Its
 * messages and timed steps are automation_queue rows carrying run_id.
 * Starting any flow stops every other active run for that lead.
 */
export const leadFlowRuns = sqliteTable(
  "lead_flow_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    leadId: integer("lead_id").notNull(),
    triggerKey: text("trigger_key").notNull(),
    status: text("status", { enum: ["active", "finished", "stopped"] }).notNull().default("active"),
    stopReason: text("stop_reason"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (t) => ({ byLead: index("idx_lead_flow_runs_lead").on(t.leadId, t.status) }),
);
export type LeadFlowRun = typeof leadFlowRuns.$inferSelect;
```

In `app/src/lib/db/tenant.ts`, at the very end of `ensureTenantTables` (after the block Task 3 added), add the lead-flows block. Later tasks add lines to it:

```ts
  // Lead follow-up flows (lib/leadFlows): runs, and the queue/trigger/message
  // columns they use. Additive and idempotent. NOT swallowed, for the same
  // reason as the system_key column above.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS lead_flow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      trigger_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      stop_reason TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_lead_flow_runs_lead ON lead_flow_runs(lead_id, status);
  `);
  {
    const addColumn = (table: string, column: string, ddl: string) => {
      const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (cols.length && !cols.some((c) => c.name === column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    };
    addColumn("automation_queue", "run_id", "run_id INTEGER");
    addColumn("automation_queue", "step", "step INTEGER");
    addColumn("automation_queue", "kind", "kind TEXT NOT NULL DEFAULT 'message'");
    addColumn("automation_queue", "payload", "payload TEXT");
    addColumn("automation_queue", "provider_message_id", "provider_message_id TEXT");
    addColumn("automation_triggers", "start_column", "start_column TEXT");
    addColumn("automation_triggers", "finish_column", "finish_column TEXT");
    addColumn("automation_triggers", "finish_after_value", "finish_after_value INTEGER");
    addColumn("automation_triggers", "finish_after_unit", "finish_after_unit TEXT");
    addColumn("automation_messages", "match_interest", "match_interest TEXT");
    sqlite.exec("CREATE INDEX IF NOT EXISTS idx_automation_queue_lead ON automation_queue(lead_id, status)");
    sqlite.exec("CREATE INDEX IF NOT EXISTS idx_automation_queue_provider ON automation_queue(provider_message_id)");
    // Later lead-flow columns go here.
  }
```

- [ ] **Step 2: Clock, tenant and test support**

Create `app/src/lib/leadFlows/clock.ts`:

```ts
import "server-only";

/**
 * The lead flows' clock. Every enrolment, check and dispatch reads the time
 * here, so the end-to-end tests can run a lead through weeks of flow on a
 * fixed date without waiting.
 */
let override: (() => number) | undefined;

export function flowNow(): number {
  return override ? override() : Date.now();
}

/** Tests only. */
export function setFlowClockForTests(fn: (() => number) | undefined): void {
  override = fn;
}
```

Create `app/src/lib/leadFlows/tenant.ts`:

```ts
import "server-only";

import { boundTenantId, getTenantById, resolveCurrentTenant } from "@/lib/db/tenant";

/**
 * The tenant the lead flows are working for: the runWithTenant binding
 * (ticker, webhooks, tests) first, else the request's business. Never
 * getCurrentTenant(), which ignores the binding.
 */
export function flowTenant(): { id: number; slug: string } | null {
  let id = boundTenantId();
  if (id == null) {
    try {
      id = resolveCurrentTenant()?.id ?? null;
    } catch {
      id = null;
    }
  }
  if (id == null) return null;
  const t = getTenantById(id);
  return t ? { id: t.id, slug: t.slug } : null;
}
```

Create `app/src/lib/leadFlows/testing/stubs.ts`:

```ts
/**
 * Test support for the lead-flow tests: import it FIRST in a test file.
 * Stubs the modules plain Node cannot load outside Next, makes every fetch
 * fail (no real provider is ever reached), and fixes the app URL and the
 * unsubscribe-token secret to obvious test values.
 */
import Module from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("redirect stub");
      },
      notFound: () => {
        throw new Error("notFound stub");
      },
    };
  }
  if (request === "next/headers") {
    return {
      cookies: () => {
        throw new Error("no request scope");
      },
      headers: () => {
        throw new Error("no request scope");
      },
    };
  }
  if (request === "next/cache") return { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;
process.env.APP_URL = "http://app.test";
process.env.EMAIL_TOKEN_SECRET = process.env.EMAIL_TOKEN_SECRET || "test-secret-not-real";

export {};
```

Create `app/src/lib/leadFlows/testing/harness.ts`:

```ts
/**
 * Test support for the lead-flow tests (not a *.test.ts, so the runner never
 * runs it on its own). Require it after ./stubs.
 */
import fs from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";

import { controlSqlite } from "@/lib/db/control";
import { getTenantDbById } from "@/lib/db/tenant";
import * as schema from "@/lib/db/schema";

import { setFlowClockForTests } from "../clock";

export interface Scratch {
  tid: number;
  slug: string;
  cleanup(): void;
}

/** A throwaway business with its own database. Slugs must end in "-test". */
export function makeScratchTenant(slug: string): Scratch {
  if (!slug.endsWith("-test")) throw new Error("scratch tenant slugs end in -test");
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, slug, `tenants/${slug}/${slug}.db`) as { id: number }).id;
  return {
    tid,
    slug,
    cleanup() {
      setFlowClockForTests(undefined);
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    },
  };
}

export function setFlowEnabled(tid: number, key: string, enabled: boolean): void {
  getTenantDbById(tid)
    .insert(schema.automationTriggers)
    .values({ key, enabled })
    .onConflictDoUpdate({ target: schema.automationTriggers.key, set: { enabled } })
    .run();
}

/** Fix the lead-flow clock at `start`; move it with set/advance. */
export function fakeClock(start: number): { now(): number; set(t: number): void; advance(ms: number): void } {
  let t = start;
  setFlowClockForTests(() => t);
  return {
    now: () => t,
    set(v: number) {
      t = v;
    },
    advance(ms: number) {
      t += ms;
    },
  };
}

export function queueRows(tid: number, leadId: number) {
  return getTenantDbById(tid).select().from(schema.automationQueue).where(eq(schema.automationQueue.leadId, leadId)).all();
}
```

- [ ] **Step 3: Write the failing test**

Create `app/src/lib/leadFlows/runs.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/runs.test.ts
//
// Starting and stopping flows, against a real scratch tenant on a fixed
// clock: off until switched on, the messages and the finish move, re-entry
// restarts, starting any flow stops the others, sending hours push steps
// back, versions by interest, a booked call's timing, and which flow a
// column starts.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead } = requireLocal("../leads") as typeof import("../leads");
  const runs = requireLocal("./runs") as typeof import("./runs");
  const defs = requireLocal("./definitions") as typeof import("./definitions");
  const { saveLeadFlowSettings } = requireLocal("./settings") as typeof import("./settings");
  const { listStages } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");

  const s = h.makeScratchTenant("lead-flow-runs-test");
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const DAY = 86_400_000;
      const WED_10 = Date.parse("2030-01-16T10:00:00Z"); // a Wednesday; winter, so Irish time = UTC
      const clock = h.fakeClock(WED_10);
      const queued = (leadId: number) =>
        tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"))).all();
      const runRows = (leadId: number) => tdb.select().from(schema.leadFlowRuns).where(eq(schema.leadFlowRuns.leadId, leadId)).all();

      const { lead } = upsertLead({ source: "manual", fullName: "Aoife Test", email: "aoife@example.com", phone: "+353870000000" });

      // Off until switched on.
      ok(runs.startFlow(lead.id, "lead_no_answer").skipped === "switched off", "a flow that is off starts nothing");
      ok(queued(lead.id).length === 0, "nothing queued");

      // On: the messages and the finish move.
      h.setFlowEnabled(s.tid, "lead_no_answer", true);
      const r1 = runs.startFlow(lead.id, "lead_no_answer");
      ok(r1.runId != null && r1.queued === 2, "two WhatsApps queued");
      const q1 = queued(lead.id);
      const msgs = q1.filter((q) => q.kind === "message").sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
      ok(msgs[0].dueAt.getTime() === WED_10 && msgs[1].dueAt.getTime() === WED_10 + 2 * DAY, "now, then two days on");
      ok(msgs.every((m) => m.runId === r1.runId && m.body.includes("Aoife") && !m.body.includes("[FIRST_NAME]")), "personalised, tied to the run");
      const move = q1.find((q) => q.kind === "move")!;
      ok(move.dueAt.getTime() === WED_10 + 4 * DAY && JSON.parse(move.payload!).column === "key:nurture", "the move to Long-term nurture after four days");

      // Re-entry restarts.
      clock.advance(DAY);
      const r2 = runs.startFlow(lead.id, "lead_no_answer");
      ok(r2.runId !== r1.runId && queued(lead.id).length === 3, "starting again replaces the old run");
      ok(runRows(lead.id).find((r) => r.id === r1.runId)?.status === "stopped", "the old run is stopped");

      // Starting another flow stops this one.
      h.setFlowEnabled(s.tid, "lead_thinking", true);
      runs.startFlow(lead.id, "lead_thinking");
      ok(queued(lead.id).every((q) => q.triggerKey === "lead_thinking"), "starting any flow stops every other flow");
      ok(runs.activeRun(lead.id, "lead_no_answer") === null && runs.activeRun(lead.id, "lead_thinking") !== null, "activeRun");
      ok(runs.startFlow(lead.id, "lead_thinking", { ifNotActive: true }).skipped === "already running", "an intake enrolment never doubles a running flow");
      ok(runs.leadFlowStatus(lead.id).flow === "Thinking about it" && runs.leadFlowStatus(lead.id).next.length === 2, "leadFlowStatus names the flow and its next messages");

      // stopFlows scopes.
      ok(runs.stopFlows(lead.id, "test", { only: ["lead_no_answer"] }) === 0 && queued(lead.id).length > 0, "only: leaves other flows");
      ok(runs.stopFlows(lead.id, "test", { except: ["lead_thinking"] }) === 0 && queued(lead.id).length > 0, "except: leaves the kept flow");
      ok(runs.stopFlows(lead.id, "replied") === 1 && queued(lead.id).length === 0, "all: stops it");
      const cancelled = tdb.select().from(schema.automationQueue).where(eq(schema.automationQueue.leadId, lead.id)).all().filter((q) => q.status === "cancelled");
      ok(cancelled.length > 0 && cancelled.every((q) => (q.error ?? "").startsWith("Stopped:")), "cancelled rows say why");

      // Sending hours push the first step back and the rest follow it.
      saveLeadFlowSettings({ window: { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" }, defaultAssigneeUserId: null, alertWhatsAppTo: null });
      clock.set(Date.parse("2030-01-19T19:00:00Z")); // Saturday evening
      runs.startFlow(lead.id, "lead_no_answer");
      const held = queued(lead.id).filter((q) => q.kind === "message").map((q) => q.dueAt.getTime()).sort((a, b) => a - b);
      ok(held[0] === Date.parse("2030-01-21T09:00:00Z"), "Saturday evening: Monday at 9");
      ok(held[1] === Date.parse("2030-01-23T09:00:00Z"), "the second step two days after the first");
      runs.stopFlows(lead.id, "reset");
      saveLeadFlowSettings({ window: null, defaultAssigneeUserId: null, alertWhatsAppTo: null });
      clock.set(WED_10);

      // An email-only lead skips the WhatsApps but still moves on at the end.
      const { lead: emailOnly } = upsertLead({ source: "manual", fullName: "Email Only", email: "emailonly@example.com" });
      const r3 = runs.startFlow(emailOnly.id, "lead_no_answer");
      ok(r3.queued === 0 && queued(emailOnly.id).length === 1 && queued(emailOnly.id)[0].kind === "move", "no phone: no WhatsApps, the move still happens");

      // Versions by interest, from saved messages (on New lead here; Long-term nurture also needs consent, Task 9).
      h.setFlowEnabled(s.tid, "new_lead", true);
      tdb.insert(schema.automationMessages)
        .values([
          { triggerKey: "new_lead", position: 0, channel: "email", subject: "Week 1", template: "Hi [FIRST_NAME], week one.", delayValue: 0, delayUnit: "days" },
          { triggerKey: "new_lead", position: 1, channel: "email", subject: "HBOT", template: "About HBOT.", delayValue: 7, delayUnit: "days", matchInterest: "hbot, hyperbaric" },
          { triggerKey: "new_lead", position: 2, channel: "email", subject: "General", template: "About our therapies.", delayValue: 7, delayUnit: "days", matchInterest: "other" },
        ])
        .run();
      const subjects = (leadId: number) => queued(leadId).filter((q) => q.kind === "message").map((q) => q.subject).join("|");
      const { lead: hbot } = upsertLead({ source: "manual", fullName: "Hb Ot", email: "hbot@example.com", therapyInterest: "Hyperbaric oxygen" });
      runs.startFlow(hbot.id, "new_lead");
      ok(subjects(hbot.id) === "Week 1|HBOT", "an HBOT lead gets the HBOT version");
      const { lead: unsure } = upsertLead({ source: "manual", fullName: "Not Sure", email: "unsure@example.com", therapyInterest: "Not sure yet" });
      runs.startFlow(unsure.id, "new_lead");
      ok(subjects(unsure.id) === "Week 1|General", "anyone else gets the general one");

      // A booked call: confirmation now, reminder counted back from the call, by email with no phone.
      h.setFlowEnabled(s.tid, "lead_call_booked", true);
      const callAt = WED_10 + DAY + 30 * 60_000; // Thursday 10:30
      ok(runs.startFlow(lead.id, "lead_call_booked").skipped === "no call time", "a booked call needs its time");
      runs.startFlow(lead.id, "lead_call_booked", { callAt });
      const call = queued(lead.id).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
      ok(call.length === 2 && call[0].dueAt.getTime() === WED_10 && call[1].dueAt.getTime() === callAt - 3_600_000, "confirmation now, reminder an hour before");
      ok(/Thursday 17 January at 10:30/.test(call[0].body), "the day and time are filled in");
      ok(JSON.parse(call[1].payload!).notAfter === callAt && !call.some((q) => q.kind === "move"), "the reminder is never sent late; no finish move");
      runs.startFlow(emailOnly.id, "lead_call_booked", { callAt });
      ok(queued(emailOnly.id).length === 2 && queued(emailOnly.id).every((q) => q.channel === "email" && (q.subject ?? "").startsWith("Your call with ")), "no phone: the call messages go by email");

      // A scheduled call's staff rows.
      tdb.insert(schema.automationQueue).values({ triggerKey: "call_alert", leadId: lead.id, kind: "staff_alert", channel: "chat", body: "alert", dueAt: new Date(callAt) }).run();
      ok(runs.cancelCallRows(lead.id, "moved") === 1, "cancelCallRows drops a call's staff alert");

      // Definitions: saved columns win over the defaults; "" means none.
      tdb.insert(schema.automationTriggers)
        .values({ key: "lead_thinking", enabled: true, startColumn: "", finishColumn: "key:undelivered", finishAfterValue: 3, finishAfterUnit: "days" })
        .onConflictDoUpdate({ target: schema.automationTriggers.key, set: { startColumn: "", finishColumn: "key:undelivered", finishAfterValue: 3, finishAfterUnit: "days" } })
        .run();
      const think = defs.getFlowDefinition("lead_thinking");
      ok(think.startColumn === null && think.finish?.column === "key:undelivered" && think.finish.afterMs === 3 * DAY, "saved settings override the defaults");
      const noAnswer = defs.getFlowDefinition("lead_no_answer");
      ok(noAnswer.startColumn === "key:no_answer" && noAnswer.finish?.afterMs === 4 * DAY, "no saved settings: the defaults");

      // Which flow a column starts.
      const cols = listStages();
      const naCol = cols.find((c) => c.systemKey === "no_answer")!;
      const thinkCol = cols.find((c) => c.systemKey === "thinking")!;
      ok(defs.flowForStage(naCol) === "lead_no_answer", "No answer starts the No answer flow");
      ok(defs.flowForStage(thinkCol) === null, "a flow pointed at no column starts from none");
      h.setFlowEnabled(s.tid, "lead_no_answer", false);
      ok(defs.flowForStage(naCol) === null, "switched off: nothing starts");
    });
    console.log(`runs: ${n} checks passed.`);
  } finally {
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test -- src/lib/leadFlows/runs.test.ts`
Expected: FAIL, "Cannot find module './runs'" (or './definitions').

- [ ] **Step 5: Write `definitions.ts`**

Create `app/src/lib/leadFlows/definitions.ts`:

```ts
import "server-only";

import { asc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { TRIGGER_LABELS, delayToMs, isMessageLive, type Channel, type IntervalUnit } from "@/lib/automationModel";
import type { FollowUpKey } from "@/lib/pipeline/followUpColumns";
import type { StageRole } from "@/lib/pipeline/roles";

import { columnMatches, flowDefaults, isTriggerEnabled, LEAD_FLOW_KEYS, type ColumnRef } from "./flowModel";
import { defaultMessagesFor } from "./presets";
import { flowTenant } from "./tenant";

/** One message of a flow, ready to schedule. */
export interface FlowMessage {
  channel: Channel;
  subject: string | null;
  template: string;
  /** Offset from the start of the flow, as the editor shows it. */
  delayMs: number;
  matchInterest: string | null;
}

/** What a flow does in this business right now: saved settings, else the defaults. */
export interface FlowDefinition {
  key: string;
  label: string;
  enabled: boolean;
  /** In position order; only live channels and non-empty templates. */
  messages: FlowMessage[];
  startColumn: ColumnRef | null;
  finish: { column: ColumnRef; afterMs: number } | null;
}

type TriggerRow = typeof schema.automationTriggers.$inferSelect;

/** null = use the default; "" = none. */
function columnSetting(saved: string | null | undefined, fallback: ColumnRef | null): ColumnRef | null {
  if (saved == null) return fallback;
  return saved.trim() || null;
}

export function flowStartColumn(key: string, state: TriggerRow | undefined): ColumnRef | null {
  return columnSetting(state?.startColumn, flowDefaults(key).startColumn);
}

export function flowFinish(key: string, state: TriggerRow | undefined): { column: ColumnRef; afterMs: number } | null {
  const d = flowDefaults(key);
  const column = columnSetting(state?.finishColumn, d.finishColumn);
  if (!column) return null;
  const afterMs =
    state?.finishAfterValue != null
      ? delayToMs(state.finishAfterValue, (state.finishAfterUnit ?? "days") as IntervalUnit)
      : d.finishAfter
        ? delayToMs(d.finishAfter.value, d.finishAfter.unit)
        : 0;
  return { column, afterMs };
}

/** A flow's effective definition for the ambient tenant. */
export function getFlowDefinition(key: string): FlowDefinition {
  const state = db.select().from(schema.automationTriggers).where(eq(schema.automationTriggers.key, key)).get();
  const saved = db
    .select()
    .from(schema.automationMessages)
    .where(eq(schema.automationMessages.triggerKey, key))
    .orderBy(asc(schema.automationMessages.position))
    .all();
  const source =
    saved.length > 0
      ? saved.map((m) => ({
          channel: m.channel as Channel,
          subject: m.subject,
          template: m.template ?? "",
          delayValue: m.delayValue,
          delayUnit: m.delayUnit as IntervalUnit,
          matchInterest: m.matchInterest ?? null,
        }))
      : defaultMessagesFor(key, flowTenant()?.slug).map((m) => ({ ...m, matchInterest: m.matchInterest ?? null }));
  const messages = source
    .filter((m) => isMessageLive(m, key) && m.template.trim())
    .map((m) => ({
      channel: m.channel,
      subject: m.subject,
      template: m.template,
      delayMs: delayToMs(m.delayValue, m.delayUnit),
      matchInterest: m.matchInterest?.trim() || null,
    }));
  return {
    key,
    label: TRIGGER_LABELS[key] ?? key,
    enabled: isTriggerEnabled(key, state),
    messages,
    startColumn: flowStartColumn(key, state),
    finish: flowFinish(key, state),
  };
}

/** The switched-on flow a lead entering this column starts, if any (catalog order; the first match wins). */
export function flowForStage(stage: { id: number; role: StageRole | null; systemKey?: FollowUpKey | null }): string | null {
  const states = new Map(db.select().from(schema.automationTriggers).all().map((s) => [s.key, s]));
  for (const key of LEAD_FLOW_KEYS) {
    const state = states.get(key);
    if (!isTriggerEnabled(key, state)) continue;
    const ref = flowStartColumn(key, state);
    if (ref && columnMatches(ref, stage)) return key;
  }
  return null;
}
```

- [ ] **Step 6: Write `runs.ts`**

Create `app/src/lib/leadFlows/runs.ts`:

```ts
import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { LeadFlowRun } from "@/lib/db/schema";
import { applyShortcodes, TRIGGER_LABELS } from "@/lib/automationModel";
import { getBusinessProfile } from "@/lib/businessProfile";

import { formatCallDay, formatCallTime, scheduleCallMessages } from "./callPlan";
import { flowNow } from "./clock";
import { getFlowDefinition } from "./definitions";
import { CALL_ALERT_KEY, CALL_BOOKED_FLOW, LEAD_FLOW_KEYS, LEAD_FLOW_KEY_SET } from "./flowModel";
import { cascadeDueTimes, finishDueAt, pickForInterest, type FlowScope } from "./flowPlan";
import { fitToWindow } from "./sendingWindow";
import { getLeadFlowSettings } from "./settings";

/**
 * Lead flow runs: starting one lead on one flow, and stopping flows. All in
 * the ambient tenant (a request, or a runWithTenant binding).
 *
 * Starting renders every message for that person there and then and parks
 * it in automation_queue with the time it is due, the way the campaign
 * nurture always has: the wording the operator approved is the wording that
 * goes, even if they edit the flow next week. Starting any flow stops every
 * other flow the lead is in, including an earlier run of the same one, so
 * re-entering a column restarts its flow.
 */

export interface StartFlowOptions {
  /** Skip when this flow is already running for the lead (enrolment at intake). */
  ifNotActive?: boolean;
  /** The first message's time, replacing its delay (the morning after a picked call-back day). */
  firstAt?: number;
  /** lead_call_booked only: when the call is. */
  callAt?: number;
  /** The checkout sequence's [OFFER_NAME] and [OFFER_LINK]. */
  extra?: { offerName?: string | null; offerLink?: string | null };
  now?: number;
}

export interface StartFlowResult {
  runId: number | null;
  /** Messages queued for the lead. */
  queued: number;
  /** Why nothing started, or null. */
  skipped: string | null;
}

function keysIn(scope: FlowScope): string[] {
  if (scope === "all") return [...LEAD_FLOW_KEYS];
  if ("only" in scope) return scope.only.filter((k) => LEAD_FLOW_KEY_SET.has(k));
  return LEAD_FLOW_KEYS.filter((k) => !scope.except.includes(k));
}

/** Stop a lead's flows in scope: their runs end and whatever they still had queued is cancelled. Returns the runs stopped. */
export function stopFlows(leadId: number, reason: string, scope: FlowScope = "all"): number {
  const keys = keysIn(scope);
  if (keys.length === 0) return 0;
  const runs = db
    .select({ id: schema.leadFlowRuns.id })
    .from(schema.leadFlowRuns)
    .where(and(eq(schema.leadFlowRuns.leadId, leadId), eq(schema.leadFlowRuns.status, "active"), inArray(schema.leadFlowRuns.triggerKey, keys)))
    .all();
  if (runs.length > 0) {
    db.update(schema.leadFlowRuns)
      .set({ status: "stopped", stopReason: reason.slice(0, 200), endedAt: new Date(flowNow()) })
      .where(inArray(schema.leadFlowRuns.id, runs.map((r) => r.id)))
      .run();
  }
  // The runs' rows, and rows queued before runs existed (no run id), for the same flows.
  db.update(schema.automationQueue)
    .set({ status: "cancelled", error: `Stopped: ${reason}`.slice(0, 300) })
    .where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"), inArray(schema.automationQueue.triggerKey, keys)))
    .run();
  return runs.length;
}

/** Drop a scheduled call's staff alerts and call-back check. */
export function cancelCallRows(leadId: number, reason: string): number {
  return db
    .update(schema.automationQueue)
    .set({ status: "cancelled", error: `Stopped: ${reason}`.slice(0, 300) })
    .where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"), eq(schema.automationQueue.triggerKey, CALL_ALERT_KEY)))
    .run().changes;
}

export function activeRun(leadId: number, triggerKey: string): LeadFlowRun | null {
  return (
    db
      .select()
      .from(schema.leadFlowRuns)
      .where(and(eq(schema.leadFlowRuns.leadId, leadId), eq(schema.leadFlowRuns.triggerKey, triggerKey), eq(schema.leadFlowRuns.status, "active")))
      .orderBy(desc(schema.leadFlowRuns.id))
      .get() ?? null
  );
}

function alreadyRunning(leadId: number, triggerKey: string): boolean {
  if (activeRun(leadId, triggerKey)) return true;
  return !!db
    .select({ id: schema.automationQueue.id })
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.triggerKey, triggerKey), eq(schema.automationQueue.status, "queued")))
    .get();
}

/** Put a lead on a flow. Nothing is sent here; the dispatch ticker sends what is due. */
export function startFlow(leadId: number, triggerKey: string, opts: StartFlowOptions = {}): StartFlowResult {
  const now = opts.now ?? flowNow();
  const skip = (why: string): StartFlowResult => ({ runId: null, queued: 0, skipped: why });
  if (!LEAD_FLOW_KEY_SET.has(triggerKey)) return skip("not a lead flow");
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!lead) return skip("no such lead");
  const def = getFlowDefinition(triggerKey);
  if (!def.enabled) return skip("switched off");
  if (opts.ifNotActive && alreadyRunning(leadId, triggerKey)) return skip("already running");
  if (triggerKey === CALL_BOOKED_FLOW && opts.callAt == null) return skip("no call time");

  stopFlows(leadId, `${def.label} started`, "all");

  const { window } = getLeadFlowSettings();
  const profile = getBusinessProfile();
  const picked = pickForInterest(def.messages, lead.therapyInterest);
  const delays = picked.map((m) => m.delayMs);
  const fit = (at: number, i: number) => fitToWindow(at, picked[i].channel, window);
  const dues: (number | null)[] =
    triggerKey === CALL_BOOKED_FLOW
      ? scheduleCallMessages({ now, callAt: opts.callAt!, delaysMs: delays, fit })
      : cascadeDueTimes(now, delays, fit, opts.firstAt);

  const vars = {
    firstName: lead.firstName,
    lastName: lead.lastName,
    businessName: profile.businessName,
    businessPhone: profile.phone ?? "",
    ...opts.extra,
    ...(opts.callAt != null ? { callDay: formatCallDay(opts.callAt), callTime: formatCallTime(opts.callAt) } : {}),
  };

  const rows: (typeof schema.automationQueue.$inferInsert)[] = [];
  picked.forEach((m, i) => {
    const due = dues[i];
    if (due == null) return;
    let channel = m.channel;
    let subject = m.subject;
    let sendTo = channel === "whatsapp" ? lead.phone : lead.email;
    // A booked call with no phone on file: the confirmation and reminder go by email.
    if (!sendTo && channel === "whatsapp" && triggerKey === CALL_BOOKED_FLOW && lead.email) {
      channel = "email";
      sendTo = lead.email;
      subject = `Your call with ${profile.businessName}`;
    }
    // A message the lead has no address for is skipped; the rest still go.
    if (!sendTo) return;
    rows.push({
      triggerKey,
      leadId,
      kind: "message",
      step: i,
      channel,
      sendTo,
      subject: channel === "email" ? applyShortcodes((subject ?? "").trim() || `A message from ${profile.businessName}`, vars) : null,
      body: applyShortcodes(m.template, vars),
      dueAt: new Date(due),
      payload: triggerKey === CALL_BOOKED_FLOW && i > 0 ? JSON.stringify({ notAfter: opts.callAt }) : null,
    });
  });
  const finishAt = def.finish && triggerKey !== CALL_BOOKED_FLOW ? finishDueAt(opts.firstAt ?? now, dues, delays, def.finish.afterMs) : null;
  if (rows.length === 0 && finishAt == null) return skip("nothing this lead can receive");

  const runId = db
    .insert(schema.leadFlowRuns)
    .values({ leadId, triggerKey, status: "active", startedAt: new Date(now) })
    .returning({ id: schema.leadFlowRuns.id })
    .get().id;
  for (const r of rows) db.insert(schema.automationQueue).values({ ...r, runId }).run();
  if (finishAt != null && def.finish) {
    db.insert(schema.automationQueue)
      .values({
        triggerKey,
        leadId,
        runId,
        kind: "move",
        channel: "chat",
        body: `Move to ${def.finish.column}`,
        dueAt: new Date(finishAt),
        payload: JSON.stringify({ column: def.finish.column }),
      })
      .run();
  }
  return { runId, queued: rows.length, skipped: null };
}

/** For the lead page: the flow the lead is in and its next few messages. */
export function leadFlowStatus(leadId: number): { flow: string | null; next: { channel: string; dueAt: number }[] } {
  const run = db
    .select()
    .from(schema.leadFlowRuns)
    .where(and(eq(schema.leadFlowRuns.leadId, leadId), eq(schema.leadFlowRuns.status, "active")))
    .orderBy(desc(schema.leadFlowRuns.id))
    .get();
  const next = db
    .select({ channel: schema.automationQueue.channel, dueAt: schema.automationQueue.dueAt })
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"), eq(schema.automationQueue.kind, "message")))
    .orderBy(asc(schema.automationQueue.dueAt))
    .limit(3)
    .all()
    .map((r) => ({ channel: r.channel, dueAt: r.dueAt.getTime() }));
  return { flow: run ? (TRIGGER_LABELS[run.triggerKey] ?? run.triggerKey) : null, next };
}
```

- [ ] **Step 7: Turn `nurture.ts` into a facade**

Replace everything in `app/src/lib/automations/nurture.ts` above `const BATCH = 25;` with:

```ts
import "server-only";

import { and, asc, eq, inArray, lte, ne } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getTenantDbById } from "@/lib/db/tenant";
import type { Lead } from "@/lib/db/schema";
import { TRIGGER_LABELS, inSendingHours } from "@/lib/automationModel";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { getThemeForTenant } from "@/lib/settings";
import { renderEmailShell, sendEmailForTenant, textToParagraphs } from "@/lib/email";
import { isStopped } from "@/lib/platform/killSwitch";
import { isTriggerEnabled } from "@/lib/leadFlows/flowModel";
import { startFlow, stopFlows } from "@/lib/leadFlows/runs";

/**
 * The lead follow-up sequences, kept under their old names for their
 * callers (leads.upsertLead, offers/fulfil, lib/automations, the ticker).
 * The engine is lib/leadFlows: runs.ts starts and stops flows,
 * definitions.ts says what a flow is in this business.
 *
 * The campaign sign-up sequence is ON unless the operator has switched it
 * off; every other flow is off until switched on.
 */
export const NURTURE_TRIGGER_KEY = "campaign_signup";

// Which triggers are on with no saved row lives with the flow vocabulary now.
export { DEFAULT_ENABLED_TRIGGERS, isTriggerEnabled } from "@/lib/leadFlows/flowModel";

/** Whether a sequence is switched on for the ambient tenant (campaign sign-up is on unless switched off). */
export function sequenceEnabled(triggerKey: string): boolean {
  const state = db
    .select({ enabled: schema.automationTriggers.enabled })
    .from(schema.automationTriggers)
    .where(eq(schema.automationTriggers.key, triggerKey))
    .get();
  return isTriggerEnabled(triggerKey, state);
}

/** Put a lead on a sequence unless it is already on it. Returns how many messages were queued. */
export function enrolLeadInSequence(
  lead: Pick<Lead, "id">,
  triggerKey: string,
  extra: { offerName?: string | null; offerLink?: string | null } = {},
): number {
  return startFlow(lead.id, triggerKey, { ifNotActive: true, extra }).queued;
}

/** The campaign sign-up sequence (kept for its callers). */
export function enrolLeadInNurture(lead: Pick<Lead, "id">): number {
  return enrolLeadInSequence(lead, NURTURE_TRIGGER_KEY);
}

/** Stop the named sequences for a lead. Returns the runs stopped. */
export function cancelSequences(leadId: number, triggerKeys: readonly string[]): number {
  if (triggerKeys.length === 0) return 0;
  return stopFlows(leadId, "stopped", { only: triggerKeys });
}

/** Stop every sequence for a lead (won or lost). */
export function cancelNurtureForLead(leadId: number): number {
  return stopFlows(leadId, "won or lost", "all");
}

/** Queued messages for a lead, soonest first -- for the lead's detail view. */
export function listQueuedForLead(leadId: number) {
  return db
    .select()
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"), eq(schema.automationQueue.kind, "message")))
    .orderBy(asc(schema.automationQueue.dueAt))
    .all();
}
```

Keep `const BATCH = 25;` and `dispatchDueAutomationQueue` below it unchanged, except: its batch query only reads message rows (the new row kinds are sent from Task 8). Change the `.where(and(...))` of the `due` query to:

```ts
      and(
        eq(schema.automationQueue.status, "queued"),
        eq(schema.automationQueue.kind, "message"),
        lte(schema.automationQueue.dueAt, new Date(now)),
        ...(emailHeld ? [ne(schema.automationQueue.channel, "email")] : []),
      ),
```

Remove imports that are now unused (`DEFAULT_MESSAGES`, `applyShortcodes`, `delayToMs`, `isMessageLive`, `type Channel`, `getBusinessProfile`). Keep `inSendingHours` (the old dispatch still uses it until Task 8).

- [ ] **Step 8: Count only messages in `leadSequences.test.ts`**

In `app/src/lib/automations/leadSequences.test.ts`, the `queued` helper's `and(...)` gains `eq(schema.automationQueue.kind, "message"),` after the status condition, and the header comment's first bullet gains "(the New lead flow's finish move to Long-term nurture is a queue row too, so counts are of messages)". Change nothing else.

- [ ] **Step 9: Run the tests**

Run: `npm test -- src/lib/leadFlows/runs.test.ts`
Expected: PASS, last line `runs: <n> checks passed.`
Run: `npm test -- src/lib/automations/leadSequences.test.ts`, `npm test -- src/lib/automations/nurtureKillSwitch.test.ts`, `npm test -- src/lib/dispatch/dispatch.test.ts`
Expected: all PASS.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add app/src/lib/db/schema.ts app/src/lib/db/tenant.ts app/src/lib/leadFlows/clock.ts app/src/lib/leadFlows/tenant.ts app/src/lib/leadFlows/definitions.ts app/src/lib/leadFlows/runs.ts app/src/lib/leadFlows/runs.test.ts app/src/lib/leadFlows/testing/stubs.ts app/src/lib/leadFlows/testing/harness.ts app/src/lib/automations/nurture.ts app/src/lib/automations/leadSequences.test.ts
git commit -m "feat(lead-flows): flow runs that start, restart and stop each other

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Entering a column starts and stops flows

**Files:**
- Create: `app/src/lib/leadFlows/columnEntry.ts`
- Modify: `app/src/lib/pipeline/stage.ts` (`writeStageId`, `setStageToId`, `onInboundFromLead`, imports)
- Test: `app/src/lib/leadFlows/columnEntry.test.ts`

**Interfaces:**
- Consumes: `columnEntryEffect` (Task 5), `flowForStage` (Task 6), `startFlow`, `stopFlows`, `cancelCallRows` (Task 6), `KEEP_ON_REPLY` (Task 4).
- Produces:
  - `applyColumnEntry(leadId: number, stage: StageRecord, actor: StageActor, opts?: { startFlow?: boolean }): void`
  - stage.ts: `interface StageWriteOptions { startFlow?: boolean; reenter?: boolean }`; `writeStageId(leadId, stageId, note, actor = "system", opts: StageWriteOptions = {})`; `setStageToId(leadId, stageId, actor = "user", opts: StageWriteOptions = {})`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/leadFlows/columnEntry.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/columnEntry.test.ts
//
// What moving a card does to flows, through the real stage writer: a person
// moving a lead stops every flow and starts the column's own; the same
// column again only restarts when asked; a booking with its flow off still
// stops the nudges; a sale stops everything; a reply stops everything but a
// booked call's reminders.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead } = requireLocal("../leads") as typeof import("../leads");
  const stage = requireLocal("../pipeline/stage") as typeof import("../pipeline/stage");
  const { listStages, resolveStageIdByRole } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");
  const runs = requireLocal("./runs") as typeof import("./runs");

  const s = h.makeScratchTenant("lead-flow-column-entry-test");
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      h.fakeClock(Date.parse("2030-01-16T10:00:00Z"));
      const active = (leadId: number) =>
        tdb.select().from(schema.leadFlowRuns).where(and(eq(schema.leadFlowRuns.leadId, leadId), eq(schema.leadFlowRuns.status, "active"))).all();
      const queuedKeys = (leadId: number) =>
        [...new Set(tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"))).all().map((q) => q.triggerKey))];
      const col = (key: string) => listStages().find((c) => c.systemKey === key)!;

      for (const k of ["new_lead", "lead_no_answer", "lead_thinking", "lead_call_booked"]) h.setFlowEnabled(s.tid, k, true);

      const { lead } = upsertLead({ source: "website", sourceLeadId: "website:ce@example.com", fullName: "Column Entry", email: "ce@example.com", phone: "+353870000001" });
      ok(active(lead.id).map((r) => r.triggerKey).join() === "new_lead", "an enquiry starts New lead");

      // A person moves the card into No answer.
      stage.setStageToId(lead.id, col("no_answer").id);
      ok(active(lead.id).map((r) => r.triggerKey).join() === "lead_no_answer", "New lead stopped, No answer started");
      const first = active(lead.id)[0].id;

      // The same column again: nothing changes unless it is a re-entry.
      stage.setStageToId(lead.id, col("no_answer").id);
      ok(active(lead.id)[0].id === first, "writing the same column is not a re-entry");
      stage.setStageToId(lead.id, col("no_answer").id, "user", { reenter: true });
      ok(active(lead.id)[0].id !== first, "re-entry restarts the flow");

      // Moved by a person into a column with no flow: everything stops.
      stage.setStageToId(lead.id, resolveStageIdByRole("engaged")!);
      ok(active(lead.id).length === 0 && queuedKeys(lead.id).length === 0, "a person moving the card stops every flow");

      // startFlow false: the move stops flows but starts nothing.
      stage.setStageToId(lead.id, col("thinking").id, "user", { startFlow: false });
      ok(active(lead.id).length === 0, "Schedule a call style: the column's own flow does not start");

      // A booking with the booked flow off still stops the nudges, but not a booked call.
      stage.setStageToId(lead.id, col("thinking").id, "user", { reenter: true });
      ok(active(lead.id).map((r) => r.triggerKey).join() === "lead_thinking", "Thinking about it running");
      stage.writeStageId(lead.id, resolveStageIdByRole("booked")!, "booked by an appointment", "automation");
      ok(active(lead.id).length === 0, "an automatic booking stops the nudges");
      runs.startFlow(lead.id, "lead_call_booked", { callAt: Date.parse("2030-01-17T10:30:00Z") });
      stage.writeStageId(lead.id, resolveStageIdByRole("engaged")!, "test", "system");
      stage.writeStageId(lead.id, resolveStageIdByRole("booked")!, "booked again", "automation");
      ok(active(lead.id).map((r) => r.triggerKey).join() === "lead_call_booked", "a booking does not stop a booked call's reminders");

      // A reply stops the nudges but not the booked call. (Two flows never run at
      // once, so the nudge here is a row queued before runs existed.)
      tdb.insert(schema.automationQueue).values({ triggerKey: "new_lead", leadId: lead.id, kind: "message", channel: "whatsapp", body: "nudge", sendTo: lead.phone, dueAt: new Date(Date.parse("2030-01-18T10:00:00Z")) }).run();
      stage.onInboundFromLead(lead.id);
      ok(queuedKeys(lead.id).join() === "lead_call_booked", "a reply stops the nudges and keeps a booked call's reminder");

      // A no-show stops the booked call; a sale stops everything.
      stage.writeStageId(lead.id, resolveStageIdByRole("no_show")!, "no-show", "automation");
      ok(active(lead.id).length === 0, "a no-show stops the booked call's messages");
      runs.startFlow(lead.id, "lead_no_answer");
      tdb.insert(schema.automationQueue).values({ triggerKey: "call_alert", leadId: lead.id, kind: "staff_alert", channel: "chat", body: "alert", dueAt: new Date(Date.parse("2030-01-17T10:20:00Z")) }).run();
      stage.writeStageId(lead.id, resolveStageIdByRole("won")!, "paid", "system");
      ok(active(lead.id).length === 0 && queuedKeys(lead.id).length === 0, "a sale stops every flow and the call alerts");

      // An automatic move into a flow column starts it.
      const { lead: other } = upsertLead({ source: "manual", fullName: "Other Lead", phone: "+353870000002" });
      stage.writeStageId(other.id, col("no_answer").id, "automatic", "automation");
      ok(active(other.id).map((r) => r.triggerKey).join() === "lead_no_answer", "an automatic move into No answer starts its flow");
      stage.writeStageId(other.id, col("undelivered").id, "undelivered", "automation");
      ok(active(other.id).map((r) => r.triggerKey).join() === "lead_no_answer", "an automatic move into Message undelivered keeps the flow running");
    });
    console.log(`columnEntry: ${n} checks passed.`);
  } finally {
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/leadFlows/columnEntry.test.ts`
Expected: FAIL (the first assertion that needs column entry, "New lead stopped, No answer started").

- [ ] **Step 3: Write `columnEntry.ts`**

Create `app/src/lib/leadFlows/columnEntry.ts`:

```ts
import "server-only";

import type { StageRecord } from "@/lib/pipeline/roles";
import type { StageActor } from "@/lib/pipeline/stageEvents";

import { flowForStage } from "./definitions";
import { columnEntryEffect } from "./flowPlan";
import { cancelCallRows, startFlow, stopFlows } from "./runs";

/**
 * What a lead entering a column does to its flows (lib/leadFlows/flowPlan
 * columnEntryEffect). Called by the one stage writer, lib/pipeline/stage.ts
 * writeStageId, after the move is saved.
 */
export function applyColumnEntry(leadId: number, stage: StageRecord, actor: StageActor, opts: { startFlow?: boolean } = {}): void {
  const effect = columnEntryEffect({ actor, role: stage.role, flowKey: flowForStage(stage), startFlow: opts.startFlow !== false });
  const why = actor === "user" || actor === "agent" ? `moved to ${stage.name} by a person` : `moved to ${stage.name}`;
  if (effect.stop !== "none") stopFlows(leadId, why, effect.stop);
  if (effect.cancelCallRows) cancelCallRows(leadId, why);
  if (effect.start) startFlow(leadId, effect.start);
}
```

- [ ] **Step 4: Wire it into the stage writer**

In `app/src/lib/pipeline/stage.ts`:

Replace the imports of `cancelNurtureForLead, cancelSequences, enrolLeadInSequence`, of `STOP_ON_BOOKED, STOP_ON_NO_SHOW, STOP_ON_REPLY` and of `INACTIVE_ROLES` with:

```ts
import { KEEP_ON_REPLY } from "@/lib/automationModel";
import { applyColumnEntry } from "@/lib/leadFlows/columnEntry";
import { stopFlows } from "@/lib/leadFlows/runs";
```

Replace `writeStageId` with:

```ts
export interface StageWriteOptions {
  /** false: enter the column without starting its flow (Schedule a call starts its own). */
  startFlow?: boolean;
  /** Treat a write to the column the lead is already in as entering it again (Log a call). */
  reenter?: boolean;
}

/**
 * Canonical writer: set a lead's stage_id + dual-write the frozen pipeline_stage
 * text (from the stage's role → legacy key) so not-yet-migrated readers/tests keep
 * working during the transition. Logs an activity row.
 */
export function writeStageId(leadId: number, stageId: number, note: string, actor: StageActor = "system", opts: StageWriteOptions = {}): void {
  const before = db
    .select({ stageId: schema.leads.stageId, pipelineId: schema.leads.pipelineId })
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .get();
  const pipelineId = leadPipelineId(leadId);
  const stage = pipelineId == null ? undefined : listStages(pipelineId).find((s) => s.id === stageId);
  const legacy = stage?.role ? ROLE_TO_LEGACY_KEY[stage.role] : undefined;
  db.update(schema.leads)
    .set({ stageId, ...(legacy ? { pipelineStage: legacy as typeof schema.leads.$inferInsert.pipelineStage } : {}), updatedAt: new Date() })
    .where(eq(schema.leads.id, leadId))
    .run();
  if (before) {
    recordStageEvent(db, { leadId, pipelineId: before.pipelineId, fromStageId: before.stageId ?? null, toStageId: stageId, actor });
  }
  // Lead follow-up flows (lib/leadFlows/columnEntry.ts): entering a column
  // can stop the flows a lead is in and start that column's own. A sale or a
  // write-off stops them all. Fail-soft: the move stands.
  if (stage && (before?.stageId !== stageId || opts.reenter)) {
    try {
      applyColumnEntry(leadId, stage, actor, { startFlow: opts.startFlow });
    } catch (err) {
      console.error(`[pipeline] follow-up flows for lead #${leadId} not updated:`, err);
    }
  }
  // A Facebook lead-ads lead that books, attends or buys: Meta is told, by
  // its own lead id, so lead ads learn which leads become customers
  // (lib/facebook/capi.ts). Once per lead and stage. Never breaks the move.
  if (stage?.role && before?.stageId !== stageId) {
    try {
      const lead = db.select({ source: schema.leads.source, sourceLeadId: schema.leads.sourceLeadId }).from(schema.leads).where(eq(schema.leads.id, leadId)).get();
      if (lead) queueCrmStage(getCurrentTenant().id, lead, stage.role);
    } catch (err) {
      console.error(`[pipeline] conversion-lead event for lead #${leadId} not queued:`, err);
    }
  }
  void logActivity("pipeline.stage", note, { leadId });
}
```

Replace `setStageToId` with:

```ts
/** Operator override — set ANY stage by id (drag / picker / agent), bypassing forward-only. */
export function setStageToId(leadId: number, stageId: number, actor: StageActor = "user", opts: StageWriteOptions = {}): void {
  const exists = db.select({ id: schema.leads.id, pipelineId: schema.leads.pipelineId }).from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!exists) return;
  // A stage from another board is refused, not silently applied: the lead
  // would then show in no column of the board it is on.
  const stage = listStages(exists.pipelineId).find((s) => s.id === stageId);
  if (!stage) return;
  writeStageId(leadId, stageId, `Lead set to ${stage.name} (manual)`, actor, opts);
}
```

Replace `onInboundFromLead` with:

```ts
export function onInboundFromLead(leadId: number): void {
  // They replied: a person takes it from here, so the automatic nudges stop
  // (a booked call's confirmation and reminder carry on).
  try {
    stopFlows(leadId, "replied", { except: KEEP_ON_REPLY });
  } catch (err) {
    console.error(`[pipeline] could not stop follow-ups for lead #${leadId}:`, err);
  }
  advanceStage(leadId, "engaged", "replied");
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- src/lib/leadFlows/columnEntry.test.ts`
Expected: PASS, `columnEntry: 14 checks passed.`
Run: `npm test -- src/lib/automations/leadSequences.test.ts` and `npm test -- src/lib/dispatch/dispatch.test.ts` and `npm test -- src/lib/pipeline/followUpColumns.db.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/leadFlows/columnEntry.ts app/src/lib/leadFlows/columnEntry.test.ts app/src/lib/pipeline/stage.ts
git commit -m "feat(lead-flows): entering a column starts its flow and stops the others

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Dispatch (send what is due, move cards at the end)

**Files:**
- Create: `app/src/lib/leadFlows/transport.ts`
- Create: `app/src/lib/leadFlows/dispatch.ts`
- Modify: `app/src/lib/automations/nurture.ts` (drop the old dispatch; re-export the new one)
- Modify: `app/src/lib/dispatch/ticker.ts` (pass `baseUrl`)
- Modify: `app/src/lib/leadFlows/testing/harness.ts` (fake transport)
- Test: `app/src/lib/leadFlows/dispatch.test.ts`

**Interfaces:**
- Consumes: Tasks 1-7.
- Produces:
  - `transport.ts`: `interface FlowTransport { whatsAppConnected(): boolean; sendWhatsAppToLead(leadId: number, text: string): Promise<{ providerMessageId: string }>; sendWhatsAppToNumber(phone: string, text: string): Promise<{ providerMessageId: string }>; sendEmail(tenantId: number, opts: SendOpts): Promise<SendResult> }`, `getFlowTransport()`, `setFlowTransportForTests(t)`
  - `dispatch.ts`: `dispatchDueAutomationQueue(tenantId: number, now?: number, baseUrl?: string): Promise<number>`, `WHATSAPP_NOT_CONNECTED`, `interface DispatchContext { tenantId; tdb; now; baseUrl; settings; businessName; accent }`, `type RowHandler = (ctx: DispatchContext, row: AutomationQueueRow) => Promise<boolean>`, `markRow(tdb, id, patch)`, `logSend(ctx, row, channel, subject, sentTo, error)` (later tasks add handlers to the `HANDLERS` map in this file)
  - `harness.ts`: `installFakeTransport(opts?: { connected?: boolean }): { sent: FakeSend[]; failWhatsAppFor: Set<number>; restore(): void }` with `interface FakeSend { to: "lead" | "number" | "email"; leadId?: number; address?: string; text: string; subject?: string; html?: string }`

- [ ] **Step 1: Write the transport seam**

Create `app/src/lib/leadFlows/transport.ts`:

```ts
import "server-only";

import { sendEmailForTenant, type SendOpts, type SendResult } from "@/lib/email";
import { isWhatsAppConfigured } from "@/lib/whatsapp/config";

/**
 * How the lead flows reach people: the business's own WhatsApp (Whapi) and
 * email. One seam, so a test can swap in a fake and nothing real is ever
 * sent from a test run.
 */
export interface FlowTransport {
  /** WhatsApp connected for the ambient tenant. */
  whatsAppConnected(): boolean;
  /** A WhatsApp to a lead, recorded on their conversation. Throws on a provider failure. */
  sendWhatsAppToLead(leadId: number, text: string): Promise<{ providerMessageId: string }>;
  /** A WhatsApp to any number (staff alerts), from the business WhatsApp. Throws on failure. */
  sendWhatsAppToNumber(phone: string, text: string): Promise<{ providerMessageId: string }>;
  /** Never throws. */
  sendEmail(tenantId: number, opts: SendOpts): Promise<SendResult>;
}

const real: FlowTransport = {
  whatsAppConnected: () => isWhatsAppConfigured(),
  async sendWhatsAppToLead(leadId, text) {
    // Loaded here: whatsapp/send imports leads, which imports the flows.
    const { sendWhatsApp } = await import("@/lib/whatsapp/send");
    const r = await sendWhatsApp({ subjectType: "lead", subjectId: leadId, text });
    return { providerMessageId: r.providerMessageId };
  },
  async sendWhatsAppToNumber(phone, text) {
    const { getWhatsAppBridge } = await import("@/lib/whatsapp");
    return getWhatsAppBridge().sendText(phone, text);
  },
  sendEmail: (tenantId, opts) => sendEmailForTenant(tenantId, opts),
};

let override: FlowTransport | undefined;

export function getFlowTransport(): FlowTransport {
  return override ?? real;
}

/** Tests only. */
export function setFlowTransportForTests(t: FlowTransport | undefined): void {
  override = t;
}
```

Append to `app/src/lib/leadFlows/testing/harness.ts`:

```ts
import { setFlowTransportForTests, type FlowTransport } from "../transport";

export interface FakeSend {
  to: "lead" | "number" | "email";
  leadId?: number;
  address?: string;
  text: string;
  subject?: string;
  html?: string;
}

/** Record every send instead of making it. `failWhatsAppFor` makes WhatsApps to those lead ids fail like an undeliverable number. */
export function installFakeTransport(opts: { connected?: boolean } = {}): { sent: FakeSend[]; failWhatsAppFor: Set<number>; restore(): void } {
  const sent: FakeSend[] = [];
  const failWhatsAppFor = new Set<number>();
  let count = 0;
  const fake: FlowTransport = {
    whatsAppConnected: () => opts.connected ?? true,
    async sendWhatsAppToLead(leadId, text) {
      if (failWhatsAppFor.has(leadId)) throw new Error("This number is not on WhatsApp.");
      sent.push({ to: "lead", leadId, text });
      return { providerMessageId: `fake-${++count}` };
    },
    async sendWhatsAppToNumber(phone, text) {
      sent.push({ to: "number", address: phone, text });
      return { providerMessageId: `fake-${++count}` };
    },
    async sendEmail(_tenantId, o) {
      sent.push({ to: "email", address: Array.isArray(o.to) ? o.to.join(",") : o.to, subject: o.subject, html: o.html, text: o.text ?? "" });
      return { ok: true, id: `fake-${++count}` };
    },
  };
  setFlowTransportForTests(fake);
  return { sent, failWhatsAppFor, restore: () => setFlowTransportForTests(undefined) };
}
```

(Move the new `import` line to the top of the file with the other imports.)

- [ ] **Step 2: Write the failing test**

Create `app/src/lib/leadFlows/dispatch.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/dispatch.test.ts
//
// The dispatch of lead-flow rows, against a real scratch tenant with a fake
// sender and a fixed clock: due messages go, a message outside sending
// hours waits for the next window, a call reminder that would go late is
// dropped, an unsubscribed address is never mailed, WhatsApp not connected
// fails visibly, the finish move moves the card, and a run with nothing
// left is closed.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead, getLead } = requireLocal("../leads") as typeof import("../leads");
  const runs = requireLocal("./runs") as typeof import("./runs");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");
  const { saveLeadFlowSettings } = requireLocal("./settings") as typeof import("./settings");
  const { listStages } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");

  const s = h.makeScratchTenant("lead-flow-dispatch-test");
  const fake = h.installFakeTransport();
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const DAY = 86_400_000;
      const WED_10 = Date.parse("2030-01-16T10:00:00Z");
      const clock = h.fakeClock(WED_10);
      const rows = (leadId: number) => tdb.select().from(schema.automationQueue).where(eq(schema.automationQueue.leadId, leadId)).all();
      const dispatch = (at: number) => dispatchDueAutomationQueue(s.tid, at, "http://app.test");

      h.setFlowEnabled(s.tid, "lead_no_answer", true);
      const { lead } = upsertLead({ source: "manual", fullName: "Disp Atch", email: "dispatch@example.com", phone: "+353870000003" });
      const run = runs.startFlow(lead.id, "lead_no_answer");

      // The first WhatsApp is due now.
      ok((await dispatch(WED_10)) === 1, "one message sent");
      ok(fake.sent.length === 1 && fake.sent[0].to === "lead" && fake.sent[0].leadId === lead.id, "by WhatsApp to the lead");
      const first = rows(lead.id).find((r) => r.kind === "message" && r.status === "sent")!;
      ok(first.providerMessageId === "fake-1", "the provider's id is kept for delivery statuses");
      ok(tdb.select().from(schema.automationLog).where(eq(schema.automationLog.channel, "whatsapp")).all().length === 1, "the Sent view shows it");

      // Sending hours: the second message comes due on a Saturday evening.
      saveLeadFlowSettings({ window: { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" }, defaultAssigneeUserId: null, alertWhatsAppTo: null });
      const second = rows(lead.id).find((r) => r.kind === "message" && r.status === "queued")!;
      const satEvening = Date.parse("2030-01-19T19:00:00Z");
      tdb.update(schema.automationQueue).set({ dueAt: new Date(satEvening) }).where(eq(schema.automationQueue.id, second.id)).run();
      ok((await dispatch(satEvening)) === 0, "nothing goes outside sending hours");
      const waited = rows(lead.id).find((r) => r.id === second.id)!;
      ok(waited.status === "queued" && waited.dueAt.getTime() === Date.parse("2030-01-21T09:00:00Z"), "it waits for Monday at 9, never dropped");

      // A call reminder that sending hours would push past the call is dropped.
      const late = tdb.insert(schema.automationQueue)
        .values({ triggerKey: "lead_call_booked", leadId: lead.id, kind: "message", channel: "whatsapp", body: "reminder", sendTo: lead.phone, dueAt: new Date(satEvening), payload: JSON.stringify({ notAfter: satEvening + 3_600_000 }) })
        .returning({ id: schema.automationQueue.id })
        .get().id;
      await dispatch(satEvening);
      ok(rows(lead.id).find((r) => r.id === late)?.status === "cancelled", "a reminder that would land after the call is dropped");
      saveLeadFlowSettings({ window: null, defaultAssigneeUserId: null, alertWhatsAppTo: null });

      // An unsubscribed address is never mailed.
      tdb.insert(schema.suppressions).values({ email: "dispatch@example.com", reason: "unsubscribe" }).run();
      const mail = tdb.insert(schema.automationQueue)
        .values({ triggerKey: "new_lead", leadId: lead.id, kind: "message", channel: "email", subject: "Hi", body: "Hello", sendTo: "Dispatch@Example.com", dueAt: new Date(WED_10) })
        .returning({ id: schema.automationQueue.id })
        .get().id;
      await dispatch(WED_10 + 1);
      ok(rows(lead.id).find((r) => r.id === mail)?.status === "cancelled" && !fake.sent.some((x) => x.to === "email"), "suppressed: cancelled, not sent");

      // WhatsApp not connected fails visibly.
      fake.restore();
      const offline = h.installFakeTransport({ connected: false });
      const { lead: off } = upsertLead({ source: "manual", fullName: "Off Line", phone: "+353870000004" });
      runs.startFlow(off.id, "lead_no_answer");
      await dispatch(WED_10 + 2);
      const failed = rows(off.id).find((r) => r.kind === "message" && r.status === "failed");
      ok(!!failed && /WhatsApp is not connected/.test(failed.error ?? "") && offline.sent.length === 0, "not connected: failed with the reason, nothing sent");
      offline.restore();
      tdb.update(schema.automationQueue).set({ status: "cancelled" }).where(eq(schema.automationQueue.leadId, off.id)).run();
      const back = h.installFakeTransport();

      // The finish move moves the card, and the finished run is closed.
      tdb.update(schema.automationQueue).set({ status: "cancelled" }).where(and(eq(schema.automationQueue.leadId, lead.id), eq(schema.automationQueue.kind, "message"), eq(schema.automationQueue.status, "queued"))).run();
      clock.set(WED_10 + 5 * DAY);
      await dispatch(WED_10 + 5 * DAY);
      const nurture = listStages().find((c) => c.systemKey === "nurture")!;
      ok(getLead(lead.id)!.stageId === nurture.id, "No answer ended with no reply: the card is in Long-term nurture");
      const runRow = tdb.select().from(schema.leadFlowRuns).where(eq(schema.leadFlowRuns.id, run.runId!)).get()!;
      ok(runRow.status !== "active", "the run is closed");
      ok(back.sent.length === 0, "the move sends nothing");

      // A deleted lead is never written to.
      const { lead: gone } = upsertLead({ source: "manual", fullName: "Gone Lead", phone: "+353870000005" });
      runs.startFlow(gone.id, "lead_no_answer");
      tdb.delete(schema.leads).where(eq(schema.leads.id, gone.id)).run();
      await dispatch(WED_10 + 5 * DAY);
      ok(rows(gone.id).filter((r) => r.status === "queued").length === 0 && back.sent.length === 0, "a deleted lead's rows are cancelled");
      back.restore();
    });
    console.log(`dispatch: ${n} checks passed.`);
  } finally {
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- src/lib/leadFlows/dispatch.test.ts`
Expected: FAIL, "Cannot find module './dispatch'".

- [ ] **Step 4: Write `dispatch.ts`**

Create `app/src/lib/leadFlows/dispatch.ts`:

```ts
import "server-only";

import { and, asc, eq, inArray, lte, ne, sql } from "drizzle-orm";

import { schema } from "@/lib/db";
import { getTenantDbById, runWithTenant, type TenantDb } from "@/lib/db/tenant";
import type { AutomationQueueRow } from "@/lib/db/schema";
import { TRIGGER_LABELS } from "@/lib/automationModel";
import { getAppBaseUrl } from "@/lib/appUrl";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { renderEmailShell, textToParagraphs } from "@/lib/email";
import { isStopped } from "@/lib/platform/killSwitch";
import { getThemeForTenant } from "@/lib/settings";

import { flowNow } from "./clock";
import { parsePayload, resolveColumn } from "./flowModel";
import { fitToWindow } from "./sendingWindow";
import { getLeadFlowSettingsForTenant } from "./settings";
import type { LeadFlowSettings } from "./settingsModel";
import { getFlowTransport } from "./transport";

/**
 * Send what is due in the lead flows, for one tenant. Called by the minute
 * dispatch ticker (lib/dispatch/ticker.ts). Each row is one of:
 *   message        a WhatsApp or email to the lead, inside sending hours
 *   move           a flow ending with no reply: the card moves column
 * (later kinds are added to HANDLERS below). Every outcome is written back
 * to the row; messages also go to automation_log, the Sent view.
 */

const BATCH = 25;

export const WHATSAPP_NOT_CONNECTED = "WhatsApp is not connected. Add credentials in Settings → Integrations → WhatsApp.";

export interface DispatchContext {
  tenantId: number;
  tdb: TenantDb;
  now: number;
  baseUrl: string;
  settings: LeadFlowSettings;
  businessName: string;
  accent: string;
}

/** Handles one due row. Returns true when a message went to a lead. */
export type RowHandler = (ctx: DispatchContext, row: AutomationQueueRow) => Promise<boolean>;

export function markRow(
  tdb: TenantDb,
  id: number,
  patch: { status: "queued" | "sent" | "failed" | "cancelled"; error?: string | null; sentAt?: Date | null; providerMessageId?: string | null },
): void {
  tdb.update(schema.automationQueue).set(patch).where(eq(schema.automationQueue.id, id)).run();
}

export function logSend(ctx: DispatchContext, row: AutomationQueueRow, channel: string, subject: string | null, sentTo: string | null, error: string | null, triggerName?: string): void {
  ctx.tdb.insert(schema.automationLog)
    .values({
      triggerKey: row.triggerKey,
      triggerName: triggerName ?? TRIGGER_LABELS[row.triggerKey] ?? row.triggerKey,
      channel,
      subject,
      sentTo,
      status: error ? "failed" : "sent",
      sentAt: new Date(ctx.now),
    })
    .run();
}

function isAddressSuppressed(tdb: TenantDb, email: string): boolean {
  const clean = email.trim().toLowerCase();
  return !!tdb.select({ id: schema.suppressions.id }).from(schema.suppressions).where(sql`lower(${schema.suppressions.email}) = ${clean}`).get();
}

async function sendWhatsAppRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  const transport = getFlowTransport();
  let error: string | null = null;
  let providerMessageId: string | null = null;
  if (item.leadId == null) error = "No lead to send to.";
  else if (!transport.whatsAppConnected()) error = WHATSAPP_NOT_CONNECTED;
  else {
    try {
      providerMessageId = (await transport.sendWhatsAppToLead(item.leadId, item.body)).providerMessageId;
    } catch (err) {
      error = err instanceof Error ? err.message : "WhatsApp send failed.";
    }
  }
  markRow(ctx.tdb, item.id, { status: error ? "failed" : "sent", error, sentAt: new Date(ctx.now), providerMessageId });
  logSend(ctx, item, "whatsapp", null, item.sendTo, error);
  if (error) console.error(`[lead flows] tenant ${ctx.tenantId} WhatsApp ${item.id} failed: ${error}`);
  return !error;
}

async function sendEmailRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  // Stopped between the batch query and this row: hold it, untouched.
  if (isStopped("email")) return false;
  if (!item.sendTo) {
    markRow(ctx.tdb, item.id, { status: "failed", error: "No email address." });
    return false;
  }
  if (isAddressSuppressed(ctx.tdb, item.sendTo)) {
    markRow(ctx.tdb, item.id, { status: "cancelled", error: "Not sent: this address unsubscribed, bounced or complained." });
    return false;
  }
  const subject = item.subject || `A message from ${ctx.businessName}`;
  const bodyHtml = textToParagraphs(item.body);
  const text = item.body;
  const html = renderEmailShell({ businessName: ctx.businessName, accent: ctx.accent, bodyHtml, footer: `Sent by ${ctx.businessName}.` });
  let error: string | null = null;
  try {
    const res = await getFlowTransport().sendEmail(ctx.tenantId, { to: item.sendTo, subject, html, text });
    if (!res.ok) error = res.error || "Send failed.";
  } catch (err) {
    error = err instanceof Error ? err.message : "Send failed.";
  }
  markRow(ctx.tdb, item.id, { status: error ? "failed" : "sent", error, sentAt: new Date(ctx.now) });
  logSend(ctx, item, "email", subject, item.sendTo, error);
  return !error;
}

async function sendMessageRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  // Sending hours: a row that became due outside them waits for the next window.
  const allowed = fitToWindow(ctx.now, item.channel, ctx.settings.window);
  if (allowed > ctx.now) {
    const notAfter = parsePayload(item.payload).notAfter;
    if (notAfter != null && allowed >= notAfter) {
      markRow(ctx.tdb, item.id, { status: "cancelled", error: "Too late: sending hours would put it after the call." });
      return false;
    }
    ctx.tdb.update(schema.automationQueue).set({ dueAt: new Date(allowed) }).where(eq(schema.automationQueue.id, item.id)).run();
    return false;
  }
  if (item.channel === "whatsapp") return sendWhatsAppRow(ctx, item);
  if (item.channel === "email") return sendEmailRow(ctx, item);
  markRow(ctx.tdb, item.id, { status: "failed", error: "This channel does not send." });
  return false;
}

async function runMoveRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  const { column } = parsePayload(item.payload);
  if (item.leadId == null || !column) {
    markRow(ctx.tdb, item.id, { status: "failed", error: "Nothing to move." });
    return false;
  }
  const lead = ctx.tdb.select({ pipelineId: schema.leads.pipelineId, stageId: schema.leads.stageId }).from(schema.leads).where(eq(schema.leads.id, item.leadId)).get();
  if (!lead) {
    markRow(ctx.tdb, item.id, { status: "cancelled", error: "Lead no longer exists." });
    return false;
  }
  // Loaded here: the stage writer imports the flows.
  const { listStages } = await import("@/lib/pipeline/stageRepo");
  const target = resolveColumn(column, listStages(lead.pipelineId));
  if (!target) {
    markRow(ctx.tdb, item.id, { status: "cancelled", error: "This board has no such column." });
    return false;
  }
  // Marked done first: entering the column may start a flow, which stops this run.
  markRow(ctx.tdb, item.id, { status: "sent", error: null, sentAt: new Date(ctx.now) });
  if (lead.stageId !== target.id) {
    const { writeStageId } = await import("@/lib/pipeline/stage");
    const label = TRIGGER_LABELS[item.triggerKey] ?? item.triggerKey;
    writeStageId(item.leadId, target.id, `Lead moved to ${target.name}: ${label} ended with no reply`, "automation");
  }
  return false;
}

async function unknownRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  markRow(ctx.tdb, item.id, { status: "failed", error: "Unknown queue row." });
  return false;
}

/** What each kind of row does when it is due. */
const HANDLERS: Record<string, RowHandler> = {
  message: sendMessageRow,
  move: runMoveRow,
};

function closeRunIfDone(tdb: TenantDb, runId: number, now: number): void {
  const left = tdb
    .select({ id: schema.automationQueue.id })
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.runId, runId), eq(schema.automationQueue.status, "queued")))
    .get();
  if (left) return;
  tdb.update(schema.leadFlowRuns)
    .set({ status: "finished", endedAt: new Date(now) })
    .where(and(eq(schema.leadFlowRuns.id, runId), eq(schema.leadFlowRuns.status, "active")))
    .run();
}

/** Send every due row for one tenant. Returns how many messages went to leads. */
export async function dispatchDueAutomationQueue(tenantId: number, now: number = flowNow(), baseUrl?: string): Promise<number> {
  return runWithTenant(tenantId, () => dispatchBound(tenantId, now, baseUrl));
}

async function dispatchBound(tenantId: number, now: number, baseUrl?: string): Promise<number> {
  const tdb = getTenantDbById(tenantId);
  // The platform "Email sending" switch holds the email rows exactly as they
  // are, kept out of the batch so they cannot crowd the WhatsApp rows out.
  const emailHeld = isStopped("email");
  const due = tdb
    .select()
    .from(schema.automationQueue)
    .where(
      and(
        eq(schema.automationQueue.status, "queued"),
        lte(schema.automationQueue.dueAt, new Date(now)),
        ...(emailHeld ? [ne(schema.automationQueue.channel, "email")] : []),
      ),
    )
    .orderBy(asc(schema.automationQueue.dueAt))
    .limit(BATCH)
    .all();
  if (due.length === 0) return 0;

  // A lead that has been deleted, or has since said no, is not written to.
  const leadIds = [...new Set(due.map((d) => d.leadId).filter((id): id is number => id != null))];
  const leadRows = leadIds.length
    ? tdb.select({ id: schema.leads.id, status: schema.leads.status }).from(schema.leads).where(inArray(schema.leads.id, leadIds)).all()
    : [];
  const leadStatus = new Map(leadRows.map((l) => [l.id, l.status]));

  let resolvedBase = baseUrl;
  if (!resolvedBase) {
    try {
      resolvedBase = getAppBaseUrl();
    } catch {
      resolvedBase = "http://localhost:3000";
    }
  }
  const ctx: DispatchContext = {
    tenantId,
    tdb,
    now,
    baseUrl: resolvedBase.replace(/\/+$/, ""),
    settings: getLeadFlowSettingsForTenant(tenantId),
    businessName: getBusinessProfileForTenant(tenantId).businessName,
    accent: getThemeForTenant(tenantId).accent,
  };

  let sent = 0;
  for (const item of due) {
    if (item.leadId != null) {
      const status = leadStatus.get(item.leadId);
      if (status === undefined || status === "lost") {
        markRow(tdb, item.id, { status: "cancelled", error: status === undefined ? "Lead no longer exists." : "Lead marked lost." });
        if (item.runId != null) closeRunIfDone(tdb, item.runId, now);
        continue;
      }
    }
    const handler = HANDLERS[item.kind] ?? unknownRow;
    try {
      if (await handler(ctx, item)) sent++;
    } catch (err) {
      console.error(`[lead flows] tenant ${tenantId} row ${item.id} failed:`, err);
      markRow(tdb, item.id, { status: "failed", error: err instanceof Error ? err.message.slice(0, 300) : "Failed." });
    }
    if (item.runId != null) closeRunIfDone(tdb, item.runId, now);
  }
  return sent;
}
```

- [ ] **Step 5: Point the facade and the ticker at it**

In `app/src/lib/automations/nurture.ts`, delete `const BATCH = 25;` and the whole old `dispatchDueAutomationQueue` function, remove the imports only it used (`inArray`, `lte`, `ne`, `getTenantDbById`, `TRIGGER_LABELS`, `inSendingHours`, `getBusinessProfileForTenant`, `getThemeForTenant`, `renderEmailShell`, `sendEmailForTenant`, `textToParagraphs`, `isStopped`), and add at the end:

```ts
// The dispatch lives with the engine now.
export { dispatchDueAutomationQueue } from "@/lib/leadFlows/dispatch";
```

In `app/src/lib/dispatch/ticker.ts`, change the nurture line to:

```ts
      summary.nurtureSent += await dispatchDueAutomationQueue(tenantId, Date.now(), baseUrl);
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- src/lib/leadFlows/dispatch.test.ts`
Expected: PASS, `dispatch: 13 checks passed.`
Run: `npm test -- src/lib/automations/leadSequences.test.ts`, `npm test -- src/lib/automations/nurtureKillSwitch.test.ts`, `npm test -- src/lib/dispatch/dispatch.test.ts`
Expected: PASS (the real transport fails with no provider exactly as the old dispatch did).
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/leadFlows/transport.ts app/src/lib/leadFlows/dispatch.ts app/src/lib/leadFlows/dispatch.test.ts app/src/lib/leadFlows/testing/harness.ts app/src/lib/automations/nurture.ts app/src/lib/dispatch/ticker.ts
git commit -m "feat(lead-flows): dispatch inside sending hours, finish moves, closed runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Marketing consent, the unsubscribe link and stopping on unsubscribe

**Files:**
- Modify: `app/src/lib/db/schema.ts` (`leads.marketingConsentAt`, `leads.marketingConsentSource`)
- Modify: `app/src/lib/db/tenant.ts` (two lines in the lead-flows block)
- Create: `app/src/lib/leadFlows/consentModel.ts` (pure), `app/src/lib/leadFlows/consent.ts`
- Modify: `app/src/lib/leadFlows/runs.ts` (nurture needs consent)
- Modify: `app/src/lib/leadFlows/dispatch.ts` (nurture emails: consent check and unsubscribe link)
- Modify: `app/src/lib/marketing/suppress.ts` (call the hook)
- Modify: `app/src/lib/leads.ts` (`NormalizedLeadInput.marketingConsent`)
- Modify: `app/src/app/api/leads/inbound/route.ts` (accept `marketingConsent`)
- Create: `app/src/app/leads/callActions.ts` (first action: consent)
- Test: `app/src/lib/leadFlows/consent.test.ts`

**Interfaces:**
- Consumes: Tasks 6-8; `createUnsubscribeToken` (`lib/marketing/unsubscribeToken`); `suppress` (`lib/marketing/suppress`).
- Produces:
  - schema `leads.marketingConsentAt: integer("marketing_consent_at")` (epoch ms, null = no consent), `leads.marketingConsentSource: text("marketing_consent_source")`
  - `consentModel.ts`: `type ConsentSource = "staff" | "form" | "api"`, `isConsentYes(v: unknown): boolean`
  - `consent.ts`: `setLeadMarketingConsent(leadId: number, granted: boolean, source: ConsentSource): { ok: true } | { ok: false; error: string }`, `ensureLeadContact(conn: TenantDb, lead: { email: string; firstName: string | null; lastName: string | null; phone: string | null }): number`, `unsubscribeUrl(conn: TenantDb, tenantId: number, baseUrl: string, lead: {...}): string`, `onEmailSuppressed(tenantId: number, email: string, reason: SuppressionReason): void`
  - `NormalizedLeadInput.marketingConsent?: ConsentSource | null`
  - `callActions.ts`: `type ActionResult = { ok: true; message?: string } | { ok: false; error: string }`, `setLeadMarketingConsentAction(leadId: number, granted: boolean): Promise<ActionResult>`

- [ ] **Step 1: Schema**

In `app/src/lib/db/schema.ts`, in `leads`, after `hotReason`:

```ts
  /**
   * When the lead agreed to marketing (news and offers), epoch ms; null = no.
   * Only the Long-term nurture flow needs it (lib/leadFlows/consent.ts).
   * Cleared by an unsubscribe.
   */
  marketingConsentAt: integer("marketing_consent_at"),
  /** How it was given: "form", "api" (a lead posted in with it), or "staff". */
  marketingConsentSource: text("marketing_consent_source"),
```

In `app/src/lib/db/tenant.ts`, in the lead-flows block, replace the `// Later lead-flow columns go here.` line with:

```ts
    addColumn("leads", "marketing_consent_at", "marketing_consent_at INTEGER");
    addColumn("leads", "marketing_consent_source", "marketing_consent_source TEXT");
    // Later lead-flow columns go here.
```

- [ ] **Step 2: Write the failing test**

Create `app/src/lib/leadFlows/consent.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/consent.test.ts
//
// Marketing consent for leads, against a scratch tenant with a fake sender:
// Long-term nurture needs it; consenting adds the address to Contacts; every
// nurture email carries the signed unsubscribe link; an unsubscribe clears
// consent and stops the flows; a staff tick never overrides an unsubscribe;
// a bounce only stops the emails; a lead posted in with consent has it.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq, sql } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead, getLead } = requireLocal("../leads") as typeof import("../leads");
  const runs = requireLocal("./runs") as typeof import("./runs");
  const consent = requireLocal("./consent") as typeof import("./consent");
  const { isConsentYes } = requireLocal("./consentModel") as typeof import("./consentModel");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");
  const { suppress } = requireLocal("../marketing/suppress") as typeof import("../marketing/suppress");
  const { parseUnsubscribeToken } = requireLocal("../marketing/unsubscribeToken") as typeof import("../marketing/unsubscribeToken");

  const s = h.makeScratchTenant("lead-flow-consent-test");
  const fake = h.installFakeTransport();
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const WED_10 = Date.parse("2030-01-16T10:00:00Z");
      h.fakeClock(WED_10);
      const queued = (leadId: number) =>
        tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"))).all();
      h.setFlowEnabled(s.tid, "lead_nurture", true);
      h.setFlowEnabled(s.tid, "lead_no_answer", true);

      ok(isConsentYes(true) && isConsentYes("Yes") && isConsentYes("1") && isConsentYes("on"), "yes in its usual forms");
      ok(!isConsentYes(false) && !isConsentYes("no") && !isConsentYes(undefined) && !isConsentYes(""), "and nothing else");

      const { lead } = upsertLead({ source: "manual", fullName: "Con Sent", email: "consent@example.com", phone: "+353870000006" });
      ok(runs.startFlow(lead.id, "lead_nurture").skipped === "no marketing consent", "no consent: no nurture");

      ok(consent.setLeadMarketingConsent(lead.id, true, "staff").ok, "staff records a yes");
      ok(getLead(lead.id)!.marketingConsentAt === WED_10 && getLead(lead.id)!.marketingConsentSource === "staff", "when and how are kept");
      const contact = tdb.select().from(schema.contacts).where(sql`lower(${schema.contacts.email}) = 'consent@example.com'`).get();
      ok(!!contact && JSON.parse(contact.tags ?? "[]").includes("leads") && contact.status === "subscribed", "the address joins Contacts, tagged leads");

      // The nurture email carries the signed unsubscribe link.
      ok(runs.startFlow(lead.id, "lead_nurture").runId != null, "with consent, nurture starts");
      await dispatchDueAutomationQueue(s.tid, WED_10, "http://app.test");
      const email = fake.sent.find((x) => x.to === "email");
      ok(!!email, "the first nurture email went");
      const link = /http:\/\/app\.test\/u\/([A-Za-z0-9_\-.]+)/.exec(email!.html ?? "");
      ok(!!link && parseUnsubscribeToken(link[1])?.contactId === contact!.id, "its link is a valid token for this contact");
      ok(/Unsubscribe: http:\/\/app\.test\/u\//.test(email!.text ?? ""), "and the plain-text part has it too");

      // An unsubscribe clears consent and stops the flows.
      runs.startFlow(lead.id, "lead_no_answer");
      suppress(s.tid, "consent@example.com", "unsubscribe");
      ok(getLead(lead.id)!.marketingConsentAt === null, "consent cleared");
      ok(queued(lead.id).length === 0, "every flow stopped");
      ok(!consent.setLeadMarketingConsent(lead.id, true, "staff").ok, "a staff tick cannot override their unsubscribe");
      ok(consent.setLeadMarketingConsent(lead.id, true, "form").ok && getLead(lead.id)!.marketingConsentAt !== null, "a fresh yes from them can");
      ok(!tdb.select().from(schema.suppressions).where(sql`lower(${schema.suppressions.email}) = 'consent@example.com'`).get(), "and lifts the unsubscribe");

      // A bounce stops the emails only.
      runs.startFlow(lead.id, "lead_nurture");
      runs.startFlow(lead.id, "lead_no_answer");
      tdb.insert(schema.automationQueue).values({ triggerKey: "lead_no_answer", leadId: lead.id, kind: "message", channel: "email", subject: "x", body: "x", sendTo: "consent@example.com", dueAt: new Date(WED_10 + 60_000) }).run();
      suppress(s.tid, "consent@example.com", "bounce");
      ok(queued(lead.id).every((q) => q.channel !== "email") && queued(lead.id).some((q) => q.channel === "whatsapp"), "a bounce cancels the emails and leaves the WhatsApps");
      ok(getLead(lead.id)!.marketingConsentAt !== null, "a bounce is not an unsubscribe");

      // No secret, no marketing email.
      tdb.delete(schema.suppressions).run();
      const { lead: noSecret } = upsertLead({ source: "manual", fullName: "No Secret", email: "nosecret@example.com" });
      consent.setLeadMarketingConsent(noSecret.id, true, "api");
      runs.startFlow(noSecret.id, "lead_nurture");
      const saved = process.env.EMAIL_TOKEN_SECRET;
      delete process.env.EMAIL_TOKEN_SECRET;
      await dispatchDueAutomationQueue(s.tid, WED_10 + 1, "http://app.test");
      process.env.EMAIL_TOKEN_SECRET = saved;
      const blocked = tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, noSecret.id), eq(schema.automationQueue.status, "failed"))).get();
      ok(!!blocked && /unsubscribe link/i.test(blocked.error ?? ""), "without the unsubscribe secret a nurture email is never sent");

      // Withdrawn consent stops nurture.
      consent.setLeadMarketingConsent(noSecret.id, false, "staff");
      ok(queued(noSecret.id).length === 0, "a no stops Long-term nurture");

      // Posted in with consent.
      const { lead: posted } = upsertLead({ source: "website", sourceLeadId: "website:posted@example.com", fullName: "Posted In", email: "posted@example.com", marketingConsent: "api" });
      ok(getLead(posted.id)!.marketingConsentSource === "api", "a lead posted in with consent has it");
    });
    console.log(`consent: ${n} checks passed.`);
  } finally {
    fake.restore();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- src/lib/leadFlows/consent.test.ts`
Expected: FAIL, "Cannot find module './consent'".

- [ ] **Step 4: Write `consentModel.ts` and `consent.ts`**

Create `app/src/lib/leadFlows/consentModel.ts`:

```ts
/** Marketing consent for leads, the pure part. */

export type ConsentSource = "staff" | "form" | "api";

const YES = new Set(["true", "yes", "y", "1", "on", "agreed", "agree"]);

/** Whether a posted value means yes (true, 1, "yes", "on"...). Anything else is no. */
export function isConsentYes(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === "string") return YES.has(v.trim().toLowerCase());
  return false;
}
```

Create `app/src/lib/leadFlows/consent.ts`:

```ts
import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { runWithTenant, type TenantDb } from "@/lib/db/tenant";
import { KEEP_ON_REPLY } from "@/lib/automationModel";
import type { SuppressionReason } from "@/lib/marketing/suppress";
import { createUnsubscribeToken } from "@/lib/marketing/unsubscribeToken";

import { flowNow } from "./clock";
import type { ConsentSource } from "./consentModel";
import { NURTURE_FLOW } from "./flowModel";
import { stopFlows } from "./runs";

/**
 * A lead's yes or no to marketing (news and offers). Only Long-term nurture
 * checks it. A yes puts the address on Email campaigns > Contacts, tagged
 * "leads", so the lead keeps getting the normal campaigns after nurture ends
 * and the signed unsubscribe link has a contact to point at.
 */

function clean(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function suppressionReason(conn: TenantDb, email: string): string | null {
  return conn.select({ reason: schema.suppressions.reason }).from(schema.suppressions).where(sql`lower(${schema.suppressions.email}) = ${clean(email)}`).get()?.reason ?? null;
}

/** The marketing contact for an address, created subscribed and tagged "leads" when missing. */
export function ensureLeadContact(conn: TenantDb, lead: { email: string; firstName: string | null; lastName: string | null; phone: string | null }): number {
  const email = clean(lead.email);
  const found = conn.select({ id: schema.contacts.id, tags: schema.contacts.tags }).from(schema.contacts).where(sql`lower(${schema.contacts.email}) = ${email}`).get();
  if (found) {
    let tags: string[] = [];
    try {
      tags = JSON.parse(found.tags ?? "[]") as string[];
    } catch {
      tags = [];
    }
    if (!tags.includes("leads")) conn.update(schema.contacts).set({ tags: JSON.stringify([...tags, "leads"]), updatedAt: new Date() }).where(eq(schema.contacts.id, found.id)).run();
    return found.id;
  }
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || null;
  return conn
    .insert(schema.contacts)
    .values({ email, name, phone: lead.phone, tags: JSON.stringify(["leads"]), status: "subscribed", source: "lead", subscribedAt: new Date() })
    .returning({ id: schema.contacts.id })
    .get().id;
}

/** The signed unsubscribe link for a lead's address. Throws when EMAIL_TOKEN_SECRET is not set. */
export function unsubscribeUrl(conn: TenantDb, tenantId: number, baseUrl: string, lead: { email: string; firstName: string | null; lastName: string | null; phone: string | null }): string {
  const contactId = ensureLeadContact(conn, lead);
  return `${baseUrl}/u/${createUnsubscribeToken(tenantId, contactId)}`;
}

/** Record a yes or a no, for the ambient tenant. A staff tick never overrides the person's own unsubscribe. */
export function setLeadMarketingConsent(leadId: number, granted: boolean, source: ConsentSource): { ok: true } | { ok: false; error: string } {
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!lead) return { ok: false, error: "Lead not found." };
  if (!granted) {
    db.update(schema.leads).set({ marketingConsentAt: null, marketingConsentSource: null }).where(eq(schema.leads.id, leadId)).run();
    stopFlows(leadId, "marketing consent withdrawn", { only: [NURTURE_FLOW] });
    return { ok: true };
  }
  if (lead.email) {
    const reason = suppressionReason(db, lead.email);
    if (reason === "unsubscribe" || reason === "manual") {
      if (source === "staff") {
        return { ok: false, error: "This address unsubscribed from emails. They need to agree again themselves, on a form or in a message." };
      }
      // A fresh yes from the person lifts their earlier unsubscribe (never a bounce or a complaint).
      db.delete(schema.suppressions).where(sql`lower(${schema.suppressions.email}) = ${clean(lead.email)}`).run();
      db.update(schema.contacts)
        .set({ status: "subscribed", subscribedAt: new Date(), unsubscribedAt: null, updatedAt: new Date() })
        .where(sql`lower(${schema.contacts.email}) = ${clean(lead.email)}`)
        .run();
    }
  }
  db.update(schema.leads).set({ marketingConsentAt: flowNow(), marketingConsentSource: source }).where(eq(schema.leads.id, leadId)).run();
  if (lead.email) ensureLeadContact(db, { email: lead.email, firstName: lead.firstName, lastName: lead.lastName, phone: lead.phone });
  return { ok: true };
}

/**
 * An address was suppressed (lib/marketing/suppress.ts): nothing more is
 * mailed to it by any flow. An unsubscribe, complaint or manual suppression
 * also clears the lead's consent and stops their flows (a booked call's
 * messages carry on). A bounce only stops the emails.
 */
export function onEmailSuppressed(tenantId: number, email: string, reason: SuppressionReason): void {
  const address = clean(email);
  if (!address) return;
  runWithTenant(tenantId, () => {
    db.update(schema.automationQueue)
      .set({ status: "cancelled", error: reason === "bounce" ? "Not sent: emails to this address bounced." : "Not sent: this address unsubscribed." })
      .where(and(eq(schema.automationQueue.status, "queued"), eq(schema.automationQueue.channel, "email"), sql`lower(${schema.automationQueue.sendTo}) = ${address}`))
      .run();
    if (reason === "bounce") return;
    const leads = db.select({ id: schema.leads.id }).from(schema.leads).where(sql`lower(${schema.leads.email}) = ${address}`).all();
    for (const l of leads) {
      db.update(schema.leads).set({ marketingConsentAt: null, marketingConsentSource: null }).where(eq(schema.leads.id, l.id)).run();
      stopFlows(l.id, "unsubscribed", { except: KEEP_ON_REPLY });
    }
  });
}
```

- [ ] **Step 5: Gate nurture on consent, add the link, call the hook**

In `app/src/lib/leadFlows/runs.ts`, import `NURTURE_FLOW` from `./flowModel` and, in `startFlow`, directly after the `if (triggerKey === CALL_BOOKED_FLOW && opts.callAt == null)` line, add:

```ts
  // Long-term nurture is marketing: only for leads who agreed to it.
  if (triggerKey === NURTURE_FLOW && lead.marketingConsentAt == null) return skip("no marketing consent");
```

In `app/src/lib/leadFlows/dispatch.ts`:

Add imports:

```ts
import { escapeHtml } from "@/lib/email";
import { unsubscribeUrl } from "./consent";
import { NURTURE_FLOW } from "./flowModel";
```

(merge `escapeHtml` into the existing `@/lib/email` import and `NURTURE_FLOW` into the existing `./flowModel` import.) In `sendEmailRow`, replace the two lines `const bodyHtml = textToParagraphs(item.body);` and `const text = item.body;` with:

```ts
  let bodyHtml = textToParagraphs(item.body);
  let text = item.body;
  // Long-term nurture is marketing: still agreed to, and every email carries the signed unsubscribe link.
  if (item.triggerKey === NURTURE_FLOW) {
    const lead = item.leadId == null
      ? undefined
      : ctx.tdb
          .select({ marketingConsentAt: schema.leads.marketingConsentAt, firstName: schema.leads.firstName, lastName: schema.leads.lastName, phone: schema.leads.phone })
          .from(schema.leads)
          .where(eq(schema.leads.id, item.leadId))
          .get();
    if (!lead || lead.marketingConsentAt == null) {
      markRow(ctx.tdb, item.id, { status: "cancelled", error: "Not sent: no marketing consent." });
      return false;
    }
    let url: string;
    try {
      url = unsubscribeUrl(ctx.tdb, ctx.tenantId, ctx.baseUrl, { email: item.sendTo, firstName: lead.firstName, lastName: lead.lastName, phone: lead.phone });
    } catch (err) {
      const error = `Can't add the unsubscribe link: ${err instanceof Error ? err.message : "unknown error"}`.slice(0, 300);
      markRow(ctx.tdb, item.id, { status: "failed", error, sentAt: new Date(ctx.now) });
      logSend(ctx, item, "email", item.subject, item.sendTo, error);
      return false;
    }
    bodyHtml += `<p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Don't want these emails? <a href="${escapeHtml(url)}" style="color:#9ca3af;">Unsubscribe</a>.</p>`;
    text += `\n\nUnsubscribe: ${url}`;
  }
```

In `app/src/lib/marketing/suppress.ts`, add `import { onEmailSuppressed } from "@/lib/leadFlows/consent";` and at the end of `suppress()` (after the contacts update):

```ts
  // Lead follow-up flows: nothing more is mailed to this address, and an
  // unsubscribe stops the lead's flows too. Never breaks the suppression.
  try {
    onEmailSuppressed(tenantId, clean, reason);
  } catch (err) {
    console.error("[marketing] lead flows not updated for a suppressed address:", err);
  }
```

- [ ] **Step 6: Consent on intake**

In `app/src/lib/leads.ts`:

Add `import { setLeadMarketingConsent } from "./leadFlows/consent";` and `import type { ConsentSource } from "./leadFlows/consentModel";`.

Add to `NormalizedLeadInput`:

```ts
  /** They agreed to marketing on the form or in the integration that sent them; how. Omitted = not asked. */
  marketingConsent?: ConsentSource | null;
```

In `upsertLead`, replace `if (existing) return { lead: existing, created: false };` with:

```ts
    if (existing) {
      if (input.marketingConsent && existing.marketingConsentAt == null) recordIntakeConsent(existing.id, input.marketingConsent);
      return { lead: existing, created: false };
    }
```

and directly after `const lead = inserted[0];` add:

```ts
  if (input.marketingConsent) recordIntakeConsent(lead.id, input.marketingConsent);
```

Add near `nz` at the bottom of the file:

```ts
/** Fail-soft: a consent problem never costs the lead. */
function recordIntakeConsent(leadId: number, source: ConsentSource): void {
  try {
    setLeadMarketingConsent(leadId, true, source);
  } catch (err) {
    console.error(`[leads] marketing consent not recorded for lead #${leadId}:`, err);
  }
}
```

(The `lead` object returned from the create path is the row as inserted; callers that need the consent field re-read it.)

In `app/src/app/api/leads/inbound/route.ts`, add `import { isConsentYes } from "@/lib/leadFlows/consentModel";`, add to the zod body schema (next to `therapyInterest`):

```ts
  marketingConsent: z.union([z.boolean(), z.string(), z.number()]).optional().nullable(),
```

and pass to `upsertLead` (next to `therapyInterest: parsed.data.therapyInterest,`):

```ts
      marketingConsent: isConsentYes(parsed.data.marketingConsent) ? "api" : null,
```

Add one line to the route's header doc comment listing the payload fields: `"marketingConsent": true    // optional: they agreed to news and offers (Long-term nurture needs it)`.

- [ ] **Step 7: The staff action**

Create `app/src/app/leads/callActions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { setLeadMarketingConsent } from "@/lib/leadFlows/consent";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const leadIdSchema = z.number().int().positive();

/** Staff record that a lead agreed (or no longer agrees) to marketing. */
export async function setLeadMarketingConsentAction(leadId: number, granted: boolean): Promise<ActionResult> {
  await requireUser();
  const id = leadIdSchema.safeParse(leadId);
  if (!id.success) return { ok: false, error: "Lead not found." };
  const res = setLeadMarketingConsent(id.data, Boolean(granted), "staff");
  revalidatePath(`/leads/${id.data}`);
  return res.ok ? { ok: true, message: granted ? "Marked as agreed to marketing." : "Marketing consent removed." } : res;
}
```

- [ ] **Step 8: Run the tests**

Run: `npm test -- src/lib/leadFlows/consent.test.ts`
Expected: PASS, `consent: 20 checks passed.`
Run: `npm test -- src/lib/leadFlows/dispatch.test.ts`, `npm test -- src/lib/leadFlows/runs.test.ts`, and every existing suppression/unsubscribe test: `npm test -- src/lib/marketing/suppress.test.ts` if it exists (find them with `ls src/lib/marketing/*.test.ts src/app/u/*/*.test.ts 2>/dev/null`) .
Expected: PASS.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/db/schema.ts app/src/lib/db/tenant.ts app/src/lib/leadFlows/consentModel.ts app/src/lib/leadFlows/consent.ts app/src/lib/leadFlows/consent.test.ts app/src/lib/leadFlows/runs.ts app/src/lib/leadFlows/dispatch.ts app/src/lib/marketing/suppress.ts app/src/lib/leads.ts app/src/app/api/leads/inbound/route.ts app/src/app/leads/callActions.ts
git commit -m "feat(lead-flows): marketing consent for leads, unsubscribe link, stop on unsubscribe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Undelivered first WhatsApp goes to email

**Files:**
- Create: `app/src/lib/leadFlows/undelivered.ts`
- Modify: `app/src/lib/leadFlows/dispatch.ts` (call it when a send throws on a connected WhatsApp)
- Modify: `app/src/app/api/whatsapp/webhook/route.ts` (call it on a `failed` delivery status)
- Test: `app/src/lib/leadFlows/undelivered.test.ts`

**Interfaces:**
- Consumes: `markRow`, the `sendWhatsAppRow` path (Task 8); `writeStageId` (stage.ts); `addMessage` (leads.ts); `listStages`.
- Produces:
  - `isFirstWhatsAppOfRun(tdb: TenantDb, row: AutomationQueueRow): boolean`
  - `handleUndelivered(tenantId: number, row: AutomationQueueRow, reason: string): Promise<void>`
  - `onWhatsAppDeliveryFailed(tenantId: number, providerMessageId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/leadFlows/undelivered.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/undelivered.test.ts
//
// When a flow's first WhatsApp can't be delivered (the send fails, or the
// provider later reports it failed), the card moves to Message undelivered
// and the rest of the flow goes by email. Only the first WhatsApp of a run
// counts, a repeated status changes nothing, no email means the WhatsApps
// stop, and WhatsApp not being connected is never treated as undelivered.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead, getLead, getLeadMessages } = requireLocal("../leads") as typeof import("../leads");
  const { activeRun } = requireLocal("./runs") as typeof import("./runs");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");
  const { onWhatsAppDeliveryFailed } = requireLocal("./undelivered") as typeof import("./undelivered");
  const { listStages } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");

  const s = h.makeScratchTenant("lead-flow-undelivered-test");
  let fake = h.installFakeTransport();
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const DAY = 86_400_000;
      const WED_10 = Date.parse("2030-01-16T10:00:00Z");
      const clock = h.fakeClock(WED_10);
      const dispatch = (at: number) => dispatchDueAutomationQueue(s.tid, at, "http://app.test");
      const msgRows = (leadId: number) =>
        tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.kind, "message"))).all();
      const notes = (leadId: number) => getLeadMessages(leadId).filter((m) => m.direction === "note");
      const undelivered = listStages().find((c) => c.systemKey === "undelivered")!;

      h.setFlowEnabled(s.tid, "new_lead", true);
      tdb.insert(schema.automationMessages)
        .values([
          { triggerKey: "new_lead", position: 0, channel: "whatsapp", template: "Hi [FIRST_NAME], thanks for getting in touch.", delayValue: 0, delayUnit: "days" },
          { triggerKey: "new_lead", position: 1, channel: "email", subject: "Thanks", template: "Hi [FIRST_NAME], thanks for your enquiry.", delayValue: 0, delayUnit: "days" },
          { triggerKey: "new_lead", position: 2, channel: "whatsapp", template: "Just checking you saw our message.", delayValue: 2, delayUnit: "days" },
          { triggerKey: "new_lead", position: 3, channel: "whatsapp", template: "Any questions, ask here.", delayValue: 4, delayUnit: "days" },
        ])
        .run();
      const enquiry = (tag: string, contact: { email?: string; phone?: string }) =>
        upsertLead({ source: "website", sourceLeadId: `website:${tag}`, fullName: `Lead ${tag}`, ...contact }).lead;

      // The send fails on the first WhatsApp.
      const one = enquiry("one", { email: "one@example.com", phone: "+353870000011" });
      fake.failWhatsAppFor.add(one.id);
      await dispatch(WED_10);
      ok(getLead(one.id)!.stageId === undelivered.id, "moved to Message undelivered");
      const rest = msgRows(one.id).filter((r) => r.status === "queued");
      ok(rest.length === 2 && rest.every((r) => r.channel === "email" && r.sendTo === "one@example.com" && !!r.subject), "the remaining WhatsApps go by email");
      ok(fake.sent.some((x) => x.to === "email" && x.address === "one@example.com"), "the welcome email still went");
      ok(notes(one.id).some((m) => /could not be delivered/.test(m.content)), "a note on the lead says so");
      ok(activeRun(one.id, "new_lead") !== null, "the flow keeps going");

      // The provider reports a sent first WhatsApp as failed.
      const two = enquiry("two", { email: "two@example.com", phone: "+353870000012" });
      await dispatch(WED_10 + 1);
      const firstWa = msgRows(two.id).find((r) => r.channel === "whatsapp" && r.status === "sent")!;
      ok(!!firstWa.providerMessageId && getLead(two.id)!.stageId !== undelivered.id, "sent, not moved yet");
      await onWhatsAppDeliveryFailed(s.tid, firstWa.providerMessageId!);
      ok(getLead(two.id)!.stageId === undelivered.id, "a failed delivery status moves the card");
      await onWhatsAppDeliveryFailed(s.tid, firstWa.providerMessageId!);
      ok(notes(two.id).length === 1, "the same status twice changes nothing more");

      // A later WhatsApp failing does not count.
      const three = enquiry("three", { email: "three@example.com", phone: "+353870000013" });
      await dispatch(WED_10 + 2);
      fake.failWhatsAppFor.add(three.id);
      clock.set(WED_10 + 2 * DAY);
      await dispatch(WED_10 + 2 * DAY);
      ok(msgRows(three.id).some((r) => r.channel === "whatsapp" && r.status === "failed") && getLead(three.id)!.stageId !== undelivered.id, "a later WhatsApp failing does not move the card");

      // No email: the WhatsApps stop.
      const four = enquiry("four", { phone: "+353870000014" });
      fake.failWhatsAppFor.add(four.id);
      await dispatch(WED_10 + 2 * DAY + 1);
      ok(msgRows(four.id).filter((r) => r.status === "queued").length === 0 && getLead(four.id)!.stageId === undelivered.id, "no email address: moved, and the WhatsApps stop");

      // WhatsApp not connected is not undelivered.
      fake.restore();
      fake = h.installFakeTransport({ connected: false });
      const five = enquiry("five", { email: "five@example.com", phone: "+353870000015" });
      await dispatch(WED_10 + 2 * DAY + 2);
      ok(getLead(five.id)!.stageId !== undelivered.id && msgRows(five.id).some((r) => r.status === "failed"), "not connected: a visible failure, no move");
    });
    console.log(`undelivered: ${n} checks passed.`);
  } finally {
    fake.restore();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/leadFlows/undelivered.test.ts`
Expected: FAIL, "Cannot find module './undelivered'".

- [ ] **Step 3: Write `undelivered.ts`**

Create `app/src/lib/leadFlows/undelivered.ts`:

```ts
import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { schema } from "@/lib/db";
import { getTenantDbById, type TenantDb } from "@/lib/db/tenant";
import type { AutomationQueueRow } from "@/lib/db/schema";
import { TRIGGER_LABELS } from "@/lib/automationModel";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";

/**
 * A flow's first WhatsApp could not be delivered: the card moves to Message
 * undelivered, and the rest of the flow goes by email when the lead has an
 * address (otherwise the WhatsApps stop). Called from the dispatch (the
 * send threw on a connected WhatsApp) and the WhatsApp webhook (a "failed"
 * delivery status). Runs in the ambient tenant (both callers bind it).
 */

const MARK = "Undelivered:";

/** Whether this row is its run's first WhatsApp message. */
export function isFirstWhatsAppOfRun(tdb: TenantDb, row: AutomationQueueRow): boolean {
  if (row.runId == null || row.step == null || row.channel !== "whatsapp" || row.kind !== "message") return false;
  const first = tdb
    .select({ step: schema.automationQueue.step })
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.runId, row.runId), eq(schema.automationQueue.kind, "message"), eq(schema.automationQueue.channel, "whatsapp")))
    .orderBy(asc(schema.automationQueue.step))
    .limit(1)
    .get();
  return first?.step === row.step;
}

export async function handleUndelivered(tenantId: number, row: AutomationQueueRow, reason: string): Promise<void> {
  const tdb = getTenantDbById(tenantId);
  if (row.leadId == null || !isFirstWhatsAppOfRun(tdb, row)) return;
  // Once per message: a webhook can report the same failure twice.
  const current = tdb.select({ error: schema.automationQueue.error }).from(schema.automationQueue).where(eq(schema.automationQueue.id, row.id)).get();
  if (current?.error?.startsWith(MARK)) return;
  tdb.update(schema.automationQueue).set({ status: "failed", error: `${MARK} ${reason}`.slice(0, 300) }).where(eq(schema.automationQueue.id, row.id)).run();

  const lead = tdb
    .select({ id: schema.leads.id, email: schema.leads.email, pipelineId: schema.leads.pipelineId, stageId: schema.leads.stageId })
    .from(schema.leads)
    .where(eq(schema.leads.id, row.leadId))
    .get();
  if (!lead) return;
  const label = TRIGGER_LABELS[row.triggerKey] ?? row.triggerKey;
  const business = getBusinessProfileForTenant(tenantId).businessName;

  const rest = tdb
    .select({ id: schema.automationQueue.id })
    .from(schema.automationQueue)
    .where(
      and(
        eq(schema.automationQueue.runId, row.runId!),
        eq(schema.automationQueue.status, "queued"),
        eq(schema.automationQueue.kind, "message"),
        eq(schema.automationQueue.channel, "whatsapp"),
      ),
    )
    .all()
    .map((r) => r.id);
  if (rest.length > 0) {
    if (lead.email) {
      tdb.update(schema.automationQueue)
        .set({ channel: "email", sendTo: lead.email, subject: `A message from ${business}` })
        .where(inArray(schema.automationQueue.id, rest))
        .run();
    } else {
      tdb.update(schema.automationQueue)
        .set({ status: "cancelled", error: "WhatsApp undelivered and no email address." })
        .where(inArray(schema.automationQueue.id, rest))
        .run();
    }
  }

  // Loaded here: the stage writer and leads import the flows.
  const { listStages } = await import("@/lib/pipeline/stageRepo");
  const target = listStages(lead.pipelineId).find((s) => s.systemKey === "undelivered");
  if (target && lead.stageId !== target.id) {
    const { writeStageId } = await import("@/lib/pipeline/stage");
    writeStageId(lead.id, target.id, `Lead moved to ${target.name}: the first WhatsApp of ${label} was not delivered`, "automation");
  }
  const { addMessage } = await import("@/lib/leads");
  addMessage({
    leadId: lead.id,
    direction: "note",
    channel: "system",
    content: lead.email
      ? `The first WhatsApp of the ${label} follow-up could not be delivered. The rest of it goes by email.`
      : `The first WhatsApp of the ${label} follow-up could not be delivered, and there is no email address, so its WhatsApps are stopped.`,
  });
}

/** The WhatsApp webhook reported a message as failed. */
export async function onWhatsAppDeliveryFailed(tenantId: number, providerMessageId: string): Promise<void> {
  const tdb = getTenantDbById(tenantId);
  const row = tdb.select().from(schema.automationQueue).where(eq(schema.automationQueue.providerMessageId, providerMessageId)).get();
  if (!row) return;
  await handleUndelivered(tenantId, row, "WhatsApp reported the message as failed.");
}
```

- [ ] **Step 4: Call it from the dispatch and the webhook**

In `app/src/lib/leadFlows/dispatch.ts`, add `import { handleUndelivered } from "./undelivered";`, and in `sendWhatsAppRow` change the `catch` and the end of the function so a provider failure on a connected WhatsApp is handled:

```ts
  let undeliverable = false;
  if (item.leadId == null) error = "No lead to send to.";
  else if (!transport.whatsAppConnected()) error = WHATSAPP_NOT_CONNECTED;
  else {
    try {
      providerMessageId = (await transport.sendWhatsAppToLead(item.leadId, item.body)).providerMessageId;
    } catch (err) {
      error = err instanceof Error ? err.message : "WhatsApp send failed.";
      undeliverable = true;
    }
  }
  markRow(ctx.tdb, item.id, { status: error ? "failed" : "sent", error, sentAt: new Date(ctx.now), providerMessageId });
  logSend(ctx, item, "whatsapp", null, item.sendTo, error);
  if (error) console.error(`[lead flows] tenant ${ctx.tenantId} WhatsApp ${item.id} failed: ${error}`);
  // A provider failure on the run's first WhatsApp: Message undelivered, the rest by email.
  if (undeliverable && error) await handleUndelivered(ctx.tenantId, { ...item, status: "failed", error }, error);
  return !error;
```

(`let undeliverable` is declared next to `let providerMessageId`.)

In `app/src/app/api/whatsapp/webhook/route.ts`, add `import { onWhatsAppDeliveryFailed } from "@/lib/leadFlows/undelivered";` and replace the status block with:

```ts
    // Delivery/read status → update the matching outbound row.
    const status = bridge.parseStatusWebhook(body);
    if (status) {
      const clientMsg = findClientMessageByProviderId(status.providerMessageId);
      if (clientMsg) {
        setClientMessageStatus(clientMsg.id, status.status);
      } else {
        const leadMsg = findLeadMessageByProviderId(status.providerMessageId);
        if (leadMsg) setLeadMessageStatus(leadMsg.id, status.status);
      }
      // A follow-up flow's first WhatsApp that never arrived: Message undelivered, the rest by email.
      if (status.status === "failed") {
        try {
          await onWhatsAppDeliveryFailed(tenant.id, status.providerMessageId);
        } catch (err) {
          console.error("[lead flows] undelivered handling failed:", err);
        }
      }
    }
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- src/lib/leadFlows/undelivered.test.ts`
Expected: PASS, `undelivered: 11 checks passed.`
Run: `npm test -- src/lib/leadFlows/dispatch.test.ts` and `npm test -- src/lib/automations/leadSequences.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/leadFlows/undelivered.ts app/src/lib/leadFlows/undelivered.test.ts app/src/lib/leadFlows/dispatch.ts app/src/app/api/whatsapp/webhook/route.ts
git commit -m "feat(lead-flows): undelivered first WhatsApp moves the card and switches to email

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Assigning leads, personal alerts, new-lead and hot-lead alerts

**Files:**
- Modify: `app/src/lib/db/schema.ts` (`leads.assignedUserId`, `notifications.forUserId`)
- Modify: `app/src/lib/db/tenant.ts` (two lines in the lead-flows block)
- Modify: `app/src/lib/notifications/store.ts`, `app/src/lib/notifications/notify.ts`
- Create: `app/src/lib/leadFlows/alertText.ts` (pure), `app/src/lib/leadFlows/assignment.ts`, `app/src/lib/leadFlows/alerts.ts`
- Modify: `app/src/lib/leadFlows/dispatch.ts` (the `staff_alert` handler)
- Modify: `app/src/lib/leads.ts` (default assignee; new-lead alert)
- Modify: `app/src/lib/pipeline/stage.ts` (`onInboundFromLead(leadId, reply?)`; hot-lead alert)
- Modify: `app/src/app/api/whatsapp/webhook/route.ts`, `app/src/app/api/integrations/meta/webhook/route.ts` (pass the reply)
- Modify: `app/src/app/leads/callActions.ts` (`assignLeadAction`)
- Test: `app/src/lib/leadFlows/alertText.test.ts`, `app/src/lib/leadFlows/alerts.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 6, 8; `leadNotifies`, `leadSourceText`, `personName` (`lib/notifications/model`); `getAppBaseUrl`.
- Produces:
  - schema `leads.assignedUserId: integer("assigned_user_id")`, `notifications.forUserId: integer("for_user_id")`
  - `NotifyInput.forUserId?: number`; `notifyUser(userId: number, input: Omit<NotifyInput, "forUserId">): number | null`; `NewNotification.forUserId?: number | null`
  - `alertText.ts`: `firstChars(text: string, max?: number): string`, `newLeadAlertText(a: { name: string; source: string; phone: string | null; link: string }): string`, `hotLeadAlertText(a: { name: string; reply: string | null; link: string }): string`, `callBackAlertText(a: { name: string; phone: string | null; link: string }): string`
  - `assignment.ts`: `interface AssignableStaff { userId: number; name: string; email: string; role: "admin" | "staff" }`, `listAssignableStaff(tenantId: number): AssignableStaff[]`, `isAssignable(tenantId: number, userId: number): boolean`, `assignLead(leadId: number, userId: number | null): { ok: true } | { ok: false; error: string }`, `defaultAssigneeForNewLead(): number | null`
  - `alerts.ts`: `leadLink(leadId: number): string`, `interface StaffAlertInput { leadId: number | null; triggerKey?: string; dueAt?: number; userId?: number | null; title?: string; body?: string; href?: string; whatsappText?: string | null }`, `queueStaffAlert(a: StaffAlertInput): void`, `alertNewLead(lead: Lead, actor?: string | null): void`, `alertHotLead(leadId: number, reply: string | null): void`
  - stage.ts: `interface LeadReply { text: string; messageId?: number; channel?: string }`, `onInboundFromLead(leadId: number, reply?: LeadReply): void`
  - `callActions.ts`: `assignLeadAction(leadId: number, userId: number | null): Promise<ActionResult>`

- [ ] **Step 1: Write the failing tests**

Create `app/src/lib/leadFlows/alertText.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/alertText.test.ts
import assert from "node:assert/strict";

import { callBackAlertText, firstChars, hotLeadAlertText, newLeadAlertText } from "./alertText";

let n = 0;
const eq = (a: string, b: string, name: string) => {
  assert.equal(a, b, name);
  n++;
};

eq(
  newLeadAlertText({ name: "Aoife Example", source: "From the website", phone: "+353870000000", link: "http://app.test/leads/7" }),
  "New lead: Aoife Example, From the website. +353870000000. Open: http://app.test/leads/7",
  "the new-lead alert, exactly",
);
eq(newLeadAlertText({ name: "Aoife Example", source: "From a form", phone: null, link: "http://app.test/leads/7" }), "New lead: Aoife Example, From a form. No phone. Open: http://app.test/leads/7", "no phone");
eq(
  hotLeadAlertText({ name: "Aoife Example", reply: "Yes please, Tuesday works", link: "http://app.test/leads/7" }),
  'Hot lead: Aoife Example replied: "Yes please, Tuesday works". Open: http://app.test/leads/7',
  "the hot-lead alert, exactly",
);
const long = "word ".repeat(60);
eq(firstChars(long), "word ".repeat(24).trim(), "the first 120 characters, whitespace tidied");
assert.ok(hotLeadAlertText({ name: "A", reply: long, link: "L" }).length < 160);
n++;
eq(hotLeadAlertText({ name: "Aoife Example", reply: null, link: "http://app.test/leads/7" }), "Hot lead: Aoife Example replied. Open: http://app.test/leads/7", "no text: no quote");
eq(callBackAlertText({ name: "Aoife Example", phone: "+353870000000", link: "http://app.test/leads/7" }), "Call back today: Aoife Example, +353870000000. Open: http://app.test/leads/7", "the call-back reminder");

console.log(`alertText: ${n} checks passed.`);
```

Create `app/src/lib/leadFlows/alerts.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/alerts.test.ts
//
// Assigning leads and the alerts that follow, against a scratch tenant with
// two fake staff and a fake sender: the business default assignee, the
// assignee's own in-app alert (nobody else's bell), the WhatsApp alert to
// the business's alert number with the agreed wording, the hot-lead alert
// on a reply that makes them hot (once), and no WhatsApp alert when no
// number is set.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead, getLead } = requireLocal("../leads") as typeof import("../leads");
  const stage = requireLocal("../pipeline/stage") as typeof import("../pipeline/stage");
  const assignment = requireLocal("./assignment") as typeof import("./assignment");
  const { saveLeadFlowSettings } = requireLocal("./settings") as typeof import("./settings");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");
  const { listForUser } = requireLocal("../notifications/store") as typeof import("../notifications/store");

  const s = h.makeScratchTenant("lead-flow-alerts-test");
  const fake = h.installFakeTransport();
  const emails = ["staff-one@example.com", "staff-two@example.com"];
  const cleanupUsers = () => {
    for (const e of emails) {
      const u = controlSqlite.prepare("SELECT id FROM users WHERE email = ?").get(e) as { id: number } | undefined;
      if (u) {
        controlSqlite.prepare("DELETE FROM memberships WHERE user_id = ?").run(u.id);
        controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(u.id);
      }
    }
  };
  cleanupUsers();
  const [one, two] = emails.map((email, i) => {
    const id = (controlSqlite.prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, 'x') RETURNING id").get(email, i === 0 ? "Staff One" : "Staff Two") as { id: number }).id;
    controlSqlite.prepare("INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, 'staff')").run(id, s.tid);
    return id;
  });
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const WED_10 = Date.parse("2030-01-16T10:00:00Z");
      h.fakeClock(WED_10);
      const alertRows = () =>
        tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.kind, "staff_alert"), eq(schema.automationQueue.status, "queued"))).all();

      ok(assignment.listAssignableStaff(s.tid).map((x) => x.name).join() === "Staff One,Staff Two", "both staff can be assigned");

      // No settings: nobody assigned, no WhatsApp alert.
      const { lead: plain } = upsertLead({ source: "website", sourceLeadId: "website:plain@example.com", fullName: "Plain Lead", email: "plain@example.com" });
      ok(getLead(plain.id)!.assignedUserId === null && alertRows().length === 0, "nothing set: no assignee, no alert");

      // The business default and the alert number.
      saveLeadFlowSettings({ window: null, defaultAssigneeUserId: one, alertWhatsAppTo: "+353870000099" });
      const { lead } = upsertLead({ source: "website", sourceLeadId: "website:ann@example.com", fullName: "Ann Example", email: "ann@example.com", phone: "+353870000010" });
      ok(getLead(lead.id)!.assignedUserId === one, "new leads go to the default assignee");
      const mine = listForUser(one, "staff");
      ok(mine.some((x) => x.title === "New lead for you: Ann Example"), "the assignee's own alert is in their bell");
      ok(!listForUser(two, "staff").some((x) => x.title.startsWith("New lead for you")), "and nobody else's");
      const wa = alertRows();
      ok(wa.length === 1 && JSON.parse(wa[0].payload!).whatsappText === `New lead: Ann Example, From the website. +353870000010. Open: http://app.test/leads/${lead.id}`, "the WhatsApp alert, as agreed");
      await dispatchDueAutomationQueue(s.tid, WED_10, "http://app.test");
      ok(fake.sent.some((x) => x.to === "number" && x.address === "+353870000099" && x.text.startsWith("New lead: Ann Example")), "sent to the alert number from the business WhatsApp");

      // A lead staff type in themselves is not alerted.
      upsertLead({ source: "manual", actor: "user", fullName: "Typed In", phone: "+353870000016" });
      ok(alertRows().length === 0, "a lead staff typed in raises no alert");

      // Assigning by hand.
      ok(assignment.assignLead(lead.id, two).ok && getLead(lead.id)!.assignedUserId === two, "reassigned");
      ok(!assignment.assignLead(lead.id, 987654).ok, "only someone on this account");
      ok(assignment.assignLead(lead.id, null).ok && getLead(lead.id)!.assignedUserId === null, "unassigned");
      assignment.assignLead(lead.id, two);

      // A reply makes them hot: the hot-lead alert, once.
      const reply = "Yes please. Could you ring me on Tuesday after lunch? I am free from two until five, any time then is fine, thanks a million for the message";
      stage.onInboundFromLead(lead.id, { text: reply, channel: "whatsapp" });
      ok(listForUser(two, "staff").some((x) => x.title === "Hot lead: Ann Example"), "the assignee gets the hot-lead alert");
      const hot = alertRows().map((r) => JSON.parse(r.payload!).whatsappText as string);
      ok(hot.length === 1 && hot[0].startsWith('Hot lead: Ann Example replied: "Yes please.') && hot[0].endsWith(`". Open: http://app.test/leads/${lead.id}`), "the hot-lead WhatsApp, as agreed");
      stage.onInboundFromLead(lead.id, { text: "And another thing", channel: "whatsapp" });
      ok(alertRows().length === 1, "already hot: no second alert");

      // No number set: no WhatsApp alert is queued, and a queued one is not sent.
      saveLeadFlowSettings({ window: null, defaultAssigneeUserId: null, alertWhatsAppTo: null });
      await dispatchDueAutomationQueue(s.tid, WED_10 + 1, "http://app.test");
      const cancelled = tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.kind, "staff_alert"), eq(schema.automationQueue.status, "cancelled"))).all();
      ok(cancelled.length === 1 && /No WhatsApp alert number/.test(cancelled[0].error ?? ""), "a queued alert with no number set is dropped, not sent");
      upsertLead({ source: "facebook", sourceLeadId: "fb-alert-1", fullName: "No Number", phone: "+353870000017" });
      ok(alertRows().length === 0, "no number: nothing queued");
    });
    console.log(`alerts: ${n} checks passed.`);
  } finally {
    fake.restore();
    cleanupUsers();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -- src/lib/leadFlows/alertText.test.ts` and `npm test -- src/lib/leadFlows/alerts.test.ts`
Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Schema and personal notifications**

In `app/src/lib/db/schema.ts`: in `leads`, after `marketingConsentSource`:

```ts
  /** The staff member (control-plane user id) this lead is assigned to; null = nobody. */
  assignedUserId: integer("assigned_user_id"),
```

In `notifications`, after `adminOnly`:

```ts
    /** Set for a personal alert: only this user (control-plane id) sees it. Null = the whole business. */
    forUserId: integer("for_user_id"),
```

In `app/src/lib/db/tenant.ts`, in the lead-flows block, before `// Later lead-flow columns go here.`:

```ts
    addColumn("leads", "assigned_user_id", "assigned_user_id INTEGER");
    addColumn("notifications", "for_user_id", "for_user_id INTEGER");
```

In `app/src/lib/notifications/store.ts`: add `isNull, or` to the drizzle-orm import; add to `NewNotification`:

```ts
  /** A personal alert: only this user sees it. */
  forUserId?: number | null;
```

add `forUserId: n.forUserId ?? null,` to the `values` in `createNotification`; and replace `visibleTo` with:

```ts
/** What this person may see in the bell: their role allows it, the kind is on in the app, and it is for everyone or for them. */
function visibleTo(userId: number, role: StaffRole): SQL | undefined {
  const off = NOTIFICATION_KINDS.filter((k) => !getPrefs(userId)[k].inApp);
  return and(
    role === "admin" ? undefined : eq(notifications.adminOnly, false),
    off.length ? notInArray(notifications.kind, off) : undefined,
    or(isNull(notifications.forUserId), eq(notifications.forUserId, userId)),
  );
}
```

In `app/src/lib/notifications/notify.ts`: add to `NotifyInput`:

```ts
  /** A personal alert: in this user's bell and on their devices only. */
  forUserId?: number;
```

in `notify()`, pass `forUserId: input.forUserId ?? null` to `createNotification`, and change `const people = staffOf(tenantId);` to:

```ts
    const people = staffOf(tenantId).filter((p) => input.forUserId == null || p.userId === input.forUserId);
```

and add after `notify`:

```ts
/** An alert for one person only: their bell and their devices, nobody else's. Never throws. */
export function notifyUser(userId: number, input: Omit<NotifyInput, "forUserId">): number | null {
  return notify({ ...input, forUserId: userId });
}
```

- [ ] **Step 4: Alert text, assignment, alerts**

Create `app/src/lib/leadFlows/alertText.ts`:

```ts
/** The wording of the staff alerts, as agreed. Pure. */

/** The first `max` characters of a message, whitespace tidied. */
export function firstChars(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max).trimEnd();
}

export function newLeadAlertText(a: { name: string; source: string; phone: string | null; link: string }): string {
  return `New lead: ${a.name}, ${a.source}. ${a.phone || "No phone"}. Open: ${a.link}`;
}

export function hotLeadAlertText(a: { name: string; reply: string | null; link: string }): string {
  const reply = a.reply?.trim();
  return reply ? `Hot lead: ${a.name} replied: "${firstChars(reply)}". Open: ${a.link}` : `Hot lead: ${a.name} replied. Open: ${a.link}`;
}

export function callBackAlertText(a: { name: string; phone: string | null; link: string }): string {
  return `Call back today: ${a.name}, ${a.phone || "no phone"}. Open: ${a.link}`;
}
```

Create `app/src/lib/leadFlows/assignment.ts`:

```ts
import "server-only";

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { controlSqlite } from "@/lib/db/control";
import { logActivity } from "@/lib/queries";

import { getLeadFlowSettings } from "./settings";
import { flowTenant } from "./tenant";

/** Who a lead can be assigned to: the business's active staff, by name. */
export interface AssignableStaff {
  userId: number;
  name: string;
  email: string;
  role: "admin" | "staff";
}

export function listAssignableStaff(tenantId: number): AssignableStaff[] {
  return (
    controlSqlite
      .prepare(
        `SELECT u.id AS userId, COALESCE(NULLIF(TRIM(u.name), ''), u.email) AS name, u.email AS email, m.role AS role
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.tenant_id = ? AND m.is_active = 1 AND u.is_active = 1
         ORDER BY name COLLATE NOCASE`,
      )
      .all(tenantId) as Array<{ userId: number; name: string; email: string; role: string }>
  ).map((r) => ({ ...r, role: r.role === "admin" ? "admin" : "staff" }));
}

export function isAssignable(tenantId: number, userId: number): boolean {
  return listAssignableStaff(tenantId).some((s) => s.userId === userId);
}

/** Assign a lead (ambient tenant), or unassign it with null. */
export function assignLead(leadId: number, userId: number | null): { ok: true } | { ok: false; error: string } {
  const tenant = flowTenant();
  if (!tenant) return { ok: false, error: "No business selected." };
  if (userId != null && !isAssignable(tenant.id, userId)) return { ok: false, error: "That person is not on this account." };
  const res = db.update(schema.leads).set({ assignedUserId: userId }).where(eq(schema.leads.id, leadId)).run();
  if (res.changes === 0) return { ok: false, error: "Lead not found." };
  void logActivity("lead.assigned", userId == null ? `Lead #${leadId} unassigned` : `Lead #${leadId} assigned to user #${userId}`, { leadId, userId });
  return { ok: true };
}

/** Who a brand-new lead goes to: the business default, while that person still works here. Never throws. */
export function defaultAssigneeForNewLead(): number | null {
  try {
    const tenant = flowTenant();
    if (!tenant) return null;
    const id = getLeadFlowSettings().defaultAssigneeUserId;
    return id != null && isAssignable(tenant.id, id) ? id : null;
  } catch {
    return null;
  }
}
```

Create `app/src/lib/leadFlows/alerts.ts`:

```ts
import "server-only";

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { Lead } from "@/lib/db/schema";
import { getAppBaseUrl } from "@/lib/appUrl";
import { leadNotifies, leadSourceText, personName } from "@/lib/notifications/model";
import { notifyUser } from "@/lib/notifications/notify";

import { firstChars, hotLeadAlertText, newLeadAlertText } from "./alertText";
import { flowNow } from "./clock";
import { STAFF_ALERT_KEY } from "./flowModel";
import { getLeadFlowSettings } from "./settings";

/**
 * Staff alerts for the lead flows. The assignee gets a personal in-app alert
 * (their bell and devices only); the business's alert number gets a
 * WhatsApp from the business WhatsApp, queued for the dispatch ticker. The
 * business-wide bell for new leads and messages is separate and unchanged.
 * Alerts are not held by sending hours: they are for staff.
 */

/** An absolute link to the lead, for a WhatsApp alert. */
export function leadLink(leadId: number): string {
  let base = "http://localhost:3000";
  try {
    base = getAppBaseUrl();
  } catch {
    // no request and no APP_URL: the dev default
  }
  return `${base.replace(/\/+$/, "")}/leads/${leadId}`;
}

export interface StaffAlertInput {
  leadId: number | null;
  /** STAFF_ALERT_KEY (default) for alerts no flow stops; CALL_ALERT_KEY for a scheduled call's. */
  triggerKey?: string;
  dueAt?: number;
  /** An in-app alert for this person... */
  userId?: number | null;
  title?: string;
  body?: string;
  href?: string;
  /** ...and/or this WhatsApp to the alert number. */
  whatsappText?: string | null;
}

/** Queue a staff alert for the dispatch ticker. Nothing to say: nothing queued. */
export function queueStaffAlert(a: StaffAlertInput): void {
  const inApp = a.userId != null && !!a.title;
  if (!inApp && !a.whatsappText) return;
  db.insert(schema.automationQueue)
    .values({
      triggerKey: a.triggerKey ?? STAFF_ALERT_KEY,
      leadId: a.leadId,
      kind: "staff_alert",
      channel: "chat",
      body: a.whatsappText ?? a.title ?? "Staff alert",
      dueAt: new Date(a.dueAt ?? flowNow()),
      payload: JSON.stringify({
        userId: inApp ? a.userId : null,
        title: a.title,
        body: a.body,
        href: a.href,
        whatsappText: a.whatsappText ?? undefined,
      }),
    })
    .run();
}

/** A lead just came in (upsertLead created it). Never throws. */
export function alertNewLead(lead: Lead, actor?: string | null): void {
  try {
    if (!leadNotifies(lead.source, actor)) return;
    const name = personName(lead.firstName, lead.lastName, lead.email || lead.phone || "no name yet");
    const source = leadSourceText(lead.source);
    if (lead.assignedUserId != null) {
      notifyUser(lead.assignedUserId, {
        kind: "lead",
        title: `New lead for you: ${name}`,
        body: `${source}. ${lead.phone || "No phone"}`,
        href: `/leads/${lead.id}`,
        key: `lead-assigned:${lead.id}`,
      });
    }
    if (getLeadFlowSettings().alertWhatsAppTo) {
      queueStaffAlert({ leadId: lead.id, whatsappText: newLeadAlertText({ name, source, phone: lead.phone, link: leadLink(lead.id) }) });
    }
  } catch (err) {
    console.error(`[lead flows] new-lead alert for lead #${lead.id} failed:`, err);
  }
}

/** A reply just made a lead hot. Never throws. */
export function alertHotLead(leadId: number, reply: string | null): void {
  try {
    const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
    if (!lead) return;
    const name = personName(lead.firstName, lead.lastName, lead.email || lead.phone || "A lead");
    if (lead.assignedUserId != null) {
      notifyUser(lead.assignedUserId, {
        kind: "lead",
        title: `Hot lead: ${name}`,
        body: reply?.trim() ? `Replied: "${firstChars(reply)}"` : "Replied",
        href: `/leads/${leadId}`,
        key: `hot:${leadId}:${flowNow()}`,
      });
    }
    if (getLeadFlowSettings().alertWhatsAppTo) {
      queueStaffAlert({ leadId, whatsappText: hotLeadAlertText({ name, reply, link: leadLink(leadId) }) });
    }
  } catch (err) {
    console.error(`[lead flows] hot-lead alert for lead #${leadId} failed:`, err);
  }
}
```

- [ ] **Step 5: Send staff alerts from the dispatch**

In `app/src/lib/leadFlows/dispatch.ts`, add `import { notifyUser } from "@/lib/notifications/notify";`, add this handler, and register it as `staff_alert: sendStaffAlertRow,` in `HANDLERS`:

```ts
async function sendStaffAlertRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  const p = parsePayload(item.payload);
  if (p.userId != null && p.title) {
    notifyUser(p.userId, { kind: "lead", title: p.title, body: p.body ?? "", href: p.href ?? "/leads", key: `alert:${item.id}` });
  }
  if (!p.whatsappText) {
    markRow(ctx.tdb, item.id, { status: "sent", error: null, sentAt: new Date(ctx.now) });
    return false;
  }
  const to = ctx.settings.alertWhatsAppTo;
  if (!to) {
    markRow(ctx.tdb, item.id, { status: "cancelled", error: "No WhatsApp alert number is set." });
    return false;
  }
  const transport = getFlowTransport();
  let error: string | null = null;
  if (!transport.whatsAppConnected()) error = WHATSAPP_NOT_CONNECTED;
  else {
    try {
      await transport.sendWhatsAppToNumber(to, p.whatsappText);
    } catch (err) {
      error = err instanceof Error ? err.message : "WhatsApp send failed.";
    }
  }
  markRow(ctx.tdb, item.id, { status: error ? "failed" : "sent", error, sentAt: new Date(ctx.now) });
  logSend(ctx, item, "whatsapp", null, to, error, "Staff alert");
  return false;
}
```

- [ ] **Step 6: Default assignee, new-lead alert, hot-lead alert**

In `app/src/lib/leads.ts`: import `defaultAssigneeForNewLead` from `./leadFlows/assignment` and `alertNewLead` from `./leadFlows/alerts`; in the `insert(leads).values({...})` of `upsertLead` add `assignedUserId: defaultAssigneeForNewLead(),`; and after `notifyNewLead(lead, input.actor);` add:

```ts
  // The assignee's own alert and the WhatsApp alert (lib/leadFlows/alerts). Never throws.
  alertNewLead(lead, input.actor);
```

In `app/src/lib/pipeline/stage.ts`, import `alertHotLead` from `@/lib/leadFlows/alerts` and replace `onInboundFromLead` with:

```ts
/** What a lead said, when the caller has it (for the hot-lead alert and the Thinking about it check). */
export interface LeadReply {
  text: string;
  messageId?: number;
  channel?: string;
}

export function onInboundFromLead(leadId: number, reply?: LeadReply): void {
  // They replied: a person takes it from here, so the automatic nudges stop
  // (a booked call's confirmation and reminder carry on).
  try {
    stopFlows(leadId, "replied", { except: KEEP_ON_REPLY });
  } catch (err) {
    console.error(`[pipeline] could not stop follow-ups for lead #${leadId}:`, err);
  }
  // Hot now, and only now: the assignee and the alert number are told.
  if (advanceStage(leadId, "engaged", "replied")) alertHotLead(leadId, reply?.text ?? null);
}
```

In `app/src/app/api/whatsapp/webhook/route.ts`, change `onInboundFromLead(lead.id);` to:

```ts
          onInboundFromLead(lead.id, { text: inbound.text, messageId: inboundMsg.id, channel: "whatsapp" });
```

In `app/src/app/api/integrations/meta/webhook/route.ts`, change `if (inbound.ownerType === "lead") onInboundFromLead(inbound.ownerId);` to:

```ts
          if (inbound.ownerType === "lead") onInboundFromLead(inbound.ownerId, { text: ev.text, messageId: inbound.messageId, channel: ev.channel });
```

- [ ] **Step 7: The assign action**

Append to `app/src/app/leads/callActions.ts` (and add `import { assignLead } from "@/lib/leadFlows/assignment";`):

```ts
/** Assign a lead to a staff member, or to nobody. */
export async function assignLeadAction(leadId: number, userId: number | null): Promise<ActionResult> {
  await requireUser();
  const id = leadIdSchema.safeParse(leadId);
  if (!id.success) return { ok: false, error: "Lead not found." };
  const who = userId == null ? null : z.number().int().positive().safeParse(userId);
  if (who && !who.success) return { ok: false, error: "Pick someone from the list." };
  const res = assignLead(id.data, who ? who.data : null);
  revalidatePath(`/leads/${id.data}`);
  revalidatePath("/leads");
  return res.ok ? { ok: true, message: userId == null ? "Unassigned." : "Assigned." } : res;
}
```

- [ ] **Step 8: Run the tests**

Run: `npm test -- src/lib/leadFlows/alertText.test.ts`
Expected: PASS, `alertText: 7 checks passed.`
Run: `npm test -- src/lib/leadFlows/alerts.test.ts`
Expected: PASS, `alerts: 16 checks passed.`
Run: `npm test -- src/lib/notifications/store.test.ts`, `npm test -- src/lib/notifications/model.test.ts`, `npm test -- src/lib/leadFlows/columnEntry.test.ts`, `npm test -- src/lib/automations/leadSequences.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib/db/schema.ts app/src/lib/db/tenant.ts app/src/lib/notifications/store.ts app/src/lib/notifications/notify.ts app/src/lib/leadFlows/alertText.ts app/src/lib/leadFlows/alertText.test.ts app/src/lib/leadFlows/assignment.ts app/src/lib/leadFlows/alerts.ts app/src/lib/leadFlows/alerts.test.ts app/src/lib/leadFlows/dispatch.ts app/src/lib/leads.ts app/src/lib/pipeline/stage.ts app/src/app/api/whatsapp/webhook/route.ts app/src/app/api/integrations/meta/webhook/route.ts app/src/app/leads/callActions.ts
git commit -m "feat(lead-flows): assign leads, personal alerts, new and hot lead WhatsApp alerts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Replies (the Thinking about it check, triage, email replies)

**Files:**
- Create: `app/src/lib/leadFlows/replies.ts`
- Modify: `app/src/lib/pipeline/stage.ts` (thinking branch; `onLeadReplyTriaged`, `resolveThinkingReply`, `onLeadEmailReply`)
- Modify: `app/src/lib/inbox/triagePipeline.ts` (call the hook)
- Modify: `app/src/lib/leadFlows/dispatch.ts` (the `reply_check` handler)
- Modify: `app/src/lib/gmail.ts`, `app/src/lib/imapEmail.ts` (email replies)
- Test: `app/src/lib/leadFlows/replies.test.ts`

**Interfaces:**
- Consumes: `isPositiveReply` (Task 5), `activeRun`, `stopFlows` (Task 6), `getFlowDefinition`, `alertHotLead` (Task 11), `EMAIL_MAX_AGE_MS` (`lib/notifications/model`).
- Produces:
  - `replies.ts`: `REPLY_CHECK_FALLBACK_MS = 900_000`, `THINKING_NURTURE_AFTER_MS = 604_800_000`, `beginThinkingReplyCheck(leadId: number, inThinkingColumn: boolean, reply?: { text: string; messageId?: number }): boolean`, `takeReplyCheck(leadId: number, messageId?: number): { text: string } | null`, `queueThinkingNurtureMove(leadId: number): void`
  - stage.ts: `onLeadReplyTriaged(leadId: number, messageId: number, triage: { category: string; priority?: string | null }): void`, `resolveThinkingReply(leadId: number, text: string, positive: boolean): void`, `onLeadEmailReply(tenantId: number, fromEmail: string | null, at: Date | null, snippet: string | null): void`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/leadFlows/replies.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/replies.test.ts
//
// The Thinking about it reply check, with the triage faked (no AI): a reply
// stops the flow and waits for the triage; wanting to book makes a hot
// lead with an alert; anything else moves them to Long-term nurture 7 days
// later unless a person acts; no triage answer in 15 minutes counts as
// wanting to talk; with the flow off a reply is an ordinary reply; and an
// email reply stops a flow like any other.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead, getLead } = requireLocal("../leads") as typeof import("../leads");
  const stage = requireLocal("../pipeline/stage") as typeof import("../pipeline/stage");
  const { listStages, resolveStageIdByRole } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");
  const { saveLeadFlowSettings } = requireLocal("./settings") as typeof import("./settings");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");
  const consent = requireLocal("./consent") as typeof import("./consent");

  const s = h.makeScratchTenant("lead-flow-replies-test");
  const fake = h.installFakeTransport();
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const MIN = 60_000;
      const DAY = 86_400_000;
      const WED_10 = Date.parse("2030-01-16T10:00:00Z");
      const clock = h.fakeClock(WED_10);
      const dispatch = (at: number) => dispatchDueAutomationQueue(s.tid, at, "http://app.test");
      const cols = listStages();
      const thinking = cols.find((c) => c.systemKey === "thinking")!;
      const nurture = cols.find((c) => c.systemKey === "nurture")!;
      const engaged = resolveStageIdByRole("engaged")!;
      const queued = (leadId: number) =>
        tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"))).all();
      saveLeadFlowSettings({ window: null, defaultAssigneeUserId: null, alertWhatsAppTo: "+353870000099" });
      h.setFlowEnabled(s.tid, "lead_thinking", true);
      const thinker = (tag: string) => {
        const { lead } = upsertLead({ source: "manual", actor: "user", fullName: `Think ${tag}`, email: `${tag}@example.com`, phone: "+353870000020" });
        stage.setStageToId(lead.id, thinking.id);
        return lead;
      };

      // A reply that is not a yes.
      const a = thinker("maybe");
      ok(queued(a.id).some((q) => q.kind === "message"), "Thinking about it is running");
      stage.onInboundFromLead(a.id, { text: "What is the price of a session?", messageId: 101 });
      ok(getLead(a.id)!.stageId === thinking.id, "the reply does not make them hot on its own");
      ok(queued(a.id).length === 1 && queued(a.id)[0].kind === "reply_check", "the flow stops and waits for the inbox triage");
      stage.onLeadReplyTriaged(a.id, 101, { category: "faq", priority: "normal" });
      const move = queued(a.id);
      ok(move.length === 1 && move[0].kind === "move" && move[0].dueAt.getTime() === WED_10 + 7 * DAY, "a question: Long-term nurture in 7 days");
      clock.set(WED_10 + 7 * DAY);
      await dispatch(WED_10 + 7 * DAY);
      ok(getLead(a.id)!.stageId === nurture.id, "7 days on, in Long-term nurture");
      clock.set(WED_10);

      // A reply that is a yes.
      const b = thinker("yes");
      stage.onInboundFromLead(b.id, { text: "Yes, can I book Thursday?", messageId: 102 });
      stage.onLeadReplyTriaged(b.id, 102, { category: "booking", priority: "normal" });
      ok(getLead(b.id)!.stageId === engaged && queued(b.id).filter((q) => q.kind !== "staff_alert").length === 0, "wants to book: Hot lead, flow over");
      ok(queued(b.id).some((q) => q.kind === "staff_alert" && /Hot lead: Think yes replied: "Yes, can I book Thursday\?"/.test(JSON.parse(q.payload!).whatsappText)), "and the hot-lead alert");

      // No triage answer.
      const c = thinker("silent");
      stage.onInboundFromLead(c.id, { text: "Call me", messageId: 103 });
      await dispatch(WED_10 + 16 * MIN);
      ok(getLead(c.id)!.stageId === engaged, "no triage in 15 minutes: treated as wanting to talk");

      // A person acts before the 7 days are up.
      const d = thinker("acted");
      stage.onInboundFromLead(d.id, { text: "Not sure yet", messageId: 104 });
      stage.onLeadReplyTriaged(d.id, 104, { category: "other", priority: "low" });
      stage.setStageToId(d.id, resolveStageIdByRole("booked")!);
      ok(queued(d.id).length === 0, "a person moving the card cancels the move to nurture");

      // A triage result after a person moved them changes nothing.
      const e = thinker("late");
      stage.onInboundFromLead(e.id, { text: "Maybe", messageId: 105 });
      stage.setStageToId(e.id, resolveStageIdByRole("booked")!);
      stage.onLeadReplyTriaged(e.id, 105, { category: "booking", priority: "high" });
      ok(getLead(e.id)!.stageId === resolveStageIdByRole("booked"), "they stay where the person put them");

      // The flow off: an ordinary reply.
      h.setFlowEnabled(s.tid, "lead_thinking", false);
      const f = thinker("off");
      stage.onInboundFromLead(f.id, { text: "Hello", messageId: 106 });
      ok(getLead(f.id)!.stageId === engaged, "with the flow off, a reply makes them hot straight away");

      // An email reply stops Long-term nurture and makes them hot.
      h.setFlowEnabled(s.tid, "lead_nurture", true);
      const { lead: g } = upsertLead({ source: "manual", actor: "user", fullName: "Mail Reply", email: "mailreply@example.com" });
      consent.setLeadMarketingConsent(g.id, true, "staff");
      stage.setStageToId(g.id, nurture.id);
      ok(queued(g.id).some((q) => q.kind === "message"), "Long-term nurture running");
      stage.onLeadEmailReply(s.tid, "MailReply@Example.com", new Date(), "Thanks, how do I book?");
      ok(queued(g.id).filter((q) => q.kind === "message").length === 0 && getLead(g.id)!.stageId === engaged, "an email reply stops it and makes them hot");
      const { lead: old } = upsertLead({ source: "manual", actor: "user", fullName: "Old Mail", email: "oldmail@example.com" });
      consent.setLeadMarketingConsent(old.id, true, "staff");
      stage.setStageToId(old.id, nurture.id);
      stage.onLeadEmailReply(s.tid, "oldmail@example.com", new Date(Date.now() - 3 * 3_600_000), "old");
      ok(queued(old.id).some((q) => q.kind === "message") && getLead(old.id)!.stageId === nurture.id, "an email from hours ago (a first sync) changes nothing");
    });
    console.log(`replies: ${n} checks passed.`);
  } finally {
    fake.restore();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/leadFlows/replies.test.ts`
Expected: FAIL (`stage.onLeadReplyTriaged is not a function`, or the first reply makes the lead hot).

- [ ] **Step 3: Write `replies.ts`**

Create `app/src/lib/leadFlows/replies.ts`:

```ts
import "server-only";

import { and, asc, eq, ne } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { flowNow } from "./clock";
import { getFlowDefinition } from "./definitions";
import { parsePayload, THINKING_FLOW } from "./flowModel";
import { activeRun } from "./runs";

/**
 * The Thinking about it flow reads a reply before acting on it. The reply
 * stops the flow's remaining messages and queues a reply check; the inbox
 * triage settles it (lib/pipeline/stage.ts onLeadReplyTriaged). If the
 * triage never answers (AI cap, an error, an email reply, which is not
 * triaged) the check fires after REPLY_CHECK_FALLBACK_MS and is treated as
 * wanting to talk, so a person looks rather than the lead waiting a week.
 */

export const REPLY_CHECK_FALLBACK_MS = 15 * 60_000;
export const THINKING_NURTURE_AFTER_MS = 7 * 86_400_000;

/** Start a reply check when the lead is in Thinking about it with its flow on. True when one started. */
export function beginThinkingReplyCheck(leadId: number, inThinkingColumn: boolean, reply?: { text: string; messageId?: number }): boolean {
  if (!inThinkingColumn) return false;
  if (!getFlowDefinition(THINKING_FLOW).enabled) return false;
  const run = activeRun(leadId, THINKING_FLOW);
  const now = flowNow();
  // They answered: no more nudges, and no move until the reply is read.
  db.update(schema.automationQueue)
    .set({ status: "cancelled", error: "Stopped: replied" })
    .where(
      and(
        eq(schema.automationQueue.leadId, leadId),
        eq(schema.automationQueue.status, "queued"),
        eq(schema.automationQueue.triggerKey, THINKING_FLOW),
        ne(schema.automationQueue.kind, "reply_check"),
      ),
    )
    .run();
  db.insert(schema.automationQueue)
    .values({
      triggerKey: THINKING_FLOW,
      leadId,
      runId: run?.id ?? null,
      kind: "reply_check",
      channel: "chat",
      body: "Reply check",
      dueAt: new Date(now + REPLY_CHECK_FALLBACK_MS),
      payload: JSON.stringify({ text: reply?.text ?? "", messageId: reply?.messageId }),
    })
    .run();
  return true;
}

/** Settle the reply check for this message (or the oldest one). Returns what they said, or null when none is waiting. */
export function takeReplyCheck(leadId: number, messageId?: number): { text: string } | null {
  const rows = db
    .select()
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"), eq(schema.automationQueue.kind, "reply_check")))
    .orderBy(asc(schema.automationQueue.id))
    .all();
  const row = messageId != null ? rows.find((r) => parsePayload(r.payload).messageId === messageId) : rows[0];
  if (!row) return null;
  db.update(schema.automationQueue)
    .set({ status: "sent", error: "Settled by the inbox triage.", sentAt: new Date(flowNow()) })
    .where(eq(schema.automationQueue.id, row.id))
    .run();
  return { text: parsePayload(row.payload).text ?? "" };
}

/** Not a yes: Long-term nurture in 7 days, unless a person moves them first (which cancels this). */
export function queueThinkingNurtureMove(leadId: number): void {
  const run = activeRun(leadId, THINKING_FLOW);
  db.insert(schema.automationQueue)
    .values({
      triggerKey: THINKING_FLOW,
      leadId,
      runId: run?.id ?? null,
      kind: "move",
      channel: "chat",
      body: "Move to key:nurture",
      dueAt: new Date(flowNow() + THINKING_NURTURE_AFTER_MS),
      payload: JSON.stringify({ column: "key:nurture" }),
    })
    .run();
}
```

- [ ] **Step 4: Wire it into the stage hooks, the triage and the dispatch**

In `app/src/lib/pipeline/stage.ts`:

Add imports:

```ts
import { runWithTenant } from "@/lib/db/tenant";
import { EMAIL_MAX_AGE_MS } from "@/lib/notifications/model";
import { isPositiveReply } from "@/lib/leadFlows/flowPlan";
import { beginThinkingReplyCheck, queueThinkingNurtureMove, takeReplyCheck } from "@/lib/leadFlows/replies";
```

(merge `runWithTenant` into the existing `@/lib/db/tenant` import.) Replace `onInboundFromLead` with:

```ts
export function onInboundFromLead(leadId: number, reply?: LeadReply): void {
  // In Thinking about it (flow on), the reply is read by the inbox triage
  // before anything moves (lib/leadFlows/replies.ts).
  try {
    if (beginThinkingReplyCheck(leadId, currentStageRecord(leadId)?.systemKey === "thinking", reply)) return;
  } catch (err) {
    console.error(`[pipeline] reply check for lead #${leadId} not started:`, err);
  }
  // They replied: a person takes it from here, so the automatic nudges stop
  // (a booked call's confirmation and reminder carry on).
  try {
    stopFlows(leadId, "replied", { except: KEEP_ON_REPLY });
  } catch (err) {
    console.error(`[pipeline] could not stop follow-ups for lead #${leadId}:`, err);
  }
  // Hot now, and only now: the assignee and the alert number are told.
  if (advanceStage(leadId, "engaged", "replied")) alertHotLead(leadId, reply?.text ?? null);
}

/** The inbox triage has read a lead's message: settles a waiting Thinking about it reply check. */
export function onLeadReplyTriaged(leadId: number, messageId: number, triage: { category: string; priority?: string | null }): void {
  const check = takeReplyCheck(leadId, messageId);
  if (!check) return;
  resolveThinkingReply(leadId, check.text, isPositiveReply(triage));
}

/**
 * Act on a Thinking about it reply: a yes (wants to book or talk) makes a
 * hot lead and alerts; anything else moves them to Long-term nurture in 7
 * days. Nothing happens if they are no longer in the column.
 */
export function resolveThinkingReply(leadId: number, text: string, positive: boolean): void {
  if (currentStageRecord(leadId)?.systemKey !== "thinking") return;
  if (positive) {
    stopFlows(leadId, "replied: wants to book or talk", "all");
    if (advanceStage(leadId, "engaged", "replied")) alertHotLead(leadId, text || null);
    return;
  }
  queueThinkingNurtureMove(leadId);
}

/**
 * An email arrived from a lead's address (Gmail or IMAP sync): a reply like
 * any other, when it is recent (a first sync of old mail changes nothing).
 * Explicit tenant: the mail sync runs with no request.
 */
export function onLeadEmailReply(tenantId: number, fromEmail: string | null, at: Date | null, snippet: string | null): void {
  const email = (fromEmail ?? "").trim().toLowerCase();
  if (!email || !at || Date.now() - at.getTime() > EMAIL_MAX_AGE_MS) return;
  runWithTenant(tenantId, () => {
    const rows = db.select({ id: schema.leads.id }).from(schema.leads).where(sql`lower(${schema.leads.email}) = ${email}`).all();
    for (const r of rows) {
      try {
        onInboundFromLead(r.id, { text: snippet ?? "", channel: "email" });
      } catch (err) {
        console.error(`[pipeline] email reply for lead #${r.id} not handled:`, err);
      }
    }
  });
}
```

In `app/src/lib/inbox/triagePipeline.ts`, add `import { onLeadReplyTriaged } from "@/lib/pipeline/stage";` and directly after `applyTags(ownerType, ownerId, triage.tags);` add:

```ts
  // The Thinking about it flow waits on this read of a lead's reply (lib/leadFlows/replies.ts).
  if (ownerType === "lead") {
    try {
      onLeadReplyTriaged(ownerId, messageId, { category: triage.category, priority: triage.priority });
    } catch (err) {
      console.error("[triage] lead flow reply check failed:", err);
    }
  }
```

In `app/src/lib/leadFlows/dispatch.ts`, add this handler and register it as `reply_check: runReplyCheckRow,` in `HANDLERS`:

```ts
/** The triage never answered: treat the reply as wanting to talk, so a person looks. */
async function runReplyCheckRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  markRow(ctx.tdb, item.id, { status: "sent", error: "No triage answer in time: treated as wanting to talk.", sentAt: new Date(ctx.now) });
  if (item.leadId == null) return false;
  const { resolveThinkingReply } = await import("@/lib/pipeline/stage");
  resolveThinkingReply(item.leadId, parsePayload(item.payload).text ?? "", true);
  return false;
}
```

In `app/src/lib/gmail.ts`, inside `if (direction === "in") {`, after the `notifyInboundEmail(...)` call, add:

```ts
        // A reply from a lead stops their follow-ups (lib/pipeline/stage.ts). Loaded
        // here: the stage writer reaches email, which reaches this file.
        void import("@/lib/pipeline/stage")
          .then((m) => m.onLeadEmailReply(tenantId, from.email || null, msg.internalDate ? new Date(Number(msg.internalDate)) : null, msg.snippet ?? null))
          .catch((err) => console.error("[gmail] lead reply hook failed:", err));
```

In `app/src/lib/imapEmail.ts`, after the `notifyInboundEmail(...)` call in `syncImapInbox`, add:

```ts
            // A reply from a lead stops their follow-ups (lib/pipeline/stage.ts).
            void import("@/lib/pipeline/stage")
              .then((mod) => mod.onLeadEmailReply(tenantId, m.from.email || null, m.internalDate, m.snippet))
              .catch((err) => console.error("[imapEmail] lead reply hook failed:", err));
```

(`m.internalDate` is a `Date` and `m.snippet` a string there.)

- [ ] **Step 5: Run the tests**

Run: `npm test -- src/lib/leadFlows/replies.test.ts`
Expected: PASS, `replies: 14 checks passed.`
Run: `npm test -- src/lib/leadFlows/alerts.test.ts`, `npm test -- src/lib/leadFlows/columnEntry.test.ts`, `npm test -- src/lib/pipeline/hotLead.test.ts`, `npm test -- src/lib/inbox/autoReplyDecision.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/leadFlows/replies.ts app/src/lib/leadFlows/replies.test.ts app/src/lib/pipeline/stage.ts app/src/lib/inbox/triagePipeline.ts app/src/lib/leadFlows/dispatch.ts app/src/lib/gmail.ts app/src/lib/imapEmail.ts
git commit -m "feat(lead-flows): Thinking about it reads replies through the inbox triage; email replies stop flows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Log a call and Schedule a call (engine)

**Files:**
- Modify: `app/src/lib/db/schema.ts` (`leadCalls`)
- Modify: `app/src/lib/db/tenant.ts` (the `lead_calls` table in the lead-flows block)
- Create: `app/src/lib/leadFlows/calls.ts`
- Modify: `app/src/lib/leadFlows/dispatch.ts` (the `callback_check` handler)
- Modify: `app/src/app/leads/callActions.ts` (`logCallAction`, `scheduleCallAction`)
- Test: `app/src/lib/leadFlows/calls.test.ts`

**Interfaces:**
- Consumes: Tasks 5-12; `createEvent`, `deleteEvent` (`lib/calendar.ts`); `addMessage` (`lib/leads.ts`); `setStageToId` (stage.ts).
- Produces:
  - schema `leadCalls` (`id, leadId, kind: "logged"|"scheduled", outcome, scheduledFor, scheduledDay, calendarEventId, note, userId, createdAt`), type `LeadCall`
  - `calls.ts`: `type CallResult = { ok: true; message: string } | { ok: false; error: string }`, `interface LogCallInput { outcome: CallOutcome; note?: string | null; callbackDay?: string | null }`, `logCall(leadId: number, input: LogCallInput, userId: number | null): CallResult`, `interface ScheduleCallInput { at?: number | null; day?: string | null }`, `scheduleCall(leadId: number, input: ScheduleCallInput, userId: number | null, opts?: { logged?: boolean; note?: string | null }): CallResult`, `listLeadCalls(leadId: number): LeadCall[]`
  - `callActions.ts`: `logCallAction(leadId: number, input: unknown): Promise<ActionResult>`, `scheduleCallAction(leadId: number, input: unknown): Promise<ActionResult>` where schedule input is `{ date?: string; time?: string; day?: string | null }` (date + time are Irish wall-clock; converted on the server)

- [ ] **Step 1: Schema**

In `app/src/lib/db/schema.ts`, after `leadFlowRuns`:

```ts
/**
 * Calls with a lead: logged after the fact (Log a call), or booked ahead
 * (Schedule a call). A timed call also has a diary entry.
 */
export const leadCalls = sqliteTable(
  "lead_calls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    leadId: integer("lead_id").notNull(),
    kind: text("kind", { enum: ["logged", "scheduled"] }).notNull(),
    /** Log a call outcome (lib/leadFlows/callPlan CallOutcome). */
    outcome: text("outcome"),
    /** A timed call, epoch ms. */
    scheduledFor: integer("scheduled_for"),
    /** A call-back day with no time, "YYYY-MM-DD". */
    scheduledDay: text("scheduled_day"),
    calendarEventId: integer("calendar_event_id"),
    note: text("note"),
    userId: integer("user_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({ byLead: index("idx_lead_calls_lead").on(t.leadId, t.createdAt) }),
);
export type LeadCall = typeof leadCalls.$inferSelect;
```

In `app/src/lib/db/tenant.ts`, in the lead-flows block's `sqlite.exec` (after the `lead_flow_runs` index), add:

```sql
    CREATE TABLE IF NOT EXISTS lead_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      outcome TEXT,
      scheduled_for INTEGER,
      scheduled_day TEXT,
      calendar_event_id INTEGER,
      note TEXT,
      user_id INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lead_calls_lead ON lead_calls(lead_id, created_at);
```

- [ ] **Step 2: Write the failing test**

Create `app/src/lib/leadFlows/calls.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/calls.test.ts
//
// Log a call and Schedule a call against a scratch tenant, a fake sender
// and a fixed clock: each outcome moves the card to its column and starts
// that column's flow; a call at a time books the lead, puts the call in the
// diary, confirms now, reminds an hour before and alerts staff 10 minutes
// before; a day without a time reminds staff that morning and starts Call
// back later the morning after if they were not reached; no day starts it
// after its own delay.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead, getLead, getLeadMessages } = requireLocal("../leads") as typeof import("../leads");
  const { listStages, resolveStageIdByRole } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");
  const calls = requireLocal("./calls") as typeof import("./calls");
  const runs = requireLocal("./runs") as typeof import("./runs");
  const { saveLeadFlowSettings } = requireLocal("./settings") as typeof import("./settings");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");

  const s = h.makeScratchTenant("lead-flow-calls-test");
  const fake = h.installFakeTransport();
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const MIN = 60_000;
      const H = 3_600_000;
      const DAY = 86_400_000;
      const WED_10 = Date.parse("2030-01-16T10:00:00Z");
      const clock = h.fakeClock(WED_10);
      const STAFF = 4242; // a user id for the in-app alerts
      const dispatch = (at: number) => dispatchDueAutomationQueue(s.tid, at, "http://app.test");
      const col = (key: string) => listStages().find((c) => c.systemKey === key)!.id;
      const queued = (leadId: number) =>
        tdb.select().from(schema.automationQueue).where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"))).all();
      const active = (leadId: number) => runs.leadFlowStatus(leadId).flow;
      for (const k of ["lead_no_answer", "lead_call_back", "lead_call_booked", "lead_thinking"]) h.setFlowEnabled(s.tid, k, true);
      saveLeadFlowSettings({ window: { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" }, defaultAssigneeUserId: null, alertWhatsAppTo: "+353870000099" });
      const newLead = (tag: string) => upsertLead({ source: "manual", actor: "user", fullName: `Call ${tag}`, email: `${tag}@example.com`, phone: "+353870000030" }).lead;

      // Log a call: each outcome moves the card and starts the column's flow.
      const a = newLead("noanswer");
      ok(calls.logCall(a.id, { outcome: "no_answer" }, STAFF).ok && getLead(a.id)!.stageId === col("no_answer") && active(a.id) === "No answer", "No answer: column and flow");
      const firstRun = runs.activeRun(a.id, "lead_no_answer")!.id;
      calls.logCall(a.id, { outcome: "no_answer", note: "Tried again" }, STAFF);
      ok(runs.activeRun(a.id, "lead_no_answer")!.id !== firstRun, "no answer again: the flow starts again");
      ok(getLeadMessages(a.id).some((m) => m.direction === "note" && m.content === "Call logged: No answer. Tried again"), "a note on the lead");
      ok(calls.listLeadCalls(a.id).length === 2, "both calls are in the call history");
      ok(calls.logCall(a.id, { outcome: "spoke" }, STAFF).ok && getLead(a.id)!.stageId === resolveStageIdByRole("engaged") && active(a.id) === null, "Spoke to them: Hot lead, follow-ups stop");
      calls.logCall(a.id, { outcome: "thinking" }, STAFF);
      ok(getLead(a.id)!.stageId === col("thinking") && active(a.id) === "Thinking about it", "Thinking about it: column and flow");
      calls.logCall(a.id, { outcome: "booked" }, STAFF);
      ok(getLead(a.id)!.stageId === resolveStageIdByRole("booked") && active(a.id) === null, "Booked a treatment: booked column");
      ok(!calls.logCall(a.id, { outcome: "maybe" as never }, STAFF).ok, "an unknown outcome is refused");

      // Schedule a call at a time: Thursday 10:30.
      const b = newLead("timed");
      const callAt = Date.parse("2030-01-17T10:30:00Z");
      ok(!calls.scheduleCall(b.id, { at: WED_10 - MIN }, STAFF).ok, "a time that has passed is refused");
      const booked = calls.scheduleCall(b.id, { at: callAt }, STAFF);
      ok(booked.ok && booked.message.includes("Thursday 17 January at 10:30"), "booked, and said back");
      ok(getLead(b.id)!.stageId === resolveStageIdByRole("booked") && active(b.id) === "Call booked", "booked column, Call booked flow");
      const event = tdb.select().from(schema.calendarEvents).all().find((e) => e.title === "Call: Call timed");
      ok(!!event && event.date === "2030-01-17" && event.startTime === "10:30" && event.endTime === "10:45", "in the diary, 15 minutes");
      const msgs = queued(b.id).filter((q) => q.kind === "message").map((q) => q.dueAt.getTime()).sort((x, y) => x - y);
      ok(msgs[0] === WED_10 && msgs[1] === callAt - H, "confirmation now, reminder an hour before");
      const staff = queued(b.id).find((q) => q.kind === "staff_alert" && q.triggerKey === "call_alert")!;
      ok(staff.dueAt.getTime() === callAt - 10 * MIN && JSON.parse(staff.payload!).userId === STAFF, "the staff alert 10 minutes before");
      clock.set(callAt - 10 * MIN);
      await dispatch(callAt - 10 * MIN);
      const bell = tdb.select().from(schema.notifications).all().find((x) => x.title === "Call in 10 minutes: Call timed");
      ok(!!bell && bell.forUserId === STAFF && bell.body === "+353870000030", "in their bell, with the number");

      // Rescheduling replaces the diary entry.
      clock.set(WED_10);
      calls.scheduleCall(b.id, { at: callAt + DAY }, STAFF);
      ok(tdb.select().from(schema.calendarEvents).all().filter((e) => e.title === "Call: Call timed").length === 1, "a new time replaces the old diary entry");

      // A day without a time: Saturday.
      const c = newLead("daylater");
      const res = calls.scheduleCall(c.id, { day: "2030-01-19" }, STAFF);
      ok(res.ok && getLead(c.id)!.stageId === col("call_back") && active(c.id) === null, "Call back later column; the flow waits");
      const morning = queued(c.id).find((q) => q.kind === "staff_alert" && q.triggerKey === "call_alert")!;
      ok(morning.dueAt.getTime() === Date.parse("2030-01-19T09:00:00Z") && /^Call back today: Call daylater/.test(JSON.parse(morning.payload!).whatsappText), "a reminder that morning, by WhatsApp to the alert number");
      clock.set(Date.parse("2030-01-19T09:00:00Z"));
      await dispatch(Date.parse("2030-01-19T09:00:00Z"));
      ok(fake.sent.some((x) => x.to === "number" && x.text.startsWith("Call back today: Call daylater")), "sent that morning");
      const endOfSat = Date.parse("2030-01-19T23:59:59.999Z");
      clock.set(endOfSat + 1);
      await dispatch(endOfSat + 1);
      ok(active(c.id) === "Call back later", "not reached by the end of the day: Call back later starts");
      const first = queued(c.id).filter((q) => q.kind === "message").map((q) => q.dueAt.getTime()).sort((x, y) => x - y)[0];
      ok(first === Date.parse("2030-01-21T09:00:00Z"), "its first message the next sending morning (Monday)");

      // Reached on the day: no follow-ups.
      clock.set(WED_10);
      const d = newLead("reached");
      calls.scheduleCall(d.id, { day: "2030-01-17" }, STAFF);
      calls.logCall(d.id, { outcome: "spoke" }, STAFF);
      ok(queued(d.id).filter((q) => q.kind === "callback_check").length === 0, "a call logged on the day cancels the check");

      // No day: Call back later starts with its own delay.
      const e = newLead("noday");
      calls.scheduleCall(e.id, {}, STAFF);
      const eFirst = queued(e.id).filter((q) => q.kind === "message").map((q) => q.dueAt.getTime()).sort((x, y) => x - y)[0];
      ok(getLead(e.id)!.stageId === col("call_back") && eFirst === WED_10 + 2 * DAY, "no day: the flow starts after 2 days");
      ok(!calls.scheduleCall(e.id, { day: "2030-01-01" }, STAFF).ok, "a past day is refused");
    });
    console.log(`calls: ${n} checks passed.`);
  } finally {
    fake.restore();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- src/lib/leadFlows/calls.test.ts`
Expected: FAIL, "Cannot find module './calls'".

- [ ] **Step 4: Write `calls.ts`**

Create `app/src/lib/leadFlows/calls.ts`:

```ts
import "server-only";

import { and, desc, eq, gt, isNotNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { Lead, LeadCall } from "@/lib/db/schema";
import { createEvent, deleteEvent } from "@/lib/calendar";
import { addMessage } from "@/lib/leads";
import { personName } from "@/lib/notifications/model";
import { setStageToId } from "@/lib/pipeline/stage";
import { listStages } from "@/lib/pipeline/stageRepo";

import { callBackAlertText } from "./alertText";
import { leadLink, queueStaffAlert } from "./alerts";
import {
  CALL_LENGTH_MINUTES,
  CALL_OUTCOMES,
  callbackDayError,
  callTimeError,
  formatCallDay,
  formatCallTime,
  isCallOutcome,
  outcomeColumn,
  staffCallAlertAt,
  type CallOutcome,
} from "./callPlan";
import { flowNow } from "./clock";
import { CALL_ALERT_KEY, CALL_BOOKED_FLOW, resolveColumn, type ColumnRef } from "./flowModel";
import { startFlow } from "./runs";
import { endOfLocalDay, localParts, morningOf, todayIn } from "./sendingWindow";
import { getLeadFlowSettings } from "./settings";

/**
 * Log a call and Schedule a call, from the lead page and the board card.
 * Every action moves the card as a person would (actor "user"), which stops
 * the lead's flows and cancels any earlier scheduled call's alerts, then
 * sets up what this call needs. Ambient tenant.
 */

export type CallResult = { ok: true; message: string } | { ok: false; error: string };

function moveTo(lead: Lead, ref: ColumnRef, startFlowOnEntry: boolean): { ok: true; name: string } | { ok: false; error: string } {
  const target = resolveColumn(ref, listStages(lead.pipelineId));
  if (!target) return { ok: false, error: "This board has no column for that. Add it under Manage stages." };
  setStageToId(lead.id, target.id, "user", { startFlow: startFlowOnEntry, reenter: true });
  return { ok: true, name: target.name };
}

/** An earlier call still to come is replaced: its diary entry goes. */
function clearUpcomingCall(leadId: number, now: number): void {
  const upcoming = db
    .select({ id: schema.leadCalls.id, eventId: schema.leadCalls.calendarEventId })
    .from(schema.leadCalls)
    .where(and(eq(schema.leadCalls.leadId, leadId), isNotNull(schema.leadCalls.calendarEventId), gt(schema.leadCalls.scheduledFor, now)))
    .all();
  for (const u of upcoming) {
    if (u.eventId != null) deleteEvent(u.eventId);
    db.update(schema.leadCalls).set({ calendarEventId: null }).where(eq(schema.leadCalls.id, u.id)).run();
  }
}

export interface LogCallInput {
  outcome: CallOutcome;
  note?: string | null;
  /** Call back later only: the day they asked for; none = the flow's own delay. */
  callbackDay?: string | null;
}

export function logCall(leadId: number, input: LogCallInput, userId: number | null): CallResult {
  if (!isCallOutcome(input.outcome)) return { ok: false, error: "Pick what happened on the call." };
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!lead) return { ok: false, error: "Lead not found." };
  const note = input.note?.trim().slice(0, 1000) || null;
  if (input.outcome === "call_back") return scheduleCall(leadId, { day: input.callbackDay ?? null }, userId, { logged: true, note });
  const label = CALL_OUTCOMES.find((o) => o.key === input.outcome)!.label;
  const moved = moveTo(lead, outcomeColumn(input.outcome), true);
  if (!moved.ok) return moved;
  db.insert(schema.leadCalls).values({ leadId, kind: "logged", outcome: input.outcome, note, userId, createdAt: flowNow() }).run();
  addMessage({ leadId, direction: "note", channel: "call", content: `Call logged: ${label}.${note ? ` ${note}` : ""}` });
  return { ok: true, message: `Logged. Moved to ${moved.name}.` };
}

export interface ScheduleCallInput {
  /** A call at a time, epoch ms. */
  at?: number | null;
  /** A day without a time, "YYYY-MM-DD". Neither: Call back later with no day. */
  day?: string | null;
}

export function scheduleCall(leadId: number, input: ScheduleCallInput, userId: number | null, opts: { logged?: boolean; note?: string | null } = {}): CallResult {
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!lead) return { ok: false, error: "Lead not found." };
  const now = flowNow();
  const settings = getLeadFlowSettings();
  const name = personName(lead.firstName, lead.lastName, lead.phone || lead.email || "this lead");
  // The alert goes to the lead's assignee, else to whoever scheduled the call.
  const alertTo = lead.assignedUserId ?? userId;
  const record = (patch: Partial<typeof schema.leadCalls.$inferInsert>) =>
    db.insert(schema.leadCalls)
      .values({ leadId, kind: opts.logged ? "logged" : "scheduled", outcome: opts.logged ? "call_back" : null, note: opts.note ?? null, userId, createdAt: now, ...patch })
      .run();

  if (input.at != null) {
    const err = callTimeError(input.at, now);
    if (err) return { ok: false, error: err };
    clearUpcomingCall(leadId, now);
    const moved = moveTo(lead, "role:booked", false);
    if (!moved.ok) return moved;
    startFlow(leadId, CALL_BOOKED_FLOW, { callAt: input.at });
    const start = formatCallTime(input.at);
    const eventId = createEvent(
      {
        title: `Call: ${name}`,
        description: [lead.phone, `/leads/${leadId}`].filter(Boolean).join("\n"),
        date: localParts(input.at).date,
        startTime: start,
        endTime: formatCallTime(input.at + CALL_LENGTH_MINUTES * 60_000),
        allDay: false,
        color: "#3b82f6",
      },
      userId ?? undefined,
    );
    queueStaffAlert({
      leadId,
      triggerKey: CALL_ALERT_KEY,
      dueAt: staffCallAlertAt(now, input.at),
      userId: alertTo,
      title: `Call in 10 minutes: ${name}`,
      body: lead.phone ?? "No phone on file",
      href: `/leads/${leadId}`,
    });
    record({ scheduledFor: input.at, calendarEventId: eventId });
    const when = `${formatCallDay(input.at)} at ${start}`;
    addMessage({ leadId, direction: "note", channel: "call", content: `Call booked for ${when}.` });
    return { ok: true, message: `Call booked for ${when}. Moved to ${moved.name}.` };
  }

  if (input.day) {
    const err = callbackDayError(input.day, todayIn(now));
    if (err) return { ok: false, error: err };
    clearUpcomingCall(leadId, now);
    const moved = moveTo(lead, "key:call_back", false);
    if (!moved.ok) return moved;
    const morning = Math.max(now, morningOf(input.day, settings.window));
    queueStaffAlert({
      leadId,
      triggerKey: CALL_ALERT_KEY,
      dueAt: morning,
      userId: alertTo,
      title: `Call back today: ${name}`,
      body: lead.phone ?? "No phone on file",
      href: `/leads/${leadId}`,
      whatsappText: settings.alertWhatsAppTo ? callBackAlertText({ name, phone: lead.phone, link: leadLink(leadId) }) : null,
    });
    // Not reached by the end of that day (no call logged, card not moved): Call back later starts.
    db.insert(schema.automationQueue)
      .values({
        triggerKey: CALL_ALERT_KEY,
        leadId,
        kind: "callback_check",
        channel: "chat",
        body: `Call back check for ${input.day}`,
        dueAt: new Date(endOfLocalDay(input.day)),
        payload: JSON.stringify({ day: input.day }),
      })
      .run();
    record({ scheduledDay: input.day });
    const dayText = formatCallDay(morningOf(input.day, settings.window));
    addMessage({ leadId, direction: "note", channel: "call", content: `Call back on ${dayText}.` });
    return { ok: true, message: `Call back on ${dayText}. Moved to ${moved.name}.` };
  }

  // No day: the Call back later flow starts after its own first delay.
  const moved = moveTo(lead, "key:call_back", true);
  if (!moved.ok) return moved;
  record({});
  addMessage({ leadId, direction: "note", channel: "call", content: "Call back later, no day set." });
  return { ok: true, message: `Moved to ${moved.name}.` };
}

/** The lead's calls, newest first. */
export function listLeadCalls(leadId: number): LeadCall[] {
  return db.select().from(schema.leadCalls).where(eq(schema.leadCalls.leadId, leadId)).orderBy(desc(schema.leadCalls.createdAt), desc(schema.leadCalls.id)).limit(20).all();
}
```

- [ ] **Step 5: The call-back check in the dispatch**

In `app/src/lib/leadFlows/dispatch.ts`, add `import { startFlow } from "./runs";`, add `endOfLocalDay` to the `./sendingWindow` import and `CALL_BACK_FLOW` to the `./flowModel` import, add this handler and register it as `callback_check: runCallbackCheckRow,` in `HANDLERS`:

```ts
/** End of the picked call-back day: still in Call back later, so nobody reached them. Start its flow the next morning. */
async function runCallbackCheckRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  const { day } = parsePayload(item.payload);
  markRow(ctx.tdb, item.id, { status: "sent", error: null, sentAt: new Date(ctx.now) });
  if (item.leadId == null || !day) return false;
  const lead = ctx.tdb.select({ pipelineId: schema.leads.pipelineId, stageId: schema.leads.stageId }).from(schema.leads).where(eq(schema.leads.id, item.leadId)).get();
  if (!lead) return false;
  const { listStages } = await import("@/lib/pipeline/stageRepo");
  const current = listStages(lead.pipelineId).find((s) => s.id === lead.stageId);
  if (current?.systemKey !== "call_back") return false;
  startFlow(item.leadId, CALL_BACK_FLOW, { firstAt: fitToWindow(endOfLocalDay(day) + 1, "whatsapp", ctx.settings.window), now: ctx.now });
  return false;
}
```

- [ ] **Step 6: The actions**

Append to `app/src/app/leads/callActions.ts` (and add `import { logCall, scheduleCall } from "@/lib/leadFlows/calls";` and `import { zonedTimeToUtc } from "@/lib/leadFlows/sendingWindow";`):

```ts
const logCallSchema = z.object({
  outcome: z.enum(["no_answer", "call_back", "spoke", "thinking", "booked"]),
  note: z.string().max(1000).optional().nullable(),
  callbackDay: z.string().optional().nullable(),
});

/** Log a call that just happened. */
export async function logCallAction(leadId: number, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const id = leadIdSchema.safeParse(leadId);
  const parsed = logCallSchema.safeParse(input);
  if (!id.success) return { ok: false, error: "Lead not found." };
  if (!parsed.success) return { ok: false, error: "Pick what happened on the call." };
  const res = logCall(id.data, parsed.data, user.id);
  revalidatePath(`/leads/${id.data}`);
  revalidatePath("/leads");
  return res.ok ? { ok: true, message: res.message } : res;
}

const scheduleSchema = z.object({
  /** Irish wall-clock date and time of a call at a time. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  /** A call-back day with no time. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

/** Schedule a call: at a time, on a day, or later with no day. */
export async function scheduleCallAction(leadId: number, input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const id = leadIdSchema.safeParse(leadId);
  const parsed = scheduleSchema.safeParse(input);
  if (!id.success) return { ok: false, error: "Lead not found." };
  if (!parsed.success) return { ok: false, error: "Pick a day, or a day and a time." };
  const { date, time, day } = parsed.data;
  const at = date && time ? zonedTimeToUtc(date, time) : null;
  const res = scheduleCall(id.data, { at, day: at ? null : (day ?? null) }, user.id);
  revalidatePath(`/leads/${id.data}`);
  revalidatePath("/leads");
  revalidatePath("/calendar");
  return res.ok ? { ok: true, message: res.message } : res;
}
```

- [ ] **Step 7: Run the tests**

Run: `npm test -- src/lib/leadFlows/calls.test.ts`
Expected: PASS, `calls: 24 checks passed.`
Run every lead-flow test: `for f in src/lib/leadFlows/*.test.ts; do npm test -- "$f" || break; done`
Expected: all PASS.
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/db/schema.ts app/src/lib/db/tenant.ts app/src/lib/leadFlows/calls.ts app/src/lib/leadFlows/calls.test.ts app/src/lib/leadFlows/dispatch.ts app/src/app/leads/callActions.ts
git commit -m "feat(lead-flows): Log a call and Schedule a call, diary entry, call alerts, call-back check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Settings page, Lead follow-ups

**Files:**
- Create: `app/src/app/settings/lead-follow-ups/page.tsx`, `app/src/app/settings/lead-follow-ups/actions.ts`
- Create: `app/src/components/settings/LeadFollowUpsForm.tsx`
- Modify: `app/src/app/settings/page.tsx` (a row next to "Lead pipeline")
- Test: `app/src/lib/leadFlows/settingsModel.test.ts` already covers the validation; this task is verified by typecheck, build and the browser check (Task 18).

**Interfaces:**
- Consumes: `getLeadFlowSettings`, `saveLeadFlowSettings` (Task 2), `validateLeadFlowSettings`, `LeadFlowSettingsInput`, `LeadFlowSettings` (Task 2), `listAssignableStaff`, `isAssignable` (Task 11).
- Produces: `saveLeadFollowUpsAction(input: LeadFlowSettingsInput): Promise<{ ok: true } | { ok: false; error: string }>`; `LeadFollowUpsForm({ initial, staff })` with `staff: { userId: number; name: string }[]`.

- [ ] **Step 1: The action**

Create `app/src/app/settings/lead-follow-ups/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import { isAssignable } from "@/lib/leadFlows/assignment";
import { saveLeadFlowSettings } from "@/lib/leadFlows/settings";
import { validateLeadFlowSettings, type LeadFlowSettingsInput } from "@/lib/leadFlows/settingsModel";

/** Save the business's lead follow-up settings. Admins only. */
export async function saveLeadFollowUpsAction(input: LeadFlowSettingsInput): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const tenantId = getCurrentMembership()?.tenant.id;
  if (!tenantId) return { ok: false, error: "No business selected." };
  const checked = validateLeadFlowSettings(input);
  if (!checked.ok) return checked;
  if (checked.value.defaultAssigneeUserId != null && !isAssignable(tenantId, checked.value.defaultAssigneeUserId)) {
    return { ok: false, error: "That person is not on this account." };
  }
  saveLeadFlowSettings(checked.value);
  revalidatePath("/settings/lead-follow-ups");
  return { ok: true };
}
```

- [ ] **Step 2: The form**

Create `app/src/components/settings/LeadFollowUpsForm.tsx`:

```tsx
"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { BellRing, Clock, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { saveLeadFollowUpsAction } from "@/app/settings/lead-follow-ups/actions";
import type { LeadFlowSettings } from "@/lib/leadFlows/settingsModel";

const DAYS: { d: number; label: string }[] = [
  { d: 1, label: "Mon" },
  { d: 2, label: "Tue" },
  { d: 3, label: "Wed" },
  { d: 4, label: "Thu" },
  { d: 5, label: "Fri" },
  { d: 6, label: "Sat" },
  { d: 0, label: "Sun" },
];

export interface StaffOption {
  userId: number;
  name: string;
}

const section: CSSProperties = { display: "flex", flexDirection: "column", gap: 12, padding: 20 };
const head: CSSProperties = { display: "flex", alignItems: "center", gap: 8, color: "var(--text-primary)" };
const note: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" };
const selectStyle: CSSProperties = {
  width: "100%",
  height: 42,
  padding: "0 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 14,
  fontFamily: "inherit",
};
const dayStyle = (on: boolean): CSSProperties => ({
  minWidth: 56,
  padding: "9px 14px",
  borderRadius: "var(--radius)",
  border: `1px solid ${on ? "var(--accent)" : "var(--hairline)"}`,
  background: on ? "var(--accent)" : "var(--surface-1)",
  color: on ? "var(--accent-contrast)" : "var(--text-secondary)",
  fontSize: 13,
  fontWeight: on ? 600 : 500,
  fontFamily: "inherit",
  cursor: "pointer",
});

export function LeadFollowUpsForm({ initial, staff }: { initial: LeadFlowSettings; staff: StaffOption[] }) {
  // Nothing saved yet: start from today's behaviour (every day, 9am to 9pm).
  const [days, setDays] = useState<number[]>(initial.window?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [start, setStart] = useState(initial.window?.start ?? "09:00");
  const [end, setEnd] = useState(initial.window?.end ?? "21:00");
  const [assignee, setAssignee] = useState(initial.defaultAssigneeUserId != null ? String(initial.defaultAssigneeUserId) : "");
  const [alertTo, setAlertTo] = useState(initial.alertWhatsAppTo ?? "");
  const [hoursSaved, setHoursSaved] = useState(initial.window != null);
  const [saving, startSave] = useTransition();

  const toggleDay = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  function save() {
    startSave(async () => {
      const res = await saveLeadFollowUpsAction({
        window: { days, start, end },
        defaultAssigneeUserId: assignee ? Number(assignee) : null,
        alertWhatsAppTo: alertTo.trim() || null,
      });
      if (res.ok) {
        setHoursSaved(true);
        toast.success("Lead follow-up settings saved.");
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <div style={section}>
          <div style={head}>
            <Clock size={16} aria-hidden />
            <CardLabel>Sending hours</CardLabel>
          </div>
          <p style={note}>
            Follow-up WhatsApps and emails only go out on these days, between these times, Irish time. A message due outside them goes at the start of the
            next sending time. Staff alerts are not held back.
          </p>
          {!hoursSaved && (
            <p style={{ ...note, color: "var(--text-primary)" }}>Not saved yet. Until you save, WhatsApps go between 9am and 9pm every day and emails go at any time.</p>
          )}
          <div role="group" aria-label="Sending days" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {DAYS.map(({ d, label }) => (
              <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => toggleDay(d)} style={dayStyle(days.includes(d))}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <div style={{ flex: "1 1 160px" }}>
              <Label htmlFor="lfu-start">From</Label>
              <Input id="lfu-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <Label htmlFor="lfu-end">Until</Label>
              <Input id="lfu-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div style={section}>
          <div style={head}>
            <UserRound size={16} aria-hidden />
            <CardLabel>Assign new leads to</CardLabel>
          </div>
          <p style={note}>New leads are assigned to this person. They get their own alert for new and hot leads, and for calls you schedule. You can change it on any lead.</p>
          <Label htmlFor="lfu-assignee" srOnly>
            Assign new leads to
          </Label>
          <select id="lfu-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} style={selectStyle}>
            <option value="">Nobody</option>
            {staff.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card>
        <div style={section}>
          <div style={head}>
            <BellRing size={16} aria-hidden />
            <CardLabel>WhatsApp alerts</CardLabel>
          </div>
          <p style={note}>
            New-lead and hot-lead alerts, and call-back reminders, go to this number by WhatsApp from your business WhatsApp. Use a mobile other than the
            business WhatsApp number itself. Leave it empty for no WhatsApp alerts.
          </p>
          <Label htmlFor="lfu-alert" srOnly>
            WhatsApp alerts to
          </Label>
          <Input id="lfu-alert" inputMode="tel" placeholder="WhatsApp number for alerts" value={alertTo} onChange={(e) => setAlertTo(e.target.value)} />
        </div>
      </Card>

      <div style={{ position: "sticky", bottom: 16, display: "flex", justifyContent: "flex-end" }}>
        <Button onClick={save} loading={saving}>
          {saving ? "Saving" : "Save"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: The page and the Settings row**

Create `app/src/app/settings/lead-follow-ups/page.tsx`:

```tsx
import { PageHeader } from "@/components/layout/PageHeader";
import { LeadFollowUpsForm } from "@/components/settings/LeadFollowUpsForm";
import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { listAssignableStaff } from "@/lib/leadFlows/assignment";
import { getLeadFlowSettings } from "@/lib/leadFlows/settings";

export const dynamic = "force-dynamic";

export default async function LeadFollowUpsSettingsPage() {
  await requireAdminPage();
  // requireAdminPage guarantees a membership in the active business.
  const tenantId = getCurrentMembership()!.tenant.id;
  const staff = listAssignableStaff(tenantId).map((s) => ({ userId: s.userId, name: s.name }));
  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader eyebrow="Settings" title="Lead follow-ups" subtitle="When follow-up messages go out, who new leads go to, and where staff alerts are sent." />
      <LeadFollowUpsForm initial={getLeadFlowSettings()} staff={staff} />
    </div>
  );
}
```

In `app/src/app/settings/page.tsx`, add `Clock` to the `lucide-react` import list, and directly after the "Lead pipeline" item add:

```ts
        { href: "/settings/lead-follow-ups", icon: Clock, title: "Lead follow-ups", desc: "Sending hours, who new leads go to, and WhatsApp alerts for staff." },
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/settings/lead-follow-ups/page.tsx app/src/app/settings/lead-follow-ups/actions.ts app/src/components/settings/LeadFollowUpsForm.tsx app/src/app/settings/page.tsx
git commit -m "feat(settings): Lead follow-ups page for sending hours, default assignee and WhatsApp alerts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Log a call / Schedule a call, assignment and consent on the lead page and board card

**Files:**
- Create: `app/src/components/leads/CallDialog.tsx`
- Create: `app/src/components/leads/LeadFollowUpsCard.tsx`
- Modify: `app/src/components/leads/LeadDetail.tsx`
- Modify: `app/src/app/leads/[id]/page.tsx`
- Modify: `app/src/components/pipeline/LeadCard.tsx`, `app/src/components/pipeline/PipelineBoard.tsx`

**Interfaces:**
- Consumes: `logCallAction`, `scheduleCallAction`, `assignLeadAction`, `setLeadMarketingConsentAction`, `ActionResult` (`app/leads/callActions.ts`); `CALL_OUTCOMES`, `CALLBACK_PICKS`, `callbackDay`, `formatCallDay`, `formatCallTime` (callPlan); `todayIn`, `zonedTimeToUtc` (sendingWindow); `listAssignableStaff`, `listLeadCalls`, `leadFlowStatus`.
- Produces:
  - `CallDialog({ leadId, leadName, open, mode, onOpenChange }: { leadId: number; leadName: string; open: boolean; mode: CallMode; onOpenChange: (open: boolean) => void })`, `type CallMode = "log" | "schedule"`
  - `LeadFollowUpsCard({ leadId, assignedUserId, consentAt, staff, flow, calls })`
  - `interface LeadCallView { id: number; kind: string; outcome: string | null; scheduledFor: number | null; scheduledDay: string | null; createdAt: number }`
  - `LeadDetail` props gain `staff: { userId: number; name: string }[]`, `flow: { flow: string | null; next: { channel: string; dueAt: number }[] }`, `calls: LeadCallView[]`
  - `LeadCardProps.onCall?: (id: number) => void`

- [ ] **Step 1: The call dialog**

Create `app/src/components/leads/CallDialog.tsx`:

```tsx
"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, PhoneCall } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { logCallAction, scheduleCallAction, type ActionResult } from "@/app/leads/callActions";
import { CALL_OUTCOMES, CALLBACK_PICKS, callbackDay, type CallbackPick, type CallOutcome } from "@/lib/leadFlows/callPlan";
import { todayIn } from "@/lib/leadFlows/sendingWindow";

export type CallMode = "log" | "schedule";
type DayPick = CallbackPick | "date" | "none";

const pill = (on: boolean): CSSProperties => ({
  padding: "10px 14px",
  borderRadius: "var(--radius)",
  border: `1px solid ${on ? "var(--accent)" : "var(--hairline)"}`,
  background: on ? "var(--accent)" : "var(--surface-1)",
  color: on ? "var(--accent-contrast)" : "var(--text-primary)",
  fontSize: 13.5,
  fontWeight: on ? 600 : 500,
  fontFamily: "inherit",
  cursor: "pointer",
  textAlign: "left",
});
const question: CSSProperties = { fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)", margin: "4px 0 8px" };
const hint: CSSProperties = { fontSize: 12.5, color: "var(--text-tertiary)", margin: "6px 0 0", lineHeight: 1.5 };

function DayPicker(props: { value: DayPick; onChange: (v: DayPick) => void; date: string; onDate: (v: string) => void; today: string }) {
  const { value, onChange, date, onDate, today } = props;
  return (
    <div>
      <div role="radiogroup" aria-label="Which day" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {CALLBACK_PICKS.map((p) => (
          <button key={p.key} type="button" role="radio" aria-checked={value === p.key} style={pill(value === p.key)} onClick={() => onChange(p.key)}>
            {p.label}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={value === "date"} style={pill(value === "date")} onClick={() => onChange("date")}>
          Pick a date
        </button>
        <button type="button" role="radio" aria-checked={value === "none"} style={pill(value === "none")} onClick={() => onChange("none")}>
          No day
        </button>
      </div>
      {value === "date" && (
        <div style={{ marginTop: 10 }}>
          <Label htmlFor="call-day">Day</Label>
          <Input id="call-day" type="date" min={today} value={date} onChange={(e) => onDate(e.target.value)} />
        </div>
      )}
      <p style={hint}>
        {value === "none"
          ? "They go to Call back later. Its follow-ups start after its own wait, 2 days unless you changed it."
          : "They go to Call back later. You get a reminder that morning; if nobody reaches them that day, the follow-ups start the next morning."}
      </p>
    </div>
  );
}

/** Log a call that just happened, or schedule one. Used on the lead page and the board card. */
export function CallDialog({
  leadId,
  leadName,
  open,
  mode,
  onOpenChange,
}: {
  leadId: number;
  leadName: string;
  open: boolean;
  mode: CallMode;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [today, setToday] = useState(() => todayIn(Date.now()));
  const [tab, setTab] = useState<CallMode>(mode);
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [note, setNote] = useState("");
  const [when, setWhen] = useState<"time" | "day">("time");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("10:00");
  const [dayPick, setDayPick] = useState<DayPick>("tomorrow");
  const [pickedDate, setPickedDate] = useState("");
  const [pending, start] = useTransition();

  // Each opening starts clean, on the tab it was opened for.
  useEffect(() => {
    if (!open) return;
    const now = todayIn(Date.now());
    setToday(now);
    setTab(mode);
    setOutcome(null);
    setNote("");
    setWhen("time");
    setDate(now);
    setTime("10:00");
    setDayPick("tomorrow");
    setPickedDate("");
  }, [open, mode]);

  function pickedDay(): { day: string | null } | { error: string } {
    if (dayPick === "none") return { day: null };
    if (dayPick === "date") return pickedDate ? { day: pickedDate } : { error: "Pick a day." };
    return { day: callbackDay(dayPick, today) };
  }

  function done(res: ActionResult) {
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(res.message ?? "Saved.");
    onOpenChange(false);
    router.refresh();
  }

  function submit() {
    start(async () => {
      if (tab === "log") {
        if (!outcome) {
          toast.error("Pick what happened on the call.");
          return;
        }
        let callbackDayValue: string | null = null;
        if (outcome === "call_back") {
          const d = pickedDay();
          if ("error" in d) {
            toast.error(d.error);
            return;
          }
          callbackDayValue = d.day;
        }
        done(await logCallAction(leadId, { outcome, note: note.trim() || null, callbackDay: callbackDayValue }));
        return;
      }
      if (when === "time") {
        if (!date || !time) {
          toast.error("Pick a day and a time.");
          return;
        }
        done(await scheduleCallAction(leadId, { date, time }));
        return;
      }
      const d = pickedDay();
      if ("error" in d) {
        toast.error(d.error);
        return;
      }
      done(await scheduleCallAction(leadId, { day: d.day }));
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={tab === "log" ? "Log a call" : "Schedule a call"} description={leadName} width={540}>
        <div role="tablist" aria-label="Call" style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <button type="button" role="tab" aria-selected={tab === "log"} style={pill(tab === "log")} onClick={() => setTab("log")}>
            <PhoneCall size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} aria-hidden />
            Log a call
          </button>
          <button type="button" role="tab" aria-selected={tab === "schedule"} style={pill(tab === "schedule")} onClick={() => setTab("schedule")}>
            <CalendarClock size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} aria-hidden />
            Schedule a call
          </button>
        </div>

        {tab === "log" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <p style={question}>What happened?</p>
              <div role="radiogroup" aria-label="What happened" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
                {CALL_OUTCOMES.map((o) => (
                  <button key={o.key} type="button" role="radio" aria-checked={outcome === o.key} style={pill(outcome === o.key)} onClick={() => setOutcome(o.key)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            {outcome === "call_back" && (
              <div>
                <p style={question}>When do they want a call?</p>
                <DayPicker value={dayPick} onChange={setDayPick} date={pickedDate} onDate={setPickedDate} today={today} />
              </div>
            )}
            <div>
              <Label htmlFor="call-note" srOnly>
                Note
              </Label>
              <Textarea id="call-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <p style={question}>When?</p>
              <div role="radiogroup" aria-label="When" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button type="button" role="radio" aria-checked={when === "time"} style={pill(when === "time")} onClick={() => setWhen("time")}>
                  At a time
                </button>
                <button type="button" role="radio" aria-checked={when === "day"} style={pill(when === "day")} onClick={() => setWhen("day")}>
                  On a day, no time
                </button>
              </div>
            </div>
            {when === "time" ? (
              <div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  <div style={{ flex: "1 1 180px" }}>
                    <Label htmlFor="call-date">Day</Label>
                    <Input id="call-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div style={{ flex: "1 1 140px" }}>
                    <Label htmlFor="call-time">Time</Label>
                    <Input id="call-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                  </div>
                </div>
                <p style={hint}>They go to Consultation booked and the call goes in the diary. They get a WhatsApp confirmation now and a reminder an hour before; you get an alert 10 minutes before.</p>
              </div>
            ) : (
              <DayPicker value={dayPick} onChange={setDayPick} date={pickedDate} onDate={setPickedDate} today={today} />
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending}>
            {tab === "log" ? "Save" : when === "time" ? "Book the call" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: The follow-ups card**

Create `app/src/components/leads/LeadFollowUpsCard.tsx`:

```tsx
"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Card, CardLabel } from "@/components/ui/Card";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { assignLeadAction, setLeadMarketingConsentAction } from "@/app/leads/callActions";
import { CALL_OUTCOMES, formatCallDay, formatCallTime } from "@/lib/leadFlows/callPlan";
import { zonedTimeToUtc } from "@/lib/leadFlows/sendingWindow";
import { formatDateTime, relativeTime } from "@/lib/utils";

export interface LeadCallView {
  id: number;
  kind: string;
  outcome: string | null;
  scheduledFor: number | null;
  scheduledDay: string | null;
  createdAt: number;
}

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", email: "Email" };

const selectStyle: CSSProperties = {
  width: "100%",
  height: 38,
  padding: "0 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 13,
  fontFamily: "inherit",
};

function callLine(c: LeadCallView): string {
  if (c.scheduledFor != null) return `Call booked for ${formatCallDay(c.scheduledFor)} at ${formatCallTime(c.scheduledFor)}`;
  if (c.scheduledDay) return `Call back on ${formatCallDay(zonedTimeToUtc(c.scheduledDay, "12:00"))}`;
  const label = CALL_OUTCOMES.find((o) => o.key === c.outcome)?.label;
  return label ? `Call: ${label}` : "Call back later, no day";
}

/** Who the lead is assigned to, whether they agreed to marketing, the flow they are in, their calls. */
export function LeadFollowUpsCard({
  leadId,
  assignedUserId,
  consentAt,
  staff,
  flow,
  calls,
}: {
  leadId: number;
  assignedUserId: number | null;
  consentAt: number | null;
  staff: { userId: number; name: string }[];
  flow: { flow: string | null; next: { channel: string; dueAt: number }[] };
  calls: LeadCallView[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [assignee, setAssignee] = useState(assignedUserId != null ? String(assignedUserId) : "");
  const [consent, setConsent] = useState(consentAt != null);
  const [pending, start] = useTransition();

  function assign(value: string) {
    const before = assignee;
    setAssignee(value);
    start(async () => {
      const res = await assignLeadAction(leadId, value ? Number(value) : null);
      if (res.ok) {
        toast.success(res.message ?? "Saved.");
        router.refresh();
      } else {
        setAssignee(before);
        toast.error(res.error);
      }
    });
  }

  async function toggleConsent() {
    const next = !consent;
    if (next) {
      const yes = await confirm({
        title: "They agreed to marketing?",
        body: "Only tick this if they told you they want news and offers. It lets the Long-term nurture flow send to them, and adds them to your email contacts.",
        confirmLabel: "They agreed",
      });
      if (!yes) return;
    }
    start(async () => {
      const res = await setLeadMarketingConsentAction(leadId, next);
      if (res.ok) {
        setConsent(next);
        toast.success(res.message ?? "Saved.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const next = flow.next[0];
  return (
    <Card className="ld-card">
      <CardLabel>Follow-ups</CardLabel>
      <dl className="ld-facts">
        <div>
          <dt>
            <label htmlFor={`assign-${leadId}`}>Assigned to</label>
          </dt>
          <dd>
            <select id={`assign-${leadId}`} value={assignee} onChange={(e) => assign(e.target.value)} disabled={pending} style={selectStyle}>
              <option value="">Nobody</option>
              {staff.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.name}
                </option>
              ))}
            </select>
          </dd>
        </div>
        <div>
          <dt>Marketing</dt>
          <dd>
            <button
              type="button"
              role="switch"
              aria-checked={consent}
              onClick={() => void toggleConsent()}
              disabled={pending}
              style={{
                padding: "7px 12px",
                borderRadius: "var(--radius)",
                border: "1px solid var(--hairline)",
                background: consent ? "var(--accent)" : "var(--surface-1)",
                color: consent ? "var(--accent-contrast)" : "var(--text-secondary)",
                fontSize: 12.5,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {consent ? "Agreed to news and offers" : "Not agreed"}
            </button>
          </dd>
        </div>
        <div>
          <dt>Flow</dt>
          <dd>{flow.flow ?? "None running"}</dd>
        </div>
        {next && (
          <div>
            <dt>Next message</dt>
            <dd>
              {CHANNEL[next.channel] ?? next.channel}, {formatDateTime(next.dueAt)}
            </dd>
          </div>
        )}
      </dl>
      {calls.length > 0 && (
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {calls.slice(0, 5).map((c) => (
            <li key={c.id} style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
              {callLine(c)} <span style={{ color: "var(--text-tertiary)" }}>· {relativeTime(c.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Wire them into the lead page**

In `app/src/components/leads/LeadDetail.tsx`:

- Add `CalendarClock` and `PhoneCall` to the `lucide-react` import, and:

```tsx
import { CallDialog, type CallMode } from "./CallDialog";
import { LeadFollowUpsCard, type LeadCallView } from "./LeadFollowUpsCard";
```

- Add to `Props`:

```tsx
  /** Staff the lead can be assigned to. */
  staff: { userId: number; name: string }[];
  /** The follow-up flow the lead is in and its next messages. */
  flow: { flow: string | null; next: { channel: string; dueAt: number }[] };
  /** Logged and scheduled calls, newest first. */
  calls: LeadCallView[];
```

- Destructure them: `export function LeadDetail({ lead: initialLead, messages: initialMessages, stages, voice, staff, flow, calls }: Props) {`
- Add state after `const [calling, setCalling] = useState(false);`:

```tsx
  const [callMode, setCallMode] = useState<CallMode | null>(null);
```

- In `<div className="ld-actions">`, directly after the stage `</DropdownMenu>`, add:

```tsx
          <Button variant="secondary" onClick={() => setCallMode("log")} disabled={pending}>
            <PhoneCall size={14} /> Log a call
          </Button>
          <Button variant="secondary" onClick={() => setCallMode("schedule")} disabled={pending}>
            <CalendarClock size={14} /> Schedule a call
          </Button>
```

- In `<aside className="ld-side">`, directly after the Details `</Card>`, add:

```tsx
          <LeadFollowUpsCard
            leadId={lead.id}
            assignedUserId={lead.assignedUserId}
            consentAt={lead.marketingConsentAt}
            staff={staff}
            flow={flow}
            calls={calls}
          />
```

- Just before the closing `</div>` of the root `<div className="ld">`, add:

```tsx
      <CallDialog leadId={lead.id} leadName={fullName} open={callMode !== null} mode={callMode ?? "log"} onOpenChange={(o) => !o && setCallMode(null)} />
```

In `app/src/app/leads/[id]/page.tsx`, add imports:

```tsx
import { listAssignableStaff } from "@/lib/leadFlows/assignment";
import { listLeadCalls } from "@/lib/leadFlows/calls";
import { leadFlowStatus } from "@/lib/leadFlows/runs";
```

after `const membership = getCurrentMembership();` add:

```tsx
  const staff = membership ? listAssignableStaff(membership.tenant.id).map((s) => ({ userId: s.userId, name: s.name })) : [];
  const flow = leadFlowStatus(id);
  const calls = listLeadCalls(id).map((c) => ({
    id: c.id,
    kind: c.kind,
    outcome: c.outcome,
    scheduledFor: c.scheduledFor,
    scheduledDay: c.scheduledDay,
    createdAt: c.createdAt,
  }));
```

and pass `staff={staff} flow={flow} calls={calls}` to `<LeadDetail ... />`.

- [ ] **Step 4: The board card**

In `app/src/components/pipeline/LeadCard.tsx`: import `PhoneCall` from `lucide-react`; add to `LeadCardProps`:

```tsx
  /** Opens Log a call / Schedule a call for this lead. */
  onCall?: (id: number) => void;
```

destructure `onCall`, and inside `<span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>` add before the AI draft tooltip:

```tsx
          {onCall && (
            <Tooltip label="Log or schedule a call">
              <button
                type="button"
                aria-label="Log or schedule a call"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onCall(lead.id);
                }}
                style={iconBtn}
              >
                <PhoneCall size={14} />
              </button>
            </Tooltip>
          )}
```

In `app/src/components/pipeline/PipelineBoard.tsx`:

- `import { CallDialog } from "@/components/leads/CallDialog";`
- state after `const [manageOpen, setManageOpen] = useState(false);`:

```tsx
  const [callLead, setCallLead] = useState<{ id: number; name: string } | null>(null);
```

- after `const whatsappLead = ...`:

```tsx
  const callLeadOpen = useCallback(
    (id: number) => {
      const l = leads.find((x) => x.id === id);
      if (l) setCallLead({ id, name: [l.firstName, l.lastName].filter(Boolean).join(" ") || "This lead" });
    },
    [leads],
  );
```

- pass `onCall={callLeadOpen}` to both `<DraggableCard ... />` uses; add `onCall` to `DraggableCard`'s props (`onCall: (id: number) => void;`) and pass it on to its `<LeadCard ... onCall={onCall} />`.
- after the `{canManageStages && (...)}` block, add:

```tsx
      <CallDialog
        leadId={callLead?.id ?? 0}
        leadName={callLead?.name ?? ""}
        open={callLead !== null}
        mode="log"
        onOpenChange={(o) => !o && setCallLead(null)}
      />
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck`
Expected: exit 0.
Run: `npm test -- src/lib/leadFlows/calls.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/leads/CallDialog.tsx app/src/components/leads/LeadFollowUpsCard.tsx app/src/components/leads/LeadDetail.tsx "app/src/app/leads/[id]/page.tsx" app/src/components/pipeline/LeadCard.tsx app/src/components/pipeline/PipelineBoard.tsx
git commit -m "feat(leads): Log a call and Schedule a call on the lead page and board card; assignment and consent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: The automations editor for flows

**Files:**
- Modify: `app/src/lib/automations.ts` (`getTrigger`, `saveTrigger`)
- Modify: `app/src/app/automations/actions.ts` (schema)
- Modify: `app/src/components/automations/TriggerEditor.tsx`
- Test: `app/src/lib/leadFlows/editorSettings.test.ts`

**Interfaces:**
- Consumes: `flowStartColumn`, `flowFinish` (Task 6), `flowDefaults`, `columnRefFor`, `isColumnRef`, `isColumnStartedFlow`, `hasFinishStep`, `LEAD_FLOW_KEY_SET`, `CALL_BOOKED_FLOW` (Task 4), `defaultMessagesFor` (Task 4), `flowTenant` (Task 6), `listStages`.
- Produces:
  - `interface FlowEditorInfo { columnStarted: boolean; finishable: boolean; beforeCall: boolean; columns: { ref: string; name: string }[] }`
  - `TriggerDetail` gains `flow: FlowEditorInfo | null` and `defaults: MessageInput[]`, and fills `startColumn`, `finishColumn`, `finishAfterValue`, `finishAfterUnit` for lead flows; messages carry `matchInterest`
  - `saveTrigger` stores the flow columns and `matchInterest`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/leadFlows/editorSettings.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/editorSettings.test.ts
//
// What the /automations editor reads and saves for a flow: the start column,
// the finish move, the treatment keywords, and the default wording; and
// that a saved setting is what the engine then uses.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const automations = requireLocal("../automations") as typeof import("../automations");
  const { getFlowDefinition } = requireLocal("./definitions") as typeof import("./definitions");
  const { DEFAULT_MESSAGES } = requireLocal("../automationModel") as typeof import("../automationModel");

  const s = h.makeScratchTenant("lead-flow-editor-test");
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const t = automations.getTrigger("lead_no_answer")!;
      ok(!!t.flow && t.flow.columnStarted && t.flow.finishable && !t.flow.beforeCall, "No answer: column-started, can finish with a move");
      ok(t.startColumn === "key:no_answer" && t.finishColumn === "key:nurture" && t.finishAfterValue === 4 && t.finishAfterUnit === "days", "the defaults are shown");
      ok(t.flow!.columns.some((c) => c.ref === "key:no_answer" && c.name === "No answer") && t.flow!.columns.some((c) => c.ref === "role:booked"), "every column of the main board is offered");
      ok(t.defaults.length === DEFAULT_MESSAGES.lead_no_answer.length, "the default wording is there to fall back to");
      ok(automations.getTrigger("lead_call_booked")!.flow!.beforeCall && !automations.getTrigger("lead_call_booked")!.flow!.finishable, "Call booked: counted back from the call, no finish move");
      ok(automations.getTrigger("client_birthday")!.flow === null, "not a lead flow: no flow settings");

      automations.saveTrigger({
        key: "lead_no_answer",
        enabled: true,
        externalEnabled: false,
        startColumn: "key:thinking",
        finishColumn: "",
        finishAfterValue: 9,
        finishAfterUnit: "days",
        messages: [
          { channel: "whatsapp", subject: null, template: "Hi [FIRST_NAME]", attachmentFilename: null, attachmentOriginal: null, delayValue: 0, delayUnit: "days", matchInterest: " hbot, hyperbaric " },
        ],
      });
      const def = getFlowDefinition("lead_no_answer");
      ok(def.enabled && def.startColumn === "key:thinking" && def.finish === null, "saved: starts from Thinking about it, no finish move");
      ok(def.messages[0].matchInterest === "hbot, hyperbaric", "keywords saved, trimmed");
      const back = automations.getTrigger("lead_no_answer")!;
      ok(back.startColumn === "key:thinking" && back.finishColumn === "" && back.messages[0].matchInterest === "hbot, hyperbaric", "and read back by the editor");

      automations.saveTrigger({ key: "lead_no_answer", enabled: true, externalEnabled: false, startColumn: "role:nope", finishColumn: "key:nurture", finishAfterValue: 4, finishAfterUnit: "days", messages: [] });
      ok(getFlowDefinition("lead_no_answer").startColumn === "key:no_answer", "a column reference that makes no sense falls back to the default");
      automations.saveTrigger({ key: "new_lead", enabled: false, externalEnabled: false, startColumn: "key:thinking", messages: [] });
      ok(getFlowDefinition("new_lead").startColumn === null, "a flow with a fixed trigger never gets a start column");
    });
    console.log(`editorSettings: ${n} checks passed.`);
  } finally {
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/lib/leadFlows/editorSettings.test.ts`
Expected: FAIL (`t.flow` is undefined).

- [ ] **Step 3: `lib/automations.ts`**

Add imports:

```ts
import { flowFinish, flowStartColumn } from "@/lib/leadFlows/definitions";
import { CALL_BOOKED_FLOW, LEAD_FLOW_KEY_SET, columnRefFor, flowDefaults, hasFinishStep, isColumnRef, isColumnStartedFlow } from "@/lib/leadFlows/flowModel";
import { defaultMessagesFor } from "@/lib/leadFlows/presets";
import { flowTenant } from "@/lib/leadFlows/tenant";
import { listStages } from "@/lib/pipeline/stageRepo";
```

Replace the `TriggerDetail` interface and `getTrigger` with:

```ts
/** The flow settings the editor offers for a lead flow. */
export interface FlowEditorInfo {
  /** "Starts when a lead enters" is offered. */
  columnStarted: boolean;
  /** "If they have not replied by the end, move them to" is offered. */
  finishable: boolean;
  /** Call booked: later messages are counted back from the call. */
  beforeCall: boolean;
  /** The main board's columns, as column references. */
  columns: { ref: string; name: string }[];
}

export interface TriggerDetail extends TriggerInput {
  label: string;
  description: string;
  status: TriggerStatus;
  /** Lead flows only. */
  flow: FlowEditorInfo | null;
  /** This business's starter wording (its preset, else the neutral default), for "Use the default wording". */
  defaults: MessageInput[];
}

export function getTrigger(key: string): TriggerDetail | null {
  const def = TRIGGER_CATALOG.find((t) => t.key === key);
  if (!def) return null;
  const state = db.select().from(automationTriggers).where(eq(automationTriggers.key, key)).get();
  const messages = db
    .select()
    .from(automationMessages)
    .where(eq(automationMessages.triggerKey, key))
    .orderBy(asc(automationMessages.position))
    .all();
  const defaults = defaultMessagesFor(key, flowTenant()?.slug);
  // No message configured yet → offer the ready-made starter messages.
  const mapped =
    messages.length > 0
      ? messages.map((m) => ({
          id: m.id,
          channel: m.channel as Channel,
          subject: m.subject,
          template: m.template ?? "",
          attachmentFilename: m.attachmentFilename,
          attachmentOriginal: m.attachmentOriginal,
          delayValue: m.delayValue,
          delayUnit: m.delayUnit as IntervalUnit,
          matchInterest: m.matchInterest ?? null,
        }))
      : defaults.map((m) => ({ ...m }));
  const isFlow = LEAD_FLOW_KEY_SET.has(key);
  const finish = isFlow ? flowFinish(key, state) : null;
  const fd = flowDefaults(key);
  return {
    key,
    label: def.label,
    description: def.description,
    status: def.status,
    enabled: isTriggerEnabled(key, state),
    externalEnabled: state?.externalEnabled ?? false,
    messages: mapped,
    startColumn: isFlow ? (flowStartColumn(key, state) ?? "") : null,
    finishColumn: isFlow ? (finish?.column ?? "") : null,
    finishAfterValue: state?.finishAfterValue ?? fd.finishAfter?.value ?? 7,
    finishAfterUnit: (state?.finishAfterUnit as IntervalUnit | null | undefined) ?? fd.finishAfter?.unit ?? "days",
    flow: isFlow
      ? {
          columnStarted: isColumnStartedFlow(key),
          finishable: hasFinishStep(key),
          beforeCall: key === CALL_BOOKED_FLOW,
          columns: listStages().map((s) => ({ ref: columnRefFor(s), name: s.name })),
        }
      : null,
    defaults,
  };
}
```

Add above `saveTrigger`:

```ts
/** A column reference to store: "" = none, a valid ref, else null (the default). */
function storedRef(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (t === "") return "";
  return isColumnRef(t) ? t : null;
}

/** The flow columns of automation_triggers for a save (empty for a trigger that is not a lead flow). */
function flowColumns(input: TriggerInput) {
  if (!LEAD_FLOW_KEY_SET.has(input.key)) return {};
  const finishable = hasFinishStep(input.key);
  return {
    startColumn: isColumnStartedFlow(input.key) ? storedRef(input.startColumn) : null,
    finishColumn: finishable ? storedRef(input.finishColumn) : null,
    finishAfterValue: finishable && input.finishAfterValue != null ? Math.max(0, Math.min(1000, Math.round(input.finishAfterValue))) : null,
    finishAfterUnit: finishable && input.finishAfterUnit ? input.finishAfterUnit : null,
  };
}
```

In `saveTrigger`, spread `...flowColumns(input)` into both the `tx.update(automationTriggers).set({...})` object and the `tx.insert(automationTriggers).values({...})` object, and add to each inserted message:

```ts
          matchInterest: m.matchInterest?.trim() || null,
```

Remove `DEFAULT_MESSAGES` from this file's imports only if nothing else in it still uses it (the immediate-send path further down does; keep it there).

- [ ] **Step 4: The action schema**

In `app/src/app/automations/actions.ts`, add to `messageSchema`:

```ts
  matchInterest: z.string().trim().max(200).nullable().optional(),
```

and to `triggerSchema`:

```ts
  startColumn: z.string().trim().max(40).nullable().optional(),
  finishColumn: z.string().trim().max(40).nullable().optional(),
  finishAfterValue: z.coerce.number().int().min(0).max(1000).nullable().optional(),
  finishAfterUnit: z.enum(["minutes", "hours", "days"]).nullable().optional(),
```

- [ ] **Step 5: The editor**

In `app/src/components/automations/TriggerEditor.tsx`:

- add `import Link from "next/link";` and import `type IntervalUnit` from `@/lib/automationModel` (with the others).
- extend `Detail`:

```tsx
interface Detail {
  key: string;
  label: string;
  description: string;
  status: TriggerStatus;
  enabled: boolean;
  externalEnabled: boolean;
  messages: MessageInput[];
  startColumn?: string | null;
  finishColumn?: string | null;
  finishAfterValue?: number | null;
  finishAfterUnit?: IntervalUnit | null;
  flow: { columnStarted: boolean; finishable: boolean; beforeCall: boolean; columns: { ref: string; name: string }[] } | null;
  defaults: MessageInput[];
}
```

- state, after `const [messages, setMessages] = ...`:

```tsx
  const [startColumn, setStartColumn] = useState(initial.startColumn ?? "");
  const [finishColumn, setFinishColumn] = useState(initial.finishColumn ?? "");
  const [finishAfterValue, setFinishAfterValue] = useState<number>(initial.finishAfterValue ?? 7);
  const [finishAfterUnit, setFinishAfterUnit] = useState<IntervalUnit>(initial.finishAfterUnit ?? "days");
```

- in `save`, the action payload becomes:

```tsx
      const res = await saveTriggerAction({
        key: initial.key,
        enabled,
        externalEnabled,
        messages: messages.filter((m) => m.template.trim() || m.attachmentFilename),
        ...(initial.flow ? { startColumn, finishColumn, finishAfterValue, finishAfterUnit } : {}),
      });
```

- directly after the Name card (`{/* Name */}` block), add:

```tsx
      {initial.flow && !comingSoon && (
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>When it runs</div>
          {initial.flow.columnStarted && (
            <div>
              <Label htmlFor="flow-start">Starts when a lead enters</Label>
              <select id="flow-start" value={startColumn} onChange={(e) => setStartColumn(e.target.value)} style={flowSelect}>
                <option value="">No column (it never starts)</option>
                {initial.flow.columns.map((c) => (
                  <option key={c.ref} value={c.ref}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div style={flowHint}>Starting a flow stops any other flow the lead is in. Entering the column again starts it again.</div>
            </div>
          )}
          {initial.flow.finishable && (
            <div>
              <Label htmlFor="flow-finish">If they have not replied by the end, move them to</Label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <select id="flow-finish" value={finishColumn} onChange={(e) => setFinishColumn(e.target.value)} style={{ ...flowSelect, flex: "1 1 220px", width: "auto" }}>
                  <option value="">Leave them where they are</option>
                  {initial.flow.columns.map((c) => (
                    <option key={c.ref} value={c.ref}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  min={0}
                  aria-label="After"
                  value={finishAfterValue}
                  disabled={!finishColumn}
                  onChange={(e) => setFinishAfterValue(Math.max(0, Number(e.target.value) || 0))}
                  style={{ flex: "0 0 96px", width: 96 }}
                />
                <select aria-label="Unit" value={finishAfterUnit} disabled={!finishColumn} onChange={(e) => setFinishAfterUnit(e.target.value as IntervalUnit)} style={{ ...flowSelect, flex: "0 0 130px", width: 130 }}>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </div>
              <div style={flowHint}>Counted from when the flow starts, like the message delays.</div>
            </div>
          )}
          {initial.flow.beforeCall && (
            <div style={flowHint}>The first message goes when the call is booked. Every later message is counted back from the call: 1 hour means an hour before it.</div>
          )}
          <div style={flowHint}>
            Messages only go out in your sending hours. Set them in <Link href="/settings/lead-follow-ups">Settings, Lead follow-ups</Link>.
          </div>
        </div>
      )}
```

- in the `MessageCard` map, pass two more props: `interestVersions={!!initial.flow}` and `beforeCall={!!initial.flow?.beforeCall}`.
- next to "Add another message", add:

```tsx
            {initial.defaults.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => {
                  setMessages(initial.defaults.map((m) => ({ ...m })));
                  toast.success("Default wording loaded. Save to keep it.");
                }}
              >
                Use the default wording
              </Button>
            )}
```

(wrap the two buttons in `<div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>`).
- `MessageCard`: add `interestVersions: boolean; beforeCall: boolean;` to its props (documented "Lead flows: the treatment keywords field" and "Call booked: later delays count back from the call"). Replace the delay label expression with:

```tsx
            {beforeCall && index > 0 ? "Send this long before the call" : delaysLive ? "Send this message after" : "When do you want to send this message?"}
```

and wrap the whole delay grid and its hint in `{beforeCall && index === 0 ? (<div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Sent when the call is booked.</div>) : (<> ...the existing delay grid and hint... </>)}`. Replace the delay hint text with:

```tsx
          {delaysLive
            ? beforeCall
              ? "Counted back from the call. A reminder that sending hours would push past the call is not sent."
              : "Counted from when the flow starts. Messages go inside your sending hours (Settings, Lead follow-ups); with none set, WhatsApps go between 9am and 9pm Irish time and emails straight away."
            : "Scheduled & multi-channel sending coming soon — for now every message sends by Email, immediately."}
```

After the template block, add:

```tsx
      {interestVersions && (
        <div>
          <Label htmlFor={`interest-${index}`}>Only for leads interested in</Label>
          <Input id={`interest-${index}`} value={message.matchInterest ?? ""} onChange={(e) => onPatch({ matchInterest: e.target.value })} placeholder="Everyone" />
          <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 6 }}>
            Leave empty for everyone. Words separated by commas, matched against what the lead asked about (for example: hbot, hyperbaric). Type other for the version everyone else gets at the same time.
          </div>
        </div>
      )}
```

- add the two styles at the bottom of the file:

```tsx
const flowSelect: React.CSSProperties = {
  width: "100%",
  height: 40,
  padding: "0 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 13,
};
const flowHint: React.CSSProperties = { fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 6, lineHeight: 1.5 };
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- src/lib/leadFlows/editorSettings.test.ts`
Expected: PASS, `editorSettings: 11 checks passed.`
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/automations.ts app/src/app/automations/actions.ts app/src/components/automations/TriggerEditor.tsx app/src/lib/leadFlows/editorSettings.test.ts
git commit -m "feat(automations): start column, finish move, treatment versions and default wording in the flow editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: End-to-end flows test

**Files:**
- Test: `app/src/lib/leadFlows/flows.e2e.test.ts`

**Interfaces:**
- Consumes: every earlier task, through public entry points only: `upsertLead`, `logCall`, `scheduleCall`, `onInboundFromLead`, `onLeadReplyTriaged`, `suppress`, `dispatchDueAutomationQueue`.
- Produces: nothing (a test).

- [ ] **Step 1: Write the test**

Create `app/src/lib/leadFlows/flows.e2e.test.ts`:

```ts
// Run: npm test -- src/lib/leadFlows/flows.e2e.test.ts
//
// End to end, on a scratch business set up like Optimal Health (Monday to
// Saturday 09:00-18:00, a default assignee, a WhatsApp alert number), with
// a fake sender and a fake clock. Leads run through each flow from the way
// it starts to the way it ends, through the same entry points the app uses.
// Every message to a lead is sent inside sending hours, and nothing reaches
// a real provider.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const { and, asc, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { upsertLead, getLead } = requireLocal("../leads") as typeof import("../leads");
  const stage = requireLocal("../pipeline/stage") as typeof import("../pipeline/stage");
  const { listStages, resolveStageIdByRole } = requireLocal("../pipeline/stageRepo") as typeof import("../pipeline/stageRepo");
  const calls = requireLocal("./calls") as typeof import("./calls");
  const runs = requireLocal("./runs") as typeof import("./runs");
  const { saveLeadFlowSettings } = requireLocal("./settings") as typeof import("./settings");
  const { dispatchDueAutomationQueue } = requireLocal("./dispatch") as typeof import("./dispatch");
  const { nextSendTime } = requireLocal("./sendingWindow") as typeof import("./sendingWindow");
  const { suppress } = requireLocal("../marketing/suppress") as typeof import("../marketing/suppress");

  const s = h.makeScratchTenant("lead-flow-e2e-test");
  const fake = h.installFakeTransport();
  const staffEmail = "e2e-staff@example.com";
  const dropStaff = () => {
    const u = controlSqlite.prepare("SELECT id FROM users WHERE email = ?").get(staffEmail) as { id: number } | undefined;
    if (u) {
      controlSqlite.prepare("DELETE FROM memberships WHERE user_id = ?").run(u.id);
      controlSqlite.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    }
  };
  dropStaff();
  const staffId = (controlSqlite.prepare("INSERT INTO users (email, name, password_hash) VALUES (?, 'E2e Staff', 'x') RETURNING id").get(staffEmail) as { id: number }).id;
  controlSqlite.prepare("INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, 'staff')").run(staffId, s.tid);
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const tdb = getTenantDbById(s.tid);
      const q = schema.automationQueue;
      const DAY = 86_400_000;
      const OH = { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" };
      saveLeadFlowSettings({ window: OH, defaultAssigneeUserId: staffId, alertWhatsAppTo: "+353870000099" });
      for (const k of ["new_lead", "lead_no_answer", "lead_call_back", "lead_call_booked", "lead_thinking", "lead_nurture"]) h.setFlowEnabled(s.tid, k, true);
      const clock = h.fakeClock(Date.parse("2030-01-19T19:30:00Z")); // a Saturday evening
      const col = (k: string) => listStages().find((c) => c.systemKey === k)!.id;
      const engaged = resolveStageIdByRole("engaged")!;

      /** Run the ticker at every due time up to `until`, the way it runs every minute. */
      async function runUntil(until: number) {
        for (let i = 0; i < 1000; i++) {
          const next = tdb.select({ dueAt: q.dueAt }).from(q).where(eq(q.status, "queued")).orderBy(asc(q.dueAt)).limit(1).get();
          if (!next || next.dueAt.getTime() > until) break;
          const at = Math.max(next.dueAt.getTime(), clock.now());
          clock.set(at);
          await dispatchDueAutomationQueue(s.tid, at, "http://app.test");
        }
        clock.set(Math.max(clock.now(), until));
      }
      const sent = (leadId: number) => tdb.select().from(q).where(and(eq(q.leadId, leadId), eq(q.kind, "message"), eq(q.status, "sent"))).all();
      const toNumber = (prefix: string) => fake.sent.some((x) => x.to === "number" && x.address === "+353870000099" && x.text.startsWith(prefix));

      // 1. A website enquiry on a Saturday evening: New lead, then Long-term nurture, then a reply.
      const { lead: aoife } = upsertLead({
        source: "website",
        sourceLeadId: "website:e2e-aoife@example.com",
        fullName: "Aoife Example",
        email: "e2e-aoife@example.com",
        phone: "+353870000040",
        therapyInterest: "Hyperbaric oxygen",
        marketingConsent: "form",
      });
      ok(getLead(aoife.id)!.assignedUserId === staffId, "assigned to the default person");
      await runUntil(clock.now());
      ok(toNumber("New lead: Aoife Example, From the website."), "the alert number hears at once");
      ok(sent(aoife.id).length === 0, "the lead hears nothing on a Saturday evening");
      await runUntil(Date.parse("2030-01-21T09:00:00Z"));
      ok(sent(aoife.id).some((r) => r.channel === "whatsapp" && r.sentAt!.getTime() === Date.parse("2030-01-21T09:00:00Z")), "the first WhatsApp goes Monday at 9");
      await runUntil(Date.parse("2030-02-05T09:00:00Z"));
      ok(sent(aoife.id).filter((r) => r.triggerKey === "new_lead" && r.channel === "whatsapp").length === 3, "New lead: all three WhatsApps went");
      ok(getLead(aoife.id)!.stageId === col("nurture"), "no reply: Long-term nurture");
      ok(runs.leadFlowStatus(aoife.id).flow === "Long-term nurture", "its flow runs, because she agreed to marketing");
      const nurtureMail = fake.sent.filter((x) => x.to === "email" && x.address === "e2e-aoife@example.com").at(-1);
      ok(!!nurtureMail && /http:\/\/app\.test\/u\//.test(nurtureMail.html ?? ""), "the nurture email carries the unsubscribe link");
      stage.onInboundFromLead(aoife.id, { text: "Yes, I'd like to book an HBOT session next week", channel: "whatsapp" });
      ok(getLead(aoife.id)!.stageId === engaged && runs.leadFlowStatus(aoife.id).flow === null, "a reply: Hot lead, and nurture stops");
      await runUntil(clock.now());
      ok(toNumber('Hot lead: Aoife Example replied: "Yes, I\'d like to book'), "the alert number hears she is hot");

      // 2. A Facebook lead: no answer, a call-back day, not reached, then a call at a time, then booked.
      clock.set(Date.parse("2030-02-05T11:00:00Z")); // Tuesday
      const { lead: brian } = upsertLead({ source: "facebook", sourceLeadId: "fb-e2e-brian", fullName: "Brian Example", phone: "+353870000041" });
      calls.logCall(brian.id, { outcome: "no_answer" }, staffId);
      await runUntil(clock.now());
      ok(sent(brian.id).filter((r) => r.triggerKey === "lead_no_answer").length === 1, "No answer: the tried-to-ring-you WhatsApp at once");
      stage.onInboundFromLead(brian.id, { text: "Ring me Thursday", channel: "whatsapp" });
      calls.scheduleCall(brian.id, { day: "2030-02-07" }, staffId);
      await runUntil(Date.parse("2030-02-07T09:00:00Z"));
      ok(toNumber("Call back today: Brian Example"), "Thursday morning: the call-back reminder");
      await runUntil(Date.parse("2030-02-08T09:00:00Z"));
      ok(runs.leadFlowStatus(brian.id).flow === "Call back later", "not reached on Thursday: Call back later starts");
      ok(sent(brian.id).some((r) => r.triggerKey === "lead_call_back" && r.sentAt!.getTime() === Date.parse("2030-02-08T09:00:00Z")), "its first message Friday at 9");
      const callAt = Date.parse("2030-02-11T10:30:00Z"); // Monday 10:30
      calls.scheduleCall(brian.id, { at: callAt }, staffId);
      await runUntil(callAt);
      const callMsgs = sent(brian.id).filter((r) => r.triggerKey === "lead_call_booked");
      ok(callMsgs.length === 2 && callMsgs.some((r) => r.sentAt!.getTime() === callAt - 3_600_000), "Call booked: the confirmation and the reminder an hour before");
      ok(tdb.select().from(schema.notifications).all().some((x) => x.title === "Call in 10 minutes: Brian Example" && x.forUserId === staffId), "the assignee's alert 10 minutes before");
      calls.logCall(brian.id, { outcome: "booked" }, staffId);
      ok(getLead(brian.id)!.stageId === resolveStageIdByRole("booked") && runs.leadFlowStatus(brian.id).flow === null, "Booked a treatment: in the booked column, no flow");

      // 3. Thinking about it: a question is not a yes, so Long-term nurture a week later; then an unsubscribe.
      const { lead: ciara } = upsertLead({
        source: "website",
        sourceLeadId: "website:e2e-ciara@example.com",
        fullName: "Ciara Example",
        email: "e2e-ciara@example.com",
        phone: "+353870000042",
        marketingConsent: "form",
      });
      calls.logCall(ciara.id, { outcome: "thinking" }, staffId);
      await runUntil(clock.now() + 6 * DAY);
      ok(sent(ciara.id).filter((r) => r.triggerKey === "lead_thinking").length === 1, "Thinking about it: the first check-in after 5 days");
      stage.onInboundFromLead(ciara.id, { text: "How much is a session?", messageId: 9001 });
      stage.onLeadReplyTriaged(ciara.id, 9001, { category: "faq", priority: "normal" });
      ok(getLead(ciara.id)!.stageId === col("thinking"), "a question is not a yes: she stays");
      await runUntil(clock.now() + 7 * DAY + 1);
      ok(getLead(ciara.id)!.stageId === col("nurture") && runs.leadFlowStatus(ciara.id).flow === "Long-term nurture", "a week on: Long-term nurture");
      suppress(s.tid, "e2e-ciara@example.com", "unsubscribe");
      ok(runs.leadFlowStatus(ciara.id).flow === null && getLead(ciara.id)!.marketingConsentAt === null, "an unsubscribe stops it");

      // 4. The first WhatsApp never arrives: Message undelivered, the rest by email.
      const { lead: dara } = upsertLead({ source: "website", sourceLeadId: "website:e2e-dara@example.com", fullName: "Dara Example", email: "e2e-dara@example.com", phone: "+353870000043" });
      fake.failWhatsAppFor.add(dara.id);
      await runUntil(clock.now() + DAY);
      const daraLeft = tdb.select().from(q).where(and(eq(q.leadId, dara.id), eq(q.status, "queued"), eq(q.kind, "message"))).all();
      ok(getLead(dara.id)!.stageId === col("undelivered") && daraLeft.length > 0 && daraLeft.every((r) => r.channel === "email"), "Message undelivered, and the rest goes by email");

      // Every message to a lead went inside sending hours, and nothing went anywhere real.
      const allSent = tdb.select().from(q).where(and(eq(q.kind, "message"), eq(q.status, "sent"))).all();
      ok(allSent.length >= 10 && allSent.every((r) => nextSendTime(r.sentAt!.getTime(), OH) === r.sentAt!.getTime()), "every message to a lead went Monday to Saturday, 09:00-18:00");
      ok(fake.sent.every((x) => x.to !== "number" || x.address === "+353870000099"), "staff alerts only ever went to the alert number");
    });
    console.log(`flows.e2e: ${n} checks passed.`);
  } finally {
    fake.restore();
    dropStaff();
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npm test -- src/lib/leadFlows/flows.e2e.test.ts`
Expected: PASS, `flows.e2e: 24 checks passed.` If a check fails, the bug is in the engine, not the test: find it in the task that owns it, fix it there (with that task's test still passing), and re-run.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/leadFlows/flows.e2e.test.ts
git commit -m "test(lead-flows): end-to-end run of every flow on a fake clock and a fake sender

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Whole-suite verification and the browser check

**Files:**
- Create then delete: `app/src/app/f/zz-lead-flows/page.tsx`, `app/src/app/f/zz-lead-flows/client.tsx` (throwaway fixtures; never committed)
- Screenshots: `/private/tmp/claude-502/-Users-truep-Desktop-Clients-Renova/76afd0d7-75fd-4576-a2e5-b6a47b0676a5/scratchpad/flow-shots/`

- [ ] **Step 1: The whole suite, typecheck and build**

Run (from `app/`): `npm test`
Expected: every file passes except the pre-existing `src/lib/programs/memberPrograms.test.ts` ("the library has a hammer curl"), which fails on a clean checkout too.
Run: `npm run typecheck` (exit 0) and `npx next build` (completes).

- [ ] **Step 2: Throwaway fixture route**

Create `app/src/app/f/zz-lead-flows/client.tsx`:

```tsx
"use client";

import { useState } from "react";

import { CallDialog, type CallMode } from "@/components/leads/CallDialog";
import { LeadCard } from "@/components/pipeline/LeadCard";
import type { LeadWithSla } from "@/lib/leads";

export function ZzCall({ mode }: { mode: CallMode }) {
  const [open, setOpen] = useState(true);
  return <CallDialog leadId={1} leadName="Aoife Example" open={open} mode={mode} onOpenChange={setOpen} />;
}

export function ZzCard({ lead }: { lead: LeadWithSla }) {
  return (
    <div style={{ width: 280, padding: 16 }}>
      <LeadCard lead={lead} now={Date.now()} onDraft={() => {}} onWhatsApp={() => {}} onCall={() => {}} />
    </div>
  );
}
```

Create `app/src/app/f/zz-lead-flows/page.tsx` (fixtures only, no database):

```tsx
import { LeadDetail } from "@/components/leads/LeadDetail";
import { LeadFollowUpsForm } from "@/components/settings/LeadFollowUpsForm";
import { TriggerEditor } from "@/components/automations/TriggerEditor";
import { DEFAULT_MESSAGES } from "@/lib/automationModel";
import type { Lead } from "@/lib/db/schema";
import type { LeadWithSla } from "@/lib/leads";
import { DEFAULT_STAGES, type StageRecord } from "@/lib/pipeline/roles";

import { ZzCall, ZzCard } from "./client";

export const dynamic = "force-dynamic";

const stages: StageRecord[] = DEFAULT_STAGES.map((s, i) => ({ id: i + 1, pipelineId: 1, ...s, systemKey: null }));
const now = new Date();
const lead = {
  id: 1, source: "website", sourceLeadId: null, campaign: null, firstName: "Aoife", lastName: "Example", email: "aoife@example.com", phone: "+353870000000",
  therapyInterest: "Hyperbaric oxygen", notes: "I'd like to know more about HBOT.", rawPayload: null, arrival: null, doNotCall: false, leadScore: 64, leadNextStep: "call",
  leadScoredAt: Date.now(), hotReason: null, marketingConsentAt: null, marketingConsentSource: null, assignedUserId: 2, status: "new", pipelineStage: "new_lead",
  stageId: 1, pipelineId: 1, clientId: null, createdAt: now, updatedAt: now,
} as Lead;

export default async function ZzLeadFlows(props: { searchParams: Promise<{ view?: string }> }) {
  const { view = "lead" } = await props.searchParams;
  if (view === "settings") {
    return (
      <div className="app-page" style={{ maxWidth: 720 }}>
        <LeadFollowUpsForm initial={{ window: { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" }, defaultAssigneeUserId: 2, alertWhatsAppTo: "+353870000000" }} staff={[{ userId: 2, name: "Staff One" }, { userId: 3, name: "Staff Two" }]} />
      </div>
    );
  }
  if (view === "automations") {
    return (
      <div className="app-page" style={{ maxWidth: 960 }}>
        <TriggerEditor
          businessName="Example Clinic"
          initial={{
            key: "lead_no_answer", label: "No answer", description: "", status: "active", enabled: false, externalEnabled: false,
            messages: DEFAULT_MESSAGES.lead_no_answer, startColumn: "key:no_answer", finishColumn: "key:nurture", finishAfterValue: 4, finishAfterUnit: "days",
            flow: { columnStarted: true, finishable: true, beforeCall: false, columns: [{ ref: "role:new", name: "New lead" }, { ref: "key:no_answer", name: "No answer" }, { ref: "key:nurture", name: "Long-term nurture" }] },
            defaults: DEFAULT_MESSAGES.lead_no_answer,
          }}
        />
      </div>
    );
  }
  if (view === "call-log" || view === "call-schedule") return <ZzCall mode={view === "call-log" ? "log" : "schedule"} />;
  if (view === "card") {
    const card: LeadWithSla = { ...lead, firstOutboundAt: null, stage: { id: 1, name: "New lead", colour: "#8b949e", position: 0, role: "new" } };
    return <ZzCard lead={card} />;
  }
  return (
    <div className="app-page">
      <LeadDetail
        lead={lead}
        messages={[]}
        stages={stages}
        voice={{ available: false, reason: "The voice agent is not set up." }}
        staff={[{ userId: 2, name: "Staff One" }, { userId: 3, name: "Staff Two" }]}
        flow={{ flow: "New lead", next: [{ channel: "whatsapp", dueAt: Date.now() + 86_400_000 }] }}
        calls={[{ id: 1, kind: "logged", outcome: "no_answer", scheduledFor: null, scheduledDay: null, createdAt: Date.now() - 3_600_000 }]}
      />
    </div>
  );
}
```

(If `TriggerEditor`'s `Detail` or `Lead` gained other required fields along the way, add them to the fixtures; the fixtures are throwaway.)

- [ ] **Step 3: Run the dev server and take the screenshots**

Run in the background (from `app/`): `npx next dev -p 3100`. Wait until `http://localhost:3100/f/zz-lead-flows` answers.

Write `/private/tmp/claude-502/-Users-truep-Desktop-Clients-Renova/76afd0d7-75fd-4576-a2e5-b6a47b0676a5/scratchpad/shots.mjs`:

```js
import { chromium } from "/Users/truep/Desktop/Clients/Renova/.claude/worktrees/agent-aed07055a762b67cc/app/node_modules/playwright-core/index.mjs";
import os from "node:os";
import fs from "node:fs";

const out = "/private/tmp/claude-502/-Users-truep-Desktop-Clients-Renova/76afd0d7-75fd-4576-a2e5-b6a47b0676a5/scratchpad/flow-shots";
fs.mkdirSync(out, { recursive: true });
const exe = `${os.homedir()}/Library/Caches/ms-playwright/chromium-1248/chrome-mac/Chromium.app/Contents/MacOS/Chromium`;
const browser = await chromium.launch({ executablePath: exe });
const views = ["lead", "card", "settings", "automations", "call-log", "call-schedule"];
for (const theme of ["dark", "light"]) {
  for (const width of [1280, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addCookies([{ name: "ui-theme", value: theme, url: "http://localhost:3100" }]);
    const page = await ctx.newPage();
    for (const view of views) {
      await page.goto(`http://localhost:3100/f/zz-lead-flows?view=${view}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      if (view === "call-log") {
        await page.getByRole("radio", { name: "Call back later" }).click();
        await page.waitForTimeout(200);
      }
      await page.screenshot({ path: `${out}/${view}-${width}-${theme}.png`, fullPage: true });
    }
    await ctx.close();
  }
}
await browser.close();
console.log("done");
```

(If the Chromium binary path differs inside `chromium-1248`, find it with `ls ~/Library/Caches/ms-playwright/chromium-1248`.) Run it with `node` and then look at every screenshot with the Read tool: nothing cramped, nothing overflowing at 390, both themes legible, no emojis, the dialogs readable. Fix what is wrong in the component (and its task's tests), re-shoot.

- [ ] **Step 4: Clean up**

Stop the dev server. Delete `app/src/app/f/zz-lead-flows/` entirely (`rm -r app/src/app/f/zz-lead-flows`). `git status` must show no trace of it.

---

## Operator actions after this ships (not code)

- Settings, Lead follow-ups: set Monday to Saturday, 09:00-18:00; assign new leads to the right person; enter DJ's mobile as the WhatsApp alert number (never in code).
- Business profile: check the phone number is the clinic's, because every Optimal Health message uses [BUSINESS_PHONE].
- Marketing consent: decide how leads agree to news and offers (a tick box on the website enquiry form and the Facebook lead form, mapped to `marketingConsent` on the inbound API). Without it Long-term nurture reaches only leads staff mark as agreed.
- `APP_URL` must be set in production so alert links and unsubscribe links are absolute from the ticker.
- `/automations`: read each flow's copy (Optimal Health's agreed wording is prefilled until saved; "Use the default wording" restores it), then switch the flows on one by one.
- If Optimal Health saved New lead messages on 2026-11-11, those saved messages win over the preset: use "Use the default wording" on New lead to load the agreed copy, then save.
