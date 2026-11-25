# New Booking Screen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild /appointments/new as the approved mockup: a form on the left (Client, Treatment, When, Payment) and a live Booking summary with the Book button on the right, posting the same body to POST /api/appointments as today.

**Architecture:** All rules live in small pure modules under `app/src/lib/booking/` (formatting, client search, treatment grouping and 30/60 collapsing, slot candidates and the day strip, package choice, voucher coverage, summary money, the POST body), each with a plain node:assert test. One new staff-only route, `GET /api/appointments/free-slots`, generates candidate starts and marks each with the existing `checkBookingSlot`. The UI is split into focused client components under `app/src/components/appointments/booking/` sharing one CSS module built only from the app's tokens; `NewBooking.tsx` holds the state and replaces the 1085-line `BookingForm.tsx`, which is deleted.

**Tech Stack:** Next.js 15 App Router, React client components, a CSS module (`booking.module.css`), drizzle + better-sqlite3 (server side only), lucide-react not needed (no glyphs), plain `node:assert` tests run through `npm test -- <path>` (tsx).

Design: `docs/superpowers/specs/2026-11-25-new-booking-redesign-design.md`. Mockup: `.superpowers/brainstorm/18469-1795619055/content/new-booking.html` in the main checkout (/Users/truep/Desktop/Clients/Renova).

## Global Constraints

- No emojis anywhere: UI, code, comments, copy, commit messages, docs. Use a `lucide-react` icon only if a glyph is genuinely needed.
- Plain copy: short factual sentences. No "X rather than Y", no "not just X", no filler.
- Controls never cramped: 12px+ side padding on every button/chip/field, 36px chevron padding on selects (globals.css already does selects).
- Dark and light from the app tokens in `app/src/app/globals.css` / `app/src/lib/theme.ts` (`--surface-*`, `--hairline*`, `--text-*`, `--accent*`, `--success*`, `--warning*`, `--danger*`). No hardcoded palette (the only literal colour allowed is `#000` inside the light-mode `color-mix` that darkens the success ink).
- `prefers-reduced-motion` respected. Works at 390px wide.
- No new packages.
- Keep the POST /api/appointments contract working for every existing path: existing client / walk-in, query-param defaults (client, date, time, voucher, therapy), voucher lookup and split payments, package use (owner, use-by date vs booking date, sessions left incl. booked ones; value = package price per session), new-package sign-up at booking, notes, the slot check and its error message. `app/src/app/api/appointments/route.ts` is NOT modified.
- Free slots: candidate starts every 15 minutes inside `dayWindow(date)`, each marked free or taken by `checkBookingSlot`; the response also carries the day's open/close and whether it is closed.
- No real personal data in code, tests or docs (use "Test Client", "0800 000 000", example.com).
- Tests are plain `node:assert/strict` scripts: `cd app && npm test -- <path>`. Route tests use the scratch-tenant pattern of `app/src/app/api/whatsapp/webhook/route.test.ts`.
- Commits: `git add <explicit paths>` only (never `git add -A` or `git add .`); message ends with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push, deploy or run `railway`.
- Stay inside the booking screen, its API and new files. Do not touch the lead page, board cards, automations or settings.

## Decisions made while planning (read before Task 1)

1. **Slot length is a fixed 15-minute grid** (`BOOKING_STEP_MINUTES`). The spec names a `slot_length_minutes` setting, but that setting was removed on 2026-09-09 as dead (commit e27e6550: nothing read it). Reading it again would resurrect a hidden knob with no UI, so the grid is a constant with the spec's default.
2. **Single-treatment selection, as today.** The spec says multi-treatment bookings via `multi_therapy_concurrent` keep working, but that setting was also removed on 2026-09-09 (it was consumed by nothing) and the current BookingForm only ever sends one `therapyIds` value. The payload, the POST and the free-slots route all still take a list, so multi-select can be added later without a contract change.
3. **A prepaid package does not pick the treatment by itself.** The banner's "Use it" does (treatment, length and payment). Once a treatment is picked, a fitting package still becomes the payment by default until staff choose a method, exactly as BookingForm does today.
4. **The When card starts with no time picked** (BookingForm defaulted to 09:00). Book stays disabled until a time is set; `?time=` still pre-selects one.
5. **The day strip** is 14 days from today (Europe/Dublin), or from `?date=` when that date falls outside those 14 days. "Other date" opens a date field for any other day.
6. **Past times today are offered** like any other (the server does not refuse them, and staff record sessions that already happened).
7. **Pronouns:** the summary line says "Already paid. Uses 1 prepaid session from {package name}." (we hold no gender for "her").
8. **The Book buttons are `type="button"`** and the screen is not a `<form>`, so Enter in a search field never submits a booking.

## File Structure

Create (pure, tested, client-safe: no `server-only`, no DB):
- `app/src/lib/booking/format.ts` (+ `.test.ts`): euro, clock and date strings.
- `app/src/lib/booking/clientSearch.ts` (+ `.test.ts`): client search, name split, initials, subline.
- `app/src/lib/booking/treatmentGroups.ts` (+ `.test.ts`): Recovery/Massage/Specialist/Other grouping, 30/60 collapsing, tile text.
- `app/src/lib/booking/slotModel.ts` (+ `.test.ts`): candidate starts, block-outs covering a day, the day strip, Morning/Afternoon/Evening.
- `app/src/lib/booking/packageChoiceModel.ts` (+ `.test.ts`): which package pays, prepaid banners.
- `app/src/lib/booking/voucherModel.ts` (+ `.test.ts`): voucher lookup mapping and what it covers.
- `app/src/lib/booking/summaryModel.ts` (+ `.test.ts`): the summary panel's value, labels and note.
- `app/src/lib/booking/bookingPayload.ts` (+ `.test.ts`): the POST body, readiness and validation messages.

Create (server):
- `app/src/app/api/appointments/free-slots/route.ts` (+ `route.test.ts`).
- `app/src/app/api/appointments/route.test.ts`: contract test of the unchanged POST against `bookingPayload`.

Create (UI, `app/src/components/appointments/booking/`):
- `booking.module.css`: every style of the screen.
- `ClientCard.tsx`, `PrepaidBanner.tsx`: card 1.
- `TreatmentCard.tsx`: card 2.
- `useFreeSlots.ts`, `WhenCard.tsx`: card 3.
- `useVoucherLookup.ts`, `VoucherPanel.tsx`, `NewPackagePanel.tsx`, `PaymentCard.tsx`: card 4.
- `BookingSummary.tsx`: the side panel and the narrow-screen bar.
- `NewBooking.tsx`: state, effects, submit; composes the cards.

Modify:
- `app/src/app/appointments/new/page.tsx`: render `NewBooking`, compute the strip, widen to 1240px.

Delete:
- `app/src/components/appointments/BookingForm.tsx` (its only importer is the page above).

## Every BookingForm behaviour, and where it goes

| # | Behaviour in BookingForm.tsx today | Kept in | Task |
|---|---|---|---|
| B1 | Props: therapies, clients, packageTemplates, defaultClientId, defaultDate, defaultStartTime, defaultVoucherCode, defaultTherapyId, defaultWalkInName | `NewBooking` props (plus `strip`) | 10 |
| B2 | Voucher recipient's name split into walk-in first / last name | `splitName` + `NewBooking` initial state | 1, 10 |
| B3 | Starts in walk-in mode when a walk-in name is given and no client id | `NewBooking` initial `clientMode` | 10 |
| B4 | Existing / Walk-in toggle | `ClientCard` header chips | 6 |
| B5 | Client search on first+last+email+phone, case-insensitive, 10 results, empty query lists the first 10 | `searchClients` + `ClientCard` | 1, 6 |
| B6 | "No matches." | `ClientCard` | 6 |
| B7 | Selected client shows name and phone; Change clears | `ClientCard` (avatar, name, phone + "Client since") | 6 |
| B8 | Walk-in fields: helper line, first name required, last name, email (type=email, optional), phone (optional) | `ClientCard` | 6 |
| B9 | Picking a treatment fills length and price from its defaults; no treatment resets both to 0 | `NewBooking` effect on `therapy` | 10 |
| B10 | Controlled date (default `?date=` or today), start time default `?time=` | `NewBooking` + `WhenCard` (date strip, time buttons, Other date, Other time) | 8, 10 |
| B11 | Usable packages for client + treatment + date (`/api/packages?...&date=`), available > 0; picked package kept while usable, else the first | one fetch `/api/packages?clientId&date` + `packagesFor` / `reconcilePackageChoice` | 3, 10 |
| B12 | A usable package becomes the payment by default until staff choose a method (`methodChosen` ref; already chosen when arriving with a voucher) | `reconcilePackageChoice(..., methodChosen)` | 3, 10 |
| B13 | Paying by package prices the session at `perSessionValue(pkg)`; switching away restores the list price | `NewBooking` `sendPrice` (derived) + `summaryMoney` | 3, 10 |
| B14 | Prepaid sessions for a different treatment: hint with "Use {package}" buttons that switch the treatment | Green banners on the Client card for every usable package, "Use it" switches treatment and payment | 3, 6, 10 |
| B15 | "This client has N prepaid sessions for this treatment..." line | Banner count + PREPAID tile tag + Prepaid package chip | 6, 7, 9 |
| B16 | Payment chips cash/card/package/voucher/bank transfer; a click marks the method chosen | `PaymentCard` chips + `pickMethod` | 9, 10 |
| B17 | Default method: voucher when arriving with a voucher code, else cash | `NewBooking` initial `choice` | 10 |
| B18 | Package mode: use existing / sign up for new | "Prepaid package" chip (existing) and "Sign up for a new package" link (new) | 9 |
| B19 | Existing packages list (name, treatment, used/total, expiry) to pick from; empty state | "Which package pays" list when more than one fits; the chip only shows when one fits | 9 |
| B20 | New package: needs a treatment first; templates for that treatment (name, price, sessions, validity); Custom; name/sessions/price/expiry; paid by card/cash/bank transfer; "The session is covered by the package (EUR 0)..." | `NewPackagePanel` | 9 |
| B21 | Voucher code lookup, 250ms debounce, states invalid / used / cancelled / valid (kind, balance, treatment, recipient, expiry, expired) | `useVoucherLookup` + `voucherInfoFrom` | 3, 9 |
| B22 | Voucher messages (treatment / money voucher, recipient, expired warning, wrong treatment, no price, what it pays, balance left, used, cancelled, not found) | `VoucherPanel`, colours from tokens | 9 |
| B23 | Voucher coverage maths and the no-price refusal | `voucherCoverage` | 3 |
| B24 | Split payment panel and second method (default card), sent only when the voucher pays less | `VoucherPanel` + `secondaryPaymentMethod` in the draft | 4, 9, 10 |
| B25 | Notes | "Add a note" link + textarea | 9 |
| B26 | status=scheduled | `bookingEntries` | 4 |
| B27 | Validation toasts: pick a treatment, pick a client, walk-in first name, new package details | `bookingProblem` (+ "Pick a start time.") | 4 |
| B28 | The FormData fields and when each is sent | `bookingEntries` / `bookingFormData`, contract-tested against the real POST | 4 |
| B29 | POST, error toast with the server's message (slot check) or "Could not book ...", success toast, go to /appointments/{id}, refresh | `NewBooking.book()` | 10 |
| B30 | Book button loading state | `Button loading` in `BookingSummary` / `BookingBar` | 10 |
| B31 | Editable duration and price | "Adjust price or length" fields (price read-only while a package pays, since the server sets it) | 9 |
| B32 | Venue vocabulary (member, service, plan, booking, bookCta) | every card via `useVocab` | 6-10 |
| B33 | Treatment tiles with "N min · EUR P" | Grouped tiles, collapsed lengths, "from EUR 50", Length switch | 1, 7 |
| B34 | Page: voucher redemption header + voucher details card | `page.tsx` unchanged apart from the swap | 10 |
| B35 | Page: query params client/date/time/voucher/therapy; voucher applies only with balance left; walk-in name from the voucher recipient | `page.tsx` unchanged apart from the swap | 10 |

New in the redesign: free-slots route (Task 5), day strip and time buttons (Tasks 2, 8), summary panel and narrow-screen bar (Tasks 3, 10), grouping and length collapsing (Tasks 1, 7), prepaid banners with Use it (Tasks 3, 6).

---

### Task 1: Formatting, client search and treatment grouping (pure)

**Files:**
- Create: `app/src/lib/booking/format.ts`, `app/src/lib/booking/format.test.ts`
- Create: `app/src/lib/booking/clientSearch.ts`, `app/src/lib/booking/clientSearch.test.ts`
- Create: `app/src/lib/booking/treatmentGroups.ts`, `app/src/lib/booking/treatmentGroups.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `format.ts`: `weekdayIndex(dateIso): number`, `weekdayShort(dateIso): string`, `weekdayLong(dateIso): string`, `shortDate(dateIso): string` ("Thu 26 Nov"), `fullDate(dateIso): string` ("1 Mar 2027"), `euro(amount): string` ("€80", "€64.50"), `addMinutes(hm, mins): string`, `chipTime(hm): string` ("9:00"), `clock12(hm): string` ("9am").
  - `clientSearch.ts`: `interface ClientLike`, `searchClients<T>(clients, query, limit = 10): T[]`, `splitName(full?): [string, string]`, `initials(first, last): string`, `displayName(first, last): string`, `clientSubline(phone, createdAt, memberWord): string`.
  - `treatmentGroups.ts`: `interface TreatmentLike {id; name; defaultDurationMinutes; defaultPriceEur}`, `interface TreatmentFamily<T> {key; name; label; options: T[]; primary: T}`, `GROUP_ORDER`, `type GroupName`, `interface TreatmentGroup<T> {name: GroupName; families}`, `baseName`, `groupFor`, `tileLabel`, `groupTreatments<T>(treatments): TreatmentGroup<T>[]`, `familyOf(groups, therapyId | null)`, `filterGroups(groups, query)`, `pickOption(family, prepaidTherapyIds: ReadonlySet<number>): T`, `priceHint(family): string`, `lengthLabel(option): string`.

- [ ] **Step 1: Write the failing tests**

`app/src/lib/booking/format.test.ts`:

```ts
// Run: npm test -- src/lib/booking/format.test.ts
import assert from "node:assert/strict";

import { addMinutes, chipTime, clock12, euro, fullDate, shortDate, weekdayIndex, weekdayLong, weekdayShort } from "./format";

assert.equal(weekdayIndex("2026-11-26"), 4, "26 Nov 2026 is a Thursday");
assert.equal(weekdayIndex("2026-11-29"), 0, "29 Nov 2026 is a Sunday");
assert.equal(weekdayShort("2026-11-25"), "Wed");
assert.equal(weekdayLong("2026-11-26"), "Thursday");
assert.equal(shortDate("2026-11-26"), "Thu 26 Nov");
assert.equal(shortDate("2026-12-01"), "Tue 1 Dec");
assert.equal(fullDate("2027-03-01"), "1 Mar 2027");

assert.equal(euro(80), "€80");
assert.equal(euro(64), "€64");
assert.equal(euro(64.5), "€64.50");
assert.equal(euro(26.666666), "€26.67");
assert.equal(euro(0), "€0");
assert.equal(euro(Number.NaN), "€0", "a missing price reads as zero, never NaN");

assert.equal(addMinutes("12:45", 60), "13:45");
assert.equal(addMinutes("09:00", 15), "09:15");
assert.equal(addMinutes("23:30", 45), "00:15", "wraps past midnight");

assert.equal(chipTime("09:00"), "9:00");
assert.equal(chipTime("12:45"), "12:45");
assert.equal(chipTime("00:15"), "0:15");

assert.equal(clock12("09:00"), "9am");
assert.equal(clock12("19:00"), "7pm");
assert.equal(clock12("19:30"), "7:30pm");
assert.equal(clock12("12:00"), "12pm");
assert.equal(clock12("00:00"), "12am");

console.log("booking format: all checks passed.");
```

`app/src/lib/booking/clientSearch.test.ts`:

```ts
// Run: npm test -- src/lib/booking/clientSearch.test.ts
import assert from "node:assert/strict";

import { clientSubline, displayName, initials, searchClients, splitName } from "./clientSearch";

const people = Array.from({ length: 14 }, (_, i) => ({
  id: i + 1,
  firstName: `Test${i + 1}`,
  lastName: "Person",
  email: i === 3 ? "four@example.com" : null,
  phone: `0800 000 ${String(i + 1).padStart(3, "0")}`,
}));

assert.equal(searchClients(people, "").length, 10, "an empty search lists the first ten");
assert.equal(searchClients(people, "   ").length, 10, "a blank search is an empty search");
assert.deepEqual(searchClients(people, "test1").map((c) => c.id), [1, 10, 11, 12, 13, 14], "name match, case-insensitive");
assert.deepEqual(searchClients(people, "FOUR@").map((c) => c.id), [4], "email match");
assert.deepEqual(searchClients(people, "000 007").map((c) => c.id), [7], "phone match");
assert.deepEqual(searchClients(people, "nobody"), [], "no matches");
assert.equal(searchClients(people, "person", 3).length, 3, "limit applies");

assert.deepEqual(splitName("Mary Anne Smith"), ["Mary", "Anne Smith"]);
assert.deepEqual(splitName("  Mary  "), ["Mary", ""]);
assert.deepEqual(splitName(undefined), ["", ""]);
assert.deepEqual(splitName(""), ["", ""]);

assert.equal(initials("Mary", "Smith"), "MS");
assert.equal(initials("mary", "—"), "M", "a walk-in's placeholder last name is not an initial");
assert.equal(initials("", ""), "?");

assert.equal(displayName("Mary", "Smith"), "Mary Smith");
assert.equal(displayName("Mary", "—"), "Mary");

assert.equal(clientSubline("0800 000 001", new Date("2026-11-24T10:00:00Z"), "Client"), "0800 000 001 · Client since 24 Nov 2026");
assert.equal(clientSubline("—", new Date("2026-11-24T10:00:00Z"), "Member"), "Member since 24 Nov 2026", "no placeholder phone");
assert.equal(clientSubline("0800 000 001", null, "Client"), "0800 000 001");
assert.equal(clientSubline("0800 000 001", "not a date", "Client"), "0800 000 001");

console.log("booking clientSearch: all checks passed.");
```

`app/src/lib/booking/treatmentGroups.test.ts`:

```ts
// Run: npm test -- src/lib/booking/treatmentGroups.test.ts
import assert from "node:assert/strict";

import {
  baseName,
  familyOf,
  filterGroups,
  groupFor,
  groupTreatments,
  lengthLabel,
  pickOption,
  priceHint,
  tileLabel,
} from "./treatmentGroups";

const t = (id: number, name: string, mins: number, price: number) => ({
  id,
  name,
  defaultDurationMinutes: mins,
  defaultPriceEur: price,
});

// A clinic list shaped like the one this was designed from.
const LIST = [
  t(1, "HBOT", 60, 95),
  t(2, "Infrared Therapy", 15, 65),
  t(3, "PEMF Therapy", 30, 65),
  t(16, "Cupping massage", 60, 80),
  t(17, "Deep tissue massage", 60, 80),
  t(18, "Deep tissue massage (30 min)", 30, 50),
  t(19, "Hot lava shells", 60, 100),
  t(20, "Indian head massage", 40, 60),
  t(21, "Lymphatic drainage", 60, 80),
  t(22, "Oncology cancer care massage", 60, 80),
  t(23, "Pamper yourself", 90, 120),
  t(24, "Reflexology", 60, 80),
  t(25, "Sculpting lifting facial", 60, 80),
  t(29, "Swedish massage (30 min)", 30, 50),
  t(28, "Swedish massage", 60, 80),
  t(30, "Gift wrapping", 5, 2),
];

// ------------------------------------------------------------ names + groups
assert.equal(baseName("Swedish massage (30 min)"), "Swedish massage");
assert.equal(baseName("Swedish massage (30 mins)"), "Swedish massage");
assert.equal(baseName("Swedish massage ( 45 minutes )"), "Swedish massage");
assert.equal(baseName("HBOT"), "HBOT");
assert.equal(baseName("Session (couples)"), "Session (couples)", "only a length suffix is removed");

assert.equal(groupFor("HBOT"), "Recovery");
assert.equal(groupFor("Infrared Therapy"), "Recovery");
assert.equal(groupFor("HIFEM Therapy"), "Recovery");
assert.equal(groupFor("Indian head massage"), "Specialist", "specialist wins over the word massage");
assert.equal(groupFor("Oncology cancer care massage"), "Specialist");
assert.equal(groupFor("Swedish massage"), "Massage");
assert.equal(groupFor("Hot lava shells"), "Massage");
assert.equal(groupFor("Yoga class"), "Other");

assert.equal(tileLabel("Swedish massage", "Massage"), "Swedish");
assert.equal(tileLabel("Massage", "Massage"), "Massage", "a bare 'Massage' keeps its name");
assert.equal(tileLabel("Oncology cancer care massage", "Specialist"), "Oncology cancer care massage", "only the Massage group shortens");

// ------------------------------------------------------------- grouping
const groups = groupTreatments(LIST);
assert.deepEqual(groups.map((g) => g.name), ["Recovery", "Massage", "Specialist", "Other"]);
assert.deepEqual(groups[0].families.map((f) => f.label), ["HBOT", "Infrared Therapy", "PEMF Therapy"]);
assert.deepEqual(groups[1].families.map((f) => f.label), ["Cupping", "Deep tissue", "Hot lava shells", "Pamper yourself", "Swedish"]);
assert.deepEqual(groups[2].families.map((f) => f.label), [
  "Indian head massage",
  "Lymphatic drainage",
  "Oncology cancer care massage",
  "Reflexology",
  "Sculpting lifting facial",
]);
assert.deepEqual(groups[3].families.map((f) => f.label), ["Gift wrapping"]);

// ------------------------------------------------------------- collapsing
const swedish = groups[1].families.find((f) => f.key === "swedish massage")!;
assert.deepEqual(swedish.options.map((o) => o.id), [29, 28], "lengths shortest first, whatever order they arrived in");
assert.equal(swedish.primary.id, 28, "the unsuffixed treatment is the default length");
assert.equal(swedish.name, "Swedish massage");
assert.equal(priceHint(swedish), "from €50");
assert.equal(lengthLabel(swedish.options[0]), "30 min · €50");
assert.equal(lengthLabel(swedish.options[1]), "60 min · €80");

const hbot = groups[0].families[0];
assert.equal(hbot.options.length, 1);
assert.equal(priceHint(hbot), "60 min · €95");

// Only suffixed rows: the shortest is the default.
const onlySuffixed = groupTreatments([t(5, "Facial (60 min)", 60, 90), t(6, "Facial (30 min)", 30, 55)]);
assert.equal(onlySuffixed[0].families[0].primary.id, 6);
assert.equal(onlySuffixed[0].families[0].name, "Facial");

// A business none of the patterns know: everything in Other, nothing lost.
const gym = groupTreatments([t(1, "Spin", 45, 12), t(2, "Pilates", 50, 15)]);
assert.deepEqual(gym.map((g) => g.name), ["Other"]);
assert.equal(gym[0].families.length, 2);

assert.deepEqual(groupTreatments([]), []);

// ------------------------------------------------------------- lookups
assert.equal(familyOf(groups, 29)?.key, "swedish massage", "a 30-minute id finds its family");
assert.equal(familyOf(groups, 999), null);
assert.equal(familyOf(groups, null), null);

assert.deepEqual(filterGroups(groups, "swed").map((g) => g.families.map((f) => f.key)), [["swedish massage"]]);
assert.deepEqual(filterGroups(groups, "30 MIN").flatMap((g) => g.families.map((f) => f.key)), ["deep tissue massage", "swedish massage"], "an option name matches");
assert.deepEqual(filterGroups(groups, "zzz"), []);
assert.equal(filterGroups(groups, "  "), groups, "a blank search changes nothing");

const deep = familyOf(groups, 17)!;
assert.equal(pickOption(deep, new Set()).id, 17, "no package: the default length");
assert.equal(pickOption(deep, new Set([18])).id, 18, "a prepaid 30-minute session picks the 30-minute length");

console.log("booking treatmentGroups: all checks passed.");
```

- [ ] **Step 2: Run them to see them fail**

Run (from `app/`): `npm test -- src/lib/booking/format.test.ts` (and the other two)
Expected: FAIL, "Cannot find module './format'" (and './clientSearch', './treatmentGroups').

- [ ] **Step 3: Implement**

`app/src/lib/booking/format.ts`:

```ts
/**
 * Pure formatting for the booking screen: money, clock times and dates.
 * Dates are ISO calendar dates (YYYY-MM-DD), read in UTC so the server and a
 * browser in Dublin always name the same weekday for the same date.
 */

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function ymd(dateIso: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateIso.split("-").map(Number);
  return { y, m, d };
}

/** 0 = Sunday .. 6 = Saturday. */
export function weekdayIndex(dateIso: string): number {
  const { y, m, d } = ymd(dateIso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "Thu" */
export function weekdayShort(dateIso: string): string {
  return WEEKDAY_SHORT[weekdayIndex(dateIso)];
}

/** "Thursday" */
export function weekdayLong(dateIso: string): string {
  return WEEKDAY_LONG[weekdayIndex(dateIso)];
}

/** "Thu 26 Nov" */
export function shortDate(dateIso: string): string {
  const { m, d } = ymd(dateIso);
  return `${weekdayShort(dateIso)} ${d} ${MONTH_SHORT[m - 1]}`;
}

/** "1 Mar 2027" */
export function fullDate(dateIso: string): string {
  const { y, m, d } = ymd(dateIso);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}

/** "€80", "€64.50". Whole euros drop the cents. */
export function euro(amount: number): string {
  const cents = Math.round((Number.isFinite(amount) ? amount : 0) * 100);
  return cents % 100 === 0 ? `€${cents / 100}` : `€${(cents / 100).toFixed(2)}`;
}

/** "12:45" plus 60 minutes is "13:45". Wraps past midnight. */
export function addMinutes(hm: string, mins: number): string {
  const [h, m] = hm.split(":").map(Number);
  const total = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** "09:00" -> "9:00" (the time buttons). */
export function chipTime(hm: string): string {
  return hm.replace(/^0(\d)/, "$1");
}

/** "09:00" -> "9am", "19:30" -> "7:30pm", "12:00" -> "12pm", "00:00" -> "12am". */
export function clock12(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}
```

`app/src/lib/booking/clientSearch.ts`:

```ts
/**
 * Pure: finding the client at the desk, and the bits of their name the
 * booking screen shows. No DB, no React.
 */

import { fullDate } from "./format";

export interface ClientLike {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
}

/** Up to `limit` clients whose name, email or phone contains the query. An empty query lists the first `limit`. */
export function searchClients<T extends ClientLike>(clients: T[], query: string, limit = 10): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return clients.slice(0, limit);
  return clients
    .filter((c) => `${c.firstName} ${c.lastName} ${c.email ?? ""} ${c.phone}`.toLowerCase().includes(q))
    .slice(0, limit);
}

/** "Mary Anne Smith" -> ["Mary", "Anne Smith"]: a voucher recipient's name as walk-in first/last name. */
export function splitName(full?: string | null): [string, string] {
  if (!full || !full.trim()) return ["", ""];
  const parts = full.trim().split(/\s+/);
  return [parts[0], parts.slice(1).join(" ")];
}

/** Walk-ins are stored with "—" for a missing last name or phone. */
function real(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v === "—" ? "" : v;
}

/** "AM" for the avatar. "?" when there is no name at all. */
export function initials(firstName: string, lastName: string): string {
  const a = real(firstName)[0] ?? "";
  const b = real(lastName)[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

/** "Mary Smith" (no trailing dash for a walk-in with no last name). */
export function displayName(firstName: string, lastName: string): string {
  return [real(firstName), real(lastName)].filter(Boolean).join(" ");
}

/** "083 000 0000 · Client since 24 Nov 2026". Leaves out a missing phone. */
export function clientSubline(
  phone: string,
  createdAt: Date | string | number | null | undefined,
  memberWord: string,
): string {
  const bits: string[] = [];
  if (real(phone)) bits.push(real(phone));
  if (createdAt != null && createdAt !== "") {
    const d = new Date(createdAt);
    if (!Number.isNaN(d.getTime())) bits.push(`${memberWord} since ${fullDate(d.toISOString().slice(0, 10))}`);
  }
  return bits.join(" · ");
}
```

`app/src/lib/booking/treatmentGroups.ts`:

```ts
/**
 * Pure: how the booking screen lays out the treatment list.
 *
 * Two jobs. GROUPING by name into Recovery / Massage / Specialist, with an
 * Other group for anything the patterns do not know, so another business's
 * list still shows (it just lands in Other). COLLAPSING the treatments whose
 * names differ only by a "(30 min)" style suffix ("Swedish massage" and
 * "Swedish massage (30 min)") into one tile with a Length switch. Each length
 * is still its own therapy row with its own id, duration and price; the tile
 * only groups them on screen.
 */

import { euro } from "./format";

export interface TreatmentLike {
  id: number;
  name: string;
  defaultDurationMinutes: number;
  defaultPriceEur: number;
}

export interface TreatmentFamily<T extends TreatmentLike = TreatmentLike> {
  /** The base name lower-cased: stable across renders. */
  key: string;
  /** The base name, with any length suffix removed: "Swedish massage". */
  name: string;
  /** What the tile says: "Swedish" inside the Massage group. */
  label: string;
  /** Every length on offer, shortest first. One entry for most treatments. */
  options: T[];
  /** Picked when the tile is clicked: the option with no suffix, else the shortest. */
  primary: T;
}

export const GROUP_ORDER = ["Recovery", "Massage", "Specialist", "Other"] as const;
export type GroupName = (typeof GROUP_ORDER)[number];

export interface TreatmentGroup<T extends TreatmentLike = TreatmentLike> {
  name: GroupName;
  families: TreatmentFamily<T>[];
}

const LENGTH_SUFFIX = /\s*\(\s*\d+\s*(?:min|mins|minutes)\s*\)\s*$/i;

/** "Swedish massage (30 min)" -> "Swedish massage". */
export function baseName(name: string): string {
  return name.replace(LENGTH_SUFFIX, "").trim();
}

// Specialist first: "Indian head massage" and "Oncology massage" are
// specialist work even though they say "massage".
const RULES: [GroupName, RegExp][] = [
  ["Specialist", /reflexology|indian head|facial|lymphatic|oncology/i],
  ["Recovery", /hbot|hyperbaric|infrared|red light|pemf|hifem|cryo|sauna|compression/i],
  ["Massage", /massage|cupping|hot lava|pamper/i],
];

export function groupFor(name: string): GroupName {
  for (const [group, pattern] of RULES) if (pattern.test(name)) return group;
  return "Other";
}

/** Inside the Massage group the heading already says massage: "Swedish massage" -> "Swedish". */
export function tileLabel(name: string, group: GroupName): string {
  if (group !== "Massage") return name;
  return name.replace(/\s+massage$/i, "").trim() || name;
}

/** Groups in GROUP_ORDER, empty groups left out; families in the order their first treatment arrived. */
export function groupTreatments<T extends TreatmentLike>(treatments: T[]): TreatmentGroup<T>[] {
  const families = new Map<string, { name: string; options: T[] }>();
  for (const t of treatments) {
    const name = baseName(t.name);
    const key = name.toLowerCase();
    const family = families.get(key);
    if (family) family.options.push(t);
    else families.set(key, { name, options: [t] });
  }

  const byGroup = new Map<GroupName, TreatmentFamily<T>[]>();
  for (const [key, f] of families) {
    const group = groupFor(f.name);
    const options = [...f.options].sort((a, b) => a.defaultDurationMinutes - b.defaultDurationMinutes);
    const primary = f.options.find((o) => o.name.trim().toLowerCase() === key) ?? options[0];
    const family: TreatmentFamily<T> = { key, name: f.name, label: tileLabel(f.name, group), options, primary };
    const list = byGroup.get(group);
    if (list) list.push(family);
    else byGroup.set(group, [family]);
  }

  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ name: g, families: byGroup.get(g)! }));
}

/** The family a therapy id belongs to, or null. */
export function familyOf<T extends TreatmentLike>(groups: TreatmentGroup<T>[], therapyId: number | null): TreatmentFamily<T> | null {
  if (therapyId == null) return null;
  for (const g of groups) for (const f of g.families) if (f.options.some((o) => o.id === therapyId)) return f;
  return null;
}

/** Groups narrowed to families whose name, tile label or any option name contains the query. */
export function filterGroups<T extends TreatmentLike>(groups: TreatmentGroup<T>[], query: string): TreatmentGroup<T>[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({
      name: g.name,
      families: g.families.filter(
        (f) => f.name.toLowerCase().includes(q) || f.label.toLowerCase().includes(q) || f.options.some((o) => o.name.toLowerCase().includes(q)),
      ),
    }))
    .filter((g) => g.families.length > 0);
}

/** What a tile click selects: the length a prepaid package covers when there is one, else the primary. */
export function pickOption<T extends TreatmentLike>(family: TreatmentFamily<T>, prepaidTherapyIds: ReadonlySet<number>): T {
  return family.options.find((o) => prepaidTherapyIds.has(o.id)) ?? family.primary;
}

/** The tile's small print: "60 min · €80" for one length, "from €50" for several. */
export function priceHint(family: TreatmentFamily): string {
  if (family.options.length === 1) {
    const only = family.options[0];
    return `${only.defaultDurationMinutes} min · ${euro(only.defaultPriceEur)}`;
  }
  return `from ${euro(Math.min(...family.options.map((o) => o.defaultPriceEur)))}`;
}

/** One Length switch button: "30 min · €50". */
export function lengthLabel(option: TreatmentLike): string {
  return `${option.defaultDurationMinutes} min · ${euro(option.defaultPriceEur)}`;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test -- src/lib/booking/format.test.ts`, `npm test -- src/lib/booking/clientSearch.test.ts`, `npm test -- src/lib/booking/treatmentGroups.test.ts`
Expected: each prints "... all checks passed." and "1/1 test file(s) passed".

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/booking/format.ts app/src/lib/booking/format.test.ts app/src/lib/booking/clientSearch.ts app/src/lib/booking/clientSearch.test.ts app/src/lib/booking/treatmentGroups.ts app/src/lib/booking/treatmentGroups.test.ts
git commit -m "feat(booking): pure formatting, client search and treatment grouping for the new booking screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Slot candidates and the day strip (pure)

**Files:**
- Create: `app/src/lib/booking/slotModel.ts`, `app/src/lib/booking/slotModel.test.ts`

**Interfaces:**
- Consumes: `hmToMin`, `minToHm` from `@/lib/scheduling/freeSlots` (existing, pure); `weekdayShort` from `./format` (Task 1).
- Produces: `BOOKING_STEP_MINUTES = 15`, `STRIP_DAYS = 14`, `slotCandidates(open, close, durationMinutes, stepMinutes = 15): string[]`, `blocksCoverDay(open, close, blocks: {startTime; endTime}[]): boolean`, `addDaysIso(dateIso, n): string`, `interface StripDay {date; weekday; day: number; closed: boolean}`, `dayStrip(from, count, isClosed: (date) => boolean): StripDay[]`, `stripStart(today, selected, count = 14): string`, `type Period = "Morning" | "Afternoon" | "Evening"`, `periodOf(hm): Period`, `groupByPeriod<T extends {time: string}>(slots): {period; slots: T[]}[]`, `onGrid(hm, step = 15): boolean`.

- [ ] **Step 1: Write the failing test**

`app/src/lib/booking/slotModel.test.ts`:

```ts
// Run: npm test -- src/lib/booking/slotModel.test.ts
import assert from "node:assert/strict";

import {
  BOOKING_STEP_MINUTES,
  addDaysIso,
  blocksCoverDay,
  dayStrip,
  groupByPeriod,
  onGrid,
  periodOf,
  slotCandidates,
  stripStart,
} from "./slotModel";

assert.equal(BOOKING_STEP_MINUTES, 15);

// ------------------------------------------------------------ candidates
const day = slotCandidates("09:00", "19:00", 60);
assert.equal(day[0], "09:00", "first start is opening time");
assert.equal(day[1], "09:15", "then every 15 minutes");
assert.equal(day[day.length - 1], "18:00", "the last start still ends by closing");
assert.equal(day.length, 37, "09:00 to 18:00 on a 15-minute grid");

assert.deepEqual(slotCandidates("09:00", "10:00", 45), ["09:00", "09:15"], "a session never runs past close");
assert.deepEqual(slotCandidates("09:00", "10:00", 60), ["09:00"], "a session may end exactly at close");
assert.deepEqual(slotCandidates("09:00", "10:00", 90), [], "too long for the day");
assert.deepEqual(slotCandidates("08:10", "09:00", 30), ["08:15", "08:30"], "an off-grid opening starts at the next grid line");
assert.deepEqual(slotCandidates("09:00", "10:00", 30, 30), ["09:00", "09:30"], "the grid can be changed");
assert.deepEqual(slotCandidates("09:00", "17:00", 0), [], "no length, no times");
assert.deepEqual(slotCandidates("09:00", "17:00", 30, 0), [], "no grid, no times");

// ------------------------------------------------------------ block-outs
assert.equal(blocksCoverDay("09:00", "17:00", []), false);
assert.equal(blocksCoverDay("09:00", "17:00", [{ startTime: "00:00", endTime: "23:59" }]), true, "an all-day block closes the day");
assert.equal(blocksCoverDay("09:00", "17:00", [{ startTime: "09:00", endTime: "13:00" }]), false, "a morning block leaves the afternoon");
assert.equal(
  blocksCoverDay("09:00", "17:00", [
    { startTime: "12:00", endTime: "17:30" },
    { startTime: "08:00", endTime: "12:00" },
  ]),
  true,
  "two blocks meeting end to end cover the day, in any order",
);
assert.equal(
  blocksCoverDay("09:00", "17:00", [
    { startTime: "09:00", endTime: "12:00" },
    { startTime: "12:15", endTime: "17:00" },
  ]),
  false,
  "a 15-minute gap keeps the day open",
);
assert.equal(blocksCoverDay("09:00", "09:00", []), true, "an empty window is closed");

// ------------------------------------------------------------ days
assert.equal(addDaysIso("2026-11-25", 1), "2026-11-26");
assert.equal(addDaysIso("2026-11-30", 1), "2026-12-01");
assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
assert.equal(addDaysIso("2026-03-28", 2), "2026-03-30", "no daylight-saving drift");

const strip = dayStrip("2026-11-25", 14, (d) => d === "2026-11-29");
assert.equal(strip.length, 14);
assert.deepEqual(strip[0], { date: "2026-11-25", weekday: "Wed", day: 25, closed: false });
assert.deepEqual(strip[4], { date: "2026-11-29", weekday: "Sun", day: 29, closed: true });
assert.deepEqual(strip[6], { date: "2026-12-01", weekday: "Tue", day: 1, closed: false });
assert.equal(strip[13].date, "2026-12-08");

assert.equal(stripStart("2026-11-25", "2026-11-25"), "2026-11-25");
assert.equal(stripStart("2026-11-25", "2026-12-08"), "2026-11-25", "the 14th day is still inside the strip");
assert.equal(stripStart("2026-11-25", "2026-12-09"), "2026-12-09", "a date past the strip starts the strip");
assert.equal(stripStart("2026-11-25", "2026-11-20"), "2026-11-20", "a past date (recording a past session) starts the strip");

// ------------------------------------------------------------ periods
assert.equal(periodOf("09:00"), "Morning");
assert.equal(periodOf("11:45"), "Morning");
assert.equal(periodOf("12:00"), "Afternoon");
assert.equal(periodOf("16:45"), "Afternoon");
assert.equal(periodOf("17:00"), "Evening");

const grouped = groupByPeriod([{ time: "09:00" }, { time: "11:45" }, { time: "12:00" }, { time: "18:00" }]);
assert.deepEqual(
  grouped.map((g) => [g.period, g.slots.map((s) => s.time)]),
  [
    ["Morning", ["09:00", "11:45"]],
    ["Afternoon", ["12:00"]],
    ["Evening", ["18:00"]],
  ],
);
assert.deepEqual(groupByPeriod([]), []);

assert.equal(onGrid("12:45"), true);
assert.equal(onGrid("12:40"), false);
assert.equal(onGrid(""), false);
assert.equal(onGrid("9:00"), false, "only HH:mm counts");

console.log("booking slotModel: all checks passed.");
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- src/lib/booking/slotModel.test.ts`
Expected: FAIL, "Cannot find module './slotModel'".

- [ ] **Step 3: Implement**

`app/src/lib/booking/slotModel.ts`:

```ts
/**
 * Pure: the start times and days the booking screen offers.
 *
 * This module only GENERATES candidates. Whether a candidate is free is
 * decided by `checkBookingSlot` (@/lib/schedule), the same check the booking
 * POST runs, so a time shown as free is a time the server accepts. See
 * app/api/appointments/free-slots/route.ts.
 */

import { hmToMin, minToHm } from "@/lib/scheduling/freeSlots";

import { weekdayShort } from "./format";

/**
 * Start times land on this grid (:00 :15 :30 :45). The old per-tenant
 * slot_length_minutes setting was removed on 2026-09-09 as dead (nothing read
 * it), so the grid is fixed here rather than resurrecting a hidden knob.
 */
export const BOOKING_STEP_MINUTES = 15;

/** How many days the strip shows. */
export const STRIP_DAYS = 14;

/**
 * Every start on the grid inside [open, close) whose session also ends by
 * close. An open time off the grid (08:10) starts at the next grid line (08:15).
 */
export function slotCandidates(open: string, close: string, durationMinutes: number, stepMinutes = BOOKING_STEP_MINUTES): string[] {
  if (!(durationMinutes > 0) || !(stepMinutes > 0)) return [];
  const openMin = hmToMin(open);
  const closeMin = hmToMin(close);
  const out: string[] = [];
  for (let start = Math.ceil(openMin / stepMinutes) * stepMinutes; start + durationMinutes <= closeMin; start += stepMinutes) {
    out.push(minToHm(start));
  }
  return out;
}

/** True when block-outs together cover the whole opening window, so the day is effectively closed. */
export function blocksCoverDay(open: string, close: string, blocks: { startTime: string; endTime: string }[]): boolean {
  const openMin = hmToMin(open);
  const closeMin = hmToMin(close);
  if (closeMin <= openMin) return true;
  const spans = blocks
    .map((b) => [Math.max(openMin, hmToMin(b.startTime)), Math.min(closeMin, hmToMin(b.endTime))] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let reach = openMin;
  for (const [s, e] of spans) {
    if (s > reach) return false;
    reach = Math.max(reach, e);
    if (reach >= closeMin) return true;
  }
  return reach >= closeMin;
}

/** ISO date plus `n` days, in UTC so no local clock is involved. */
export function addDaysIso(dateIso: string, n: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export interface StripDay {
  date: string;
  /** "Wed" */
  weekday: string;
  /** Day of the month, 1-31. */
  day: number;
  closed: boolean;
}

/** `count` days from `from`, each marked closed by the caller's rule (opening hours, block-outs). */
export function dayStrip(from: string, count: number, isClosed: (dateIso: string) => boolean): StripDay[] {
  const out: StripDay[] = [];
  for (let i = 0; i < count; i++) {
    const date = addDaysIso(from, i);
    out.push({ date, weekday: weekdayShort(date), day: Number(date.slice(8, 10)), closed: isClosed(date) });
  }
  return out;
}

/** The strip starts today, unless the booking's date falls outside it; then it starts on that date. */
export function stripStart(today: string, selected: string, count = STRIP_DAYS): string {
  const last = addDaysIso(today, count - 1);
  return selected < today || selected > last ? selected : today;
}

export type Period = "Morning" | "Afternoon" | "Evening";

/** Before 12:00 is morning, before 17:00 afternoon, then evening. */
export function periodOf(hm: string): Period {
  const min = hmToMin(hm);
  if (min < 12 * 60) return "Morning";
  if (min < 17 * 60) return "Afternoon";
  return "Evening";
}

/** Slots split into Morning / Afternoon / Evening runs, in order, empty runs left out. */
export function groupByPeriod<T extends { time: string }>(slots: T[]): { period: Period; slots: T[] }[] {
  const out: { period: Period; slots: T[] }[] = [];
  for (const s of slots) {
    const period = periodOf(s.time);
    const last = out[out.length - 1];
    if (last && last.period === period) last.slots.push(s);
    else out.push({ period, slots: [s] });
  }
  return out;
}

/** True when `hm` sits on the booking grid, so it will appear as a button. */
export function onGrid(hm: string, stepMinutes = BOOKING_STEP_MINUTES): boolean {
  return /^\d{2}:\d{2}$/.test(hm) && hmToMin(hm) % stepMinutes === 0;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npm test -- src/lib/booking/slotModel.test.ts`
Expected: "booking slotModel: all checks passed."

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/booking/slotModel.ts app/src/lib/booking/slotModel.test.ts
git commit -m "feat(booking): slot candidates, block-out closed days and the 14-day strip (pure)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Package choice, voucher coverage and summary money (pure)

**Files:**
- Create: `app/src/lib/booking/packageChoiceModel.ts`, `app/src/lib/booking/packageChoiceModel.test.ts`
- Create: `app/src/lib/booking/voucherModel.ts`, `app/src/lib/booking/voucherModel.test.ts`
- Create: `app/src/lib/booking/summaryModel.ts`, `app/src/lib/booking/summaryModel.test.ts`

**Interfaces:**
- Consumes: `fullDate`, `euro`, `addMinutes`, `shortDate` from `./format` (Task 1); `perSessionValue` from `@/lib/packageBalanceModel` (existing).
- Produces:
  - `packageChoiceModel.ts`: `type PaymentMethod = "cash" | "card" | "package" | "voucher" | "bank_transfer"`, `type PackageMode = "existing" | "new"`, `interface UsablePackage {id; therapyId; packageName; totalSessions; sessionsUsed; pricePaidEur; expiryDate; available}`, `interface PaymentChoice {paymentMethod; packageMode; packageId: number | null}`, `packagesFor(packages, therapyId | null)`, `reconcilePackageChoice(choice, packages, therapyId, methodChosen, fallback = "cash"): PaymentChoice`, `sameChoice(a, b)`, `interface PrepaidOffer {packageId; therapyId; count; treatment; minutes; packageName; expiryDate}`, `prepaidOffers(packages, treatments)`, `offerText(offer, firstName): {lead; strong; rest}`.
  - `voucherModel.ts`: `interface VoucherLookupResponse`, `type VoucherInfo`, `voucherInfoFrom(d): VoucherInfo`, `interface VoucherCoverage {covers; wrongTreatment; noPrice; needsSplit}`, `voucherCoverage(info, therapyId | null, price, listPrice): VoucherCoverage`.
  - `summaryModel.ts`: `type SecondaryMethod = "cash" | "card" | "bank_transfer"`, `methodLabel(m)`, `interface SummaryInput`, `interface SummaryMoney {value; struck: number | null; paymentLabel; shortPayment; note; tone: "paid" | "due"}`, `summaryMoney(input): SummaryMoney`, `whenLabel(date, startTime, durationMinutes): string`, `bookLabel(firstName, fallback): string`.

- [ ] **Step 1: Write the failing tests**

`app/src/lib/booking/packageChoiceModel.test.ts`:

```ts
// Run: npm test -- src/lib/booking/packageChoiceModel.test.ts
import assert from "node:assert/strict";

import {
  offerText,
  packagesFor,
  prepaidOffers,
  reconcilePackageChoice,
  sameChoice,
  type PaymentChoice,
  type UsablePackage,
} from "./packageChoiceModel";

const pkg = (id: number, therapyId: number, over: Partial<UsablePackage> = {}): UsablePackage => ({
  id,
  therapyId,
  packageName: `Package ${id}`,
  totalSessions: 1,
  sessionsUsed: 0,
  pricePaidEur: 64,
  expiryDate: "2027-03-01",
  available: 1,
  ...over,
});

const DEEP = 17;
const HBOT = 1;
const PKGS = [pkg(7, DEEP, { packageName: "Black Friday" }), pkg(8, HBOT, { available: 3, totalSessions: 5, sessionsUsed: 2 })];

const cash: PaymentChoice = { paymentMethod: "cash", packageMode: "existing", packageId: null };

// ------------------------------------------------------------ fitting packages
assert.deepEqual(packagesFor(PKGS, DEEP).map((p) => p.id), [7]);
assert.deepEqual(packagesFor(PKGS, null), [], "no treatment, no package");
assert.deepEqual(packagesFor([pkg(9, DEEP, { available: 0 })], DEEP), [], "a package with nothing left to book does not fit");

// ------------------------------------------------------------ reconcile
assert.deepEqual(
  reconcilePackageChoice(cash, PKGS, DEEP, false),
  { paymentMethod: "package", packageMode: "existing", packageId: 7 },
  "a prepaid session is used by default until staff choose a method",
);
assert.deepEqual(
  reconcilePackageChoice(cash, PKGS, DEEP, true),
  { paymentMethod: "cash", packageMode: "existing", packageId: 7 },
  "once staff chose cash, cash stays (the package is remembered for the Prepaid button)",
);
assert.deepEqual(
  reconcilePackageChoice({ paymentMethod: "package", packageMode: "existing", packageId: 7 }, PKGS, 99, true),
  { paymentMethod: "cash", packageMode: "existing", packageId: null },
  "switching to a treatment no package covers falls back to cash",
);
assert.deepEqual(
  reconcilePackageChoice({ paymentMethod: "package", packageMode: "existing", packageId: 7 }, PKGS, 99, true, "card"),
  { paymentMethod: "card", packageMode: "existing", packageId: null },
  "the fallback method can be named",
);
assert.deepEqual(
  reconcilePackageChoice({ paymentMethod: "package", packageMode: "existing", packageId: 7 }, [], DEEP, false),
  { paymentMethod: "cash", packageMode: "existing", packageId: null },
  "a date past the package's use-by date removes it, and the payment falls back",
);
const twoFit = [pkg(7, DEEP), pkg(10, DEEP)];
assert.equal(
  reconcilePackageChoice({ paymentMethod: "package", packageMode: "existing", packageId: 10 }, twoFit, DEEP, true).packageId,
  10,
  "the package staff picked is kept while it still fits",
);
const signUp: PaymentChoice = { paymentMethod: "package", packageMode: "new", packageId: null };
assert.equal(reconcilePackageChoice(signUp, PKGS, DEEP, false), signUp, "signing up for a new package is left alone");
const voucher: PaymentChoice = { paymentMethod: "voucher", packageMode: "existing", packageId: null };
assert.deepEqual(
  reconcilePackageChoice(voucher, PKGS, DEEP, true),
  { paymentMethod: "voucher", packageMode: "existing", packageId: 7 },
  "a voucher redemption (method chosen up front) is not switched to the package",
);
assert.deepEqual(reconcilePackageChoice(cash, [], null, false), cash, "nothing to reconcile");

assert.equal(sameChoice(cash, { ...cash }), true);
assert.equal(sameChoice(cash, { ...cash, packageId: 7 }), false);

// ------------------------------------------------------------ banners
const treatments = [
  { id: DEEP, name: "Deep tissue massage", defaultDurationMinutes: 60 },
  { id: HBOT, name: "HBOT", defaultDurationMinutes: 60 },
];
const offers = prepaidOffers([...PKGS, pkg(11, 404)], treatments);
assert.deepEqual(
  offers.map((o) => [o.packageId, o.therapyId, o.count, o.treatment, o.minutes]),
  [
    [7, DEEP, 1, "Deep tissue massage", 60],
    [8, HBOT, 3, "HBOT", 60],
  ],
  "one line per usable package; a package for a retired treatment is left out",
);
assert.deepEqual(offerText(offers[0], "Mary"), {
  lead: "Mary has ",
  strong: "1 prepaid Deep tissue massage",
  rest: ", 60 min, from Black Friday. Use by 1 Mar 2027.",
});
assert.equal(offerText(offers[0], "  ").lead, "This client has ", "no first name yet");

console.log("booking packageChoiceModel: all checks passed.");
```

`app/src/lib/booking/voucherModel.test.ts`:

```ts
// Run: npm test -- src/lib/booking/voucherModel.test.ts
import assert from "node:assert/strict";

import { voucherCoverage, voucherInfoFrom, type VoucherInfo } from "./voucherModel";

// ------------------------------------------------------------ lookup mapping
assert.deepEqual(voucherInfoFrom({ ok: false }), { state: "invalid" });
assert.deepEqual(voucherInfoFrom({ ok: true, cancelled: true, empty: true }), { state: "cancelled" }, "cancelled wins over used");
assert.deepEqual(voucherInfoFrom({ ok: true, empty: true }), { state: "empty" });
assert.deepEqual(voucherInfoFrom({ ok: true, kind: "amount", balanceEur: 30, expiryDate: "2027-01-01" }), {
  state: "valid",
  kind: "amount",
  balance: 30,
  therapyId: null,
  therapyName: null,
  recipientName: null,
  expiryDate: "2027-01-01",
  expired: false,
});
const treatmentInfo = voucherInfoFrom({ ok: true, kind: "treatment", therapyId: 17, therapyName: "Deep tissue massage", expired: true });
assert.equal(treatmentInfo.state === "valid" && treatmentInfo.kind, "treatment");
assert.equal(treatmentInfo.state === "valid" && treatmentInfo.expired, true, "an expired voucher is still valid (a warning)");

// ------------------------------------------------------------ coverage
const money = (balance: number): VoucherInfo => ({
  state: "valid",
  kind: "amount",
  balance,
  therapyId: null,
  therapyName: null,
  recipientName: null,
  expiryDate: "",
  expired: false,
});
const forTreatment = (therapyId: number): VoucherInfo => ({ ...money(0), kind: "treatment", therapyId } as VoucherInfo);

assert.deepEqual(voucherCoverage(money(100), 17, 80, 80), { covers: 80, wrongTreatment: false, noPrice: false, needsSplit: false }, "a big money voucher pays it all");
assert.deepEqual(voucherCoverage(money(30), 17, 80, 80), { covers: 30, wrongTreatment: false, noPrice: false, needsSplit: true }, "a small one pays part: split");
assert.deepEqual(voucherCoverage(forTreatment(17), 17, 80, 80), { covers: 80, wrongTreatment: false, noPrice: false, needsSplit: false });
assert.deepEqual(
  voucherCoverage(forTreatment(17), 17, 100, 80),
  { covers: 80, wrongTreatment: false, noPrice: false, needsSplit: true },
  "a treatment voucher pays up to the listed price; a dearer session is split",
);
assert.deepEqual(voucherCoverage(forTreatment(18), 17, 80, 80), { covers: 0, wrongTreatment: true, noPrice: false, needsSplit: false }, "another treatment's voucher pays nothing");
assert.deepEqual(voucherCoverage(forTreatment(17), 17, 80, 0), { covers: 0, wrongTreatment: false, noPrice: true, needsSplit: false }, "no listed price: refused, not split");
assert.deepEqual(voucherCoverage(money(30), 17, 0, 0), { covers: 0, wrongTreatment: false, noPrice: false, needsSplit: false }, "a free session needs no split");
assert.deepEqual(voucherCoverage({ state: "invalid" }, 17, 80, 80), { covers: 0, wrongTreatment: false, noPrice: false, needsSplit: false });
assert.deepEqual(voucherCoverage({ state: "idle" }, 17, 80, 80).needsSplit, false);

console.log("booking voucherModel: all checks passed.");
```

`app/src/lib/booking/summaryModel.test.ts`:

```ts
// Run: npm test -- src/lib/booking/summaryModel.test.ts
import assert from "node:assert/strict";

import { bookLabel, methodLabel, summaryMoney, whenLabel, type SummaryInput } from "./summaryModel";

const base: SummaryInput = {
  listPrice: 80,
  price: 80,
  paymentMethod: "cash",
  packageMode: "existing",
  pkg: null,
  newPackage: null,
  voucher: null,
  secondaryMethod: "card",
};

// ------------------------------------------------------------ package value
const fromPackage = summaryMoney({
  ...base,
  paymentMethod: "package",
  pkg: { packageName: "Black Friday", pricePaidEur: 64, totalSessions: 1 },
});
assert.equal(fromPackage.value, 64, "a session from a EUR 64 package is worth EUR 64, not the EUR 80 list price");
assert.equal(fromPackage.struck, 80, "the list price is struck through beside it");
assert.equal(fromPackage.paymentLabel, "Black Friday");
assert.equal(fromPackage.shortPayment, "Prepaid");
assert.equal(fromPackage.note, "Already paid. Uses 1 prepaid session from Black Friday.");
assert.equal(fromPackage.tone, "paid");

const bundle = summaryMoney({
  ...base,
  paymentMethod: "package",
  pkg: { packageName: "Five pack", pricePaidEur: 400, totalSessions: 5 },
});
assert.equal(bundle.value, 80);
assert.equal(bundle.struck, null, "nothing to strike when the package value equals the list price");

// Paying by package with no package picked is not a prepaid session.
const noPkg = summaryMoney({ ...base, paymentMethod: "package" });
assert.equal(noPkg.value, 80);
assert.equal(noPkg.tone, "due");

// ------------------------------------------------------------ new package
const signUp = summaryMoney({ ...base, paymentMethod: "package", packageMode: "new", newPackage: { name: "Ten pack", priceEur: 600 } });
assert.equal(signUp.value, 600, "the package sale is what is taken");
assert.equal(signUp.paymentLabel, "New: Ten pack");
assert.equal(summaryMoney({ ...base, paymentMethod: "package", packageMode: "new", newPackage: { name: " ", priceEur: 0 } }).paymentLabel, "New: New package");

// ------------------------------------------------------------ voucher
const full = summaryMoney({ ...base, paymentMethod: "voucher", voucher: { valid: true, covers: 80, wrongTreatment: false, noPrice: false, needsSplit: false } });
assert.deepEqual([full.paymentLabel, full.note, full.tone], ["Gift voucher", "Paid by gift voucher.", "paid"]);
const split = summaryMoney({
  ...base,
  paymentMethod: "voucher",
  secondaryMethod: "bank_transfer",
  voucher: { valid: true, covers: 30, wrongTreatment: false, noPrice: false, needsSplit: true },
});
assert.equal(split.paymentLabel, "Gift voucher and bank transfer");
assert.equal(split.note, "Voucher pays €30. €50 to pay by bank transfer.");
assert.equal(split.value, 80);
const wrong = summaryMoney({ ...base, paymentMethod: "voucher", voucher: { valid: true, covers: 0, wrongTreatment: true, noPrice: false, needsSplit: false } });
assert.deepEqual([wrong.paymentLabel, wrong.note, wrong.tone], ["Gift voucher", "To pay on the day.", "due"]);
const noCode = summaryMoney({ ...base, paymentMethod: "voucher" });
assert.equal(noCode.note, "To pay on the day.");

// ------------------------------------------------------------ plain methods
const card = summaryMoney({ ...base, paymentMethod: "card", price: 70 });
assert.deepEqual([card.value, card.struck, card.paymentLabel, card.shortPayment, card.note, card.tone], [70, null, "Card", "Card", "To pay on the day.", "due"]);
assert.equal(summaryMoney({ ...base, paymentMethod: "bank_transfer" }).paymentLabel, "Bank transfer");
assert.equal(methodLabel("cash"), "Cash");

// ------------------------------------------------------------ when + button
assert.equal(whenLabel("2026-11-26", "12:45", 60), "Thu 26 Nov, 12:45 to 13:45");
assert.equal(whenLabel("2026-11-26", "", 60), "Thu 26 Nov", "no time yet");
assert.equal(whenLabel("2026-11-26", "12:45", 0), "Thu 26 Nov, 12:45", "no length yet");
assert.equal(whenLabel("", "12:45", 60), "");

assert.equal(bookLabel("Mary", "Book appointment"), "Book Mary in");
assert.equal(bookLabel("  ", "Book appointment"), "Book appointment");

console.log("booking summaryModel: all checks passed.");
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- src/lib/booking/packageChoiceModel.test.ts` (and the other two)
Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Implement**

`app/src/lib/booking/packageChoiceModel.ts`:

```ts
/**
 * Pure: which prepaid package (if any) pays for the booking being made.
 *
 * The client's usable packages come from GET /api/packages?clientId&date:
 * active, not expired by the booking's date, and with a session left once the
 * sessions already booked on them are held (`available`). The server checks
 * all of that again on POST; this module only decides what the screen offers
 * and pre-selects, so a prepaid session (a Black Friday buyer's) is used by
 * default instead of charging for the treatment again.
 */

import { fullDate } from "./format";

export type PaymentMethod = "cash" | "card" | "package" | "voucher" | "bank_transfer";
export type PackageMode = "existing" | "new";

/** One row of GET /api/packages. */
export interface UsablePackage {
  id: number;
  therapyId: number;
  packageName: string;
  totalSessions: number;
  sessionsUsed: number;
  pricePaidEur: number;
  expiryDate: string;
  /** Sessions left once booked-but-not-done sessions are held. */
  available: number;
}

export interface PaymentChoice {
  paymentMethod: PaymentMethod;
  packageMode: PackageMode;
  packageId: number | null;
}

/** The packages that can pay for this treatment. */
export function packagesFor(packages: UsablePackage[], therapyId: number | null): UsablePackage[] {
  if (therapyId == null) return [];
  return packages.filter((p) => p.therapyId === therapyId && p.available > 0);
}

/**
 * Re-run whenever the client's packages, the treatment or the date change.
 *
 * - Signing up for a NEW package is left alone.
 * - The picked package is kept while it still fits; otherwise the first that fits.
 * - Until staff pick a payment method themselves (`methodChosen`), a fitting
 *   package becomes the payment.
 * - Paying by package with nothing that fits falls back to `fallback`.
 */
export function reconcilePackageChoice(
  choice: PaymentChoice,
  packages: UsablePackage[],
  therapyId: number | null,
  methodChosen: boolean,
  fallback: PaymentMethod = "cash",
): PaymentChoice {
  if (choice.paymentMethod === "package" && choice.packageMode === "new") return choice;
  const fits = packagesFor(packages, therapyId);
  const kept = choice.packageId != null && fits.some((p) => p.id === choice.packageId);
  const packageId = kept ? choice.packageId : (fits[0]?.id ?? null);
  if (packageId != null && !methodChosen) return { paymentMethod: "package", packageMode: "existing", packageId };
  if (choice.paymentMethod === "package" && packageId == null) {
    return { paymentMethod: fallback, packageMode: "existing", packageId: null };
  }
  return { ...choice, packageId };
}

export function sameChoice(a: PaymentChoice, b: PaymentChoice): boolean {
  return a.paymentMethod === b.paymentMethod && a.packageMode === b.packageMode && a.packageId === b.packageId;
}

/** One green banner line on the Client card. */
export interface PrepaidOffer {
  packageId: number;
  therapyId: number;
  /** Sessions left to book. */
  count: number;
  treatment: string;
  minutes: number;
  packageName: string;
  expiryDate: string;
}

/** One offer per usable package whose treatment is on the list (a retired treatment cannot be booked). */
export function prepaidOffers(
  packages: UsablePackage[],
  treatments: { id: number; name: string; defaultDurationMinutes: number }[],
): PrepaidOffer[] {
  const byId = new Map(treatments.map((t) => [t.id, t]));
  const out: PrepaidOffer[] = [];
  for (const p of packages) {
    const t = byId.get(p.therapyId);
    if (!t || p.available <= 0) continue;
    out.push({
      packageId: p.id,
      therapyId: p.therapyId,
      count: p.available,
      treatment: t.name,
      minutes: t.defaultDurationMinutes,
      packageName: p.packageName,
      expiryDate: p.expiryDate,
    });
  }
  return out;
}

/**
 * The banner sentence in three parts, so the middle can be bold:
 * "Mary has " + "1 prepaid Deep tissue massage" + ", 60 min, from Black Friday. Use by 1 Mar 2027."
 */
export function offerText(offer: PrepaidOffer, firstName: string): { lead: string; strong: string; rest: string } {
  const who = firstName.trim() || "This client";
  return {
    lead: `${who} has `,
    strong: `${offer.count} prepaid ${offer.treatment}`,
    rest: `, ${offer.minutes} min, from ${offer.packageName}. Use by ${fullDate(offer.expiryDate)}.`,
  };
}
```

`app/src/lib/booking/voucherModel.ts`:

```ts
/**
 * Pure: what a gift voucher typed at the desk pays towards this booking.
 * The same sum the server does in lib/vouchers/redeem (redeemAtBooking):
 * a money voucher up to its balance; a treatment voucher the session price up
 * to the treatment's listed price, and only for that treatment.
 */

/** GET /api/vouchers/<code> */
export interface VoucherLookupResponse {
  ok: boolean;
  empty?: boolean;
  cancelled?: boolean;
  expired?: boolean;
  kind?: "amount" | "treatment";
  balanceEur?: number;
  therapyId?: number | null;
  therapyName?: string | null;
  recipientName?: string | null;
  expiryDate?: string;
}

export type VoucherInfo =
  | { state: "idle" | "invalid" | "empty" | "cancelled" }
  | {
      state: "valid";
      kind: "amount" | "treatment";
      balance: number;
      therapyId: number | null;
      therapyName: string | null;
      recipientName: string | null;
      expiryDate: string;
      expired: boolean;
    };

export function voucherInfoFrom(d: VoucherLookupResponse): VoucherInfo {
  if (!d.ok) return { state: "invalid" };
  if (d.cancelled) return { state: "cancelled" };
  if (d.empty) return { state: "empty" };
  return {
    state: "valid",
    kind: d.kind === "treatment" ? "treatment" : "amount",
    balance: d.balanceEur ?? 0,
    therapyId: d.therapyId ?? null,
    therapyName: d.therapyName ?? null,
    recipientName: d.recipientName ?? null,
    expiryDate: d.expiryDate ?? "",
    expired: d.expired === true,
  };
}

export interface VoucherCoverage {
  /** Euros the voucher pays towards this session. */
  covers: number;
  /** A treatment voucher for some other treatment. */
  wrongTreatment: boolean;
  /** A treatment voucher whose treatment has no listed price: the server refuses it. */
  noPrice: boolean;
  /** The voucher pays part; the rest needs a second payment method. */
  needsSplit: boolean;
}

export function voucherCoverage(info: VoucherInfo, therapyId: number | null, price: number, listPrice: number): VoucherCoverage {
  if (info.state !== "valid") return { covers: 0, wrongTreatment: false, noPrice: false, needsSplit: false };
  const wrongTreatment = info.kind === "treatment" && info.therapyId !== therapyId;
  const covers = info.kind === "treatment" ? (wrongTreatment ? 0 : Math.min(price, listPrice)) : Math.min(info.balance, price);
  const noPrice = info.kind === "treatment" && !wrongTreatment && covers <= 0;
  const needsSplit = !wrongTreatment && !noPrice && price > 0 && covers < price;
  return { covers, wrongTreatment, noPrice, needsSplit };
}
```

`app/src/lib/booking/summaryModel.ts`:

```ts
/**
 * Pure: the words and money on the Booking summary (the right-hand panel and
 * the narrow-screen bar). Mirrors what the POST will record: a session paid
 * from a package is worth what the package cost per session
 * (perSessionValue), not the treatment's list price.
 */

import { perSessionValue } from "@/lib/packageBalanceModel";

import { addMinutes, euro, shortDate } from "./format";
import type { PackageMode, PaymentMethod } from "./packageChoiceModel";
import type { VoucherCoverage } from "./voucherModel";

export type SecondaryMethod = "cash" | "card" | "bank_transfer";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  voucher: "Gift voucher",
  package: "Prepaid package",
};

export function methodLabel(m: PaymentMethod): string {
  return METHOD_LABEL[m];
}

export interface SummaryInput {
  /** The selected treatment's list price; 0 when none is picked. */
  listPrice: number;
  /** The price the booking will send (list price, or what staff typed). */
  price: number;
  paymentMethod: PaymentMethod;
  packageMode: PackageMode;
  /** The package paying, when paying from an existing one. */
  pkg: { packageName: string; pricePaidEur: number; totalSessions: number } | null;
  /** The package being sold with this booking (package + new). */
  newPackage: { name: string; priceEur: number } | null;
  /** Null unless paying by voucher with a code typed. */
  voucher: (VoucherCoverage & { valid: boolean }) | null;
  secondaryMethod: SecondaryMethod;
}

export interface SummaryMoney {
  /** The big number. */
  value: number;
  /** The list price struck through beside it, or null. */
  struck: number | null;
  /** The Payment row. */
  paymentLabel: string;
  /** "Prepaid", "Card": the narrow-screen bar. */
  shortPayment: string;
  /** The line under the value. */
  note: string;
  /** "paid" draws the note in the success colour. */
  tone: "paid" | "due";
}

const DUE = "To pay on the day.";

export function summaryMoney(i: SummaryInput): SummaryMoney {
  if (i.paymentMethod === "package" && i.packageMode === "existing" && i.pkg) {
    const value = perSessionValue(i.pkg);
    return {
      value,
      struck: i.listPrice > 0 && i.listPrice !== value ? i.listPrice : null,
      paymentLabel: i.pkg.packageName,
      shortPayment: "Prepaid",
      note: `Already paid. Uses 1 prepaid session from ${i.pkg.packageName}.`,
      tone: "paid",
    };
  }
  if (i.paymentMethod === "package" && i.packageMode === "new") {
    const name = i.newPackage?.name.trim() || "New package";
    return {
      value: i.newPackage?.priceEur ?? 0,
      struck: null,
      paymentLabel: `New: ${name}`,
      shortPayment: "New package",
      note: "Sold with this booking. This session uses one of its sessions.",
      tone: "due",
    };
  }
  if (i.paymentMethod === "voucher" && i.voucher?.valid && !i.voucher.wrongTreatment && !i.voucher.noPrice) {
    if (i.voucher.needsSplit) {
      const rest = Math.round((i.price - i.voucher.covers) * 100) / 100;
      const second = methodLabel(i.secondaryMethod);
      return {
        value: i.price,
        struck: null,
        paymentLabel: `Gift voucher and ${second.toLowerCase()}`,
        shortPayment: "Voucher",
        note: `Voucher pays ${euro(i.voucher.covers)}. ${euro(rest)} to pay by ${second.toLowerCase()}.`,
        tone: "due",
      };
    }
    return { value: i.price, struck: null, paymentLabel: "Gift voucher", shortPayment: "Voucher", note: "Paid by gift voucher.", tone: "paid" };
  }
  const label = i.paymentMethod === "package" ? "Prepaid package" : methodLabel(i.paymentMethod);
  return { value: i.price, struck: null, paymentLabel: label, shortPayment: label, note: DUE, tone: "due" };
}

/** "Thu 26 Nov, 12:45 to 13:45"; just the day until a time is picked. */
export function whenLabel(date: string, startTime: string, durationMinutes: number): string {
  if (!date) return "";
  if (!/^\d{2}:\d{2}$/.test(startTime)) return shortDate(date);
  if (!(durationMinutes > 0)) return `${shortDate(date)}, ${startTime}`;
  return `${shortDate(date)}, ${startTime} to ${addMinutes(startTime, durationMinutes)}`;
}

/** "Book Mary in", or the venue's own phrase until there is a name. */
export function bookLabel(firstName: string, fallback: string): string {
  const name = firstName.trim();
  return name ? `Book ${name} in` : fallback;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run the three files. Expected: each "... all checks passed."

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/booking/packageChoiceModel.ts app/src/lib/booking/packageChoiceModel.test.ts app/src/lib/booking/voucherModel.ts app/src/lib/booking/voucherModel.test.ts app/src/lib/booking/summaryModel.ts app/src/lib/booking/summaryModel.test.ts
git commit -m "feat(booking): package choice, voucher coverage and summary value rules (pure)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The POST body, and a contract test against the real POST

**Files:**
- Create: `app/src/lib/booking/bookingPayload.ts`, `app/src/lib/booking/bookingPayload.test.ts`
- Create: `app/src/app/api/appointments/route.test.ts` (the route itself is NOT changed)

**Interfaces:**
- Consumes: `PaymentMethod`, `PackageMode` (Task 3, `packageChoiceModel.ts`); `SecondaryMethod` (Task 3, `summaryModel.ts`); the existing `POST` in `app/src/app/api/appointments/route.ts`.
- Produces: `interface NewPackageDraft {templateId: number | null; name; sessions; priceEur; expiry; paymentMethod: SecondaryMethod}`, `interface BookingDraft {clientMode; clientId: number | null; walkIn: {firstName; lastName; email; phone}; therapyIds: number[]; date; startTime; durationMinutes; priceEur; paymentMethod; packageMode; packageId: number | null; newPackage; voucherCode; secondaryPaymentMethod: SecondaryMethod | null; notes}`, `EMPTY_NEW_PACKAGE`, `bookingEntries(d): [string, string][]`, `bookingFormData(d): FormData`, `readyToBook(d): boolean`, `bookingProblem(d, vocab: {service; member}): string | null`.

Notes for the route test: it runs the real POST on a scratch tenant whose database file it deletes before and after (`app/data/tenants/appointments-route-test/`), so reruns start clean. The `[db] migration applied` / `[migrate]` lines it prints come from creating a fresh tenant and control database, as in the other scratch-tenant tests.

- [ ] **Step 1: Write the failing tests**

`app/src/lib/booking/bookingPayload.test.ts`:

```ts
// Run: npm test -- src/lib/booking/bookingPayload.test.ts
//
// The body POST /api/appointments takes, for every path the old BookingForm
// sent. Field names and presence are the contract: a missing packageMode
// books a package sign-up as a plain package payment, a missing
// secondaryPaymentMethod leaves a split voucher payment short.
import assert from "node:assert/strict";

import { EMPTY_NEW_PACKAGE, bookingEntries, bookingFormData, bookingProblem, readyToBook, type BookingDraft } from "./bookingPayload";

const VOCAB = { service: "Therapy", member: "Client" };

const draft = (over: Partial<BookingDraft> = {}): BookingDraft => ({
  clientMode: "existing",
  clientId: 5,
  walkIn: { firstName: "", lastName: "", email: "", phone: "" },
  therapyIds: [17],
  date: "2030-01-07",
  startTime: "12:45",
  durationMinutes: 60,
  priceEur: 80,
  paymentMethod: "cash",
  packageMode: "existing",
  packageId: null,
  newPackage: EMPTY_NEW_PACKAGE,
  voucherCode: "",
  secondaryPaymentMethod: null,
  notes: "",
  ...over,
});

const asObject = (d: BookingDraft) => Object.fromEntries(bookingEntries(d));

// ------------------------------------------------------------ existing client, cash
assert.deepEqual(bookingEntries(draft()), [
  ["therapyIds", "17"],
  ["clientId", "5"],
  ["date", "2030-01-07"],
  ["startTime", "12:45"],
  ["durationMinutes", "60"],
  ["totalPriceEur", "80"],
  ["paymentMethod", "cash"],
  ["notes", ""],
  ["status", "scheduled"],
]);

// ------------------------------------------------------------ walk-in
const walkIn = asObject(
  draft({ clientMode: "walk_in", clientId: 5, walkIn: { firstName: " Sam ", lastName: " Test ", email: " sam@example.com ", phone: " 0800 000 000 " } }),
);
assert.equal(walkIn.clientId, undefined, "a walk-in never sends a client id, even one left over from the other tab");
assert.deepEqual(
  [walkIn.walkInFirstName, walkIn.walkInLastName, walkIn.walkInEmail, walkIn.walkInPhone],
  ["Sam", "Test", "sam@example.com", "0800 000 000"],
  "walk-in fields are trimmed",
);

// ------------------------------------------------------------ several treatments
assert.deepEqual(
  bookingEntries(draft({ therapyIds: [1, 2] })).filter(([k]) => k === "therapyIds"),
  [
    ["therapyIds", "1"],
    ["therapyIds", "2"],
  ],
);

// ------------------------------------------------------------ existing package
const pkg = asObject(draft({ paymentMethod: "package", packageId: 7, priceEur: 64 }));
assert.deepEqual([pkg.paymentMethod, pkg.packageMode, pkg.packageId, pkg.totalPriceEur], ["package", "existing", "7", "64"]);

// ------------------------------------------------------------ new package from a template
const tpl = asObject(
  draft({ paymentMethod: "package", packageMode: "new", newPackage: { ...EMPTY_NEW_PACKAGE, templateId: 3, paymentMethod: "cash" } }),
);
assert.equal(tpl.totalPriceEur, "0", "the session is covered by the new package");
assert.deepEqual([tpl.packageMode, tpl.newPackageTemplateId, tpl.newPackagePaymentMethod], ["new", "3", "cash"]);
assert.equal(tpl.newPackageName, undefined, "a template sends no custom fields");
assert.equal(tpl.packageId, undefined);

// ------------------------------------------------------------ new custom package
const custom = asObject(
  draft({
    paymentMethod: "package",
    packageMode: "new",
    newPackage: { templateId: null, name: " Ten pack ", sessions: 10, priceEur: 600, expiry: "2031-01-01", paymentMethod: "bank_transfer" },
  }),
);
assert.deepEqual(
  [custom.newPackageName, custom.newPackageSessions, custom.newPackagePriceEur, custom.newPackageExpiry, custom.newPackagePaymentMethod],
  ["Ten pack", "10", "600", "2031-01-01", "bank_transfer"],
);
assert.equal(custom.newPackageTemplateId, undefined);

// ------------------------------------------------------------ voucher, whole and split
const whole = asObject(draft({ paymentMethod: "voucher", voucherCode: "GIFT-ABC" }));
assert.deepEqual([whole.voucherCode, whole.secondaryPaymentMethod], ["GIFT-ABC", undefined]);
const split = asObject(draft({ paymentMethod: "voucher", voucherCode: "GIFT-ABC", secondaryPaymentMethod: "card" }));
assert.equal(split.secondaryPaymentMethod, "card");
const paper = asObject(draft({ paymentMethod: "voucher", voucherCode: "" }));
assert.equal(paper.voucherCode, undefined, "a paper voucher with no code sends no code (the old desk path)");
assert.equal(asObject(draft({ paymentMethod: "card", voucherCode: "GIFT-ABC" })).voucherCode, undefined, "a code typed then abandoned is not sent");

// ------------------------------------------------------------ notes + FormData
assert.equal(asObject(draft({ notes: "Allergic to nuts" })).notes, "Allergic to nuts");
const fd = bookingFormData(draft({ therapyIds: [1, 2] }));
assert.deepEqual(fd.getAll("therapyIds"), ["1", "2"]);
assert.equal(fd.get("status"), "scheduled");

// ------------------------------------------------------------ problems
assert.equal(bookingProblem(draft(), VOCAB), null);
assert.equal(bookingProblem(draft({ therapyIds: [] }), VOCAB), "Pick a therapy.");
assert.equal(bookingProblem(draft({ durationMinutes: 0 }), VOCAB), "Pick a therapy.");
assert.equal(bookingProblem(draft({ clientId: null }), VOCAB), "Pick a client.");
assert.equal(bookingProblem(draft({ clientMode: "walk_in" }), VOCAB), "Enter the walk-in client's first name.");
assert.equal(bookingProblem(draft({ startTime: "" }), VOCAB), "Pick a start time.");
assert.equal(
  bookingProblem(draft({ paymentMethod: "package", packageMode: "new", newPackage: { ...EMPTY_NEW_PACKAGE, name: "Ten pack", sessions: 10 } }), VOCAB),
  "Pick a package template or fill in the custom package details.",
  "a custom package needs an expiry",
);
assert.equal(bookingProblem(draft({ paymentMethod: "package", packageMode: "new", newPackage: { ...EMPTY_NEW_PACKAGE, templateId: 3 } }), VOCAB), null);
assert.equal(bookingProblem(draft({ clientId: null }), { service: "Class", member: "Member" }), "Pick a member.", "venue words");

assert.equal(readyToBook(draft()), true);
assert.equal(readyToBook(draft({ clientId: null })), false);
assert.equal(readyToBook(draft({ clientMode: "walk_in", walkIn: { firstName: "Sam", lastName: "", email: "", phone: "" } })), true);
assert.equal(readyToBook(draft({ therapyIds: [] })), false);
assert.equal(readyToBook(draft({ startTime: "" })), false);

console.log("booking bookingPayload: all checks passed.");
```

`app/src/app/api/appointments/route.test.ts`:

```ts
// Run: npm test -- src/app/api/appointments/route.test.ts
//
// The booking screen's body (lib/booking/bookingPayload) against the REAL
// POST /api/appointments on a scratch tenant: the redesign must not change
// what the server records for any path. Checked here: an existing client
// paying cash, a walk-in, a prepaid package (valued at what the package cost
// per session, not the list price), a new package sold at booking, and the
// slot check refusing a clash with its own message. Only the auth gate is
// stubbed (there is no request session in this runner).
import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import { createRequire } from "node:module";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/api/guard") return { guard: async () => null };
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in appointments route.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../../../lib/db/control") as typeof import("@/lib/db/control");
  const { runWithTenant } = requireLocal("../../../lib/db/tenant") as typeof import("@/lib/db/tenant");
  const { db } = requireLocal("../../../lib/db") as typeof import("@/lib/db");
  const schema = requireLocal("../../../lib/db/schema") as typeof import("@/lib/db/schema");
  const { and, eq } = requireLocal("drizzle-orm") as typeof import("drizzle-orm");
  const { EMPTY_NEW_PACKAGE, bookingFormData } = requireLocal("../../../lib/booking/bookingPayload") as typeof import("@/lib/booking/bookingPayload");
  const { POST } = requireLocal("./route") as typeof import("./route");
  type BookingDraft = import("@/lib/booking/bookingPayload").BookingDraft;

  const slug = "appointments-route-test";
  // A fresh tenant database every run: rows left by an earlier run would
  // clash with this one's bookings.
  const tenantDir = path.join(process.cwd(), "data", "tenants", slug);
  fs.rmSync(tenantDir, { recursive: true, force: true });
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const { id: tid } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Appointments Route Test", `tenants/${slug}/${slug}.db`) as { id: number };

  const post = async (d: BookingDraft) => {
    const res = await POST(new Request("http://localhost/api/appointments", { method: "POST", body: bookingFormData(d) }) as never);
    return { status: res.status, body: (await res.json()) as { ok: boolean; id?: number; error?: string } };
  };

  try {
    await runWithTenant(tid, async () => {
      const [therapy] = db
        .insert(schema.therapies)
        .values({ name: "Deep tissue massage", colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: 80 })
        .returning()
        .all();
      const [client] = db.insert(schema.clients).values({ firstName: "Test", lastName: "Client", phone: "0800 000 000" }).returning().all();
      const [pkg] = db
        .insert(schema.packages)
        .values({
          clientId: client.id,
          therapyId: therapy.id,
          packageName: "Test offer",
          totalSessions: 1,
          pricePaidEur: 64,
          purchaseDate: "2029-12-01",
          expiryDate: "2030-12-31",
        })
        .returning()
        .all();
      const [tpl] = db
        .insert(schema.packageTemplates)
        .values({ name: "Five pack", therapyId: therapy.id, totalSessions: 5, priceEur: 350, validityMonths: 6 })
        .returning()
        .all();

      // 2030-01-07 is a Monday: open 08:00-20:00 on the default hours.
      const draft = (over: Partial<BookingDraft>): BookingDraft => ({
        clientMode: "existing",
        clientId: client.id,
        walkIn: { firstName: "", lastName: "", email: "", phone: "" },
        therapyIds: [therapy.id],
        date: "2030-01-07",
        startTime: "09:00",
        durationMinutes: 60,
        priceEur: 80,
        paymentMethod: "cash",
        packageMode: "existing",
        packageId: null,
        newPackage: EMPTY_NEW_PACKAGE,
        voucherCode: "",
        secondaryPaymentMethod: null,
        notes: "",
        ...over,
      });
      const apptOf = (id: number) => db.select().from(schema.appointments).where(eq(schema.appointments.id, id)).get()!;
      const paymentsOf = (id: number) => db.select().from(schema.payments).where(eq(schema.payments.appointmentId, id)).all();

      // Existing client, cash.
      const cash = await post(draft({ notes: "First visit" }));
      assert.equal(cash.status, 200, JSON.stringify(cash.body));
      const cashAppt = apptOf(cash.body.id!);
      assert.deepEqual(
        [cashAppt.clientId, cashAppt.startTime, cashAppt.endTime, cashAppt.totalPriceEur, cashAppt.notes, cashAppt.status],
        [client.id, "09:00", "10:00", 80, "First visit", "scheduled"],
      );
      assert.deepEqual(paymentsOf(cash.body.id!).map((p) => [p.paymentMethod, p.amountEur]), [["cash", 80]]);

      // The same treatment at an overlapping time is refused by the slot check.
      const clash = await post(draft({ startTime: "09:30" }));
      assert.equal(clash.status, 409, "a clashing time is refused");
      assert.equal(clash.body.ok, false);
      assert.ok(clash.body.error && clash.body.error.length > 0, "with the slot check's own message");

      // Walk-in.
      const walk = await post(
        draft({ clientMode: "walk_in", clientId: null, startTime: "10:00", walkIn: { firstName: "Walk", lastName: "", email: "", phone: "" } }),
      );
      assert.equal(walk.status, 200, JSON.stringify(walk.body));
      const walker = db.select().from(schema.clients).where(eq(schema.clients.id, apptOf(walk.body.id!).clientId)).get()!;
      assert.deepEqual([walker.firstName, walker.lastName, walker.phone], ["Walk", "—", "—"]);

      // Prepaid package: valued at EUR 64, a EUR 0 package payment.
      const prepaid = await post(draft({ startTime: "11:00", paymentMethod: "package", packageId: pkg.id, priceEur: 64 }));
      assert.equal(prepaid.status, 200, JSON.stringify(prepaid.body));
      assert.equal(apptOf(prepaid.body.id!).totalPriceEur, 64);
      assert.deepEqual(paymentsOf(prepaid.body.id!).map((p) => [p.paymentMethod, p.amountEur, p.packageId]), [["package", 0, pkg.id]]);

      // That package's one session is now booked: a second use is refused.
      const again = await post(draft({ startTime: "13:00", paymentMethod: "package", packageId: pkg.id, priceEur: 64 }));
      assert.equal(again.status, 409, "a package with its session already booked is refused");

      // New package sold at booking, from a template.
      const sold = await post(
        draft({ startTime: "14:00", paymentMethod: "package", packageMode: "new", newPackage: { ...EMPTY_NEW_PACKAGE, templateId: tpl.id, paymentMethod: "card" } }),
      );
      assert.equal(sold.status, 200, JSON.stringify(sold.body));
      assert.equal(apptOf(sold.body.id!).totalPriceEur, 0, "the session is covered by the new package");
      const soldPayments = paymentsOf(sold.body.id!);
      assert.ok(soldPayments.some((p) => p.paymentMethod === "card" && p.amountEur === 350), "the package sale is recorded");
      const created = db
        .select()
        .from(schema.packages)
        .where(and(eq(schema.packages.clientId, client.id), eq(schema.packages.packageName, "Five pack")))
        .get();
      assert.ok(created && created.totalSessions === 5, "the package is created for the client");
    });
    console.log("appointments POST: booking screen payloads accepted, 6 paths checked.");
  } finally {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    fs.rmSync(tenantDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test -- src/lib/booking/bookingPayload.test.ts` and `npm test -- src/app/api/appointments/route.test.ts`
Expected: FAIL, "Cannot find module './bookingPayload'" / "Cannot find module '../../../lib/booking/bookingPayload'".

- [ ] **Step 3: Implement**

`app/src/lib/booking/bookingPayload.ts`:

```ts
/**
 * Pure: the booking screen's state as the multipart body POST /api/appointments
 * has always taken. The field names and when each is sent are the contract;
 * they match what the old BookingForm sent, field for field, so every server
 * path (existing client / walk-in, package use, new-package sign-up, voucher
 * and split payment) keeps working unchanged.
 */

import type { PackageMode, PaymentMethod } from "./packageChoiceModel";
import type { SecondaryMethod } from "./summaryModel";

export interface NewPackageDraft {
  /** A package template, or null for a custom package. */
  templateId: number | null;
  name: string;
  sessions: number;
  priceEur: number;
  expiry: string;
  /** How the package itself is paid for. */
  paymentMethod: SecondaryMethod;
}

export interface BookingDraft {
  clientMode: "existing" | "walk_in";
  clientId: number | null;
  walkIn: { firstName: string; lastName: string; email: string; phone: string };
  therapyIds: number[];
  date: string;
  startTime: string;
  durationMinutes: number;
  priceEur: number;
  paymentMethod: PaymentMethod;
  packageMode: PackageMode;
  packageId: number | null;
  newPackage: NewPackageDraft;
  voucherCode: string;
  /** Only when the voucher pays less than the session (split payment). */
  secondaryPaymentMethod: SecondaryMethod | null;
  notes: string;
}

export const EMPTY_NEW_PACKAGE: NewPackageDraft = {
  templateId: null,
  name: "",
  sessions: 0,
  priceEur: 0,
  expiry: "",
  paymentMethod: "card",
};

const HM = /^\d{2}:\d{2}$/;

export function bookingEntries(d: BookingDraft): [string, string][] {
  const e: [string, string][] = [];
  for (const id of d.therapyIds) e.push(["therapyIds", String(id)]);
  if (d.clientMode === "existing") {
    if (d.clientId != null) e.push(["clientId", String(d.clientId)]);
  } else {
    e.push(["walkInFirstName", d.walkIn.firstName.trim()]);
    e.push(["walkInLastName", d.walkIn.lastName.trim()]);
    e.push(["walkInEmail", d.walkIn.email.trim()]);
    e.push(["walkInPhone", d.walkIn.phone.trim()]);
  }
  e.push(["date", d.date]);
  e.push(["startTime", d.startTime]);
  e.push(["durationMinutes", String(d.durationMinutes)]);
  const signUp = d.paymentMethod === "package" && d.packageMode === "new";
  // A new package covers the session (EUR 0); the API records the package price as the sale.
  e.push(["totalPriceEur", signUp ? "0" : String(d.priceEur)]);
  e.push(["paymentMethod", d.paymentMethod]);
  if (d.paymentMethod === "package") {
    e.push(["packageMode", d.packageMode]);
    if (d.packageMode === "existing") {
      if (d.packageId != null) e.push(["packageId", String(d.packageId)]);
    } else {
      e.push(["newPackagePaymentMethod", d.newPackage.paymentMethod]);
      if (d.newPackage.templateId != null) {
        e.push(["newPackageTemplateId", String(d.newPackage.templateId)]);
      } else {
        e.push(["newPackageName", d.newPackage.name.trim()]);
        e.push(["newPackageSessions", String(d.newPackage.sessions)]);
        e.push(["newPackagePriceEur", String(d.newPackage.priceEur)]);
        e.push(["newPackageExpiry", d.newPackage.expiry]);
      }
    }
  }
  if (d.paymentMethod === "voucher" && d.voucherCode) {
    e.push(["voucherCode", d.voucherCode]);
    if (d.secondaryPaymentMethod) e.push(["secondaryPaymentMethod", d.secondaryPaymentMethod]);
  }
  e.push(["notes", d.notes]);
  e.push(["status", "scheduled"]);
  return e;
}

export function bookingFormData(d: BookingDraft): FormData {
  const fd = new FormData();
  for (const [k, v] of bookingEntries(d)) fd.append(k, v);
  return fd;
}

/** Client, treatment and a time are set: the Book button can be pressed. */
export function readyToBook(d: BookingDraft): boolean {
  const client = d.clientMode === "existing" ? d.clientId != null : d.walkIn.firstName.trim() !== "";
  return client && d.therapyIds.length > 0 && d.durationMinutes > 0 && HM.test(d.startTime);
}

/** Why this booking cannot be sent yet, in the words the toast shows, or null. */
export function bookingProblem(d: BookingDraft, vocab: { service: string; member: string }): string | null {
  if (d.therapyIds.length === 0 || !(d.durationMinutes > 0)) return `Pick a ${vocab.service.toLowerCase()}.`;
  if (d.clientMode === "existing" && d.clientId == null) return `Pick a ${vocab.member.toLowerCase()}.`;
  if (d.clientMode === "walk_in" && !d.walkIn.firstName.trim()) return `Enter the walk-in ${vocab.member.toLowerCase()}'s first name.`;
  if (!HM.test(d.startTime)) return "Pick a start time.";
  if (
    d.paymentMethod === "package" &&
    d.packageMode === "new" &&
    d.newPackage.templateId == null &&
    (!d.newPackage.name.trim() || d.newPackage.sessions <= 0 || !d.newPackage.expiry)
  ) {
    return "Pick a package template or fill in the custom package details.";
  }
  return null;
}
```

- [ ] **Step 4: Run them to see them pass (run the route test twice: it must pass on a rerun)**

Expected: "booking bookingPayload: all checks passed." and "appointments POST: booking screen payloads accepted, 6 paths checked." on both runs.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/booking/bookingPayload.ts app/src/lib/booking/bookingPayload.test.ts app/src/app/api/appointments/route.test.ts
git commit -m "feat(booking): the booking screen's POST body, contract-tested against the unchanged appointments POST

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: GET /api/appointments/free-slots

**Files:**
- Create: `app/src/app/api/appointments/free-slots/route.ts`, `app/src/app/api/appointments/free-slots/route.test.ts`

**Interfaces:**
- Consumes: `BOOKING_STEP_MINUTES`, `blocksCoverDay`, `slotCandidates` (Task 2); existing `guard` (`@/lib/api/guard`), `blockOutsForDate`, `checkBookingSlot`, `dayWindow` (`@/lib/schedule`).
- Produces: `GET /api/appointments/free-slots?date=YYYY-MM-DD&duration=N&therapyIds=1,2` (staff only) returning `{ ok: true, date, closed: boolean, open: "HH:mm", close: "HH:mm", stepMinutes: 15, slots: { time: "HH:mm"; free: boolean; reason?: string }[] }`, or `400 { ok: false, error }` for a bad date or length. Task 8's `useFreeSlots` reads exactly this shape.

- [ ] **Step 1: Write the failing test**

`app/src/app/api/appointments/free-slots/route.test.ts`:

```ts
// Run: npm test -- src/app/api/appointments/free-slots/route.test.ts
//
// The free-slots route on a scratch tenant, against real opening hours,
// appointments and block-outs: a start that would clash with an existing
// booking is marked taken (with the slot check's reason), a closed day and a
// fully blocked day come back closed, and a different treatment at the same
// time is still free. Only the auth gate is stubbed.
import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import { createRequire } from "node:module";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/api/guard") return { guard: async () => null };
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in free-slots route.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

interface Body {
  ok: boolean;
  error?: string;
  closed?: boolean;
  open?: string;
  close?: string;
  stepMinutes?: number;
  slots?: { time: string; free: boolean; reason?: string }[];
}

(async () => {
  const { controlSqlite } = requireLocal("../../../../lib/db/control") as typeof import("@/lib/db/control");
  const { runWithTenant } = requireLocal("../../../../lib/db/tenant") as typeof import("@/lib/db/tenant");
  const { db } = requireLocal("../../../../lib/db") as typeof import("@/lib/db");
  const schema = requireLocal("../../../../lib/db/schema") as typeof import("@/lib/db/schema");
  const { GET } = requireLocal("./route") as typeof import("./route");

  const slug = "free-slots-route-test";
  const tenantDir = path.join(process.cwd(), "data", "tenants", slug);
  fs.rmSync(tenantDir, { recursive: true, force: true });
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const { id: tid } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Free Slots Route Test", `tenants/${slug}/${slug}.db`) as { id: number };

  const get = async (query: string) => {
    const res = await GET({ nextUrl: new URL(`http://localhost/api/appointments/free-slots?${query}`) } as never);
    return { status: res.status, body: (await res.json()) as Body };
  };

  try {
    await runWithTenant(tid, async () => {
      const [massage, hbot] = db
        .insert(schema.therapies)
        .values([
          { name: "Deep tissue massage", colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: 80 },
          { name: "HBOT", colourHex: "#888888", defaultDurationMinutes: 60, defaultPriceEur: 95 },
        ])
        .returning()
        .all();
      const [client] = db.insert(schema.clients).values({ firstName: "Test", lastName: "Client", phone: "0800 000 000" }).returning().all();
      // 2030-01-07 is a Monday (default hours 08:00-20:00); 2030-01-06 a Sunday (closed).
      db.insert(schema.appointments)
        .values({
          clientId: client.id,
          date: "2030-01-07",
          startTime: "10:00",
          endTime: "11:00",
          status: "scheduled",
          therapyIds: JSON.stringify([massage.id]),
          totalPriceEur: 80,
        })
        .run();
      // A cancelled booking holds nothing.
      db.insert(schema.appointments)
        .values({
          clientId: client.id,
          date: "2030-01-07",
          startTime: "15:00",
          endTime: "16:00",
          status: "cancelled",
          therapyIds: JSON.stringify([massage.id]),
          totalPriceEur: 80,
        })
        .run();
      // Tuesday 2030-01-08 is blocked all day.
      db.insert(schema.blockOuts).values({ type: "one_off", date: "2030-01-08", startTime: "00:00", endTime: "23:59", reason: "Staff training" }).run();

      const monday = await get(`date=2030-01-07&duration=60&therapyIds=${massage.id}`);
      assert.equal(monday.status, 200);
      assert.equal(monday.body.ok, true);
      assert.equal(monday.body.closed, false);
      assert.deepEqual([monday.body.open, monday.body.close, monday.body.stepMinutes], ["08:00", "20:00", 15]);
      const slots = new Map(monday.body.slots!.map((s) => [s.time, s]));
      assert.equal(monday.body.slots![0].time, "08:00", "first start is opening time");
      assert.equal(monday.body.slots![monday.body.slots!.length - 1].time, "19:00", "last start ends at closing");
      assert.equal(monday.body.slots!.length, 45, "08:00 to 19:00 every 15 minutes");
      assert.equal(slots.get("09:00")!.free, true, "ending as the booking starts is fine");
      assert.equal(slots.get("09:15")!.free, false, "overlapping the 10:00 booking is taken");
      assert.equal(slots.get("10:00")!.free, false, "the clashing start is taken");
      assert.ok((slots.get("10:00")!.reason ?? "").length > 0, "a taken start says why");
      assert.equal(slots.get("10:45")!.free, false);
      assert.equal(slots.get("11:00")!.free, true, "starting as the booking ends is fine");
      assert.equal(slots.get("15:00")!.free, true, "a cancelled booking holds nothing");

      const otherTreatment = await get(`date=2030-01-07&duration=60&therapyIds=${hbot.id}`);
      assert.equal(new Map(otherTreatment.body.slots!.map((s) => [s.time, s])).get("10:00")!.free, true, "a different treatment does not clash");

      const sunday = await get(`date=2030-01-06&duration=60&therapyIds=${massage.id}`);
      assert.deepEqual([sunday.body.ok, sunday.body.closed, sunday.body.slots], [true, true, []], "a closed day has no times");

      const blocked = await get(`date=2030-01-08&duration=60&therapyIds=${massage.id}`);
      assert.deepEqual([blocked.body.closed, blocked.body.slots], [true, []], "a day blocked end to end is closed");

      const bad = await get("date=07-01-2030&duration=60");
      assert.equal(bad.status, 400);
      assert.equal(bad.body.ok, false);
      assert.equal((await get("date=2030-01-07&duration=0")).status, 400, "no length is refused");
      assert.equal((await get("date=2030-01-07&duration=abc")).status, 400);
    });
    console.log("free-slots route: all checks passed.");
  } finally {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    fs.rmSync(tenantDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- src/app/api/appointments/free-slots/route.test.ts`
Expected: FAIL, "Cannot find module './route'".

- [ ] **Step 3: Implement**

`app/src/app/api/appointments/free-slots/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api/guard";
import { BOOKING_STEP_MINUTES, blocksCoverDay, slotCandidates } from "@/lib/booking/slotModel";
import { blockOutsForDate, checkBookingSlot, dayWindow } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/** The longest session the screen asks about: a whole day. */
const MAX_DURATION = 24 * 60;

/**
 * GET /api/appointments/free-slots?date=YYYY-MM-DD&duration=N&therapyIds=1,2
 *
 * The start times the booking screen offers for one day, each marked free or
 * taken. Free means `checkBookingSlot` accepts it: the SAME check POST
 * /api/appointments runs (opening hours, block-outs, resource limits,
 * buffer), so a time shown as free is a time the booking goes through at.
 * Staff only.
 */
export async function GET(req: NextRequest) {
  const denied = await guard("user");
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const date = sp.get("date") ?? "";
  const duration = Number(sp.get("duration") ?? "");
  const therapyIds = (sp.get("therapyIds") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "Give the date as YYYY-MM-DD." }, { status: 400 });
  }
  if (!Number.isInteger(duration) || duration <= 0 || duration > MAX_DURATION) {
    return NextResponse.json({ ok: false, error: "Give the length in whole minutes." }, { status: 400 });
  }

  const win = dayWindow(date);
  const closed = win.closed || blocksCoverDay(win.open, win.close, blockOutsForDate(date));
  const slots = closed
    ? []
    : slotCandidates(win.open, win.close, duration, BOOKING_STEP_MINUTES).map((time) => {
        const check = checkBookingSlot(date, time, duration, therapyIds);
        return check.ok ? { time, free: true } : { time, free: false, reason: check.reason ?? "Taken." };
      });

  return NextResponse.json({
    ok: true,
    date,
    closed,
    open: win.open,
    close: win.close,
    stepMinutes: BOOKING_STEP_MINUTES,
    slots,
  });
}
```

- [ ] **Step 4: Run it to see it pass (twice)**

Expected: "free-slots route: all checks passed."

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/appointments/free-slots/route.ts app/src/app/api/appointments/free-slots/route.test.ts
git commit -m "feat(booking): free-slots route marks each start free or taken with checkBookingSlot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Stylesheet and the Client card

**Files:**
- Create: `app/src/components/appointments/booking/booking.module.css`
- Create: `app/src/components/appointments/booking/PrepaidBanner.tsx`
- Create: `app/src/components/appointments/booking/ClientCard.tsx`

**Interfaces:**
- Consumes: `searchClients`, `displayName`, `initials`, `clientSubline` (Task 1); `PrepaidOffer`, `offerText` (Task 3); existing `Card`, `CardLabel` (`@/components/ui/Card`), `Input`, `Label` (`@/components/ui/Input`), `useVocab`, type `Client` (`@/lib/db/schema`).
- Produces: `booking.module.css` with every class the later cards use (do not rename classes: Tasks 7-10 import them); `interface WalkIn {firstName; lastName; email; phone}`; `ClientCard(props: {clients; mode: "existing" | "walk_in"; onMode; clientId: number | null; onClientId(id | null); walkIn; onWalkIn; offers: PrepaidOffer[]; usingPackageId: number | null; onUseOffer(offer, use: boolean)})`; `PrepaidBanner(props: {offer; firstName; using; onToggle(use)})`.

The look follows the mockup: card label with the Existing / Walk-in chips (or "Change" once a client is picked) on the right; a 40px rounded avatar with initials, the name, and "phone · Client since 24 Nov 2026"; one green banner per prepaid package with the count in a small square, the sentence, and a "Use it" / "Using it" pill. At 560px and below the banner's button drops under the sentence.

- [ ] **Step 1: Create the stylesheet**

`app/src/components/appointments/booking/booking.module.css`:

```css
/* New booking screen (/appointments/new). Every colour is an app token from
   globals.css / lib/theme.ts, so dark and light both follow the admin theme.
   Selection uses the accent; the prepaid banner and tag use the success
   colour. Controls keep at least 12px of side padding. */

.root {
  --bk-sel: var(--accent);
  --bk-sel-soft: var(--accent-soft);
  --bk-ok: var(--success);
  --bk-ok-soft: var(--success-soft);
  --bk-ok-ink: var(--success);
}
:global(:root[data-theme="light"]) .root {
  /* The dark-tuned green is too light to read as text on a near-white card. */
  --bk-ok-ink: color-mix(in srgb, var(--success) 70%, #000);
}

/* ------------------------------------------------------------- layout */
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 24px;
  align-items: start;
}
.main {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.side {
  position: sticky;
  top: 20px;
}

/* -------------------------------------------------------- card pieces */
.cardHead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.link {
  background: none;
  border: 0;
  padding: 4px 0;
  font: inherit;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: var(--hairline-strong);
}
.link:hover {
  color: var(--text-primary);
}
.muted {
  color: var(--text-tertiary);
  font-size: 13px;
}
.link:focus-visible,
.chip:focus-visible,
.tile:focus-visible,
.day:focus-visible,
.slot:focus-visible,
.segBtn:focus-visible,
.result:focus-visible,
.option:focus-visible {
  outline: 2px solid var(--bk-sel);
  outline-offset: 2px;
}

/* -------------------------------------------------------------- pills */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  padding: 9px 16px;
  min-height: 38px;
  border-radius: 999px;
  border: 1px solid var(--hairline-strong);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s var(--ease), border-color 0.15s var(--ease);
}
.chip:hover {
  border-color: var(--text-tertiary);
}
.chipOn {
  background: var(--bk-sel-soft);
  border-color: var(--bk-sel);
}
.chipOk {
  background: color-mix(in srgb, var(--bk-ok) 18%, transparent);
  border-color: var(--bk-ok);
  color: var(--bk-ok-ink);
}
.chipSm {
  font-size: 12.5px;
  padding: 7px 14px;
  min-height: 34px;
}

/* ------------------------------------------------------------- client */
.who {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--surface-3);
  display: grid;
  place-items: center;
  font-family: var(--font-heading), sans-serif;
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
  flex-shrink: 0;
}
.whoName {
  font-weight: 600;
  font-size: 16px;
  color: var(--text-primary);
}
.whoSub {
  color: var(--text-tertiary);
  font-size: 13px;
}
.results {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.result {
  text-align: left;
  padding: 10px 12px;
  background: transparent;
  border: 1px solid var(--hairline);
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--text-primary);
  font: inherit;
  font-size: 14px;
}
.result:hover {
  border-color: var(--hairline-strong);
}
.resultSub {
  color: var(--text-tertiary);
  margin-left: 8px;
}
.walkGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.prepaid {
  margin-top: 14px;
  border: 1px solid color-mix(in srgb, var(--bk-ok) 45%, transparent);
  background: var(--bk-ok-soft);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  gap: 12px;
  align-items: center;
}
.prepaid + .prepaid {
  margin-top: 8px;
}
.prepaidCount {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--bk-ok) 22%, transparent);
  display: grid;
  place-items: center;
  color: var(--bk-ok-ink);
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}
.prepaidText {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--text-secondary);
}
.prepaidText b {
  color: var(--text-primary);
  font-weight: 600;
}

/* ---------------------------------------------------------- treatment */
.groupSection + .groupSection {
  margin-top: 16px;
}
.group {
  font-size: 12.5px;
  color: var(--text-tertiary);
  margin: 0 0 8px;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}
.tile {
  font: inherit;
  text-align: left;
  border: 1px solid var(--hairline);
  background: var(--surface-2);
  border-radius: 12px;
  padding: 11px 12px;
  min-height: 46px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 4px 8px;
  flex-wrap: wrap;
  color: var(--text-primary);
  transition: border-color 0.15s var(--ease), background-color 0.15s var(--ease);
}
.tile:hover {
  border-color: var(--hairline-strong);
}
.tileOn {
  border-color: var(--bk-sel);
  background: var(--bk-sel-soft);
}
.tileName {
  font-weight: 500;
  font-size: 14px;
}
.tileMeta {
  font-size: 12.5px;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.tag {
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--bk-ok-ink);
  white-space: nowrap;
}
.length {
  display: flex;
  gap: 8px 10px;
  margin-top: 14px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--text-secondary);
}
.seg {
  display: inline-flex;
  flex-wrap: wrap;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  border-radius: 999px;
  padding: 3px;
}
.segBtn {
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 7px 14px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
}
.segBtnOn {
  background: var(--surface-3);
  color: var(--text-primary);
}

/* --------------------------------------------------------------- when */
.days {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 2px 2px 6px;
  margin: -2px -2px 10px;
  scrollbar-width: thin;
}
.day {
  flex: 0 0 auto;
  width: 64px;
  border: 1px solid var(--hairline);
  background: var(--surface-2);
  border-radius: 12px;
  padding: 8px 0;
  text-align: center;
  cursor: pointer;
  font: inherit;
  color: var(--text-primary);
}
.dayName {
  display: block;
  font-size: 11px;
  color: var(--text-tertiary);
}
.dayNum {
  font-family: var(--font-heading), sans-serif;
  font-weight: 600;
  font-size: 17px;
}
.dayOn {
  border-color: var(--bk-sel);
  background: var(--bk-sel-soft);
}
.day:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.period {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 12px 0 8px;
}
.periods > .period:first-child {
  margin-top: 0;
}
.slots {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.slot {
  font: inherit;
  font-size: 13.5px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  border: 1px solid var(--hairline);
  background: var(--surface-2);
  border-radius: 999px;
  padding: 8px 14px;
  min-width: 66px;
  color: var(--text-primary);
  cursor: pointer;
}
.slot:hover:not(:disabled) {
  border-color: var(--hairline-strong);
}
.slotOn {
  border-color: var(--bk-sel);
  background: var(--bk-sel-soft);
}
.slot:disabled {
  color: var(--text-tertiary);
  text-decoration: line-through;
  cursor: not-allowed;
  opacity: 0.55;
}
.hint {
  font-size: 12.5px;
  color: var(--text-tertiary);
  margin-top: 12px;
}
.warn {
  font-size: 12.5px;
  color: var(--warning);
  margin-top: 8px;
}
.inline {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-top: 12px;
}

/* ------------------------------------------------------------ payment */
.links {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
}
.panel {
  margin-top: 14px;
  padding: 14px;
  border: 1px solid var(--hairline);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.option {
  font: inherit;
  text-align: left;
  padding: 10px 12px;
  border: 1px solid var(--hairline);
  background: transparent;
  border-radius: var(--radius);
  cursor: pointer;
  color: var(--text-primary);
  font-size: 14px;
}
.optionOn {
  border-color: var(--bk-sel);
  background: var(--bk-sel-soft);
}
.optionRow {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.optionName {
  font-weight: 500;
}
.optionSub {
  color: var(--text-tertiary);
  font-size: 12px;
  margin-top: 4px;
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fieldGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.full {
  grid-column: 1 / -1;
}
.fieldLabel {
  display: block;
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.msgs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
}
.msgOk {
  color: var(--bk-ok-ink);
  font-weight: 500;
}
.msgWarn {
  color: var(--warning);
}
.msgBad {
  color: var(--danger);
}
.msg {
  color: var(--text-secondary);
}
.split {
  padding: 14px;
  border: 1px solid var(--hairline-strong);
  border-radius: 12px;
  background: var(--warning-soft);
}
.splitTitle {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 6px;
}
.splitText {
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}

/* ------------------------------------------------------------ summary */
.summary {
  background: var(--surface-1);
  border: 1px solid var(--hairline-strong);
  border-radius: 18px;
  padding: 20px;
  box-shadow: var(--shadow-2);
}
.summaryTitle {
  margin: 0 0 14px;
  font-family: var(--font-heading), sans-serif;
  font-weight: 600;
  font-size: 16px;
  color: var(--text-primary);
}
.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-top: 1px solid var(--hairline);
  font-size: 14px;
}
.rowKey {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.rowValue {
  font-weight: 500;
  text-align: right;
  color: var(--text-primary);
  min-width: 0;
  overflow-wrap: anywhere;
}
.rowEmpty {
  color: var(--text-tertiary);
  font-weight: 400;
}
.total {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin: 14px 0 4px;
}
.totalKey {
  color: var(--text-tertiary);
  font-size: 14px;
}
.totalValue {
  font-family: var(--font-heading), sans-serif;
  font-weight: 600;
  font-size: 26px;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.struck {
  text-decoration: line-through;
  color: var(--text-tertiary);
  font-size: 14px;
  font-weight: 400;
  margin-right: 8px;
}
.notePaid {
  font-size: 12.5px;
  color: var(--bk-ok-ink);
}
.noteDue {
  font-size: 12.5px;
  color: var(--text-tertiary);
}
.book {
  width: 100%;
  margin-top: 16px;
}

/* A summary line and the Book button, pinned to the bottom of the screen
   while the form scrolls, when there is no room for the side panel. */
.bar {
  display: none;
  position: sticky;
  bottom: 12px;
  z-index: 20;
  margin-top: 16px;
  align-items: center;
  gap: 12px;
  padding: 12px 12px 12px 16px;
  background: var(--surface-1);
  border: 1px solid var(--hairline-strong);
  border-radius: 16px;
  box-shadow: var(--shadow-2);
}
.barText {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text-secondary);
}
.barTitle {
  display: block;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ------------------------------------------------------ narrow screens */
@media (max-width: 1100px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .side {
    display: none;
  }
  .bar {
    display: flex;
  }
}
@media (max-width: 560px) {
  .walkGrid,
  .fieldGrid {
    grid-template-columns: 1fr;
  }
  .tiles {
    grid-template-columns: 1fr 1fr;
  }
  /* The sentence takes the row; the Use it button drops under it, lined up with the text. */
  .prepaid {
    flex-wrap: wrap;
    row-gap: 10px;
  }
  .prepaidText {
    flex: 1 1 calc(100% - 42px);
  }
  .prepaid .chip {
    margin-left: 42px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chip,
  .tile {
    transition: none;
  }
}
```

- [ ] **Step 2: Create the banner and the card**

`app/src/components/appointments/booking/PrepaidBanner.tsx`:

```tsx
"use client";

import { offerText, type PrepaidOffer } from "@/lib/booking/packageChoiceModel";

import s from "./booking.module.css";

interface Props {
  offer: PrepaidOffer;
  firstName: string;
  /** This package is paying for the booking. */
  using: boolean;
  onToggle: (use: boolean) => void;
}

/** One green line: "Mary has 1 prepaid Deep tissue massage, 60 min, from Black Friday. Use by 1 Mar 2027." */
export function PrepaidBanner({ offer, firstName, using, onToggle }: Props) {
  const text = offerText(offer, firstName);
  return (
    <div className={s.prepaid}>
      <div className={s.prepaidCount} aria-hidden>
        {offer.count}
      </div>
      <div className={s.prepaidText}>
        {text.lead}
        <b>{text.strong}</b>
        {text.rest}
      </div>
      <button
        type="button"
        aria-pressed={using}
        className={`${s.chip} ${s.chipSm} ${using ? s.chipOk : ""}`}
        onClick={() => onToggle(!using)}
      >
        {using ? "Using it" : "Use it"}
      </button>
    </div>
  );
}
```

`app/src/components/appointments/booking/ClientCard.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";

import { useVocab } from "@/components/providers/VocabProvider";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { clientSubline, displayName, initials, searchClients } from "@/lib/booking/clientSearch";
import type { PrepaidOffer } from "@/lib/booking/packageChoiceModel";
import type { Client } from "@/lib/db/schema";

import { PrepaidBanner } from "./PrepaidBanner";
import s from "./booking.module.css";

export interface WalkIn {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

interface Props {
  clients: Client[];
  mode: "existing" | "walk_in";
  onMode: (mode: "existing" | "walk_in") => void;
  clientId: number | null;
  onClientId: (id: number | null) => void;
  walkIn: WalkIn;
  onWalkIn: (next: WalkIn) => void;
  /** One per usable prepaid package the selected client has. */
  offers: PrepaidOffer[];
  /** The package paying for this booking, when one is. */
  usingPackageId: number | null;
  onUseOffer: (offer: PrepaidOffer, use: boolean) => void;
}

/** Card 1: who the booking is for. Existing client (search) or walk-in, plus their prepaid sessions. */
export function ClientCard({ clients, mode, onMode, clientId, onClientId, walkIn, onWalkIn, offers, usingPackageId, onUseOffer }: Props) {
  const vocab = useVocab();
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchClients(clients, query), [clients, query]);
  const selected = clientId != null ? clients.find((c) => c.id === clientId) ?? null : null;
  const member = vocab.member.toLowerCase();

  return (
    <Card>
      <div className={s.cardHead}>
        <CardLabel style={{ marginBottom: 0 }}>{vocab.member}</CardLabel>
        {mode === "existing" && selected ? (
          <button type="button" className={s.link} onClick={() => onClientId(null)}>
            Change
          </button>
        ) : (
          <div className={s.chips} role="group" aria-label={`${vocab.member} type`}>
            {(
              [
                ["existing", "Existing"],
                ["walk_in", "Walk-in"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                className={`${s.chip} ${s.chipSm} ${mode === value ? s.chipOn : ""}`}
                onClick={() => onMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === "existing" ? (
        selected ? (
          <>
            <div className={s.who}>
              <div className={s.avatar} aria-hidden>
                {initials(selected.firstName, selected.lastName)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className={s.whoName}>{displayName(selected.firstName, selected.lastName)}</div>
                <div className={s.whoSub}>{clientSubline(selected.phone, selected.createdAt, vocab.member)}</div>
              </div>
            </div>
            {offers.map((offer) => (
              <PrepaidBanner
                key={offer.packageId}
                offer={offer}
                firstName={selected.firstName}
                using={usingPackageId === offer.packageId}
                onToggle={(use) => onUseOffer(offer, use)}
              />
            ))}
          </>
        ) : (
          <>
            <Label htmlFor="booking-client-search" srOnly>
              Search {member}s
            </Label>
            <Input
              id="booking-client-search"
              placeholder={`Search ${member} by name, email or phone`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
            <div className={s.results}>
              {results.map((c) => (
                <button key={c.id} type="button" className={s.result} onClick={() => onClientId(c.id)}>
                  {displayName(c.firstName, c.lastName)}
                  <span className={s.resultSub}>{c.phone}</span>
                </button>
              ))}
              {results.length === 0 && <div className={s.muted}>No matches.</div>}
            </div>
          </>
        )
      ) : (
        <>
          <p className={s.muted} style={{ margin: "0 0 12px" }}>
            For voucher redemptions or one-off visits. A {member} record is made from what you fill in. Only the first name is needed.
          </p>
          <div className={s.walkGrid}>
            <div>
              <Label htmlFor="walkInFirstName" srOnly>
                First name
              </Label>
              <Input
                id="walkInFirstName"
                placeholder="First name *"
                value={walkIn.firstName}
                onChange={(e) => onWalkIn({ ...walkIn, firstName: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="walkInLastName" srOnly>
                Last name
              </Label>
              <Input
                id="walkInLastName"
                placeholder="Last name"
                value={walkIn.lastName}
                onChange={(e) => onWalkIn({ ...walkIn, lastName: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="walkInEmail" srOnly>
                Email (optional)
              </Label>
              <Input
                id="walkInEmail"
                type="email"
                placeholder="Email (optional)"
                value={walkIn.email}
                onChange={(e) => onWalkIn({ ...walkIn, email: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="walkInPhone" srOnly>
                Phone (optional)
              </Label>
              <Input
                id="walkInPhone"
                placeholder="Phone (optional)"
                value={walkIn.phone}
                onChange={(e) => onWalkIn({ ...walkIn, phone: e.target.value })}
              />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run (from `app/`): `npm run typecheck` then `npx eslint src/components/appointments/booking`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/appointments/booking/booking.module.css app/src/components/appointments/booking/PrepaidBanner.tsx app/src/components/appointments/booking/ClientCard.tsx
git commit -m "feat(booking): booking screen stylesheet and the Client card with prepaid banners

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The Treatment card

**Files:**
- Create: `app/src/components/appointments/booking/TreatmentCard.tsx`

**Interfaces:**
- Consumes: `familyOf`, `filterGroups`, `lengthLabel`, `pickOption`, `priceHint`, `TreatmentGroup` (Task 1); `booking.module.css` classes `groupSection`, `group`, `tiles`, `tile`, `tileOn`, `tileName`, `tileMeta`, `tag`, `length`, `seg`, `segBtn`, `segBtnOn`, `muted` (Task 6); existing `Card`, `CardLabel`, `Input`, `Label`, `useVocab`, type `Therapy`.
- Produces: `TreatmentCard(props: {groups: TreatmentGroup<Therapy>[]; therapyId: number | null; onPick(therapyId: number); prepaidTherapyIds: ReadonlySet<number>})`.

Search box, then each group with its heading (no heading when the only group is "Other"), tiles in an auto-fill grid (min 200px, two columns at 560px and below). A tile shows its label and either "PREPAID" (when the client has a usable package for any of its lengths) or the price hint. Clicking a tile picks the prepaid length if there is one, else the default length. A selected tile with several lengths shows the Length switch under the list.

- [ ] **Step 1: Create the card**

`app/src/components/appointments/booking/TreatmentCard.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";

import { useVocab } from "@/components/providers/VocabProvider";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import {
  familyOf,
  filterGroups,
  lengthLabel,
  pickOption,
  priceHint,
  type TreatmentGroup,
} from "@/lib/booking/treatmentGroups";
import type { Therapy } from "@/lib/db/schema";

import s from "./booking.module.css";

interface Props {
  groups: TreatmentGroup<Therapy>[];
  therapyId: number | null;
  onPick: (therapyId: number) => void;
  /** Treatments the client has a usable prepaid session for. */
  prepaidTherapyIds: ReadonlySet<number>;
}

/** Card 2: the treatment, grouped, with one tile per treatment and a Length switch for 30/60-minute versions. */
export function TreatmentCard({ groups, therapyId, onPick, prepaidTherapyIds }: Props) {
  const vocab = useVocab();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterGroups(groups, query), [groups, query]);
  const selected = familyOf(groups, therapyId);
  // One "Other" group alone is a business the name patterns do not know: no heading.
  const headings = !(groups.length === 1 && groups[0].name === "Other");

  return (
    <Card>
      <CardLabel>{vocab.service}</CardLabel>
      <Label htmlFor="booking-treatment-search" srOnly>
        Search {vocab.services.toLowerCase()}
      </Label>
      <Input
        id="booking-treatment-search"
        placeholder={`Search ${vocab.services.toLowerCase()}`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
        style={{ marginBottom: 14 }}
      />

      {shown.length === 0 && <div className={s.muted}>No {vocab.services.toLowerCase()} match.</div>}

      {shown.map((group) => (
        <section key={group.name} className={s.groupSection} aria-label={headings ? group.name : undefined}>
          {headings && <div className={s.group}>{group.name}</div>}
          <div className={s.tiles}>
            {group.families.map((family) => {
              const on = selected?.key === family.key;
              const prepaid = family.options.some((o) => prepaidTherapyIds.has(o.id));
              return (
                <button
                  key={family.key}
                  type="button"
                  aria-pressed={on}
                  title={family.name}
                  className={`${s.tile} ${on ? s.tileOn : ""}`}
                  onClick={() => {
                    if (!on) onPick(pickOption(family, prepaidTherapyIds).id);
                  }}
                >
                  <span className={s.tileName}>{family.label}</span>
                  {prepaid ? <span className={s.tag}>PREPAID</span> : <span className={s.tileMeta}>{priceHint(family)}</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {selected && selected.options.length > 1 && (
        <div className={s.length}>
          <span id="booking-length-label">Length</span>
          <div className={s.seg} role="group" aria-labelledby="booking-length-label">
            {selected.options.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={option.id === therapyId}
                className={`${s.segBtn} ${option.id === therapyId ? s.segBtnOn : ""}`}
                onClick={() => onPick(option.id)}
              >
                {lengthLabel(option)}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck` then `npx eslint src/components/appointments/booking`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/appointments/booking/TreatmentCard.tsx
git commit -m "feat(booking): grouped Treatment card with collapsed lengths and a Length switch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The When card

**Files:**
- Create: `app/src/components/appointments/booking/useFreeSlots.ts`
- Create: `app/src/components/appointments/booking/WhenCard.tsx`

**Interfaces:**
- Consumes: the free-slots response shape (Task 5); `chipTime`, `clock12`, `weekdayLong` (Task 1); `groupByPeriod`, `onGrid`, `StripDay` (Task 2); CSS classes `cardHead`, `link`, `inline`, `days`, `day`, `dayOn`, `dayName`, `dayNum`, `periods`, `period`, `slots`, `slot`, `slotOn`, `hint`, `warn`, `muted` (Task 6).
- Produces: `interface FreeSlotsDay`, `type FreeSlotsState = {status: "idle"} | {status: "loading"} | {status: "ready"; day: FreeSlotsDay} | {status: "error"}`, `useFreeSlots(date, durationMinutes, therapyIds: number[]): FreeSlotsState`; `WhenCard(props: {strip: StripDay[]; date; onDate(date); startTime; onStartTime(time); durationMinutes; therapyIds: number[]})`.

The strip of 14 day buttons (closed days disabled and dimmed), then the day's times grouped Morning / Afternoon / Evening, free ones selectable, taken ones struck through and disabled (their reason in the title). The hint line: "Free times for a 60-minute session. Thursday: open 9am to 7pm." or "Thursday is closed.". "Other date" in the card header opens a date field; "Other time" opens a time field for any start. A picked time that turns out taken for the current length shows a warning line with the slot check's reason.

- [ ] **Step 1: Create the hook and the card**

`app/src/components/appointments/booking/useFreeSlots.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

/** GET /api/appointments/free-slots */
export interface FreeSlotsDay {
  ok: true;
  date: string;
  closed: boolean;
  open: string;
  close: string;
  stepMinutes: number;
  slots: { time: string; free: boolean; reason?: string }[];
}

export type FreeSlotsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; day: FreeSlotsDay }
  | { status: "error" };

/** The day's start times for this length and these treatments. Idle until both are known. */
export function useFreeSlots(date: string, durationMinutes: number, therapyIds: number[]): FreeSlotsState {
  const [state, setState] = useState<FreeSlotsState>({ status: "idle" });
  const ids = therapyIds.join(",");

  useEffect(() => {
    if (!date || !(durationMinutes > 0) || !ids) {
      setState({ status: "idle" });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: "loading" });
    const qs = new URLSearchParams({ date, duration: String(durationMinutes), therapyIds: ids });
    fetch(`/api/appointments/free-slots?${qs.toString()}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d: FreeSlotsDay | { ok: false }) => setState(d.ok ? { status: "ready", day: d } : { status: "error" }))
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ status: "error" });
      });
    return () => ctrl.abort();
  }, [date, durationMinutes, ids]);

  return state;
}
```

`app/src/components/appointments/booking/WhenCard.tsx`:

```tsx
"use client";

import { useState } from "react";

import { useVocab } from "@/components/providers/VocabProvider";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { chipTime, clock12, weekdayLong } from "@/lib/booking/format";
import { groupByPeriod, onGrid, type StripDay } from "@/lib/booking/slotModel";

import s from "./booking.module.css";
import { useFreeSlots } from "./useFreeSlots";

interface Props {
  strip: StripDay[];
  date: string;
  onDate: (date: string) => void;
  startTime: string;
  onStartTime: (time: string) => void;
  durationMinutes: number;
  therapyIds: number[];
}

/** Card 3: a strip of days, then that day's start times, free or taken, for the chosen treatment and length. */
export function WhenCard({ strip, date, onDate, startTime, onStartTime, durationMinutes, therapyIds }: Props) {
  const vocab = useVocab();
  const slots = useFreeSlots(date, durationMinutes, therapyIds);
  const inStrip = strip.some((d) => d.date === date);
  const [otherDate, setOtherDate] = useState(!inStrip);
  const [otherTime, setOtherTime] = useState(Boolean(startTime) && !onGrid(startTime));

  const day = slots.status === "ready" ? slots.day : null;
  const picked = day?.slots.find((x) => x.time === startTime) ?? null;
  const freeCount = day ? day.slots.filter((x) => x.free).length : 0;

  return (
    <Card>
      <div className={s.cardHead}>
        <CardLabel style={{ marginBottom: 0 }}>When</CardLabel>
        <button type="button" className={s.link} onClick={() => setOtherDate((v) => !v)} aria-expanded={otherDate}>
          Other date
        </button>
      </div>

      {otherDate && (
        <div className={s.inline} style={{ marginTop: 0, marginBottom: 12 }}>
          <Label htmlFor="booking-date" srOnly>
            Date
          </Label>
          <Input id="booking-date" type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} style={{ width: 200 }} />
        </div>
      )}

      <div className={s.days} role="group" aria-label="Day">
        {strip.map((d) => (
          <button
            key={d.date}
            type="button"
            disabled={d.closed}
            aria-pressed={d.date === date}
            aria-label={`${weekdayLong(d.date)} ${d.day}${d.closed ? ", closed" : ""}`}
            className={`${s.day} ${d.date === date ? s.dayOn : ""}`}
            onClick={() => onDate(d.date)}
          >
            <span className={s.dayName}>{d.weekday}</span>
            <span className={s.dayNum}>{d.day}</span>
          </button>
        ))}
      </div>

      {slots.status === "idle" && <div className={s.muted}>Pick a {vocab.service.toLowerCase()} to see the free times.</div>}
      {slots.status === "loading" && <div className={s.muted}>Finding free times.</div>}
      {slots.status === "error" && <div className={s.warn}>Could not load the free times. Type a time below.</div>}

      {day && !day.closed && (
        <div className={s.periods}>
          {groupByPeriod(day.slots).map((run) => (
            <div key={run.period}>
              <div className={s.period}>{run.period}</div>
              <div className={s.slots}>
                {run.slots.map((slot) => (
                  <button
                    key={slot.time}
                    type="button"
                    disabled={!slot.free}
                    aria-pressed={slot.time === startTime}
                    title={slot.free ? undefined : slot.reason}
                    className={`${s.slot} ${slot.time === startTime ? s.slotOn : ""}`}
                    onClick={() => onStartTime(slot.time)}
                  >
                    {chipTime(slot.time)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {day && (
        <div className={s.hint}>
          {day.closed
            ? `${weekdayLong(date)} is closed.`
            : `Free times for a ${durationMinutes}-minute session. ${weekdayLong(date)}: open ${clock12(day.open)} to ${clock12(day.close)}.`}
          {!day.closed && freeCount === 0 ? " Nothing free for this length." : ""}
        </div>
      )}
      {picked && !picked.free && (
        <div className={s.warn}>
          {chipTime(startTime)} is taken for this length. {picked.reason}
        </div>
      )}

      <div className={s.inline}>
        {otherTime ? (
          <>
            <Label htmlFor="booking-time" srOnly>
              Start time
            </Label>
            <Input id="booking-time" type="time" value={startTime} onChange={(e) => onStartTime(e.target.value)} style={{ width: 160 }} />
            <span className={s.muted}>Any start time. The booking is still checked when you book.</span>
          </>
        ) : (
          <button type="button" className={s.link} onClick={() => setOtherTime(true)}>
            Other time
          </button>
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck` then `npx eslint src/components/appointments/booking`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/appointments/booking/useFreeSlots.ts app/src/components/appointments/booking/WhenCard.tsx
git commit -m "feat(booking): When card with a 14-day strip and free or taken start times

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The Payment card

**Files:**
- Create: `app/src/components/appointments/booking/useVoucherLookup.ts`
- Create: `app/src/components/appointments/booking/VoucherPanel.tsx`
- Create: `app/src/components/appointments/booking/NewPackagePanel.tsx`
- Create: `app/src/components/appointments/booking/PaymentCard.tsx`

**Interfaces:**
- Consumes: `voucherInfoFrom`, `VoucherInfo`, `VoucherLookupResponse`, `VoucherCoverage` (Task 3); `PaymentChoice`, `PaymentMethod`, `UsablePackage` (Task 3); `SecondaryMethod` (Task 3); `NewPackageDraft` (Task 4); `euro`, `fullDate` (Task 1); CSS classes `chips`, `chip`, `chipSm`, `chipOn`, `panel`, `stack`, `option`, `optionOn`, `optionRow`, `optionName`, `optionSub`, `fieldGrid`, `full`, `fieldLabel`, `msgs`, `msgOk`, `msgWarn`, `msgBad`, `msg`, `split`, `splitTitle`, `splitText`, `links`, `link`, `muted` (Task 6); existing `Card`, `CardLabel`, `Input`, `Label`, `Textarea`, `useVocab`, type `PackageTemplate`; existing `GET /api/vouchers/<code>`.
- Produces: `useVoucherLookup(code, enabled): VoucherInfo`; `VoucherPanel(props: {code; onCode; info; coverage; price; secondary; onSecondary})`; `NewPackagePanel(props: {therapyId: number | null; templates: PackageTemplate[]; draft: NewPackageDraft; onDraft})`; `PaymentCard(props: {choice; onMethod(m); onPackageId(id); onSignUp(signUp: boolean); fits: UsablePackage[]; therapyId; templates; newPackage; onNewPackage; voucherCode; onVoucherCode; voucherInfo; coverage; secondary; onSecondary; price; onPrice; duration; onDuration; priceLocked: boolean; notes; onNotes})`.

One row of pills: "Prepaid package" (only when a package fits the treatment, or one is paying), Card, Cash, Gift voucher, Bank transfer. Below: "Which package pays" when more than one fits; the voucher panel (code, messages, split payment) when paying by voucher; the new package panel when signing up. Links: "Sign up for a new package" (or "Cancel the new package"), "Adjust price or length" (length and price fields; price read-only while a package pays), "Add a note" (textarea, hidden link once open).

- [ ] **Step 1: Create the hook and the panels**

`app/src/components/appointments/booking/useVoucherLookup.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

import { voucherInfoFrom, type VoucherInfo, type VoucherLookupResponse } from "@/lib/booking/voucherModel";

/** Looks a typed voucher code up (250ms after typing stops) while paying by voucher. */
export function useVoucherLookup(code: string, enabled: boolean): VoucherInfo {
  const [info, setInfo] = useState<VoucherInfo>({ state: "idle" });

  useEffect(() => {
    if (!enabled || !code) {
      setInfo({ state: "idle" });
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      fetch(`/api/vouchers/${encodeURIComponent(code)}`)
        .then((r) => r.json())
        .then((d: VoucherLookupResponse) => {
          if (live) setInfo(voucherInfoFrom(d));
        })
        .catch(() => {
          if (live) setInfo({ state: "invalid" });
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [code, enabled]);

  return info;
}
```

`app/src/components/appointments/booking/VoucherPanel.tsx`:

```tsx
"use client";

import { Input, Label } from "@/components/ui/Input";
import { euro } from "@/lib/booking/format";
import type { SecondaryMethod } from "@/lib/booking/summaryModel";
import type { VoucherCoverage, VoucherInfo } from "@/lib/booking/voucherModel";

import s from "./booking.module.css";

const SECONDARY: [SecondaryMethod, string][] = [
  ["card", "Card"],
  ["cash", "Cash"],
  ["bank_transfer", "Bank transfer"],
];

interface Props {
  code: string;
  onCode: (code: string) => void;
  info: VoucherInfo;
  coverage: VoucherCoverage;
  /** The session price the voucher pays towards. */
  price: number;
  secondary: SecondaryMethod;
  onSecondary: (m: SecondaryMethod) => void;
}

/** Gift voucher: the code, what it pays, and the second method when it pays only part. */
export function VoucherPanel({ code, onCode, info, coverage, price, secondary, onSecondary }: Props) {
  return (
    <div className={s.panel}>
      <div>
        <Label htmlFor="voucherCode" srOnly>
          Voucher code
        </Label>
        <Input id="voucherCode" placeholder="Voucher code" value={code} onChange={(e) => onCode(e.target.value)} autoComplete="off" />
      </div>

      {code && info.state !== "idle" && (
        <div className={s.msgs}>
          {info.state === "valid" ? (
            <>
              <div className={s.msgOk}>
                {info.kind === "treatment" ? `Treatment voucher: one ${info.therapyName ?? "session"}` : `Money voucher: ${euro(info.balance)} left`}
                {info.recipientName ? ` · for ${info.recipientName}` : ""}
              </div>
              {info.expired && <div className={s.msgWarn}>This voucher&apos;s date ({info.expiryDate}) has passed. You can still take it.</div>}
              {coverage.wrongTreatment ? (
                <div className={s.msgBad}>This voucher is for {info.therapyName ?? "a different treatment"}.</div>
              ) : coverage.noPrice ? (
                <div className={s.msgBad}>This voucher cannot be applied: the treatment has no price.</div>
              ) : info.kind === "treatment" ? (
                <div className={s.msg}>
                  {coverage.covers < price
                    ? "Pays for this session up to the treatment's listed price. The voucher is then used up."
                    : "Pays for this session. The voucher is then used up."}
                </div>
              ) : (
                price > 0 &&
                info.balance >= price && (
                  <div className={s.msg}>
                    Pays {euro(price)}. {euro(info.balance - price)} stays on the voucher.
                  </div>
                )
              )}
            </>
          ) : info.state === "empty" ? (
            <div className={s.msgWarn}>This voucher has been used.</div>
          ) : info.state === "cancelled" ? (
            <div className={s.msgBad}>This voucher was cancelled.</div>
          ) : (
            <div className={s.msgBad}>Voucher not found.</div>
          )}
        </div>
      )}

      {coverage.needsSplit && (
        <div className={s.split}>
          <div className={s.splitTitle}>Split payment</div>
          <div className={s.splitText}>
            The voucher pays {euro(coverage.covers)} of {euro(price)}. The other {euro(price - coverage.covers)} is paid by:
          </div>
          <div className={s.chips}>
            {SECONDARY.map(([m, label]) => (
              <button
                key={m}
                type="button"
                aria-pressed={secondary === m}
                className={`${s.chip} ${s.chipSm} ${secondary === m ? s.chipOn : ""}`}
                onClick={() => onSecondary(m)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

`app/src/components/appointments/booking/NewPackagePanel.tsx`:

```tsx
"use client";

import { useVocab } from "@/components/providers/VocabProvider";
import { Input, Label } from "@/components/ui/Input";
import type { NewPackageDraft } from "@/lib/booking/bookingPayload";
import { euro } from "@/lib/booking/format";
import type { SecondaryMethod } from "@/lib/booking/summaryModel";
import type { PackageTemplate } from "@/lib/db/schema";

import s from "./booking.module.css";

const PAID_BY: [SecondaryMethod, string][] = [
  ["card", "Card"],
  ["cash", "Cash"],
  ["bank_transfer", "Bank transfer"],
];

interface Props {
  therapyId: number | null;
  templates: PackageTemplate[];
  draft: NewPackageDraft;
  onDraft: (next: NewPackageDraft) => void;
}

/** "Sign up for a new package" at booking: a template for this treatment, or a custom package, and how it is paid. */
export function NewPackagePanel({ therapyId, templates, draft, onDraft }: Props) {
  const vocab = useVocab();
  const plan = vocab.plan.toLowerCase();

  if (therapyId == null) {
    return (
      <div className={s.panel}>
        <div className={s.muted}>Pick a {vocab.service.toLowerCase()} first.</div>
      </div>
    );
  }

  const forTherapy = templates.filter((t) => t.therapyId === therapyId);

  return (
    <div className={s.panel}>
      <div className={s.stack}>
        {forTherapy.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            aria-pressed={draft.templateId === tpl.id}
            className={`${s.option} ${draft.templateId === tpl.id ? s.optionOn : ""}`}
            onClick={() => onDraft({ ...draft, templateId: tpl.id, name: "" })}
          >
            <div className={s.optionRow}>
              <span className={s.optionName}>{tpl.name}</span>
              <span className={s.muted}>{euro(tpl.priceEur)}</span>
            </div>
            <div className={s.optionSub}>
              {tpl.totalSessions} sessions · valid {tpl.validityMonths} months
            </div>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={draft.templateId == null}
          className={`${s.option} ${draft.templateId == null ? s.optionOn : ""}`}
          onClick={() => onDraft({ ...draft, templateId: null })}
        >
          Custom {plan}
        </button>
      </div>

      {draft.templateId == null && (
        <div className={s.fieldGrid}>
          <div className={s.full}>
            <Label htmlFor="newPkgName" srOnly>
              {vocab.plan} name
            </Label>
            <Input id="newPkgName" placeholder={`${vocab.plan} name`} value={draft.name} onChange={(e) => onDraft({ ...draft, name: e.target.value })} />
          </div>
          <div>
            <label className={s.fieldLabel} htmlFor="newPkgSessions">
              Sessions
            </label>
            <Input
              id="newPkgSessions"
              type="number"
              min={1}
              value={draft.sessions}
              onChange={(e) => onDraft({ ...draft, sessions: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className={s.fieldLabel} htmlFor="newPkgPrice">
              Price (€)
            </label>
            <Input
              id="newPkgPrice"
              type="number"
              step="0.01"
              min={0}
              value={draft.priceEur}
              onChange={(e) => onDraft({ ...draft, priceEur: Number(e.target.value) })}
            />
          </div>
          <div className={s.full}>
            <label className={s.fieldLabel} htmlFor="newPkgExpiry">
              Expiry
            </label>
            <Input id="newPkgExpiry" type="date" value={draft.expiry} onChange={(e) => onDraft({ ...draft, expiry: e.target.value })} />
          </div>
        </div>
      )}

      <div>
        <div className={s.fieldLabel}>{vocab.plan} paid by</div>
        <div className={s.chips}>
          {PAID_BY.map(([m, label]) => (
            <button
              key={m}
              type="button"
              aria-pressed={draft.paymentMethod === m}
              className={`${s.chip} ${s.chipSm} ${draft.paymentMethod === m ? s.chipOn : ""}`}
              onClick={() => onDraft({ ...draft, paymentMethod: m })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={s.optionSub} style={{ marginTop: 8 }}>
          The session is covered by the {plan} (€0). The {plan} price is recorded as the sale.
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the card**

`app/src/components/appointments/booking/PaymentCard.tsx`:

```tsx
"use client";

import { useState } from "react";

import { useVocab } from "@/components/providers/VocabProvider";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Input";
import type { NewPackageDraft } from "@/lib/booking/bookingPayload";
import { euro, fullDate } from "@/lib/booking/format";
import type { PaymentChoice, PaymentMethod, UsablePackage } from "@/lib/booking/packageChoiceModel";
import type { SecondaryMethod } from "@/lib/booking/summaryModel";
import type { VoucherCoverage, VoucherInfo } from "@/lib/booking/voucherModel";
import type { PackageTemplate } from "@/lib/db/schema";

import { NewPackagePanel } from "./NewPackagePanel";
import { VoucherPanel } from "./VoucherPanel";
import s from "./booking.module.css";

const METHODS: [Exclude<PaymentMethod, "package">, string][] = [
  ["card", "Card"],
  ["cash", "Cash"],
  ["voucher", "Gift voucher"],
  ["bank_transfer", "Bank transfer"],
];

interface Props {
  choice: PaymentChoice;
  onMethod: (m: PaymentMethod) => void;
  onPackageId: (id: number) => void;
  onSignUp: (signUp: boolean) => void;
  /** The client's packages that can pay for the selected treatment. */
  fits: UsablePackage[];
  therapyId: number | null;
  templates: PackageTemplate[];
  newPackage: NewPackageDraft;
  onNewPackage: (next: NewPackageDraft) => void;
  voucherCode: string;
  onVoucherCode: (code: string) => void;
  voucherInfo: VoucherInfo;
  coverage: VoucherCoverage;
  secondary: SecondaryMethod;
  onSecondary: (m: SecondaryMethod) => void;
  /** The price the booking will send. */
  price: number;
  onPrice: (eur: number) => void;
  duration: number;
  onDuration: (minutes: number) => void;
  /** Set by the package paying: the price field is read-only. */
  priceLocked: boolean;
  notes: string;
  onNotes: (notes: string) => void;
}

/** Card 4: how it is paid, plus the price/length and note behind links. */
export function PaymentCard(p: Props) {
  const vocab = useVocab();
  const plan = vocab.plan.toLowerCase();
  const [adjust, setAdjust] = useState(false);
  const [note, setNote] = useState(Boolean(p.notes));
  const signingUp = p.choice.paymentMethod === "package" && p.choice.packageMode === "new";
  const usingPackage = p.choice.paymentMethod === "package" && p.choice.packageMode === "existing";
  const showPrepaid = p.fits.length > 0 || usingPackage;

  return (
    <Card>
      <CardLabel>Payment</CardLabel>
      <div className={s.chips} role="group" aria-label="Payment method">
        {showPrepaid && (
          <button
            type="button"
            aria-pressed={usingPackage}
            className={`${s.chip} ${usingPackage ? s.chipOn : ""}`}
            onClick={() => p.onMethod("package")}
          >
            Prepaid {plan}
          </button>
        )}
        {METHODS.map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={p.choice.paymentMethod === m}
            className={`${s.chip} ${p.choice.paymentMethod === m ? s.chipOn : ""}`}
            onClick={() => p.onMethod(m)}
          >
            {label}
          </button>
        ))}
      </div>

      {usingPackage && p.fits.length > 1 && (
        <div className={s.panel}>
          <div className={s.fieldLabel} style={{ marginBottom: 0 }}>
            Which {plan} pays
          </div>
          <div className={s.stack}>
            {p.fits.map((pkg) => (
              <button
                key={pkg.id}
                type="button"
                aria-pressed={p.choice.packageId === pkg.id}
                className={`${s.option} ${p.choice.packageId === pkg.id ? s.optionOn : ""}`}
                onClick={() => p.onPackageId(pkg.id)}
              >
                <div className={s.optionName}>{pkg.packageName}</div>
                <div className={s.optionSub}>
                  {pkg.available} left to book · {pkg.sessionsUsed}/{pkg.totalSessions} used · use by {fullDate(pkg.expiryDate)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {signingUp && <NewPackagePanel therapyId={p.therapyId} templates={p.templates} draft={p.newPackage} onDraft={p.onNewPackage} />}

      {p.choice.paymentMethod === "voucher" && (
        <VoucherPanel
          code={p.voucherCode}
          onCode={p.onVoucherCode}
          info={p.voucherInfo}
          coverage={p.coverage}
          price={p.price}
          secondary={p.secondary}
          onSecondary={p.onSecondary}
        />
      )}

      <div className={s.links}>
        <button type="button" className={s.link} onClick={() => p.onSignUp(!signingUp)}>
          {signingUp ? `Cancel the new ${plan}` : `Sign up for a new ${plan}`}
        </button>
        <button type="button" className={s.link} onClick={() => setAdjust((v) => !v)} aria-expanded={adjust}>
          Adjust price or length
        </button>
        {!note && (
          <button type="button" className={s.link} onClick={() => setNote(true)}>
            Add a note
          </button>
        )}
      </div>

      {adjust && (
        <div className={s.fieldGrid} style={{ marginTop: 14 }}>
          <div>
            <label className={s.fieldLabel} htmlFor="booking-duration">
              Length (minutes)
            </label>
            <Input id="booking-duration" type="number" min={0} value={p.duration} onChange={(e) => p.onDuration(Number(e.target.value))} />
          </div>
          <div>
            <label className={s.fieldLabel} htmlFor="booking-price">
              Price (€)
            </label>
            <Input
              id="booking-price"
              type="number"
              step="0.01"
              min={0}
              value={p.price}
              disabled={p.priceLocked}
              onChange={(e) => p.onPrice(Number(e.target.value))}
            />
            {p.priceLocked && (
              <div className={s.optionSub} style={{ marginTop: 6 }}>
                Set by the {plan}: {euro(p.price)} a session.
              </div>
            )}
          </div>
        </div>
      )}

      {note && (
        <div style={{ marginTop: 14 }}>
          <Label htmlFor="booking-notes" srOnly>
            Note
          </Label>
          <Textarea id="booking-notes" placeholder="Anything we should know?" rows={3} value={p.notes} onChange={(e) => p.onNotes(e.target.value)} />
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck` then `npx eslint src/components/appointments/booking`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/appointments/booking/useVoucherLookup.ts app/src/components/appointments/booking/VoucherPanel.tsx app/src/components/appointments/booking/NewPackagePanel.tsx app/src/components/appointments/booking/PaymentCard.tsx
git commit -m "feat(booking): Payment card with prepaid, voucher split and new package sign-up

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Summary, the NewBooking container, page wiring, BookingForm removed

**Files:**
- Create: `app/src/components/appointments/booking/BookingSummary.tsx`
- Create: `app/src/components/appointments/booking/NewBooking.tsx`
- Modify: `app/src/app/appointments/new/page.tsx` (imports; strip computation before `return`; `maxWidth: 880` -> `1240`; `<BookingForm` -> `<NewBooking` with `strip` and `defaultDate={bookDate}`)
- Delete: `app/src/components/appointments/BookingForm.tsx`

**Interfaces:**
- Consumes: everything above: Tasks 1-4 models, Task 6-9 components, `dublinDay` (`@/lib/cashModel`), `blockOutsForDate`, `dayWindow` (`@/lib/schedule`), `perSessionValue` (`@/lib/packageBalanceModel`), `Button` (`@/components/ui/Button`), `toast` (`sonner`), `useRouter`.
- Produces: `BookingSummary(props: {client; treatment; when; money: SummaryMoney; bookLabel; canBook; submitting; onBook})`, `BookingBar(props: {title; money; canBook; submitting; onBook})`, `NewBooking(props: {therapies; clients; packageTemplates; strip: StripDay[]; defaultDate: string; defaultClientId?; defaultStartTime?; defaultVoucherCode?; defaultTherapyId?; defaultWalkInName?})`.

The summary: "Booking" title; rows Client, Treatment ("Deep tissue massage, 60 min"), When ("Thu 26 Nov, 12:45 to 13:45"), Payment; Value large with the list price struck through when a package pays; the note line (success colour when already paid); the primary "Book {first name} in" button, disabled until client, treatment and time are set. Sticky at top 20px. At 1100px and below the side panel hides and the bar (summary line + Book) sits pinned to the bottom of the screen while the form scrolls (position: sticky inside the screen, so it never covers the sidebar).

- [ ] **Step 1: Create the summary and the container**

`app/src/components/appointments/booking/BookingSummary.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/Button";
import { euro } from "@/lib/booking/format";
import type { SummaryMoney } from "@/lib/booking/summaryModel";

import s from "./booking.module.css";

interface Props {
  client: string;
  /** "Deep tissue massage, 60 min" */
  treatment: string;
  /** "Thu 26 Nov, 12:45 to 13:45" */
  when: string;
  money: SummaryMoney;
  bookLabel: string;
  canBook: boolean;
  submitting: boolean;
  onBook: () => void;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className={s.row}>
      <span className={s.rowKey}>{k}</span>
      <span className={`${s.rowValue} ${v ? "" : s.rowEmpty}`}>{v || "Not set"}</span>
    </div>
  );
}

/** The sticky Booking panel on wide screens. */
export function BookingSummary({ client, treatment, when, money, bookLabel, canBook, submitting, onBook }: Props) {
  return (
    <div className={s.summary}>
      <h2 className={s.summaryTitle}>Booking</h2>
      <Row k="Client" v={client} />
      <Row k="Treatment" v={treatment} />
      <Row k="When" v={when} />
      <Row k="Payment" v={money.paymentLabel} />
      <div className={s.total}>
        <span className={s.totalKey}>Value</span>
        <span className={s.totalValue}>
          {money.struck != null && (
            <span className={s.struck} aria-label={`List price ${euro(money.struck)}`}>
              {euro(money.struck)}
            </span>
          )}
          {euro(money.value)}
        </span>
      </div>
      <div className={money.tone === "paid" ? s.notePaid : s.noteDue}>{money.note}</div>
      <Button type="button" size="lg" className={s.book} disabled={!canBook} loading={submitting} onClick={onBook}>
        {submitting ? "Booking" : bookLabel}
      </Button>
    </div>
  );
}

interface BarProps {
  /** "Deep tissue, Thu 26 Nov 12:45" */
  title: string;
  money: SummaryMoney;
  canBook: boolean;
  submitting: boolean;
  onBook: () => void;
}

/** The narrow-screen version: one summary line and Book, pinned to the bottom while the form scrolls. */
export function BookingBar({ title, money, canBook, submitting, onBook }: BarProps) {
  return (
    <div className={s.bar}>
      <div className={s.barText}>
        <span className={s.barTitle}>{title}</span>
        {money.shortPayment} · {euro(money.value)}
      </div>
      <Button type="button" disabled={!canBook} loading={submitting} onClick={onBook}>
        Book
      </Button>
    </div>
  );
}
```

`app/src/components/appointments/booking/NewBooking.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useVocab } from "@/components/providers/VocabProvider";
import {
  EMPTY_NEW_PACKAGE,
  bookingFormData,
  bookingProblem,
  readyToBook,
  type BookingDraft,
  type NewPackageDraft,
} from "@/lib/booking/bookingPayload";
import { chipTime, shortDate } from "@/lib/booking/format";
import { displayName, splitName } from "@/lib/booking/clientSearch";
import {
  packagesFor,
  prepaidOffers,
  reconcilePackageChoice,
  sameChoice,
  type PaymentChoice,
  type PaymentMethod,
  type PrepaidOffer,
  type UsablePackage,
} from "@/lib/booking/packageChoiceModel";
import type { StripDay } from "@/lib/booking/slotModel";
import { bookLabel, summaryMoney, whenLabel, type SecondaryMethod } from "@/lib/booking/summaryModel";
import { familyOf, groupTreatments } from "@/lib/booking/treatmentGroups";
import { voucherCoverage } from "@/lib/booking/voucherModel";
import { perSessionValue } from "@/lib/packageBalanceModel";
import type { Client, PackageTemplate, Therapy } from "@/lib/db/schema";

import { BookingBar, BookingSummary } from "./BookingSummary";
import { ClientCard, type WalkIn } from "./ClientCard";
import { PaymentCard } from "./PaymentCard";
import { TreatmentCard } from "./TreatmentCard";
import { WhenCard } from "./WhenCard";
import { useVoucherLookup } from "./useVoucherLookup";
import s from "./booking.module.css";

interface Props {
  therapies: Therapy[];
  clients: Client[];
  packageTemplates: PackageTemplate[];
  /** The 14-day strip, closed days marked (opening hours and block-outs). */
  strip: StripDay[];
  /** The booking's date: ?date=, else today in Dublin. */
  defaultDate: string;
  defaultClientId?: number;
  defaultStartTime?: string;
  defaultVoucherCode?: string;
  defaultTherapyId?: number;
  /** Arriving from a voucher redemption: the recipient's name is the walk-in starting point. */
  defaultWalkInName?: string;
}

/** The method a booking starts on and falls back to. */
const FALLBACK: PaymentMethod = "cash";

/**
 * /appointments/new: the form on the left (client, treatment, when, payment)
 * and a live Booking summary with the Book button on the right. Posts the
 * same body to /api/appointments the old BookingForm did (lib/booking/bookingPayload).
 */
export function NewBooking({
  therapies,
  clients,
  packageTemplates,
  strip,
  defaultDate,
  defaultClientId,
  defaultStartTime,
  defaultVoucherCode,
  defaultTherapyId,
  defaultWalkInName,
}: Props) {
  const router = useRouter();
  const vocab = useVocab();

  // ------------------------------------------------------------ client
  const [clientMode, setClientMode] = useState<"existing" | "walk_in">(defaultWalkInName && !defaultClientId ? "walk_in" : "existing");
  const [clientId, setClientId] = useState<number | null>(defaultClientId ?? null);
  const [walkIn, setWalkIn] = useState<WalkIn>(() => {
    const [firstName, lastName] = splitName(defaultWalkInName);
    return { firstName, lastName, email: "", phone: "" };
  });
  const client = clientId != null ? clients.find((c) => c.id === clientId) ?? null : null;

  // ------------------------------------------------------------ treatment
  const groups = useMemo(() => groupTreatments(therapies), [therapies]);
  const therapyById = useMemo(() => new Map(therapies.map((t) => [t.id, t])), [therapies]);
  const [therapyId, setTherapyId] = useState<number | null>(defaultTherapyId ?? null);
  const therapy = therapyId != null ? therapyById.get(therapyId) ?? null : null;
  const [duration, setDuration] = useState(0);
  const [price, setPrice] = useState(0);
  // A treatment brings its own length and list price; staff can still adjust both.
  useEffect(() => {
    setDuration(therapy?.defaultDurationMinutes ?? 0);
    setPrice(therapy?.defaultPriceEur ?? 0);
  }, [therapy]);

  // ------------------------------------------------------------ when
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState(defaultStartTime ?? "");

  // ------------------------------------------------------------ payment
  const [choice, setChoice] = useState<PaymentChoice>({
    paymentMethod: defaultVoucherCode ? "voucher" : FALLBACK,
    packageMode: "existing",
    packageId: null,
  });
  // Until staff pick a method themselves, a prepaid session pays by default.
  const methodChosen = useRef(Boolean(defaultVoucherCode));
  const [newPackage, setNewPackage] = useState<NewPackageDraft>(EMPTY_NEW_PACKAGE);
  const [voucherCode, setVoucherCode] = useState(defaultVoucherCode ?? "");
  const voucherInfo = useVoucherLookup(voucherCode, choice.paymentMethod === "voucher");
  const [secondary, setSecondary] = useState<SecondaryMethod>("card");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Every usable prepaid package the client has on the booking's date, any treatment.
  const [packages, setPackages] = useState<UsablePackage[]>([]);
  useEffect(() => {
    if (clientMode !== "existing" || clientId == null) {
      setPackages([]);
      return;
    }
    let live = true;
    fetch(`/api/packages?clientId=${clientId}&date=${encodeURIComponent(date)}`)
      .then((r) => r.json())
      .then((d: UsablePackage[]) => {
        if (live) setPackages(Array.isArray(d) ? d : []);
      })
      .catch(() => {
        if (live) setPackages([]);
      });
    return () => {
      live = false;
    };
  }, [clientMode, clientId, date]);

  useEffect(() => {
    setChoice((prev) => {
      const next = reconcilePackageChoice(prev, packages, therapyId, methodChosen.current, FALLBACK);
      return sameChoice(prev, next) ? prev : next;
    });
  }, [packages, therapyId]);

  const fits = packagesFor(packages, therapyId);
  const offers = useMemo(() => prepaidOffers(packages, therapies), [packages, therapies]);
  const prepaidTherapyIds = useMemo(() => new Set(packages.filter((p) => p.available > 0).map((p) => p.therapyId)), [packages]);
  const pkg = choice.paymentMethod === "package" && choice.packageMode === "existing" ? fits.find((p) => p.id === choice.packageId) ?? null : null;
  // Paying from a package: the session is worth what the package cost per session.
  const sendPrice = pkg ? perSessionValue(pkg) : price;
  const listPrice = therapy?.defaultPriceEur ?? 0;
  const coverage = voucherCoverage(voucherInfo, therapyId, sendPrice, listPrice);

  function pickMethod(m: PaymentMethod) {
    methodChosen.current = true;
    if (m === "package") {
      const keep = fits.some((p) => p.id === choice.packageId);
      setChoice({ paymentMethod: "package", packageMode: "existing", packageId: keep ? choice.packageId : (fits[0]?.id ?? null) });
    } else setChoice((c) => ({ ...c, paymentMethod: m, packageMode: "existing" }));
  }

  function signUp(on: boolean) {
    methodChosen.current = true;
    if (on) setChoice((c) => ({ ...c, paymentMethod: "package", packageMode: "new" }));
    else setChoice({ paymentMethod: fits.length ? "package" : FALLBACK, packageMode: "existing", packageId: fits[0]?.id ?? null });
  }

  function toggleOffer(offer: PrepaidOffer, use: boolean) {
    methodChosen.current = true;
    if (use) {
      setTherapyId(offer.therapyId);
      setChoice({ paymentMethod: "package", packageMode: "existing", packageId: offer.packageId });
    } else {
      setChoice((c) => ({ ...c, paymentMethod: FALLBACK, packageMode: "existing" }));
    }
  }

  // ------------------------------------------------------------ the booking
  const draft: BookingDraft = {
    clientMode,
    clientId,
    walkIn,
    therapyIds: therapyId != null ? [therapyId] : [],
    date,
    startTime,
    durationMinutes: duration,
    priceEur: sendPrice,
    paymentMethod: choice.paymentMethod,
    packageMode: choice.packageMode,
    packageId: choice.packageId,
    newPackage,
    voucherCode,
    secondaryPaymentMethod: coverage.needsSplit ? secondary : null,
    notes,
  };

  const money = summaryMoney({
    listPrice,
    price: sendPrice,
    paymentMethod: choice.paymentMethod,
    packageMode: choice.packageMode,
    pkg,
    newPackage: (() => {
      if (choice.packageMode !== "new") return null;
      const tpl = newPackage.templateId != null ? packageTemplates.find((t) => t.id === newPackage.templateId) : null;
      return tpl ? { name: tpl.name, priceEur: tpl.priceEur } : { name: newPackage.name, priceEur: newPackage.priceEur };
    })(),
    voucher: choice.paymentMethod === "voucher" && voucherCode ? { ...coverage, valid: voucherInfo.state === "valid" } : null,
    secondaryMethod: secondary,
  });

  const firstName = clientMode === "existing" ? client?.firstName ?? "" : walkIn.firstName.trim();
  const clientLabel =
    clientMode === "existing" ? (client ? displayName(client.firstName, client.lastName) : "") : displayName(walkIn.firstName, walkIn.lastName);
  const family = familyOf(groups, therapyId);
  const treatmentLabel = therapy ? `${family?.name ?? therapy.name}, ${duration} min` : "";
  const canBook = readyToBook(draft) && !submitting;
  const barTitle = therapy
    ? [family?.label ?? therapy.name, startTime ? `${shortDate(date)} ${chipTime(startTime)}` : shortDate(date)].join(", ")
    : "Pick a treatment";

  async function book() {
    const problem = bookingProblem(draft, vocab);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/appointments", { method: "POST", body: bookingFormData(draft) });
      const data = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; id?: number; error?: string };
      if (!data.ok) {
        toast.error(data.error ?? `Could not book ${vocab.booking.toLowerCase()}.`);
        return;
      }
      toast.success(`${vocab.booking} booked.`);
      router.push(`/appointments/${data.id}`);
      router.refresh();
    } catch {
      toast.error(`Could not book ${vocab.booking.toLowerCase()}.`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={s.root}>
      <div className={s.layout}>
        <div className={s.main}>
          <ClientCard
            clients={clients}
            mode={clientMode}
            onMode={setClientMode}
            clientId={clientId}
            onClientId={setClientId}
            walkIn={walkIn}
            onWalkIn={setWalkIn}
            offers={offers}
            usingPackageId={pkg?.id ?? null}
            onUseOffer={toggleOffer}
          />
          <TreatmentCard groups={groups} therapyId={therapyId} onPick={setTherapyId} prepaidTherapyIds={prepaidTherapyIds} />
          <WhenCard
            strip={strip}
            date={date}
            onDate={setDate}
            startTime={startTime}
            onStartTime={setStartTime}
            durationMinutes={duration}
            therapyIds={draft.therapyIds}
          />
          <PaymentCard
            choice={choice}
            onMethod={pickMethod}
            onPackageId={(id) => setChoice((c) => ({ ...c, packageId: id }))}
            onSignUp={signUp}
            fits={fits}
            therapyId={therapyId}
            templates={packageTemplates}
            newPackage={newPackage}
            onNewPackage={setNewPackage}
            voucherCode={voucherCode}
            onVoucherCode={setVoucherCode}
            voucherInfo={voucherInfo}
            coverage={coverage}
            secondary={secondary}
            onSecondary={setSecondary}
            price={sendPrice}
            onPrice={setPrice}
            duration={duration}
            onDuration={setDuration}
            priceLocked={pkg != null}
            notes={notes}
            onNotes={setNotes}
          />
        </div>
        <aside className={s.side} aria-label="Booking summary">
          <BookingSummary
            client={clientLabel}
            treatment={treatmentLabel}
            when={whenLabel(date, startTime, duration)}
            money={money}
            bookLabel={bookLabel(firstName, vocab.bookCta)}
            canBook={canBook}
            submitting={submitting}
            onBook={book}
          />
        </aside>
      </div>
      <BookingBar title={barTitle} money={money} canBook={canBook} submitting={submitting} onBook={book} />
    </div>
  );
}
```

- [ ] **Step 2: Wire the page**

`app/src/app/appointments/new/page.tsx`, the whole file after the change (the voucher header and card are unchanged):

```tsx
import { PageHeader } from "@/components/layout/PageHeader";
import { NewBooking } from "@/components/appointments/booking/NewBooking";
import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { clients, giftVouchers, packageTemplates, therapies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { formatDate, formatEur } from "@/lib/utils";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";
import { dublinDay } from "@/lib/cashModel";
import { blockOutsForDate, dayWindow } from "@/lib/schedule";
import { STRIP_DAYS, blocksCoverDay, dayStrip, stripStart } from "@/lib/booking/slotModel";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ client?: string; date?: string; time?: string; voucher?: string; therapy?: string }>;
}

export default async function NewAppointmentPage(props: Props) {
  const searchParams = await props.searchParams;
  const vocab = getVocab(getVenueType());
  const allTherapies = db
    .select()
    .from(therapies)
    .where(eq(therapies.isActive, true))
    .all();
  const allClients = db.select().from(clients).all();
  const allTemplates = db
    .select()
    .from(packageTemplates)
    .where(eq(packageTemplates.isActive, true))
    .all();

  // If a voucher code is in the URL, look it up so we can show a preview
  // banner and pre-fill the booking form's payment + therapy fields.
  const voucher = searchParams.voucher
    ? db
        .select()
        .from(giftVouchers)
        .where(eq(giftVouchers.code, searchParams.voucher))
        .get()
    : null;

  // The booking's date (?date=, else today in Dublin) and the 14-day strip it
  // sits in, closed days marked from opening hours and block-outs.
  const today = dublinDay(Date.now());
  const bookDate = searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date) ? searchParams.date : today;
  const strip = dayStrip(stripStart(today, bookDate, STRIP_DAYS), STRIP_DAYS, (d) => {
    const win = dayWindow(d);
    return win.closed || blocksCoverDay(win.open, win.close, blockOutsForDate(d));
  });

  return (
    <div className="app-page" style={{ maxWidth: 1240 }}>
      <PageHeader
        eyebrow={voucher ? "Voucher redemption" : "Schedule"}
        title={voucher ? "Redeem voucher" : `New ${vocab.booking.toLowerCase()}`}
        subtitle={
          voucher
            ? `Code ${voucher.code} · purchased by ${voucher.purchaserName}`
            : undefined
        }
      />

      {voucher && (
        <Card style={{ marginBottom: 24 }}>
          <CardLabel>Voucher details</CardLabel>
          {(() => {
            const balance = voucher.balanceEur ?? voucher.valueEur;
            const empty = balance <= 0.01;
            const expired =
              voucher.expiryDate < new Date().toISOString().slice(0, 10);
            const partiallyUsed =
              balance > 0.01 && balance < voucher.valueEur - 0.01;
            return (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 16,
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                    Balance
                  </div>
                  <div
                    style={{
                      color: empty ? "var(--text-tertiary)" : "var(--text-primary)",
                      fontWeight: 600,
                      fontFamily: "var(--font-heading)",
                      fontSize: 22,
                    }}
                  >
                    {formatEur(balance)}
                  </div>
                  {partiallyUsed && (
                    <div style={{ color: "var(--text-tertiary)", fontSize: 11, marginTop: 2 }}>
                      of {formatEur(voucher.valueEur)} original
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                    Recipient
                  </div>
                  <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                    {voucher.recipientName ?? "—"}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                    Expiry
                  </div>
                  <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                    {formatDate(voucher.expiryDate)}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                    Status
                  </div>
                  {empty ? (
                    <Badge tone="green">Fully redeemed</Badge>
                  ) : expired ? (
                    <Badge tone="red">Expired</Badge>
                  ) : partiallyUsed ? (
                    <Badge tone="amber">Partial — ready</Badge>
                  ) : (
                    <Badge tone="green">Ready to redeem</Badge>
                  )}
                </div>
              </div>
            );
          })()}
        </Card>
      )}

      <NewBooking
        therapies={allTherapies}
        clients={allClients}
        packageTemplates={allTemplates}
        strip={strip}
        defaultClientId={searchParams.client ? Number(searchParams.client) : undefined}
        defaultDate={bookDate}
        defaultStartTime={searchParams.time}
        defaultVoucherCode={
          voucher && (voucher.balanceEur ?? voucher.valueEur) > 0
            ? voucher.code
            : undefined
        }
        defaultTherapyId={
          voucher &&
          voucher.therapyId &&
          (voucher.balanceEur ?? voucher.valueEur) > 0
            ? voucher.therapyId
            : searchParams.therapy && Number(searchParams.therapy) > 0
              ? Number(searchParams.therapy)
              : undefined
        }
        defaultWalkInName={
          voucher &&
          voucher.recipientName &&
          (voucher.balanceEur ?? voucher.valueEur) > 0
            ? voucher.recipientName
            : undefined
        }
      />
    </div>
  );
}
```

- [ ] **Step 3: Delete the old form**

```bash
git rm app/src/components/appointments/BookingForm.tsx
grep -rn "BookingForm" app/src || echo "no references left"
```
Expected: "no references left".

- [ ] **Step 4: Full verification**

Run (from `app/`): `npm run typecheck`, `npm test` (whole suite), `npx eslint src/components/appointments/booking src/lib/booking src/app/api/appointments src/app/appointments/new`, `npx next build`.
Expected: typecheck clean; every test file passes; lint clean; build succeeds. If `next build` modifies `app/next-env.d.ts`, restore it with `git checkout -- app/next-env.d.ts` (do not commit it).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/appointments/booking/BookingSummary.tsx app/src/components/appointments/booking/NewBooking.tsx app/src/app/appointments/new/page.tsx
git commit -m "feat(booking): new booking screen with a live summary, replacing BookingForm

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the tasks (controller)

Browser check on a throwaway route `app/src/app/f/zz-booking/` (rendering `NewBooking` with made-up data and the staff APIs mocked by Playwright), at 1280 and 390, dark and light, with a client who has a prepaid package and one who does not, plus one booking clicked end to end with the POST body captured. Screenshots go to the session scratchpad. The throwaway route is deleted and never committed.
