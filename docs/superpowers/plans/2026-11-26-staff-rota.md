# Staff rota and staff-aware booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly staff rota at `/appointments/rota`, and a staff rule ("enough people on shift for what is booked") applied wherever a booking is checked or a free time is offered, off until a business uses it.

**Architecture:** One pure rule module (`src/lib/scheduling/staffDemand.ts`) beside `resourceDemand.ts`, called from the same two seams that already share the resource rule: `checkBookingSlot` (`src/lib/schedule.ts`) and `computeFreeSlots` (`src/lib/scheduling/freeSlots.ts`). A pure rota model (`rotaModel.ts`: shift validation, week maths, coverage runs, the page's data shape, the bookings-to-look-at list) and a server repo (`rotaRepo.ts`: shifts, settings key, staffing, loading) sit beside them. The page is a server component that loads `RotaWeekData` and hands it, plus server actions, to one client view laid out by container queries.

**Tech Stack:** Next.js 15 App Router, React 19, drizzle-orm over better-sqlite3 (one SQLite file per tenant), zod, lucide-react, sonner toasts, plain `node:assert` tests run by `npm test -- <path>` (tsx, `--conditions=react-server`).

## Global Constraints

- NO EMOJIS anywhere: code, comments, copy, logs, commits, docs. Use `lucide-react` icons.
- Plain copy: short factual sentences. No "X rather than Y", no "not just X", no warm filler.
- Colours only from theme tokens in `app/src/app/globals.css` (`--surface-1..3`, `--hairline`, `--hairline-strong`, `--text-primary|secondary|tertiary`, `--info`, `--accent-pemf`, `--success`, `--warning`, `--warning-soft`, `--grid`, `--accent`). They are redefined for light mode already, so no per-theme CSS is needed.
- With `staff_rota_on` off (the default), every booking check and free-slot result must be exactly today's. Tests assert it.
- All times are "HH:mm" Europe/Dublin wall-clock; dates are "YYYY-MM-DD" calendar dates, read with UTC arithmetic (never local `Date` parsing for weekday maths in new code).
- Week starts Monday.
- No real personal data in code, fixtures, docs or commits. Invented names only, e.g. "Example Therapist", "Second Therapist".
- Never `git add -A`; add files by path. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do NOT push, merge, deploy or run `railway`.
- All commands run from `app/` inside the worktree: `/Users/truep/Desktop/Clients/Renova/.claude/worktrees/agent-a5d3c192f810cb54c/app`.
- Copy strings that are fixed by the spec (use verbatim):
  - Rota sub: "Who is in each day. Bookings only allow what the people on shift can cover."
  - Empty staff: "Add the people who work in the clinic"
  - Rule reasons: "Only one therapist on at 14:00 and Deep tissue massage is booked then." / "Nobody is on the rota then."
  - Diary banner: "This week's rota is not filled in, so bookings assume one person on." + link "Fill in the rota"
  - Off switch: "Stop using the rota for bookings"
  - Staffing choices: "Whole time" / "Sets it up"

---

## File structure

| File | Responsibility |
|---|---|
| `app/src/lib/scheduling/staffDemand.ts` (new, pure) | The staff rule: people needed vs people on shift; first failing moment; reason text. |
| `app/src/lib/scheduling/staffDemand.test.ts` (new) | Pure rule tests. |
| `app/src/lib/scheduling/rotaModel.ts` (new, pure) | Shift validation, week dates, coverage runs and text, labels, `coverForDate`, `lookAtFrom`, `buildRotaWeek` and the `RotaWeekData` type. |
| `app/src/lib/scheduling/rotaModel.test.ts` (new) | Pure model tests. |
| `app/src/lib/db/schema.ts` (modify) | `staffShifts` table, `therapies.staffing`. |
| `app/src/lib/db/tenant.ts` (modify) | `CREATE TABLE IF NOT EXISTS staff_shifts`, `ALTER TABLE therapies ADD COLUMN staffing`. |
| `app/src/lib/db/migrations/index.ts` (modify) | `0012-seed-therapy-staffing`. |
| `app/src/lib/db/migrations/seedTherapyStaffing.test.ts` (new) | Migration test. |
| `app/src/lib/scheduling/rotaRepo.ts` (new, server-only) | Settings key, shifts CRUD, copy week, people, staffing, cover resolver, `loadRotaWeek`. |
| `app/src/lib/scheduling/rotaRepo.test.ts` (new) | Scratch-tenant repo tests. |
| `app/src/lib/scheduling/freeSlots.ts` (modify) | Optional `staff` per day + `staffing` input; calls `firstStaffShortfall`. |
| `app/src/lib/schedule.ts` (modify) | Step 4 in `checkBookingSlot`: the staff rule. |
| `app/src/lib/scheduling/availability.ts` (modify) | Loads covers + staffing into `computeFreeSlots`; `recheck` option. |
| `app/src/app/api/appointments/free-slots/route.ts` (modify) | Adds `rota: { unfilled, week }` to the response. |
| `app/src/lib/scheduling/staffRule.test.ts` (new) | Scratch tenant: both seams agree, rota off unchanged. |
| `app/src/lib/scheduling/resourceDemand.ts` (modify) | Header comment: staff now modelled in `staffDemand.ts`. |
| `app/src/app/appointments/rota/page.tsx` (new) | Server page. |
| `app/src/app/appointments/rota/actions.ts` (new) | Server actions. |
| `app/src/components/appointments/rota/RotaView.tsx` (new, client) | The whole page UI. |
| `app/src/components/appointments/rota/ShiftDialog.tsx` (new, client) | Add/edit/remove a shift. |
| `app/src/components/appointments/rota/AddPersonDialog.tsx` (new, client) | Add a person. |
| `app/src/components/appointments/rota/RotaUnfilledBanner.tsx` (new, server-safe) | Banner reused by the diary and the booking screen. |
| `app/src/app/globals.css` (modify) | `.rv-*` styles with `@container rv` queries. |
| `app/src/app/appointments/page.tsx` (modify) | "Rota" header button, unfilled banner. |
| `app/src/components/appointments/booking/useFreeSlots.ts`, `WhenCard.tsx` (modify) | Unfilled banner on the booking screen. |
| `app/src/components/settings/TherapyEditor.tsx`, `app/src/app/settings/therapies/actions.ts` (modify) | Staffing field where a therapy is edited. |

---

### Task 1: The pure staff rule

**Files:**
- Create: `app/src/lib/scheduling/staffDemand.ts`
- Test: `app/src/lib/scheduling/staffDemand.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact):
  ```ts
  export type Staffing = "whole" | "setup";
  export interface StaffedSpan { startMin: number; endMin: number; staffing: Staffing; label: string }
  export interface ShiftSpan { startMin: number; endMin: number }
  export type DayCover =
    | { mode: "off" }
    | { mode: "assumeOne"; openMin: number; closeMin: number }
    | { mode: "shifts"; shifts: ShiftSpan[] };
  export function staffingOf(list: Staffing[]): Staffing;
  export function onShiftAt(cover: DayCover, t: number): number;
  export function neededFor(spans: { staffing: Staffing }[]): number;
  export interface StaffShortfall { atMin: number; needed: number; onShift: number; others: StaffedSpan[] }
  export function firstStaffShortfall(input: { startMin: number; endMin: number; staffing: Staffing; booked: StaffedSpan[]; cover: DayCover }): StaffShortfall | null;
  export function staffShortfallReason(s: StaffShortfall): string;
  ```

- [ ] **Step 1: Write the failing test** `app/src/lib/scheduling/staffDemand.test.ts`:

```ts
// Run: npm test -- src/lib/scheduling/staffDemand.test.ts
import assert from "node:assert/strict";

import {
  firstStaffShortfall,
  neededFor,
  onShiftAt,
  staffShortfallReason,
  staffingOf,
  type DayCover,
  type StaffedSpan,
} from "./staffDemand";

const h = (hm: string) => {
  const [a, b] = hm.split(":").map(Number);
  return a * 60 + b;
};
const span = (s: string, e: string, staffing: "whole" | "setup", label: string): StaffedSpan => ({
  startMin: h(s), endMin: h(e), staffing, label,
});
const shifts = (...pairs: [string, string][]): DayCover => ({
  mode: "shifts",
  shifts: pairs.map(([s, e]) => ({ startMin: h(s), endMin: h(e) })),
});
const try_ = (s: string, e: string, staffing: "whole" | "setup", booked: StaffedSpan[], cover: DayCover) =>
  firstStaffShortfall({ startMin: h(s), endMin: h(e), staffing, booked, cover });

const massage = span("10:00", "11:00", "whole", "Deep tissue massage");
const hbot = span("10:00", "11:00", "setup", "HBOT");
const infrared = span("10:00", "11:00", "setup", "Infrared");
const ONE = shifts(["09:00", "17:00"]);
const TWO = shifts(["09:00", "17:00"], ["09:00", "17:00"]);

// staffingOf: whole if any is whole; an appointment with no therapies needs a person.
assert.equal(staffingOf(["setup", "setup"]), "setup");
assert.equal(staffingOf(["setup", "whole"]), "whole");
assert.equal(staffingOf([]), "whole");

// neededFor: one per whole, plus one if any setup.
assert.equal(neededFor([]), 0);
assert.equal(neededFor([{ staffing: "setup" }, { staffing: "setup" }]), 1);
assert.equal(neededFor([{ staffing: "whole" }, { staffing: "setup" }, { staffing: "setup" }]), 2);
assert.equal(neededFor([{ staffing: "whole" }, { staffing: "whole" }]), 2);

// onShiftAt is half-open.
assert.equal(onShiftAt(ONE, h("09:00")), 1);
assert.equal(onShiftAt(ONE, h("17:00")), 0);
assert.equal(onShiftAt(TWO, h("12:00")), 2);
assert.equal(onShiftAt({ mode: "assumeOne", openMin: h("09:00"), closeMin: h("19:00") }, h("18:59")), 1);
assert.equal(onShiftAt({ mode: "assumeOne", openMin: h("09:00"), closeMin: h("19:00") }, h("19:00")), 0);

// Rota off changes nothing.
assert.equal(try_("10:00", "11:00", "whole", [massage, massage, massage], { mode: "off" }), null);

// One on: a massage blocks the machines, and the reverse.
assert.ok(try_("10:00", "11:00", "setup", [massage], ONE));
assert.ok(try_("10:30", "11:30", "whole", [hbot], ONE));
// One on: two machines together are fine.
assert.equal(try_("10:00", "11:00", "setup", [hbot], ONE), null);
assert.equal(try_("10:00", "11:00", "setup", [hbot, infrared], ONE), null);
// One on: back to back is fine (half-open).
assert.equal(try_("11:00", "12:00", "setup", [massage], ONE), null);
assert.equal(try_("09:00", "10:00", "whole", [massage], ONE), null);

// Two on: a massage plus the machines is fine; a third need is refused.
assert.equal(try_("10:00", "11:00", "setup", [massage], TWO), null);
assert.equal(try_("10:00", "11:00", "whole", [hbot, infrared], TWO), null);
assert.ok(try_("10:00", "11:00", "whole", [massage, hbot], TWO));
assert.ok(try_("10:00", "11:00", "whole", [massage, massage], TWO));

// A combined massage-plus-infrared appointment needs one person: one on, nothing else booked, fits.
assert.equal(try_("10:00", "11:30", staffingOf(["whole", "setup"]), [], ONE), null);

// Partial overlap at shift edges: second person leaves at 13:00.
const SPLIT = shifts(["09:00", "17:00"], ["09:00", "13:00"]);
assert.equal(try_("12:00", "13:00", "setup", [span("12:00", "13:00", "whole", "Facial")], SPLIT), null);
const late = try_("12:30", "13:30", "setup", [span("12:00", "14:00", "whole", "Facial")], SPLIT);
assert.ok(late);
assert.equal(late!.atMin, h("13:00"), "fails first at the moment the second person leaves");
assert.equal(late!.needed, 2);
assert.equal(late!.onShift, 1);

// Starting before the shift: nobody on at the start.
const early = try_("08:30", "09:30", "whole", [], ONE);
assert.ok(early);
assert.equal(early!.atMin, h("08:30"));
assert.equal(early!.onShift, 0);

// Nobody on at all.
const nobody = try_("10:00", "11:00", "setup", [], shifts());
assert.ok(nobody);
assert.equal(staffShortfallReason(nobody!), "Nobody is on the rota then.");

// Unfilled week counts as one person during opening hours.
const assumed: DayCover = { mode: "assumeOne", openMin: h("09:00"), closeMin: h("19:00") };
assert.equal(try_("10:00", "11:00", "whole", [], assumed), null);
assert.ok(try_("10:00", "11:00", "whole", [massage], assumed));

// Reasons, in words.
const one = try_("14:00", "15:00", "setup", [span("14:00", "15:00", "whole", "Deep tissue massage")], ONE);
assert.equal(staffShortfallReason(one!), "Only one therapist on at 14:00 and Deep tissue massage is booked then.");
const many = try_("10:00", "11:00", "whole", [massage, hbot], TWO);
assert.equal(staffShortfallReason(many!), "Only 2 therapists on at 10:00 and Deep tissue massage and HBOT are booked then.");
const three = try_("10:00", "11:00", "whole", [massage, span("10:00", "11:00", "whole", "Facial"), hbot], shifts(["09:00", "17:00"], ["09:00", "17:00"], ["09:00", "17:00"]));
assert.equal(staffShortfallReason(three!), "Only 3 therapists on at 10:00 and Deep tissue massage, Facial and HBOT are booked then.");
const unnamed = try_("10:00", "11:00", "whole", [span("10:00", "11:00", "whole", "")], ONE);
assert.equal(staffShortfallReason(unnamed!), "Only one therapist on at 10:00 and another booking is booked then.");

// An empty or inverted proposal never fails.
assert.equal(try_("10:00", "10:00", "whole", [massage], shifts()), null);

console.log("staffDemand: all checks passed.");
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test -- src/lib/scheduling/staffDemand.test.ts`
Expected: FAIL, cannot find module `./staffDemand`.

- [ ] **Step 3: Implement** `app/src/lib/scheduling/staffDemand.ts`:

```ts
/**
 * PURE staff arithmetic: no DB, no `server-only`.
 *
 * The rule: at any moment, the people needed are one for each appointment in
 * progress that includes a "whole" therapy (a therapist is with the client the
 * whole time), plus one if any appointment in progress has only "setup"
 * therapies (a therapist sets those up and can look after several at once).
 * One appointment that carries several therapies is one client doing them one
 * after another, so it needs at most one person: it counts as "whole" if any
 * of its therapies is "whole". Needed may not exceed the people on shift at
 * any moment of the proposed booking.
 *
 * Called from the same two seams as ./resourceDemand: `checkBookingSlot`
 * (@/lib/schedule) and `computeFreeSlots` (./freeSlots), so a time offered is
 * a time the booking path accepts.
 *
 * No buffer applies here: the buffer is dead time for a room or machine, and
 * a therapist can finish one client at 10:00 and start the next at 10:00.
 * Half-open throughout, as in ./resourceDemand.
 */

export type Staffing = "whole" | "setup";

/** One booking already in the diary, as minutes from midnight. `label` names its treatments for the reason text. */
export interface StaffedSpan {
  startMin: number;
  endMin: number;
  staffing: Staffing;
  label: string;
}

export interface ShiftSpan {
  startMin: number;
  endMin: number;
}

/**
 * Who is on, for one day.
 *  off        the business does not use the rota: the rule never applies.
 *  assumeOne  the rota is on but this week has no shifts: one person during opening hours.
 *  shifts     the week has shifts: these are the people on this day (none means nobody).
 */
export type DayCover =
  | { mode: "off" }
  | { mode: "assumeOne"; openMin: number; closeMin: number }
  | { mode: "shifts"; shifts: ShiftSpan[] };

/** An appointment's staffing from its therapies. No therapies needs a person, to fail safe. */
export function staffingOf(list: Staffing[]): Staffing {
  if (list.length === 0) return "whole";
  return list.some((s) => s === "whole") ? "whole" : "setup";
}

/** People on shift at minute `t`. */
export function onShiftAt(cover: DayCover, t: number): number {
  if (cover.mode === "off") return Number.POSITIVE_INFINITY;
  if (cover.mode === "assumeOne") return cover.openMin <= t && t < cover.closeMin ? 1 : 0;
  let n = 0;
  for (const s of cover.shifts) if (s.startMin <= t && t < s.endMin) n++;
  return n;
}

/** People needed by appointments that are all in progress together. */
export function neededFor(spans: { staffing: Staffing }[]): number {
  let whole = 0;
  let setup = false;
  for (const s of spans) {
    if (s.staffing === "whole") whole++;
    else setup = true;
  }
  return whole + (setup ? 1 : 0);
}

export interface StaffShortfall {
  /** The first minute the booking would leave too few people on. */
  atMin: number;
  needed: number;
  onShift: number;
  /** The other bookings in progress at that minute. */
  others: StaffedSpan[];
}

/**
 * The first moment this booking would need more people than are on, or null.
 *
 * Needed and on-shift only change where a booking or a shift starts or ends,
 * so checking the proposal's start and every such edge inside it is exact.
 */
export function firstStaffShortfall(input: {
  startMin: number;
  endMin: number;
  staffing: Staffing;
  booked: StaffedSpan[];
  cover: DayCover;
}): StaffShortfall | null {
  const { startMin, endMin, staffing, booked, cover } = input;
  if (cover.mode === "off" || endMin <= startMin) return null;

  const overlapping = booked.filter((b) => b.startMin < endMin && startMin < b.endMin);
  const points = new Set<number>([startMin]);
  const inside = (t: number) => {
    if (startMin < t && t < endMin) points.add(t);
  };
  for (const b of overlapping) {
    inside(b.startMin);
    inside(b.endMin);
  }
  if (cover.mode === "assumeOne") {
    inside(cover.openMin);
    inside(cover.closeMin);
  } else {
    for (const s of cover.shifts) {
      inside(s.startMin);
      inside(s.endMin);
    }
  }

  for (const t of [...points].sort((a, b) => a - b)) {
    const others = overlapping.filter((b) => b.startMin <= t && t < b.endMin);
    const needed = neededFor([...others, { staffing }]);
    const onShift = onShiftAt(cover, t);
    if (needed > onShift) return { atMin: t, needed, onShift, others };
  }
  return null;
}

function hm(mins: number): string {
  return `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Plain-English reason for the operator, the booking screen or an agent. */
export function staffShortfallReason(s: StaffShortfall): string {
  if (s.onShift === 0) return "Nobody is on the rota then.";
  const labels = s.others.map((o) => o.label.trim()).filter(Boolean);
  const what =
    labels.length > 0
      ? `${listWords(labels)} ${s.others.length === 1 ? "is" : "are"}`
      : s.others.length === 1
        ? "another booking is"
        : "other bookings are";
  const people = s.onShift === 1 ? "Only one therapist on" : `Only ${s.onShift} therapists on`;
  return `${people} at ${hm(s.atMin)} and ${what} booked then.`;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npm test -- src/lib/scheduling/staffDemand.test.ts`
Expected: `staffDemand: all checks passed.`

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/scheduling/staffDemand.ts app/src/lib/scheduling/staffDemand.test.ts
git commit -m "feat(rota): pure staff rule beside the resource rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The pure rota model

**Files:**
- Create: `app/src/lib/scheduling/rotaModel.ts`
- Test: `app/src/lib/scheduling/rotaModel.test.ts`

**Interfaces:**
- Consumes (Task 1): `DayCover`, `ShiftSpan`, `Staffing`, `StaffedSpan`, `firstStaffShortfall`, `staffShortfallReason` from `./staffDemand`. `addDaysIso` from `@/lib/booking/slotModel`; `shortDate`, `weekdayIndex` from `@/lib/booking/format`; `hmToMin` from `./freeSlots`.
- Produces (exact):
  ```ts
  export interface OpeningHourLike { dow: number; closed: boolean; open?: string; close?: string }
  export interface ShiftRow { id: number; staffId: number; date: string; start: string; end: string }
  export interface ShiftDraft { id?: number; staffId: number; date: string; start: string; end: string }
  export function isHm(s: string): boolean;
  export function isIsoDate(s: string): boolean;
  export function hoursFor(dateIso: string, openingHours: OpeningHourLike[]): OpeningHourLike | undefined;
  export function validateShift(shift: ShiftDraft, openingHours: OpeningHourLike[], sameDay: ShiftDraft[]): string | null;
  export function mondayOf(dateIso: string): string;
  export function weekDates(mondayIso: string): string[];
  export interface CoverRun { startMin: number; endMin: number; count: number }
  export function coverRuns(shifts: { start: string; end: string }[], openMin: number, closeMin: number): CoverRun[];
  export function coverText(runs: CoverRun[]): string[];
  export function shortTime(hm: string): string;          // "09:00" -> "9:00"
  export function shiftLabel(start: string, end: string): string; // "9:00–17:00"
  export function hoursLabel(shifts: { start: string; end: string }[]): string; // "32 h this week"
  export function weekRangeLabel(mondayIso: string): string; // "Mon 30 Nov – Sun 6 Dec"
  export function dayLabel(dateIso: string): string;        // "Mon 30"
  export function initials(name: string): string;
  export function coverForDate(dateIso: string, ctx: { rotaOn: boolean; weekShifts: ShiftRow[]; openingHours: OpeningHourLike[] }): DayCover;
  export interface LookAtAppt { id: number; date: string; startTime: string; endTime: string; staffing: Staffing; label: string }
  export interface LookAtItem { appointmentId: number; date: string; startTime: string; title: string; reason: string }
  export function lookAtFrom(appts: LookAtAppt[], coverOf: (dateIso: string) => DayCover): LookAtItem[];
  export interface RotaDay { date: string; label: string; closed: boolean; open: string | null; close: string | null; runs: CoverRun[]; text: string[] }
  export interface RotaPerson { id: number; name: string; initials: string; hours: string; shifts: ShiftRow[]; tone: number }
  export interface TreatmentStaffing { id: number; name: string; staffing: Staffing }
  export interface RotaWeekData {
    monday: string; prevMonday: string; nextMonday: string; rangeLabel: string;
    rotaOn: boolean; unfilled: boolean;
    days: RotaDay[]; people: RotaPerson[];
    lookAt: LookAtItem[]; treatments: TreatmentStaffing[];
    lastWeekShiftCount: number; thisWeekShiftCount: number;
  }
  export function buildRotaWeek(input: {
    monday: string; rotaOn: boolean; openingHours: OpeningHourLike[];
    people: { id: number; name: string }[]; weekShifts: ShiftRow[]; lastWeekShiftCount: number;
    appts: LookAtAppt[]; treatments: TreatmentStaffing[];
  }): RotaWeekData;
  ```

- [ ] **Step 1: Write the failing test** `app/src/lib/scheduling/rotaModel.test.ts`:

```ts
// Run: npm test -- src/lib/scheduling/rotaModel.test.ts
import assert from "node:assert/strict";

import {
  buildRotaWeek,
  coverForDate,
  coverRuns,
  coverText,
  dayLabel,
  hoursLabel,
  initials,
  lookAtFrom,
  mondayOf,
  shiftLabel,
  validateShift,
  weekDates,
  weekRangeLabel,
  type OpeningHourLike,
  type ShiftRow,
} from "./rotaModel";

const HOURS: OpeningHourLike[] = [
  { dow: 0, closed: true },
  { dow: 1, closed: false, open: "09:00", close: "19:00" },
  { dow: 2, closed: false, open: "09:00", close: "19:00" },
  { dow: 3, closed: false, open: "09:00", close: "17:00" },
  { dow: 4, closed: false, open: "09:00", close: "19:00" },
  { dow: 5, closed: false, open: "09:00", close: "17:00" },
  { dow: 6, closed: false, open: "09:00", close: "14:00" },
];
const h = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

// Week maths. 2026-11-30 is a Monday; 2026-12-06 the Sunday.
assert.equal(mondayOf("2026-11-30"), "2026-11-30");
assert.equal(mondayOf("2026-12-06"), "2026-11-30");
assert.equal(mondayOf("2026-12-02"), "2026-11-30");
assert.deepEqual(weekDates("2026-11-30"), [
  "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06",
]);
assert.equal(weekRangeLabel("2026-11-30"), "Mon 30 Nov – Sun 6 Dec");
assert.equal(dayLabel("2026-12-01"), "Tue 1");
assert.equal(shiftLabel("09:00", "17:00"), "9:00–17:00");
assert.equal(shiftLabel("13:30", "19:00"), "13:30–19:00");
assert.equal(initials("Example Therapist"), "ET");
assert.equal(initials("  example "), "E");
assert.equal(hoursLabel([{ start: "09:00", end: "17:00" }, { start: "09:00", end: "17:00" }, { start: "11:00", end: "19:00" }, { start: "09:00", end: "17:00" }]), "32 h this week");
assert.equal(hoursLabel([{ start: "09:00", end: "12:30" }]), "3.5 h this week");
assert.equal(hoursLabel([]), "No shifts this week");

// Validation.
const ok = { staffId: 1, date: "2026-11-30", start: "09:00", end: "17:00" };
assert.equal(validateShift(ok, HOURS, []), null);
assert.equal(validateShift({ ...ok, start: "9:00" }, HOURS, []), "Give the times as HH:mm.");
assert.equal(validateShift({ ...ok, date: "2026-12-06" }, HOURS, []), "Closed that day, so no shifts.");
assert.equal(validateShift({ ...ok, end: "09:00" }, HOURS, []), "The shift has to end after it starts.");
assert.equal(validateShift({ ...ok, end: "19:30" }, HOURS, []), "Shifts have to sit inside opening hours (09:00–19:00).");
assert.equal(validateShift({ ...ok, start: "08:30" }, HOURS, []), "Shifts have to sit inside opening hours (09:00–19:00).");
assert.equal(
  validateShift({ ...ok, start: "16:00", end: "19:00" }, HOURS, [{ id: 7, ...ok }]),
  "This overlaps another shift for the same person.",
);
assert.equal(validateShift({ ...ok, start: "17:00", end: "19:00" }, HOURS, [{ id: 7, ...ok }]), null, "a split day is two shifts");
assert.equal(validateShift({ id: 7, ...ok, end: "18:00" }, HOURS, [{ id: 7, ...ok }]), null, "editing a shift ignores itself");
assert.equal(validateShift({ ...ok, start: "10:00" }, HOURS, [{ id: 8, ...ok, staffId: 2 }]), null, "another person may overlap");

// Coverage runs and text, as the mockup's Monday.
const mon = coverRuns([{ start: "09:00", end: "17:00" }, { start: "13:00", end: "19:00" }], h("09:00"), h("19:00"));
assert.deepEqual(mon, [
  { startMin: h("09:00"), endMin: h("13:00"), count: 1 },
  { startMin: h("13:00"), endMin: h("17:00"), count: 2 },
  { startMin: h("17:00"), endMin: h("19:00"), count: 1 },
]);
assert.deepEqual(coverText(mon), ["1 on 9–13", "2 on 13–17", "1 on 17–19"]);
assert.deepEqual(coverText(coverRuns([{ start: "09:00", end: "17:00" }], h("09:00"), h("19:00"))), ["1 on 9–17", "None 17–19"]);
assert.deepEqual(coverText(coverRuns([], h("09:00"), h("14:00"))), ["Nobody on"]);
assert.deepEqual(coverText(coverRuns([{ start: "09:30", end: "14:00" }], h("09:00"), h("14:00"))), ["None 9–9:30", "1 on 9:30–14"]);

// Cover for a date.
const shift = (id: number, staffId: number, date: string, start: string, end: string): ShiftRow => ({ id, staffId, date, start, end });
assert.deepEqual(coverForDate("2026-11-30", { rotaOn: false, weekShifts: [], openingHours: HOURS }), { mode: "off" });
assert.deepEqual(coverForDate("2026-11-30", { rotaOn: true, weekShifts: [], openingHours: HOURS }), { mode: "assumeOne", openMin: h("09:00"), closeMin: h("19:00") });
assert.deepEqual(coverForDate("2026-12-06", { rotaOn: true, weekShifts: [], openingHours: HOURS }), { mode: "assumeOne", openMin: 0, closeMin: 0 });
const week = [shift(1, 1, "2026-11-30", "09:00", "17:00")];
assert.deepEqual(coverForDate("2026-11-30", { rotaOn: true, weekShifts: week, openingHours: HOURS }), { mode: "shifts", shifts: [{ startMin: h("09:00"), endMin: h("17:00") }] });
assert.deepEqual(coverForDate("2026-12-01", { rotaOn: true, weekShifts: week, openingHours: HOURS }), { mode: "shifts", shifts: [] }, "a day with no shifts in a week that has some has nobody on");

// Bookings to look at: the later-booked one in a clash is listed, once.
const coverOf = (d: string) => coverForDate(d, { rotaOn: true, weekShifts: week, openingHours: HOURS });
const items = lookAtFrom(
  [
    { id: 10, date: "2026-11-30", startTime: "14:00", endTime: "15:00", staffing: "whole", label: "Deep tissue massage" },
    { id: 11, date: "2026-11-30", startTime: "14:00", endTime: "15:00", staffing: "setup", label: "HBOT" },
    { id: 12, date: "2026-11-30", startTime: "15:00", endTime: "16:00", staffing: "setup", label: "HBOT" },
    { id: 13, date: "2026-12-05", startTime: "11:00", endTime: "12:00", staffing: "setup", label: "Infrared" },
  ],
  coverOf,
);
assert.deepEqual(items, [
  { appointmentId: 11, date: "2026-11-30", startTime: "14:00", title: "Mon 30 Nov, 14:00 · HBOT", reason: "Only one therapist on at 14:00 and Deep tissue massage is booked then." },
  { appointmentId: 13, date: "2026-12-05", startTime: "11:00", title: "Sat 5 Dec, 11:00 · Infrared", reason: "Nobody is on the rota then." },
]);
assert.deepEqual(lookAtFrom([{ id: 1, date: "2026-11-30", startTime: "14:00", endTime: "15:00", staffing: "whole", label: "X" }], () => ({ mode: "off" })), []);

// The page's data.
const data = buildRotaWeek({
  monday: "2026-11-30",
  rotaOn: true,
  openingHours: HOURS,
  people: [{ id: 1, name: "Example Therapist" }, { id: 2, name: "Second Therapist" }],
  weekShifts: [shift(1, 1, "2026-11-30", "09:00", "17:00"), shift(2, 2, "2026-11-30", "13:00", "19:00")],
  lastWeekShiftCount: 4,
  appts: [],
  treatments: [{ id: 1, name: "HBOT", staffing: "setup" }],
});
assert.equal(data.rangeLabel, "Mon 30 Nov – Sun 6 Dec");
assert.equal(data.prevMonday, "2026-11-23");
assert.equal(data.nextMonday, "2026-12-07");
assert.equal(data.unfilled, false);
assert.equal(data.thisWeekShiftCount, 2);
assert.equal(data.lastWeekShiftCount, 4);
assert.equal(data.days.length, 7);
assert.deepEqual([data.days[0].label, data.days[0].open, data.days[0].close, data.days[0].closed], ["Mon 30", "09:00", "19:00", false]);
assert.deepEqual(data.days[0].text, ["1 on 9–13", "2 on 13–17", "1 on 17–19"]);
assert.deepEqual([data.days[6].closed, data.days[6].open, data.days[6].text], [true, null, []]);
assert.deepEqual(data.people.map((p) => [p.name, p.initials, p.hours, p.shifts.length, p.tone]), [
  ["Example Therapist", "ET", "8 h this week", 1, 0],
  ["Second Therapist", "ST", "6 h this week", 1, 1],
]);
const empty = buildRotaWeek({ monday: "2026-11-30", rotaOn: true, openingHours: HOURS, people: [], weekShifts: [], lastWeekShiftCount: 0, appts: [], treatments: [] });
assert.equal(empty.unfilled, true, "rota on and no shifts this week");
assert.equal(buildRotaWeek({ monday: "2026-11-30", rotaOn: false, openingHours: HOURS, people: [], weekShifts: [], lastWeekShiftCount: 0, appts: [], treatments: [] }).unfilled, false, "unfilled only matters while the rota is on");

console.log("rotaModel: all checks passed.");
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test -- src/lib/scheduling/rotaModel.test.ts`
Expected: FAIL, cannot find module `./rotaModel`.

- [ ] **Step 3: Implement** `app/src/lib/scheduling/rotaModel.ts`:

```ts
/**
 * PURE rota model: no DB, no `server-only`, so the page, the repo, a test and
 * the browser-check harness all build the same week the same way.
 */

import { addDaysIso } from "@/lib/booking/slotModel";
import { shortDate, weekdayIndex, weekdayShort } from "@/lib/booking/format";

import { hmToMin } from "./freeSlots";
import {
  firstStaffShortfall,
  staffShortfallReason,
  type DayCover,
  type Staffing,
  type StaffedSpan,
} from "./staffDemand";

export interface OpeningHourLike {
  dow: number;
  closed: boolean;
  open?: string;
  close?: string;
}

export interface ShiftRow {
  id: number;
  staffId: number;
  date: string;
  start: string;
  end: string;
}

export interface ShiftDraft {
  id?: number;
  staffId: number;
  date: string;
  start: string;
  end: string;
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isHm = (s: string) => HM.test(s);
export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function hoursFor(dateIso: string, openingHours: OpeningHourLike[]): OpeningHourLike | undefined {
  return openingHours.find((o) => o.dow === weekdayIndex(dateIso));
}

/** Null when the shift can be saved, else the reason in words. */
export function validateShift(shift: ShiftDraft, openingHours: OpeningHourLike[], sameDay: ShiftDraft[]): string | null {
  if (!isHm(shift.start) || !isHm(shift.end)) return "Give the times as HH:mm.";
  const oh = hoursFor(shift.date, openingHours);
  if (!oh || oh.closed) return "Closed that day, so no shifts.";
  const s = hmToMin(shift.start);
  const e = hmToMin(shift.end);
  if (e <= s) return "The shift has to end after it starts.";
  const open = oh.open ?? "00:00";
  const close = oh.close ?? "23:59";
  if (s < hmToMin(open) || e > hmToMin(close)) return `Shifts have to sit inside opening hours (${open}–${close}).`;
  const clash = sameDay.some(
    (o) =>
      o.staffId === shift.staffId &&
      o.date === shift.date &&
      (shift.id == null || o.id !== shift.id) &&
      hmToMin(o.start) < e &&
      s < hmToMin(o.end),
  );
  if (clash) return "This overlaps another shift for the same person.";
  return null;
}

/** The Monday of the week holding this date. */
export function mondayOf(dateIso: string): string {
  const dow = weekdayIndex(dateIso);
  return addDaysIso(dateIso, dow === 0 ? -6 : 1 - dow);
}

export function weekDates(mondayIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(mondayIso, i));
}

export interface CoverRun {
  startMin: number;
  endMin: number;
  count: number;
}

/** How many are on through the opening window, as runs of equal count. */
export function coverRuns(shifts: { start: string; end: string }[], openMin: number, closeMin: number): CoverRun[] {
  if (closeMin <= openMin) return [];
  const edges = new Set<number>([openMin, closeMin]);
  for (const s of shifts) {
    for (const t of [hmToMin(s.start), hmToMin(s.end)]) if (openMin < t && t < closeMin) edges.add(t);
  }
  const sorted = [...edges].sort((a, b) => a - b);
  const runs: CoverRun[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const t = sorted[i];
    const count = shifts.filter((s) => hmToMin(s.start) <= t && t < hmToMin(s.end)).length;
    const last = runs[runs.length - 1];
    if (last && last.count === count) last.endMin = sorted[i + 1];
    else runs.push({ startMin: t, endMin: sorted[i + 1], count });
  }
  return runs;
}

/** "9", "9:30", "13" */
function clockShort(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? String(h) : `${h}:${String(m).padStart(2, "0")}`;
}

/** ["1 on 9–13", "2 on 13–17", "None 17–19"], or ["Nobody on"] for a day with no one. */
export function coverText(runs: CoverRun[]): string[] {
  if (runs.length === 0) return [];
  if (runs.every((r) => r.count === 0)) return ["Nobody on"];
  return runs.map((r) => `${r.count === 0 ? "None" : `${r.count} on`} ${clockShort(r.startMin)}–${clockShort(r.endMin)}`);
}

/** "09:00" -> "9:00" */
export function shortTime(hm: string): string {
  return hm.startsWith("0") ? hm.slice(1) : hm;
}

export function shiftLabel(start: string, end: string): string {
  return `${shortTime(start)}–${shortTime(end)}`;
}

export function hoursLabel(shifts: { start: string; end: string }[]): string {
  const mins = shifts.reduce((sum, s) => sum + hmToMin(s.end) - hmToMin(s.start), 0);
  if (mins <= 0) return "No shifts this week";
  const hours = Math.round((mins / 60) * 10) / 10;
  return `${hours} h this week`;
}

/** "Mon 30 Nov – Sun 6 Dec" */
export function weekRangeLabel(mondayIso: string): string {
  return `${shortDate(mondayIso)} – ${shortDate(addDaysIso(mondayIso, 6))}`;
}

/** "Mon 30" */
export function dayLabel(dateIso: string): string {
  return `${weekdayShort(dateIso)} ${Number(dateIso.slice(8, 10))}`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * Who is on for one date.
 * Rota off: the rule never applies. Rota on, week with no shifts: one person
 * during opening hours. Otherwise the day's shifts (none means nobody).
 */
export function coverForDate(
  dateIso: string,
  ctx: { rotaOn: boolean; weekShifts: ShiftRow[]; openingHours: OpeningHourLike[] },
): DayCover {
  if (!ctx.rotaOn) return { mode: "off" };
  const monday = mondayOf(dateIso);
  const inWeek = ctx.weekShifts.filter((s) => mondayOf(s.date) === monday);
  if (inWeek.length === 0) {
    const oh = hoursFor(dateIso, ctx.openingHours);
    if (!oh || oh.closed) return { mode: "assumeOne", openMin: 0, closeMin: 0 };
    return { mode: "assumeOne", openMin: hmToMin(oh.open ?? "00:00"), closeMin: hmToMin(oh.close ?? "23:59") };
  }
  return {
    mode: "shifts",
    shifts: inWeek.filter((s) => s.date === dateIso).map((s) => ({ startMin: hmToMin(s.start), endMin: hmToMin(s.end) })),
  };
}

export interface LookAtAppt {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  staffing: Staffing;
  label: string;
}

export interface LookAtItem {
  appointmentId: number;
  date: string;
  startTime: string;
  /** "Tue 1 Dec, 14:00 · HBOT" */
  title: string;
  reason: string;
}

/**
 * Bookings that break the staff rule. Booked-first wins: appointments are
 * taken in id order, and one that does not fit beside those already kept is
 * listed (and not kept), so a clash between two is listed once, on the later
 * booking, naming the earlier one.
 */
export function lookAtFrom(appts: LookAtAppt[], coverOf: (dateIso: string) => DayCover): LookAtItem[] {
  const kept = new Map<string, StaffedSpan[]>();
  const out: LookAtItem[] = [];
  for (const a of [...appts].sort((x, y) => x.id - y.id)) {
    const cover = coverOf(a.date);
    const span: StaffedSpan = { startMin: hmToMin(a.startTime), endMin: hmToMin(a.endTime), staffing: a.staffing, label: a.label };
    const day = kept.get(a.date) ?? [];
    const short = firstStaffShortfall({ ...span, booked: day, cover });
    if (short) {
      out.push({
        appointmentId: a.id,
        date: a.date,
        startTime: a.startTime,
        title: `${shortDate(a.date)}, ${a.startTime} · ${a.label || "Booking"}`,
        reason: staffShortfallReason(short),
      });
    } else {
      day.push(span);
      kept.set(a.date, day);
    }
  }
  return out.sort((x, y) => (x.date + x.startTime).localeCompare(y.date + y.startTime) || x.appointmentId - y.appointmentId);
}

export interface RotaDay {
  date: string;
  /** "Mon 30" */
  label: string;
  closed: boolean;
  open: string | null;
  close: string | null;
  runs: CoverRun[];
  text: string[];
}

export interface RotaPerson {
  id: number;
  name: string;
  initials: string;
  /** "32 h this week" */
  hours: string;
  shifts: ShiftRow[];
  /** 0 or 1: alternating shift colour per row. */
  tone: number;
}

export interface TreatmentStaffing {
  id: number;
  name: string;
  staffing: Staffing;
}

export interface RotaWeekData {
  monday: string;
  prevMonday: string;
  nextMonday: string;
  rangeLabel: string;
  rotaOn: boolean;
  /** Rota on and this week has no shifts: bookings assume one person on. */
  unfilled: boolean;
  days: RotaDay[];
  people: RotaPerson[];
  lookAt: LookAtItem[];
  treatments: TreatmentStaffing[];
  lastWeekShiftCount: number;
  thisWeekShiftCount: number;
}

export function buildRotaWeek(input: {
  monday: string;
  rotaOn: boolean;
  openingHours: OpeningHourLike[];
  people: { id: number; name: string }[];
  weekShifts: ShiftRow[];
  lastWeekShiftCount: number;
  appts: LookAtAppt[];
  treatments: TreatmentStaffing[];
}): RotaWeekData {
  const { monday, rotaOn, openingHours, people, weekShifts } = input;
  const days: RotaDay[] = weekDates(monday).map((date) => {
    const oh = hoursFor(date, openingHours);
    const closed = !oh || oh.closed;
    const open = closed ? null : (oh!.open ?? "00:00");
    const close = closed ? null : (oh!.close ?? "23:59");
    const runs = closed ? [] : coverRuns(weekShifts.filter((s) => s.date === date), hmToMin(open!), hmToMin(close!));
    return { date, label: dayLabel(date), closed, open, close, runs, text: coverText(runs) };
  });
  const coverOf = (d: string) => coverForDate(d, { rotaOn, weekShifts, openingHours });
  return {
    monday,
    prevMonday: addDaysIso(monday, -7),
    nextMonday: addDaysIso(monday, 7),
    rangeLabel: weekRangeLabel(monday),
    rotaOn,
    unfilled: rotaOn && weekShifts.length === 0,
    days,
    people: people.map((p, i) => {
      const shifts = weekShifts.filter((s) => s.staffId === p.id).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
      return { id: p.id, name: p.name, initials: initials(p.name), hours: hoursLabel(shifts), shifts, tone: i % 2 };
    }),
    lookAt: lookAtFrom(input.appts, coverOf),
    treatments: input.treatments,
    lastWeekShiftCount: input.lastWeekShiftCount,
    thisWeekShiftCount: weekShifts.length,
  };
}
```

Note: `weekShifts` passed to `buildRotaWeek` must already be limited to this week and to active people (the repo does that).

- [ ] **Step 4: Run it and see it pass**

Run: `npm test -- src/lib/scheduling/rotaModel.test.ts`
Expected: `rotaModel: all checks passed.` If a label assertion fails, fix the code, not the test (the strings are the agreed copy).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/scheduling/rotaModel.ts app/src/lib/scheduling/rotaModel.test.ts
git commit -m "feat(rota): pure rota model (validation, week maths, coverage, look-at list)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Data: `staff_shifts`, `therapies.staffing`, staffing seed migration

**Files:**
- Modify: `app/src/lib/db/schema.ts` (the `therapies` table near line 108; add `staffShifts` after the `staff` table near line 2351)
- Modify: `app/src/lib/db/tenant.ts` (`ensureTenantTables`: add the table next to `CREATE TABLE IF NOT EXISTS staff` near line 771; add the column next to the "therapies capacity migration" block near line 2160)
- Modify: `app/src/lib/db/migrations/index.ts` (append to `TENANT_MIGRATIONS` after `0011-follow-up-columns`)
- Test: `app/src/lib/db/migrations/seedTherapyStaffing.test.ts`

**Interfaces:**
- Produces: drizzle `staffShifts` table (`id`, `staffId`, `date`, `start`, `end`, `createdAt`, `updatedAt`), type `StaffShift`; `therapies.staffing: "whole" | "setup"` (drizzle `text("staffing", { enum: ["whole", "setup"] }).notNull().default("whole")`); migration id `0012-seed-therapy-staffing`; exported `SETUP_RESOURCE_PATTERN` regex from `migrations/index.ts`.

- [ ] **Step 1: Write the failing test** `app/src/lib/db/migrations/seedTherapyStaffing.test.ts`:

```ts
// Run: npm test -- src/lib/db/migrations/seedTherapyStaffing.test.ts
//
// 0012 sets "setup" for therapies mapped to a machine-like resource (HBOT,
// infrared, HIFEM, red light, PEMF, sauna) and leaves the rest "whole".
// In-memory better-sqlite3 with only the tables it touches, as
// seedTherapyResources.test.ts does.
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { TENANT_MIGRATIONS } from "./index";

const migration = TENANT_MIGRATIONS.find((m) => m.id === "0012-seed-therapy-staffing");
assert.ok(migration, "0012-seed-therapy-staffing is in TENANT_MIGRATIONS");

function freshDb(withColumn: boolean) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE therapies (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL ${withColumn ? ", staffing TEXT NOT NULL DEFAULT 'whole'" : ""});
    CREATE TABLE resources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE therapy_resources (therapy_id INTEGER NOT NULL, resource_id INTEGER NOT NULL, units INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (therapy_id, resource_id));
  `);
  return db;
}

function seed(db: Database.Database) {
  const res = ["HBOT", "Infrared Therapy", "HIFEM Therapy", "Massage room", "Red Light Bed", "pemf mat", "Sauna"];
  for (const r of res) db.prepare("INSERT INTO resources (name) VALUES (?)").run(r);
  const th = [
    ["HBOT session", 1],
    ["Infrared session", 2],
    ["HIFEM session", 3],
    ["Deep tissue massage", 4],
    ["Facial", 4],
    ["Red light", 5],
    ["PEMF", 6],
    ["Sauna session", 7],
  ] as const;
  for (const [name, rid] of th) {
    const id = Number(db.prepare("INSERT INTO therapies (name) VALUES (?)").run(name).lastInsertRowid);
    db.prepare("INSERT INTO therapy_resources (therapy_id, resource_id) VALUES (?, ?)").run(id, rid);
  }
  // A therapy with no resource stays whole, even with a machine-like name.
  db.prepare("INSERT INTO therapies (name) VALUES ('HBOT unmapped')").run();
}

for (const withColumn of [true, false]) {
  const db = freshDb(withColumn);
  seed(db);
  migration!.up(db);
  const rows = db.prepare("SELECT name, staffing FROM therapies ORDER BY id").all() as { name: string; staffing: string }[];
  assert.deepEqual(rows, [
    { name: "HBOT session", staffing: "setup" },
    { name: "Infrared session", staffing: "setup" },
    { name: "HIFEM session", staffing: "setup" },
    { name: "Deep tissue massage", staffing: "whole" },
    { name: "Facial", staffing: "whole" },
    { name: "Red light", staffing: "setup" },
    { name: "PEMF", staffing: "setup" },
    { name: "Sauna session", staffing: "setup" },
    { name: "HBOT unmapped", staffing: "whole" },
  ], `staffing seeded (column ${withColumn ? "present" : "added by the migration"})`);

  // Re-running changes nothing.
  migration!.up(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM therapies WHERE staffing = 'setup'").get() as { n: number }).n, 6);
}

console.log("seedTherapyStaffing: all checks passed.");
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test -- src/lib/db/migrations/seedTherapyStaffing.test.ts`
Expected: FAIL, "0012-seed-therapy-staffing is in TENANT_MIGRATIONS".

- [ ] **Step 3: Schema.** In `app/src/lib/db/schema.ts`, inside `therapies` after `capacity`:

```ts
  // Staff rota: "whole" = a therapist is with the client the whole time;
  // "setup" = a therapist sets it up and can look after several at once.
  // See @/lib/scheduling/staffDemand.
  staffing: text("staffing", { enum: ["whole", "setup"] }).notNull().default("whole"),
```

After the `staff` table:

```ts
/** One shift on the staff rota: a person on from start to end on a Dublin calendar date. */
export const staffShifts = sqliteTable(
  "staff_shifts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    staffId: integer("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    /** "YYYY-MM-DD" */
    date: text("date").notNull(),
    /** "HH:mm" */
    start: text("start").notNull(),
    /** "HH:mm" */
    end: text("end").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ dateIdx: index("idx_staff_shifts_date").on(t.date) }),
);
export type StaffShift = typeof staffShifts.$inferSelect;
```

Check how other tables in schema.ts declare indexes (search `index(` in the file) and copy that exact form (array vs object return) and the `index` import; if no table uses drizzle indexes, drop the third argument and rely on the SQL index in tenant.ts. Also check whether `Staff` type is exported as `typeof staff.$inferSelect` and follow the same convention.

- [ ] **Step 4: Bootstrap.** In `ensureTenantTables` (`app/src/lib/db/tenant.ts`), right after the `CREATE TABLE IF NOT EXISTS staff (...)` statement inside the same SQL string:

```sql
    CREATE TABLE IF NOT EXISTS staff_shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      start TEXT NOT NULL,
      "end" TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_staff_shifts_date ON staff_shifts(date);
```

(`end` is an SQL keyword: keep it quoted in raw SQL; drizzle quotes column names itself.)

After the "therapies capacity migration" try/catch block:

```ts
  // Staff rota: who a treatment needs ("whole" or "setup"). Seeded once by
  // migration 0012-seed-therapy-staffing.
  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(therapies)")
      .all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "staffing")) {
      sqlite.exec("ALTER TABLE therapies ADD COLUMN staffing TEXT NOT NULL DEFAULT 'whole'");
    }
  } catch (err) {
    console.error("[db] therapies staffing migration failed:", err);
  }
```

- [ ] **Step 5: Migration.** In `app/src/lib/db/migrations/index.ts`, above `TENANT_MIGRATIONS`:

```ts
/** Resource names whose treatments a therapist sets up and leaves running (0012). */
export const SETUP_RESOURCE_PATTERN = /hbot|infrared|hifem|red light|pemf|sauna/i;
```

Append to `TENANT_MIGRATIONS`:

```ts
  {
    id: "0012-seed-therapy-staffing",
    description:
      "Staff rota: mark therapies mapped to a machine-like resource (HBOT, infrared, HIFEM, red light, PEMF, sauna, by resource name, case-insensitive) as 'setup', meaning one therapist can set several up and look after them together. Everything else keeps the column default 'whole'. Runs once. Nothing changes for a business until it uses the rota (setting staff_rota_on), because the staff rule is off by default.",
    up: (sqlite) => {
      const cols = sqlite.prepare("PRAGMA table_info(therapies)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "staffing")) {
        sqlite.exec("ALTER TABLE therapies ADD COLUMN staffing TEXT NOT NULL DEFAULT 'whole'");
      }
      const rows = sqlite
        .prepare(
          "SELECT DISTINCT tr.therapy_id AS id, r.name AS name FROM therapy_resources tr JOIN resources r ON r.id = tr.resource_id",
        )
        .all() as { id: number; name: string }[];
      const setSetup = sqlite.prepare("UPDATE therapies SET staffing = 'setup' WHERE id = ?");
      for (const id of new Set(rows.filter((r) => SETUP_RESOURCE_PATTERN.test(r.name)).map((r) => r.id))) {
        setSetup.run(id);
      }
    },
  },
```

- [ ] **Step 6: Run the tests**

Run: `npm test -- src/lib/db/migrations/seedTherapyStaffing.test.ts && npm test -- src/lib/db/migrations/index.test.ts && npm test -- src/lib/db/migrations/wiring.test.ts && npm test -- src/lib/db/tenant.test.ts && npm run typecheck`
Expected: all pass. If `wiring.test.ts` or `index.test.ts` pins the migration count or id list, update it to include `0012-seed-therapy-staffing`.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/db/schema.ts app/src/lib/db/tenant.ts app/src/lib/db/migrations/index.ts app/src/lib/db/migrations/seedTherapyStaffing.test.ts
# plus any migration test you had to update, by path
git commit -m "feat(rota): staff_shifts table, therapies.staffing and its seed migration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The rota repo (server)

**Files:**
- Create: `app/src/lib/scheduling/rotaRepo.ts`
- Test: `app/src/lib/scheduling/rotaRepo.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Staffing`, `staffingOf`, `DayCover`), Task 2 (`ShiftRow`, `validateShift`, `mondayOf`, `weekDates`, `coverForDate`, `buildRotaWeek`, `RotaWeekData`, `TreatmentStaffing`, `LookAtAppt`), Task 3 (`staffShifts`, `therapies.staffing`). `db` from `@/lib/db`, `readKey`, `setKey`, `getSettings` from `@/lib/settings`, `addDaysIso` from `@/lib/booking/slotModel`.
- Produces (exact):
  ```ts
  export const ROTA_ON_KEY = "staff_rota_on";
  export function rotaOn(): boolean;
  export function setRotaOn(on: boolean): void;
  export function rotaPeople(): { id: number; name: string }[];        // active staff, by name
  export function addPerson(name: string): { ok: true; id: number } | { ok: false; error: string };
  export function shiftsBetween(fromIso: string, toIso: string): ShiftRow[]; // active staff only, by date then start
  export type RotaResult = { ok: true; id?: number } | { ok: false; error: string };
  export function addShift(input: { staffId: number; date: string; start: string; end: string }): RotaResult;
  export function updateShift(id: number, patch: { start: string; end: string }): RotaResult;
  export function deleteShift(id: number): void;
  export function copyWeek(fromMonday: string, toMonday: string): number;   // replaces target week, returns copied count
  export function staffCoverResolver(): (dateIso: string) => DayCover;     // caches rotaOn + per-week shifts
  export function staffCoverFor(dateIso: string): DayCover;
  export function weekUnfilled(dateIso: string): boolean;                  // rota on and the week holding the date has no shifts
  export function staffingForTherapies(ids: number[]): Staffing;
  export function staffingResolver(): (therapyIdsJson: string | null) => { staffing: Staffing; label: string };
  export function listTreatmentStaffing(): TreatmentStaffing[];           // active therapies, by name
  export function setTherapyStaffing(id: number, staffing: Staffing): void;
  export function loadRotaWeek(monday: string): RotaWeekData;
  ```

Rules this module owns:
- `rotaOn()` = `readKey(ROTA_ON_KEY, false) === true`.
- The first shift switches the rota on: after a successful `addShift` or a `copyWeek` that copied at least one shift, if the settings row for `staff_rota_on` does not exist yet (`readKey<boolean | null>(ROTA_ON_KEY, null) === null`), `setKey(ROTA_ON_KEY, true)`. A business that switched it off stays off.
- `addShift`/`updateShift` validate with `validateShift(draft, getSettings().openingHours, sameDayShiftsOfThatPerson)`; unknown or inactive `staffId` returns `{ ok: false, error: "That person is not on the rota." }`; unknown shift id on update returns `{ ok: false, error: "That shift no longer exists." }`.
- `copyWeek` runs in one `db.transaction`: delete every shift in the target week (all staff), insert each source shift of an active person shifted by the day offset (`addDaysIso(date, days between mondays)`), skipping any that fail `validateShift` against opening hours. Returns the count inserted.
- Shifts of inactive staff do not count anywhere (`shiftsBetween` joins `staff` with `isActive = true`).
- `staffingResolver` caches per JSON string; label = the therapy names in the order of the ids, joined with " and " (unknown ids skipped); staffing = `staffingOf` of known ids' staffing (an unknown id counts as "whole").
- `loadRotaWeek(monday)`: people = `rotaPeople()`; weekShifts = `shiftsBetween(monday, monday+6)`; lastWeekShiftCount = `shiftsBetween(monday-7, monday-1).length`; appts = this week's appointments with status `scheduled` or `confirmed`, mapped through `staffingResolver`; treatments = `listTreatmentStaffing()`; then `buildRotaWeek`.

- [ ] **Step 1: Write the failing test** `app/src/lib/scheduling/rotaRepo.test.ts`:

```ts
// Run: npm test -- src/lib/scheduling/rotaRepo.test.ts
//
// The rota repo on a scratch tenant: shifts CRUD and validation, the setting
// switching on with the first shift (and staying off once switched off),
// copy last week, cover resolution, staffing, and the page's data.
import "@/lib/leadFlows/testing/stubs";

import assert from "node:assert/strict";

import { runWithTenant } from "@/lib/db/tenant";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { makeScratchTenant } from "@/lib/leadFlows/testing/harness";
import { readKey, setKey } from "@/lib/settings";

import * as repo from "./rotaRepo";

const scratch = makeScratchTenant("rota-repo-test");

(async () => {
  try {
    await runWithTenant(scratch.tid, async () => {
      // Mon 2030-01-07 .. Sun 2030-01-13. Default hours: Mon-Fri 08:00-20:00, Sat 09:00-16:00, Sun closed.
      assert.equal(repo.rotaOn(), false, "off by default");
      assert.deepEqual(repo.staffCoverFor("2030-01-07"), { mode: "off" });
      assert.equal(repo.weekUnfilled("2030-01-07"), false, "unfilled only matters while on");

      assert.deepEqual(repo.addPerson("  "), { ok: false, error: "Give the person a name." });
      const a = repo.addPerson("Example Therapist");
      const b = repo.addPerson("Second Therapist");
      assert.ok(a.ok && b.ok);
      const aId = (a as { id: number }).id;
      const bId = (b as { id: number }).id;
      assert.deepEqual(repo.rotaPeople().map((p) => p.name), ["Example Therapist", "Second Therapist"]);

      // Validation.
      assert.deepEqual(repo.addShift({ staffId: aId, date: "2030-01-13", start: "09:00", end: "17:00" }), { ok: false, error: "Closed that day, so no shifts." });
      assert.deepEqual(repo.addShift({ staffId: 9999, date: "2030-01-07", start: "09:00", end: "17:00" }), { ok: false, error: "That person is not on the rota." });
      assert.equal(repo.rotaOn(), false, "a refused shift does not switch the rota on");

      // First shift switches it on.
      const s1 = repo.addShift({ staffId: aId, date: "2030-01-07", start: "09:00", end: "17:00" });
      assert.ok(s1.ok && s1.id);
      assert.equal(repo.rotaOn(), true, "the first shift switches the rota on");
      assert.deepEqual(repo.addShift({ staffId: aId, date: "2030-01-07", start: "16:00", end: "18:00" }), { ok: false, error: "This overlaps another shift for the same person." });
      const s2 = repo.addShift({ staffId: aId, date: "2030-01-07", start: "17:00", end: "19:00" });
      assert.ok(s2.ok, "a split day is two shifts");
      assert.ok(repo.addShift({ staffId: bId, date: "2030-01-08", start: "13:00", end: "20:00" }).ok);

      // Update and delete.
      assert.deepEqual(repo.updateShift(s2.ok ? s2.id! : 0, { start: "17:00", end: "21:00" }), { ok: false, error: "Shifts have to sit inside opening hours (08:00–20:00)." });
      assert.deepEqual(repo.updateShift(s2.ok ? s2.id! : 0, { start: "17:30", end: "19:30" }), { ok: true, id: s2.ok ? s2.id : undefined });
      assert.deepEqual(repo.updateShift(123456, { start: "09:00", end: "10:00" }), { ok: false, error: "That shift no longer exists." });
      repo.deleteShift(s2.ok ? s2.id! : 0);
      assert.equal(repo.shiftsBetween("2030-01-07", "2030-01-13").length, 2);

      // Cover.
      assert.deepEqual(repo.staffCoverFor("2030-01-07"), { mode: "shifts", shifts: [{ startMin: 540, endMin: 1020 }] });
      assert.deepEqual(repo.staffCoverFor("2030-01-09"), { mode: "shifts", shifts: [] }, "a day with no shifts in a week with some has nobody");
      assert.deepEqual(repo.staffCoverFor("2030-01-14"), { mode: "assumeOne", openMin: 480, closeMin: 1200 }, "an empty week assumes one person in opening hours");
      assert.equal(repo.weekUnfilled("2030-01-16"), true);
      assert.equal(repo.weekUnfilled("2030-01-09"), false);

      // Copy last week into the next, replacing what was there.
      repo.addShift({ staffId: bId, date: "2030-01-15", start: "08:00", end: "10:00" });
      assert.equal(repo.copyWeek("2030-01-07", "2030-01-14"), 2);
      const next = repo.shiftsBetween("2030-01-14", "2030-01-20");
      assert.deepEqual(next.map((s) => [s.staffId, s.date, s.start, s.end]), [
        [aId, "2030-01-14", "09:00", "17:00"],
        [bId, "2030-01-15", "13:00", "20:00"],
      ]);

      // Switching off keeps it off, even when shifts are added later.
      repo.setRotaOn(false);
      assert.equal(repo.rotaOn(), false);
      repo.addShift({ staffId: aId, date: "2030-01-10", start: "09:00", end: "12:00" });
      assert.equal(repo.rotaOn(), false, "only the first-ever shift switches it on");
      assert.equal(readKey<boolean | null>(repo.ROTA_ON_KEY, null), false);
      repo.setRotaOn(true);

      // Inactive people do not count.
      db.update(schema.staff).set({ isActive: false }).where((await import("drizzle-orm")).eq(schema.staff.id, bId)).run();
      assert.deepEqual(repo.rotaPeople().map((p) => p.name), ["Example Therapist"]);
      assert.equal(repo.shiftsBetween("2030-01-14", "2030-01-20").length, 1);
      db.update(schema.staff).set({ isActive: true }).where((await import("drizzle-orm")).eq(schema.staff.id, bId)).run();

      // Staffing.
      const [massage, hbot, infrared] = db
        .insert(schema.therapies)
        .values([
          { name: "Deep tissue massage", colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: 80 },
          { name: "HBOT", colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: 95, staffing: "setup" },
          { name: "Infrared", colourHex: "#888888", defaultDurationMinutes: 30, defaultPriceEur: 40, staffing: "setup" },
        ])
        .returning()
        .all();
      assert.equal(massage.staffing, "whole", "column default");
      assert.equal(repo.staffingForTherapies([hbot.id, infrared.id]), "setup");
      assert.equal(repo.staffingForTherapies([hbot.id, massage.id]), "whole");
      assert.equal(repo.staffingForTherapies([]), "whole");
      const of = repo.staffingResolver();
      assert.deepEqual(of(JSON.stringify([massage.id, infrared.id])), { staffing: "whole", label: "Deep tissue massage and Infrared" });
      assert.deepEqual(of("not json"), { staffing: "whole", label: "" });
      repo.setTherapyStaffing(massage.id, "setup");
      assert.equal(repo.staffingForTherapies([massage.id]), "setup");
      repo.setTherapyStaffing(massage.id, "whole");
      assert.deepEqual(repo.listTreatmentStaffing().map((t) => [t.name, t.staffing]), [
        ["Deep tissue massage", "whole"],
        ["HBOT", "setup"],
        ["Infrared", "setup"],
      ]);

      // The page's data, with a booking to look at.
      const [client] = db.insert(schema.clients).values({ firstName: "Test", lastName: "Client", phone: "0800 000 000" }).returning().all();
      const base = { clientId: client.id, date: "2030-01-07", startTime: "10:00", endTime: "11:00", totalPriceEur: 0 } as const;
      db.insert(schema.appointments).values({ ...base, status: "scheduled", therapyIds: JSON.stringify([massage.id]) }).run();
      const [clash] = db.insert(schema.appointments).values({ ...base, status: "confirmed", therapyIds: JSON.stringify([hbot.id]) }).returning().all();
      db.insert(schema.appointments).values({ ...base, status: "cancelled", therapyIds: JSON.stringify([massage.id]) }).run();
      const week = repo.loadRotaWeek("2030-01-07");
      assert.equal(week.rotaOn, true);
      assert.equal(week.unfilled, false);
      assert.equal(week.thisWeekShiftCount, 3);
      assert.equal(week.people.length, 2);
      assert.deepEqual(week.lookAt.map((l) => [l.appointmentId, l.reason]), [
        [clash.id, "Only one therapist on at 10:00 and Deep tissue massage is booked then."],
      ]);
      assert.equal(week.treatments.length, 3);
    });
    console.log("rotaRepo: all checks passed.");
  } finally {
    scratch.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

(If `runWithTenant`'s signature differs, read `app/src/lib/db/tenant.ts` and adapt; see `app/src/app/api/appointments/free-slots/route.test.ts` for a working use. If importing `@/lib/leadFlows/testing/stubs` with the `@/` alias fails under tsx, use the relative path `../leadFlows/testing/stubs`. Replace the inline `await import("drizzle-orm")` with a top-level `import { eq } from "drizzle-orm";` — it is written inline above only to keep the snippet self-contained.)

- [ ] **Step 2: Run it and see it fail**

Run: `npm test -- src/lib/scheduling/rotaRepo.test.ts`
Expected: FAIL, cannot find module `./rotaRepo`.

- [ ] **Step 3: Implement** `app/src/lib/scheduling/rotaRepo.ts`:

```ts
import "server-only";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { appointments, staff, staffShifts, therapies } from "@/lib/db/schema";
import { addDaysIso } from "@/lib/booking/slotModel";
import { getSettings, readKey, setKey } from "@/lib/settings";

import {
  buildRotaWeek,
  coverForDate,
  mondayOf,
  validateShift,
  type RotaWeekData,
  type ShiftRow,
  type TreatmentStaffing,
} from "./rotaModel";
import { staffingOf, type DayCover, type Staffing } from "./staffDemand";

/**
 * Loading and saving side of the staff rota. The rule itself is pure
 * (./staffDemand), and so is the page's data (./rotaModel).
 *
 * The setting `staff_rota_on` decides whether bookings follow the rota at
 * all. Off by default, so every business that never opens the rota books
 * exactly as before. The first shift ever saved switches it on; once someone
 * switches it off it stays off until switched on again.
 */

export const ROTA_ON_KEY = "staff_rota_on";

export function rotaOn(): boolean {
  return readKey<boolean>(ROTA_ON_KEY, false) === true;
}

export function setRotaOn(on: boolean): void {
  setKey(ROTA_ON_KEY, on);
}

function switchOnWithFirstShift(): void {
  if (readKey<boolean | null>(ROTA_ON_KEY, null) === null) setKey(ROTA_ON_KEY, true);
}

export function rotaPeople(): { id: number; name: string }[] {
  return db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(eq(staff.isActive, true))
    .orderBy(asc(staff.name), asc(staff.id))
    .all();
}

export function addPerson(name: string): { ok: true; id: number } | { ok: false; error: string } {
  const clean = name.trim().slice(0, 120);
  if (!clean) return { ok: false, error: "Give the person a name." };
  const [row] = db.insert(staff).values({ name: clean }).returning({ id: staff.id }).all();
  return { ok: true, id: row!.id };
}

export function shiftsBetween(fromIso: string, toIso: string): ShiftRow[] {
  return db
    .select({ id: staffShifts.id, staffId: staffShifts.staffId, date: staffShifts.date, start: staffShifts.start, end: staffShifts.end })
    .from(staffShifts)
    .innerJoin(staff, eq(staff.id, staffShifts.staffId))
    .where(and(gte(staffShifts.date, fromIso), lte(staffShifts.date, toIso), eq(staff.isActive, true)))
    .orderBy(asc(staffShifts.date), asc(staffShifts.start), asc(staffShifts.id))
    .all();
}

export type RotaResult = { ok: true; id?: number } | { ok: false; error: string };

function personIsActive(staffId: number): boolean {
  const row = db.select({ id: staff.id, isActive: staff.isActive }).from(staff).where(eq(staff.id, staffId)).get();
  return !!row && row.isActive;
}

function sameDay(staffId: number, date: string): ShiftRow[] {
  return db
    .select({ id: staffShifts.id, staffId: staffShifts.staffId, date: staffShifts.date, start: staffShifts.start, end: staffShifts.end })
    .from(staffShifts)
    .where(and(eq(staffShifts.staffId, staffId), eq(staffShifts.date, date)))
    .all();
}

export function addShift(input: { staffId: number; date: string; start: string; end: string }): RotaResult {
  if (!personIsActive(input.staffId)) return { ok: false, error: "That person is not on the rota." };
  const error = validateShift(input, getSettings().openingHours, sameDay(input.staffId, input.date));
  if (error) return { ok: false, error };
  const [row] = db.insert(staffShifts).values(input).returning({ id: staffShifts.id }).all();
  switchOnWithFirstShift();
  return { ok: true, id: row!.id };
}

export function updateShift(id: number, patch: { start: string; end: string }): RotaResult {
  const current = db.select().from(staffShifts).where(eq(staffShifts.id, id)).get();
  if (!current) return { ok: false, error: "That shift no longer exists." };
  const draft = { id, staffId: current.staffId, date: current.date, start: patch.start, end: patch.end };
  const error = validateShift(draft, getSettings().openingHours, sameDay(current.staffId, current.date));
  if (error) return { ok: false, error };
  db.update(staffShifts).set({ start: patch.start, end: patch.end, updatedAt: new Date() }).where(eq(staffShifts.id, id)).run();
  return { ok: true, id };
}

export function deleteShift(id: number): void {
  db.delete(staffShifts).where(eq(staffShifts.id, id)).run();
}

/** Days between two ISO dates (b - a). */
function daysBetween(a: string, b: string): number {
  const ms = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** Replace the target week's shifts with the source week's. Returns how many were copied. */
export function copyWeek(fromMonday: string, toMonday: string): number {
  const offset = daysBetween(fromMonday, toMonday);
  const source = shiftsBetween(fromMonday, addDaysIso(fromMonday, 6));
  const hours = getSettings().openingHours;
  let copied = 0;
  db.transaction((tx) => {
    tx.delete(staffShifts)
      .where(and(gte(staffShifts.date, toMonday), lte(staffShifts.date, addDaysIso(toMonday, 6))))
      .run();
    const placed: ShiftRow[] = [];
    for (const s of source) {
      const draft = { staffId: s.staffId, date: addDaysIso(s.date, offset), start: s.start, end: s.end };
      if (validateShift(draft, hours, placed.filter((p) => p.staffId === draft.staffId && p.date === draft.date))) continue;
      const [row] = tx.insert(staffShifts).values(draft).returning({ id: staffShifts.id }).all();
      placed.push({ id: row!.id, ...draft });
      copied++;
    }
  });
  if (copied > 0) switchOnWithFirstShift();
  return copied;
}

/** Who is on, per date, with the setting and each week's shifts read once. */
export function staffCoverResolver(): (dateIso: string) => DayCover {
  const on = rotaOn();
  if (!on) return () => ({ mode: "off" });
  const openingHours = getSettings().openingHours;
  const weeks = new Map<string, ShiftRow[]>();
  return (dateIso) => {
    const monday = mondayOf(dateIso);
    let weekShifts = weeks.get(monday);
    if (!weekShifts) {
      weekShifts = shiftsBetween(monday, addDaysIso(monday, 6));
      weeks.set(monday, weekShifts);
    }
    return coverForDate(dateIso, { rotaOn: true, weekShifts, openingHours });
  };
}

export function staffCoverFor(dateIso: string): DayCover {
  return staffCoverResolver()(dateIso);
}

/** Rota on, and the week holding this date has no shifts: bookings assume one person on. */
export function weekUnfilled(dateIso: string): boolean {
  if (!rotaOn()) return false;
  const monday = mondayOf(dateIso);
  return shiftsBetween(monday, addDaysIso(monday, 6)).length === 0;
}

function therapyStaffingRows(ids: number[]): { id: number; name: string; staffing: Staffing }[] {
  if (ids.length === 0) return [];
  return db
    .select({ id: therapies.id, name: therapies.name, staffing: therapies.staffing })
    .from(therapies)
    .where(inArray(therapies.id, ids))
    .all();
}

export function staffingForTherapies(ids: number[]): Staffing {
  const rows = new Map(therapyStaffingRows(ids).map((r) => [r.id, r.staffing]));
  return staffingOf(ids.map((id) => rows.get(id) ?? "whole"));
}

/** Staffing and a label per appointment, keyed by its therapy_ids JSON (combinations repeat, so each is resolved once). */
export function staffingResolver(): (therapyIdsJson: string | null) => { staffing: Staffing; label: string } {
  const cache = new Map<string, { staffing: Staffing; label: string }>();
  return (json) => {
    const key = json || "[]";
    const hit = cache.get(key);
    if (hit) return hit;
    let ids: number[] = [];
    try {
      const parsed = JSON.parse(key);
      if (Array.isArray(parsed)) ids = parsed.map(Number).filter((n) => Number.isFinite(n));
    } catch {
      ids = [];
    }
    const rows = new Map(therapyStaffingRows(ids).map((r) => [r.id, r]));
    const value = {
      staffing: staffingOf(ids.map((id) => rows.get(id)?.staffing ?? "whole")),
      label: ids.map((id) => rows.get(id)?.name).filter((n): n is string => !!n).join(" and "),
    };
    cache.set(key, value);
    return value;
  };
}

export function listTreatmentStaffing(): TreatmentStaffing[] {
  return db
    .select({ id: therapies.id, name: therapies.name, staffing: therapies.staffing })
    .from(therapies)
    .where(eq(therapies.isActive, true))
    .orderBy(asc(therapies.name), asc(therapies.id))
    .all();
}

export function setTherapyStaffing(id: number, staffing: Staffing): void {
  db.update(therapies).set({ staffing }).where(eq(therapies.id, id)).run();
}

export function loadRotaWeek(monday: string): RotaWeekData {
  const sunday = addDaysIso(monday, 6);
  const of = staffingResolver();
  const appts = db
    .select({ id: appointments.id, date: appointments.date, startTime: appointments.startTime, endTime: appointments.endTime, therapyIds: appointments.therapyIds })
    .from(appointments)
    .where(and(gte(appointments.date, monday), lte(appointments.date, sunday), inArray(appointments.status, ["scheduled", "confirmed"])))
    .all()
    .map((a) => ({ id: a.id, date: a.date, startTime: a.startTime, endTime: a.endTime, ...of(a.therapyIds) }));
  return buildRotaWeek({
    monday,
    rotaOn: rotaOn(),
    openingHours: getSettings().openingHours,
    people: rotaPeople(),
    weekShifts: shiftsBetween(monday, sunday),
    lastWeekShiftCount: shiftsBetween(addDaysIso(monday, -7), addDaysIso(monday, -1)).length,
    appts,
    treatments: listTreatmentStaffing(),
  });
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npm test -- src/lib/scheduling/rotaRepo.test.ts && npm run typecheck`
Expected: `rotaRepo: all checks passed.` and no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/scheduling/rotaRepo.ts app/src/lib/scheduling/rotaRepo.test.ts
git commit -m "feat(rota): rota repo (shifts, copy week, cover, staffing, week data)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Apply the staff rule through both seams

**Files:**
- Modify: `app/src/lib/scheduling/freeSlots.ts`
- Modify: `app/src/lib/schedule.ts` (`checkBookingSlot`)
- Modify: `app/src/lib/scheduling/availability.ts` (`findFreeSlots`)
- Modify: `app/src/app/api/appointments/free-slots/route.ts`
- Modify: `app/src/lib/scheduling/resourceDemand.ts` (header comment only)
- Modify: `app/src/lib/scheduling/freeSlots.test.ts` (add staff cases)
- Test: `app/src/lib/scheduling/staffRule.test.ts`

**Interfaces:**
- Consumes: Task 1 `firstStaffShortfall`, `staffShortfallReason`, `DayCover`, `StaffedSpan`, `Staffing`; Task 4 `staffCoverFor`, `staffCoverResolver`, `staffingForTherapies`, `staffingResolver`, `weekUnfilled`; Task 2 `mondayOf`.
- Produces:
  - `DayAvailability.staff?: { cover: DayCover; booked: StaffedSpan[] }` and `FreeSlotsInput.staffing?: Staffing` in `freeSlots.ts`.
  - `findFreeSlots(opts: { limit?: number; maxPerDay?: number; now?: Date; recheck?: boolean })` — `recheck` defaults to true; false skips the final `checkBookingSlot` filter (test hook so the agreement test sees what the pure search alone offers).
  - Free-slots JSON gains `rota: { unfilled: boolean; week: string }` (`week` = Monday ISO of `date`).

- [ ] **Step 1: Pure seam tests.** Append to `app/src/lib/scheduling/freeSlots.test.ts` before its final log line (read the file first and reuse its helpers if it has them):

```ts
// ── Staff rule through the same seam ──────────────────────────────────────
{
  const day = (staff?: { cover: import("./staffDemand").DayCover; booked: import("./staffDemand").StaffedSpan[] }) => ({
    date: "2030-01-07", closed: false, openMin: 9 * 60, closeMin: 12 * 60, busy: [], staff,
  });
  const base = {
    durationMinutes: 60, bufferMinutes: 0, granularityMinutes: 60, demand: new Map([[1, 1]]),
    limits: new Map(), earliest: { date: "2030-01-01", min: 0 }, limit: 10,
  };
  const massageAt10 = { startMin: 600, endMin: 660, staffing: "whole" as const, label: "Massage" };
  const ONE = { mode: "shifts" as const, shifts: [{ startMin: 540, endMin: 720 }] };
  const times = (s: { startTime: string }[]) => s.map((x) => x.startTime);

  assert.deepEqual(times(computeFreeSlots({ ...base, days: [day()] })), ["09:00", "10:00", "11:00"], "no staff info = today");
  assert.deepEqual(times(computeFreeSlots({ ...base, days: [day({ cover: { mode: "off" }, booked: [massageAt10] })] })), ["09:00", "10:00", "11:00"], "rota off = today");
  assert.deepEqual(times(computeFreeSlots({ ...base, staffing: "setup", days: [day({ cover: ONE, booked: [massageAt10] })] })), ["09:00", "11:00"], "one on: the massage hour is not offered");
  assert.deepEqual(times(computeFreeSlots({ ...base, staffing: "setup", days: [day({ cover: { mode: "shifts", shifts: [] }, booked: [] })] })), [], "nobody on: nothing offered");
}
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test -- src/lib/scheduling/freeSlots.test.ts`
Expected: FAIL on "one on: the massage hour is not offered" (and a type error on `staff`/`staffing` is fine under tsx, which does not typecheck).

- [ ] **Step 3: `freeSlots.ts`.** Import and extend:

```ts
import { firstStaffShortfall, type DayCover, type Staffing, type StaffedSpan } from "./staffDemand";
```

In `DayAvailability` add:

```ts
  /**
   * Who is on and what is booked, for the staff rule (./staffDemand). Absent
   * or cover "off" means the rule does not apply: today's behaviour.
   */
  staff?: { cover: DayCover; booked: StaffedSpan[] };
```

In `FreeSlotsInput` add:

```ts
  /** Who this service needs for the staff rule. Defaults to "whole". */
  staffing?: Staffing;
```

Destructure `staffing` in `computeFreeSlots` and, right after `if (clash) continue;`:

```ts
      // The SAME staff rule the booking path enforces — see ./staffDemand.
      if (
        day.staff &&
        firstStaffShortfall({ startMin: start, endMin: end, staffing: staffing ?? "whole", booked: day.staff.booked, cover: day.staff.cover })
      ) {
        continue;
      }
```

Update the header comment: the rules are `./resourceDemand` and `./staffDemand`, each called here and in `checkBookingSlot`.

Run: `npm test -- src/lib/scheduling/freeSlots.test.ts` — Expected: PASS.

- [ ] **Step 4: Write the failing agreement test** `app/src/lib/scheduling/staffRule.test.ts`:

```ts
// Run: npm test -- src/lib/scheduling/staffRule.test.ts
//
// The staff rule through both seams on a scratch tenant: the booking check
// (checkBookingSlot), the booking screen's free times (GET
// /api/appointments/free-slots) and the lead engine's search (findFreeSlots
// without its final re-check) agree on the same diary, and with the rota off
// every answer is exactly what it was before any rota data existed.
import Module from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/api/guard") return { guard: async () => null };
  return realLoad.call(this, request, ...rest);
};

import "@/lib/leadFlows/testing/stubs";

import assert from "node:assert/strict";

import { runWithTenant } from "@/lib/db/tenant";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { makeScratchTenant } from "@/lib/leadFlows/testing/harness";
import { setKey } from "@/lib/settings";
import { checkBookingSlot } from "@/lib/schedule";

import { findFreeSlots } from "./availability";
import * as repo from "./rotaRepo";

interface Slot { time: string; free: boolean; reason?: string }
interface Body { ok: boolean; slots: Slot[]; rota: { unfilled: boolean; week: string } }

const scratch = makeScratchTenant("staff-rule-test");

(async () => {
  const { GET } = await import("@/app/api/appointments/free-slots/route");
  const route = async (date: string, duration: number, ids: number[]) => {
    const res = await GET({ nextUrl: new URL(`http://localhost/api/appointments/free-slots?date=${date}&duration=${duration}&therapyIds=${ids.join(",")}`) } as never);
    return (await res.json()) as Body;
  };
  const freeTimes = (b: Body) => b.slots.filter((s) => s.free).map((s) => s.time);
  // The lead engine's search for a day, without the final re-check.
  const search = (date: string) =>
    findFreeSlots({ limit: 1000, now: new Date("2030-01-06T12:00:00Z"), recheck: false }).slots.filter((s) => s.date === date).map((s) => s.startTime);

  try {
    await runWithTenant(scratch.tid, async () => {
      const [massage, hbot] = db
        .insert(schema.therapies)
        .values([
          { name: "Deep tissue massage", colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: 80, staffing: "whole" },
          { name: "HBOT", colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: 95, staffing: "setup" },
        ])
        .returning()
        .all();
      const [client] = db.insert(schema.clients).values({ firstName: "Test", lastName: "Client", phone: "0800 000 000" }).returning().all();
      // Mon 2030-01-07 and Mon 2030-01-14 (default hours 08:00-20:00): a massage 10:00-11:00 each.
      for (const date of ["2030-01-07", "2030-01-14"]) {
        db.insert(schema.appointments).values({ clientId: client.id, date, startTime: "10:00", endTime: "11:00", status: "scheduled", therapyIds: JSON.stringify([massage.id]), totalPriceEur: 80 }).run();
      }
      // The lead engine offers 60-minute HBOT sessions on a 15-minute grid, no lead time.
      setKey("consultation_minutes", 60);
      setKey("consultation_granularity_minutes", 15);
      setKey("consultation_lead_minutes", 0);
      setKey("consultation_horizon_days", 14);
      setKey("consultation_therapy_ids", [hbot.id]);

      // ── Rota off, no rota data: the baseline every business has today.
      const baseline = await route("2030-01-07", 60, [hbot.id]);
      const baselineSearch = search("2030-01-07");
      assert.equal(baseline.rota.unfilled, false);
      assert.equal(baseline.rota.week, "2030-01-07");
      assert.equal(checkBookingSlot("2030-01-07", "10:00", 60, [hbot.id]).ok, true, "rota off: HBOT beside a massage is allowed, as today");
      assert.deepEqual(freeTimes(baseline), baselineSearch, "rota off: route and search agree");

      // ── Rota on with one person Monday 09:00-17:00.
      const a = repo.addPerson("Example Therapist");
      assert.ok(a.ok);
      const aId = (a as { id: number }).id;
      assert.ok(repo.addShift({ staffId: aId, date: "2030-01-07", start: "09:00", end: "17:00" }).ok);
      assert.equal(repo.rotaOn(), true);

      assert.deepEqual(checkBookingSlot("2030-01-07", "10:00", 60, [hbot.id]), { ok: false, reason: "Only one therapist on at 10:00 and Deep tissue massage is booked then." });
      assert.deepEqual(checkBookingSlot("2030-01-07", "09:30", 60, [hbot.id]), { ok: false, reason: "Only one therapist on at 10:00 and Deep tissue massage is booked then." });
      assert.equal(checkBookingSlot("2030-01-07", "11:00", 60, [hbot.id]).ok, true);
      assert.deepEqual(checkBookingSlot("2030-01-07", "16:30", 60, [hbot.id]), { ok: false, reason: "Nobody is on the rota then." });
      assert.deepEqual(checkBookingSlot("2030-01-08", "10:00", 60, [hbot.id]), { ok: false, reason: "Nobody is on the rota then." }, "a day with no shifts in a week with some");
      assert.equal(checkBookingSlot("2030-01-07", "10:00", 60, [hbot.id], undefined).ok, false);

      const on = await route("2030-01-07", 60, [hbot.id]);
      assert.equal(on.rota.unfilled, false);
      for (const s of on.slots) {
        assert.equal(s.free, checkBookingSlot("2030-01-07", s.time, 60, [hbot.id]).ok, `route agrees with the booking check at ${s.time}`);
      }
      assert.deepEqual(freeTimes(on), search("2030-01-07"), "rota on: route and search agree");
      assert.equal(freeTimes(on)[0], "09:00");
      assert.ok(!freeTimes(on).includes("10:00"));
      assert.ok(freeTimes(on).includes("11:00"));
      assert.ok(!freeTimes(on).includes("16:15"), "16:15-17:15 runs past the only shift");
      const taken = on.slots.find((s) => s.time === "10:00")!;
      assert.equal(taken.reason, "Only one therapist on at 10:00 and Deep tissue massage is booked then.", "the reason reaches the booking screen");

      // Two on: the massage and HBOT together are fine.
      const b = repo.addPerson("Second Therapist");
      assert.ok(b.ok);
      assert.ok(repo.addShift({ staffId: (b as { id: number }).id, date: "2030-01-07", start: "09:00", end: "17:00" }).ok);
      assert.equal(checkBookingSlot("2030-01-07", "10:00", 60, [hbot.id]).ok, true);
      assert.deepEqual(freeTimes(await route("2030-01-07", 60, [hbot.id])), search("2030-01-07"));

      // ── Unfilled week (no shifts week of 14th): one person in opening hours.
      const unfilled = await route("2030-01-14", 60, [hbot.id]);
      assert.equal(unfilled.rota.unfilled, true);
      assert.equal(unfilled.rota.week, "2030-01-14");
      assert.equal(checkBookingSlot("2030-01-14", "10:00", 60, [hbot.id]).ok, false, "one assumed person is busy with the massage");
      assert.equal(checkBookingSlot("2030-01-14", "11:00", 60, [hbot.id]).ok, true);
      assert.deepEqual(freeTimes(unfilled), search("2030-01-14"));

      // ── Switched off: exactly the baseline again, rota data and all.
      repo.setRotaOn(false);
      const off = await route("2030-01-07", 60, [hbot.id]);
      assert.deepEqual(off.slots, baseline.slots, "rota off: identical to before any rota data");
      assert.deepEqual(search("2030-01-07"), baselineSearch);
      assert.equal(off.rota.unfilled, false);
      assert.equal(checkBookingSlot("2030-01-08", "10:00", 60, [hbot.id]).ok, true);
    });
    console.log("staffRule: all checks passed.");
  } finally {
    scratch.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Notes for the implementer: the stub ordering matters (`@/lib/api/guard` must be stubbed before the route loads; the route is imported dynamically inside the async block for that reason). If the alias import fails under tsx, use relative paths as in `app/src/app/api/appointments/free-slots/route.test.ts`, which also shows `runWithTenant`. 2030-01-06 12:00Z is Sunday 12:00 in Dublin (closed), so the search starts Monday.

- [ ] **Step 5: Run it and see it fail**

Run: `npm test -- src/lib/scheduling/staffRule.test.ts`
Expected: FAIL (`rota` missing from the route body, then the rule not applied).

- [ ] **Step 6: `checkBookingSlot`.** In `app/src/lib/schedule.ts` import:

```ts
import { firstStaffShortfall, staffShortfallReason } from "./scheduling/staffDemand";
import { staffCoverFor, staffingForTherapies, staffingResolver } from "./scheduling/rotaRepo";
```

Refactor step 3 so the filtered list is a named const reused by step 4:

```ts
  const kept = existing.filter(
    (a) => a.status !== "cancelled" && (excludeAppointmentId == null || a.id !== excludeAppointmentId),
  );
```

pass `booked: kept.map(...)` to `firstConflict`, then after `if (conflict) ...`:

```ts
  // 4. Staff on the rota. Only when the business uses the rota (setting
  //    staff_rota_on); off, `staffCoverFor` says "off" and this is skipped,
  //    so every other business books exactly as before. The arithmetic is
  //    @/lib/scheduling/staffDemand, shared with the free-slot engine.
  const cover = staffCoverFor(dateIso);
  if (cover.mode !== "off") {
    const staffingOfAppt = staffingResolver();
    const short = firstStaffShortfall({
      startMin,
      endMin,
      staffing: staffingForTherapies(therapyIds),
      cover,
      booked: kept.map((a) => ({
        startMin: hmToMin(a.startTime),
        endMin: hmToMin(a.endTime),
        ...staffingOfAppt(a.therapyIds),
      })),
    });
    if (short) return { ok: false, reason: staffShortfallReason(short) };
  }
```

Also fix the stale doc comment above `checkBookingSlot` ("share at least one therapy (capacity-1-per-therapy model)") to say: opening hours, block-outs, resource limits, then the staff rule when the rota is on.

- [ ] **Step 7: `findFreeSlots`.** In `app/src/lib/scheduling/availability.ts`:
  - import `staffCoverResolver, staffingForTherapies, staffingResolver` from `./rotaRepo`;
  - add `recheck?: boolean` to the opts type (doc: "Defaults to true. False skips the final checkBookingSlot filter; tests use it to see what the search alone offers.");
  - before the day loop: `const coverOf = staffCoverResolver(); const staffingOfAppt = staffingResolver();`
  - in the open-day branch, build `staff` from the day's appointments (not the block-outs):

```ts
    const dayAppts = byDate.get(date) ?? [];
    const cover = coverOf(date);
    const staff = cover.mode === "off"
      ? undefined
      : {
          cover,
          booked: dayAppts.map((a) => ({
            startMin: hmToMin(a.startTime),
            endMin: hmToMin(a.endTime),
            ...staffingOfAppt(a.therapyIds),
          })),
        };
```

   and push `staff` on the `DayAvailability`;
  - pass `staffing: staffingForTherapies(config.therapyIds)` to `computeFreeSlots`;
  - the final filter becomes `const slots = (opts.recheck === false ? candidates : candidates.filter(...)).slice(0, limit);`
  - update the header comment: both rules (`./resourceDemand`, `./staffDemand`).

- [ ] **Step 8: Free-slots route.** In `app/src/app/api/appointments/free-slots/route.ts` import `weekUnfilled` from `@/lib/scheduling/rotaRepo` and `mondayOf` from `@/lib/scheduling/rotaModel`, and add to the JSON:

```ts
    // The booking screen shows a reminder when this week's rota is empty.
    rota: { unfilled: weekUnfilled(date), week: mondayOf(date) },
```

Update the doc comment: free means `checkBookingSlot` accepts it (opening hours, block-outs, resource limits, buffer, and the staff rule when the rota is on).

- [ ] **Step 9: `resourceDemand.ts` header.** Replace the paragraph starting "Staff are deliberately NOT modelled." with:

```ts
 * Staff are modelled separately, in ./staffDemand: a person is not a
 * resource with a fixed concurrency, because one therapist can watch three
 * machines while a massage takes a whole person. That rule reads the staff
 * rota and applies only when a business uses it.
```

- [ ] **Step 10: Run everything touched**

Run: `npm test -- src/lib/scheduling/staffRule.test.ts && npm test -- src/lib/scheduling/freeSlots.test.ts && npm test -- src/lib/scheduling/resourceDemand.test.ts && npm test -- src/app/api/appointments/free-slots/route.test.ts && npm test -- src/app/api/appointments/route.test.ts && npm run typecheck`
Expected: all pass. Then `grep -rln "checkBookingSlot\|findFreeSlots\|offerableSlots\|bookConsultation" app/src --include=*.test.ts` and run each listed test; all must still pass.

- [ ] **Step 11: Commit**

```bash
git add app/src/lib/scheduling/freeSlots.ts app/src/lib/scheduling/freeSlots.test.ts app/src/lib/schedule.ts app/src/lib/scheduling/availability.ts app/src/app/api/appointments/free-slots/route.ts app/src/lib/scheduling/resourceDemand.ts app/src/lib/scheduling/staffRule.test.ts
git commit -m "feat(rota): apply the staff rule in checkBookingSlot and the free-slot search

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The rota page

**Files:**
- Create: `app/src/app/appointments/rota/page.tsx`
- Create: `app/src/app/appointments/rota/actions.ts`
- Create: `app/src/components/appointments/rota/RotaView.tsx`
- Create: `app/src/components/appointments/rota/ShiftDialog.tsx`
- Create: `app/src/components/appointments/rota/AddPersonDialog.tsx`
- Modify: `app/src/app/globals.css` (append a `.rv` block at the end of the file)
- Modify: `app/src/app/appointments/page.tsx` (add a "Rota" header button)

**Interfaces:**
- Consumes: Task 2 `RotaWeekData`, `RotaPerson`, `RotaDay`, `shiftLabel`, `isIsoDate`, `mondayOf`; Task 4 repo functions; `dublinDay` from `@/lib/cashModel` (check its signature: it returns today's Dublin "YYYY-MM-DD"; if it takes a Date, pass `new Date()`).
- Produces:
  ```ts
  // actions.ts ("use server")
  export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };
  export async function addShiftAction(input: { staffId: number; date: string; start: string; end: string }): Promise<ActionResult>;
  export async function updateShiftAction(id: number, input: { start: string; end: string }): Promise<ActionResult>;
  export async function deleteShiftAction(id: number): Promise<ActionResult>;
  export async function copyLastWeekAction(monday: string): Promise<ActionResult>;  // message: "Copied 9 shifts."
  export async function addPersonAction(name: string): Promise<ActionResult>;
  export async function setRotaOnAction(on: boolean): Promise<ActionResult>;        // admin
  export async function setStaffingAction(therapyId: number, staffing: "whole" | "setup"): Promise<ActionResult>; // admin
  // RotaView.tsx ("use client")
  export interface RotaActions { addShift; updateShift; deleteShift; copyLastWeek; addPerson; setRotaOn; setStaffing } // same signatures as above
  export function RotaView(props: { data: RotaWeekData; isAdmin: boolean; actions: RotaActions; weekHref?: (monday: string) => string }): JSX.Element;
  ```
  `actions` is a prop (the page passes the server actions) so the browser-check harness in Task 8 can pass in-memory fakes. `weekHref` defaults to `(m) => "/appointments/rota?week=" + m`.

**Behaviour and copy (match the mockup at `/Users/truep/Desktop/Clients/Renova/.superpowers/brainstorm/39327-1795697818/content/rota.html`; read it before starting):**

1. Page (`page.tsx`, server): `export const dynamic = "force-dynamic"`; `await requireUserPage()`; `const role = getCurrentMembership()?.role`; week param: `isIsoDate(sp.week) ? mondayOf(sp.week) : mondayOf(dublinDay(...))`; render `<div className="app-page"><RotaView data={loadRotaWeek(monday)} isAdmin={role === "admin"} actions={{ addShift: addShiftAction, ... }} /></div>`.
2. Actions: each starts `await requireUser()` (staffing and on/off: `await requireAdmin()`), validates input with zod (`date` ISO, times `isHm`, ids positive ints, name 1-120 chars after trim, staffing enum), calls the repo, `revalidatePath("/appointments/rota")` and also `revalidatePath("/appointments")` and `revalidatePath("/appointments/new")`, returns `{ ok: false, error }` on refusal and never throws for user errors. `copyLastWeekAction(monday)` copies `addDaysIso(monday, -7)` into `monday`; returns `{ ok: false, error: "Last week has no shifts to copy." }` when the count is 0 (check the source count first so nothing is deleted in that case), else `{ ok: true, message: "Copied N shifts." }` (`"Copied 1 shift."` for one).
3. Header: `PageHeader` with `title="Rota"`, `eyebrow="Schedule"`, `subtitle="Who is in each day. Bookings only allow what the people on shift can cover."`, `actions` = week nav (prev/next as `Link`s styled as icon buttons with `ChevronLeft`/`ChevronRight` and `aria-label="Previous week"`/`"Next week"`, range label `data.rangeLabel` between them in `.rv-week`), a "Copy last week" `Button variant="secondary"` with `Copy` icon, and an "Add a person" `Button variant="secondary"` with `Plus` icon.
4. Banners above the grid (`.rv-banner`, icon + text):
   - rota off: `Info` icon, "Bookings do not check the rota." plus, for admins, a `Button size="sm" variant="secondary"` "Use the rota for bookings" calling `setRotaOn(true)`.
   - `data.unfilled`: warning tone, `AlertTriangle` icon, "No shifts this week, so bookings assume one person on during opening hours."
5. No people: `EmptyState` with icon `UserPlus`, title "Add the people who work in the clinic", message "Then add their shifts for each week.", action "Add a person" button. The look-at and treatments cards still render below.
6. Grid (`.rv-grid`, CSS grid `170px repeat(7, minmax(0, 1fr))`) inside a `.rv-panel`:
   - header row: empty corner, then per day `<b>{day.label}</b>` and `Open {shortTime(open)}–{shortTime(close)}` or "Closed" (class `is-closed`).
   - one row per person: `.rv-who` with `.rv-av` (initials) and name, `<small>{person.hours}</small>`; then per day a `.rv-cell` (hatched + empty for closed days) holding the person's shifts as buttons `.rv-shift` (`data-tone={person.tone}`, text `shiftLabel(start, end)`, `aria-label="Edit {name}'s shift on {day.label}, {label}"`) and a dashed `+ Add` button `.rv-add` (`aria-label="Add a shift for {name} on {day.label}"`).
   - "On shift" row: `.rv-foot` "<b>On shift</b>how many are in", then per open day `.rv-cov`: a `.rv-bar` with one `<i>` per run, `style={{ flexGrow: run.endMin - run.startMin }}` and `data-n={Math.min(run.count, 2)}`, then the `text` lines each on its own line; closed days empty.
   - legend `.rv-legend`: three swatches with "Two on: a massage and the machines together", "One on: a massage or the machines", "Nobody on: no bookings".
7. Phone cards (`.rv-cards`): one `.rv-day` card per day: header `<b>{label}</b>` + `text.join(" · ")` (or "Closed"), then per person a `.rv-prow`: name, their shifts as `.rv-shift` buttons, and `+ Add`. Closed day cards show "Closed" only.
8. Shift dialog (`ShiftDialog.tsx`): `Dialog` + `DialogContent` with `title` "Add a shift" or "Edit shift", `description` "{person name}, {weekdayLong(date)} {fullDate(date)}"; two `Input type="time"` with `Label`s "Starts" and "Ends" (defaults for add: the day's opening and closing times); an error line (`role="alert"`) for the action's error; buttons "Save" (primary, `loading` while pending), "Remove shift" (destructive outline, edit only, asks `useConfirm()` "Remove this shift?" first) and "Cancel". On success: close, `toast.success("Shift saved.")`/`"Shift removed."`, `router.refresh()`.
9. Add person dialog: title "Add a person", one `Input` labelled "Name" (required, `maxLength={120}`), "Add" button; error line; on success close + `toast.success("Added.")` + refresh.
10. Copy last week: if `data.lastWeekShiftCount === 0` -> `toast.error("Last week has no shifts to copy.")`; else if `data.thisWeekShiftCount > 0` -> `useConfirm()` with title "Replace this week's shifts?", body "This week already has shifts. Copy last week replaces them with last week's.", confirmLabel "Replace", destructive; then call; toast the returned message; refresh.
11. Below the grid, `.rv-row2` (two columns `minmax(0,1fr) 380px`):
    - `Card` "Bookings to look at this week ({n})" (label style as `CardLabel`): each item `.rv-clash`: `AlertCircle` in a warning-soft square, `<b>{item.title}</b>`, `<p>{item.reason} Move one, or add someone to the rota.</p>`, and a `Link href={"/appointments/" + id}` "Open" styled `.rv-link`. Empty: "Nothing to look at this week." When the rota is off: "The rota is off, so bookings are not checked against it."
    - `Card` "Treatments: who they need": per treatment `.rv-tr`: name and a two-button segmented control `.rv-seg` (`role="radiogroup"`, buttons `role="radio"` `aria-checked`) "Whole time" / "Sets it up". Non-admins see it disabled with a line "Only an admin can change this." Calls `setStaffing`; optimistic local state, revert + `toast.error` on failure. Under the list: "Whole time: a therapist is with the client throughout. Sets it up: one therapist can look after several at once." No treatments: "No treatments yet."
12. Footer (rota on, admins only): a ghost `Button` "Stop using the rota for bookings" -> `useConfirm()` title "Stop using the rota for bookings?", body "Bookings will no longer check who is on. Your shifts are kept.", then `setRotaOn(false)`, toast "The rota is off for bookings.", refresh.
13. All buttons: `type="button"`. All interactive controls reachable by keyboard. Icons from `lucide-react` only.

**CSS (append to `app/src/app/globals.css`):** container-query driven, tokens only. Starting point (adjust spacing to match the mockup):

```css
/* ── Staff rota (rv-): week grid on a wide container, one card per day on a narrow one. ──
   Sized by its own width (container queries), as the lead page (lv-) is. */
.rv { container-type: inline-size; container-name: rv; min-width: 0; }
.rv-week { display: flex; align-items: center; gap: 8px; }
.rv-week-label { font-family: var(--font-helvetica-now); font-weight: 600; font-size: 15px; min-width: 190px; text-align: center; white-space: nowrap; }
.rv-ib { width: 38px; height: 38px; border-radius: 10px; border: 1px solid var(--hairline-strong); display: grid; place-items: center; color: var(--text-secondary); background: var(--surface-1); }
.rv-ib:hover { color: var(--text-primary); background: var(--surface-2); }
.rv-banner { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 11px 14px; border-radius: 12px; background: var(--surface-1); border: 1px solid var(--hairline); color: var(--text-secondary); font-size: 13px; margin-bottom: 16px; }
.rv-banner.is-warn { background: var(--warning-soft); border-color: color-mix(in srgb, var(--warning) 30%, transparent); color: var(--warning); }
.rv-panel { background: var(--surface-1); border: 1px solid var(--hairline); border-radius: var(--radius-lg); min-width: 0; }
.rv-grid { display: grid; grid-template-columns: 170px repeat(7, minmax(0, 1fr)); }
.rv-hd { padding: 12px; border-bottom: 1px solid var(--hairline); font-size: 12.5px; color: var(--text-tertiary); min-width: 0; }
.rv-hd b { display: block; color: var(--text-primary); font-family: var(--font-helvetica-now); font-weight: 600; font-size: 14px; }
.rv-hd.is-closed b { color: var(--text-tertiary); }
.rv-who { padding: 14px 12px 14px 16px; border-bottom: 1px solid var(--hairline); display: flex; align-items: center; gap: 10px; min-width: 0; }
.rv-who small { display: block; color: var(--text-tertiary); font-size: 12px; }
.rv-av { width: 30px; height: 30px; flex: none; border-radius: 50%; background: var(--surface-2); border: 1px solid var(--hairline-strong); display: grid; place-items: center; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.rv-cell { padding: 10px 8px; border-bottom: 1px solid var(--hairline); border-left: 1px solid var(--hairline); display: grid; gap: 6px; align-content: start; min-height: 64px; min-width: 0; }
.rv-cell.is-closed, .rv-day.is-closed { background: repeating-linear-gradient(135deg, transparent 0 8px, var(--grid) 8px 16px); }
.rv-shift { --tone: var(--info); display: flex; align-items: center; justify-content: center; padding: 7px 8px; border-radius: 9px; font: inherit; font-size: 12.5px; font-weight: 500; white-space: nowrap; cursor: pointer; color: var(--text-primary); background: color-mix(in srgb, var(--tone) 14%, transparent); border: 1px solid color-mix(in srgb, var(--tone) 34%, transparent); min-width: 0; }
.rv-shift[data-tone="1"] { --tone: var(--accent-pemf); }
.rv-shift:hover { background: color-mix(in srgb, var(--tone) 22%, transparent); }
.rv-add { display: flex; align-items: center; justify-content: center; gap: 5px; height: 32px; border-radius: 9px; border: 1px dashed var(--hairline-strong); background: transparent; color: var(--text-tertiary); font: inherit; font-size: 12px; cursor: pointer; }
.rv-add:hover { color: var(--text-primary); border-color: var(--text-tertiary); }
.rv-foot { padding: 14px 12px 14px 16px; font-size: 12.5px; color: var(--text-secondary); }
.rv-foot b { display: block; color: var(--text-primary); font-weight: 500; }
.rv-cov { padding: 12px 8px 14px; border-left: 1px solid var(--hairline); display: grid; gap: 6px; align-content: start; min-width: 0; }
.rv-cov span { font-size: 11.5px; color: var(--text-secondary); line-height: 1.35; }
.rv-bar { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: var(--surface-3); }
.rv-bar i { display: block; height: 100%; flex-basis: 0; }
.rv-bar i[data-n="1"], .rv-swatch.is-one { background: color-mix(in srgb, var(--warning) 75%, transparent); }
.rv-bar i[data-n="2"], .rv-swatch.is-two { background: color-mix(in srgb, var(--success) 80%, transparent); }
.rv-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; background: var(--surface-3); }
.rv-legend { display: flex; gap: 8px 16px; padding: 12px 16px; border-top: 1px solid var(--hairline); font-size: 12.5px; color: var(--text-secondary); flex-wrap: wrap; }
.rv-cards { display: none; gap: 10px; }
.rv-day { border: 1px solid var(--hairline); border-radius: 12px; background: var(--surface-1); padding: 12px 14px; min-width: 0; }
.rv-day-h { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.rv-day-h b { font-family: var(--font-helvetica-now); font-weight: 600; font-size: 14px; }
.rv-day-h span { font-size: 12px; color: var(--text-tertiary); }
.rv-prow { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 0 0; margin-top: 8px; border-top: 1px solid var(--hairline); font-size: 13px; }
.rv-prow-shifts { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.rv-prow .rv-shift { padding: 4px 9px; }
.rv-prow .rv-add { height: 28px; padding: 0 10px; }
.rv-row2 { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 20px; margin-top: 20px; align-items: start; }
.rv-clash { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 10px; padding: 11px 0; border-top: 1px solid var(--hairline); align-items: start; }
.rv-clash:first-of-type { border-top: 0; }
.rv-clash-ic { width: 28px; height: 28px; border-radius: 8px; background: var(--warning-soft); color: var(--warning); display: grid; place-items: center; }
.rv-clash b { font-weight: 500; font-size: 13.5px; }
.rv-clash p { margin: 2px 0 0; color: var(--text-secondary); font-size: 13px; }
.rv-link { color: var(--text-primary); font-size: 12.5px; border: 1px solid var(--hairline-strong); border-radius: 8px; padding: 5px 10px; white-space: nowrap; }
.rv-tr { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--hairline); font-size: 13.5px; }
.rv-tr:first-of-type { border-top: 0; }
.rv-seg { display: inline-flex; flex: none; border: 1px solid var(--hairline-strong); border-radius: 9px; overflow: hidden; }
.rv-seg button { padding: 5px 10px; font: inherit; font-size: 12px; color: var(--text-tertiary); background: transparent; border: 0; white-space: nowrap; cursor: pointer; }
.rv-seg button[aria-checked="true"] { background: var(--surface-3); color: var(--text-primary); }
.rv-seg button:disabled { cursor: default; }
.rv-muted { color: var(--text-tertiary); font-size: 13px; }
.rv-end { margin-top: 20px; display: flex; justify-content: flex-end; }
/* Tablet: the grid no longer fits, cards two to a row; the side cards stack. */
@container rv (max-width: 900px) {
  .rv-grid, .rv-legend { display: none; }
  .rv-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rv-panel { background: transparent; border: 0; }
  .rv-row2 { grid-template-columns: minmax(0, 1fr); }
}
/* Phone: one card per day. */
@container rv (max-width: 560px) {
  .rv-cards { grid-template-columns: minmax(0, 1fr); }
  .rv-clash { grid-template-columns: 28px minmax(0, 1fr); }
  .rv-clash .rv-link { grid-column: 2; justify-self: start; }
  .rv-tr { flex-wrap: wrap; }
  .rv-week-label { min-width: 0; }
}
```

The `.rv` wrapper is the outermost element `RotaView` renders. The header actions wrap on a phone (`.page-head-actions` already has `flex-wrap: wrap`); check the week nav does not force overflow at 390px.

- [ ] **Step 1: Read** the mockup, `app/src/components/appointments/booking/WhenCard.tsx` (Card/CardLabel usage), `app/src/components/settings/TherapyEditor.tsx` (Dialog, toast and server-action patterns), `app/src/components/ui/Dialog.tsx`, `app/src/components/ui/Input.tsx` and `app/src/components/ui/EmptyState.tsx`.
- [ ] **Step 2: Write `actions.ts`** as specified in 2.
- [ ] **Step 3: Write `ShiftDialog.tsx`, `AddPersonDialog.tsx`, `RotaView.tsx`** as specified in 3-13. Keep `RotaView` under ~400 lines: put the grid, the cards and the two side cards in small components inside the file or split out `RotaGrid.tsx` / `RotaCards.tsx` if it grows past that. One open-dialog state in `RotaView`: `{ kind: "shift"; personId; personName; date; shift?: ShiftRow; open; close } | { kind: "person" } | null`.
- [ ] **Step 4: Write `page.tsx`** as specified in 1, and add to `app/src/app/appointments/page.tsx` header actions, before the "Diary" link:

```tsx
            <Link href={`/appointments/rota?week=${isoStart}`}>
              <Button variant="ghost">
                <UsersRound size={15} /> Rota
              </Button>
            </Link>
```

  (import `UsersRound` from `lucide-react`).
- [ ] **Step 5: Append the CSS.**
- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npx next lint --dir src/app/appointments --dir src/components/appointments`
Expected: no errors in the new files.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/appointments/rota/page.tsx app/src/app/appointments/rota/actions.ts app/src/components/appointments/rota/RotaView.tsx app/src/components/appointments/rota/ShiftDialog.tsx app/src/components/appointments/rota/AddPersonDialog.tsx app/src/app/globals.css app/src/app/appointments/page.tsx
# plus RotaGrid.tsx / RotaCards.tsx if you split them out
git commit -m "feat(rota): the rota page (week grid, phone cards, look-at list, treatment staffing)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Reminders and the therapy editor

**Files:**
- Create: `app/src/components/appointments/rota/RotaUnfilledBanner.tsx`
- Modify: `app/src/app/appointments/page.tsx`
- Modify: `app/src/components/appointments/booking/useFreeSlots.ts`, `app/src/components/appointments/booking/WhenCard.tsx`
- Modify: `app/src/components/settings/TherapyEditor.tsx`, `app/src/app/settings/therapies/actions.ts`

**Interfaces:**
- Consumes: Task 4 `weekUnfilled`; Task 5 route field `rota: { unfilled: boolean; week: string }`.
- Produces: `export function RotaUnfilledBanner({ week }: { week: string }): JSX.Element` (no `"use client"`; works in both server and client trees).

- [ ] **Step 1: Banner component:**

```tsx
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/** Shown on the diary and the booking screen while the rota is on and the week has no shifts. */
export function RotaUnfilledBanner({ week }: { week: string }) {
  return (
    <div className="rv-banner is-warn" role="status">
      <AlertTriangle size={15} aria-hidden />
      <span>This week&apos;s rota is not filled in, so bookings assume one person on.</span>
      <Link href={`/appointments/rota?week=${week}`} className="rv-banner-link">
        Fill in the rota
      </Link>
    </div>
  );
}
```

  Add to globals.css (in the `.rv` block): `.rv-banner-link { color: inherit; font-weight: 500; text-decoration: underline; text-underline-offset: 3px; }`.
- [ ] **Step 2: Diary.** In `app/src/app/appointments/page.tsx`, above the week-nav row: `{weekUnfilled(isoStart) && <RotaUnfilledBanner week={isoStart} />}` (import `weekUnfilled` from `@/lib/scheduling/rotaRepo`).
- [ ] **Step 3: Booking screen.** In `useFreeSlots.ts` add `rota?: { unfilled: boolean; week: string }` to `FreeSlotsDay`. In `WhenCard.tsx`, right under the day strip: `{day?.rota?.unfilled && <RotaUnfilledBanner week={day.rota.week} />}`. The refused-time reason already shows via `slot.reason` / the `picked` warning; nothing else to change there.
- [ ] **Step 4: Therapy editor.** In `app/src/app/settings/therapies/actions.ts` add `staffing: z.enum(["whole", "setup"]).optional()` to `therapySchema`, read it in `readForm` (`String(formData.get("staffing") ?? "") || undefined`), and set it in create and update only when present (`...(parsed.staffing ? { staffing: parsed.staffing } : {})`); also `revalidatePath("/appointments/rota")` in update. In `TherapyEditor.tsx` add `staffing: "whole" | "setup"` to `TherapyValues` (default `therapy?.staffing ?? "whole"`), put it into `toFormData`, and add a field after the duration/price fields: a `Label` "Who it needs" and a native `<select>` (the app's global select styling applies) with options `whole` "Whole time: a therapist is with the client throughout" and `setup` "Sets it up: one therapist can look after several". Read the file first and follow its exact field markup.
- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test -- src/lib/scheduling/staffRule.test.ts`
Expected: pass. If a test covers the therapies actions or TherapyEditor (`grep -rl "therapySchema\|TherapyEditor" app/src --include=*.test.ts`), run it too.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/appointments/rota/RotaUnfilledBanner.tsx app/src/app/appointments/page.tsx app/src/components/appointments/booking/useFreeSlots.ts app/src/components/appointments/booking/WhenCard.tsx app/src/components/settings/TherapyEditor.tsx app/src/app/settings/therapies/actions.ts app/src/app/globals.css
git commit -m "feat(rota): unfilled-rota reminders and staffing in the therapy editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Browser check (throwaway route, removed before finishing)

**Files:**
- Create then DELETE: `app/src/app/f/zz-rota/page.tsx`, `app/src/app/f/zz-rota/Harness.tsx`
- Script (scratchpad, not committed): `/private/tmp/claude-502/-Users-truep-Desktop-Clients-Renova/76afd0d7-75fd-4576-a2e5-b6a47b0676a5/scratchpad/rota-shots/check.mjs`

**Interfaces:**
- Consumes: Task 2 `buildRotaWeek`, `validateShift`, `addDaysIso`; Task 6 `RotaView`, `RotaActions`.

Steps:

- [ ] **Step 1:** `Harness.tsx` ("use client"): holds in-memory people, shifts, appointments, treatments and `rotaOn` in state, seeded for the week of `2026-11-30` with "Example Therapist" (Mon-Wed 09:00-17:00, Thu 11:00-19:00) and "Second Therapist" (Mon 13:00-19:00, Thu 09:00-13:00, Fri 09:00-17:00), last week a copy, opening hours as the mockup (Mon/Tue/Thu 09:00-19:00, Wed/Fri 09:00-17:00, Sat 09:00-14:00, Sun closed), treatments (Deep tissue massage whole, HBOT setup, Infrared setup, HIFEM setup) and two appointments that break the rule (Tue 1 Dec 14:00 massage + HBOT at 14:00; Sat 5 Dec 11:00 Infrared). Implements every `RotaActions` member against that state using `validateShift`, and renders `<ConfirmProvider><RotaView data={buildRotaWeek(...)} isAdmin actions={fakes} weekHref={(m) => "/f/zz-rota?week=" + m} /></ConfirmProvider>`. `page.tsx` (server) renders `<Harness />` inside, for the 1440 case, an optional fake sidebar: `?sidebar=1` wraps it in a flex row with a 260px `aside` (`background: var(--surface-1)`). Make sure the root layout's theme can be forced: check how `ui-theme` is applied (cookie `ui-theme` or `data-theme` on `<html>`) and set it from the script.
- [ ] **Step 2:** Start the dev server from `app/` (`npm run dev`, background) and wait for it.
- [ ] **Step 3:** Script with `playwright-core` (`app/node_modules/playwright-core`), `executablePath: "/Users/truep/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"`. For widths 1440 (with `?sidebar=1`), 1180, 820, 390 and themes dark and light: load `/f/zz-rota`, measure `document.documentElement.scrollWidth - innerWidth` (must be 0), check the grid is visible at 1440/1180 and the cards at 820/390, and save full-page screenshots as `rota-<width>-<theme>.png` in `/private/tmp/claude-502/-Users-truep-Desktop-Clients-Renova/76afd0d7-75fd-4576-a2e5-b6a47b0676a5/scratchpad/rota-shots/`. At 1440 dark also: click a shift, change the end time, save, check the label changed; click "Copy last week", confirm, check a toast; check the look-at list shows 2 items; screenshot the open dialog (`rota-dialog.png`).
- [ ] **Step 4:** Fix any overflow or layout problem in the real components/CSS (never only in the harness), re-run until clean. Commit those fixes by path.
- [ ] **Step 5:** Stop the dev server, `rm -rf app/src/app/f/zz-rota`, confirm `git status` shows no trace of it.

---

## Final verification

- [ ] `npm run typecheck`
- [ ] `npm test` (whole suite)
- [ ] `npx next build` (if stale `.next/types` mention `zz-rota`, `rm -rf .next` and build again)
- [ ] `grep -rnP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" app/src/lib/scheduling app/src/components/appointments/rota app/src/app/appointments/rota` returns nothing.
