# Implementation Plan — Venue-Neutral Domain Refactor

**Spec:** `docs/superpowers/specs/2026-05-23-venue-neutral-domain-design.md`
**Approach:** A (vocabulary/presentation layer + additive schema). No physical
renames, no destructive migrations. Default `venue_type=clinic` keeps Renova a
visual no-op until deliberately switched.

**Sequencing principle:** each phase leaves the app fully working. Schema and
plumbing land first (invisible), UI wiring last. After every phase: app boots,
typecheck passes, clinic view unchanged.

---

## Phase 0 — Additive schema

**Objective:** add the flexible columns; no behavior change.

**Files:**
- `src/lib/db/schema.ts` — add Drizzle columns:
  - `therapies`: `capacity: integer("capacity").notNull().default(1)`
  - `packages`: `planType: text("plan_type",{enum:["prepaid_sessions","recurring_membership","drop_in"]}).notNull().default("prepaid_sessions")`,
    `billingIntervalMonths: integer("billing_interval_months")`,
    `recurringPriceEur: real("recurring_price_eur")`
  - `packageTemplates`: same three plan columns as `packages`.
- `src/lib/db/index.ts` — in `ensureTables()`, add PRAGMA-guarded
  `ALTER TABLE ... ADD COLUMN` blocks (mirroring the existing column-add
  migrations) for: `therapies.capacity`, `packages.plan_type` /
  `billing_interval_months` / `recurring_price_eur`, and the same on
  `package_templates`.
- `src/lib/db/schema.ts` types are inferred — no manual type edits needed.

**Verify:** boot dev server; `PRAGMA table_info(therapies)` shows `capacity`,
`PRAGMA table_info(packages)`/`package_templates` show the three plan columns;
existing Renova rows intact (`capacity`=1, `plan_type`='prepaid_sessions');
`tsc` passes.

---

## Phase 1 — Venue type setting

**Objective:** persist and read the venue type; default `clinic`.

**Files:**
- `src/lib/db/index.ts` — in `ensureSeed()`, add
  `setIf.run("venue_type", "clinic")` (idempotent `INSERT OR IGNORE`).
- `src/lib/settings.ts` — add:
  ```ts
  export type VenueType = "clinic" | "gym";
  export function getVenueType(): VenueType {
    const v = readKey<string>("venue_type", "clinic");
    return v === "gym" ? "gym" : "clinic";
  }
  export function setVenueType(v: VenueType) { setKey("venue_type", v); }
  ```

**Verify:** call `getVenueType()` from a temporary log/route → `"clinic"`.

---

## Phase 2 — Vocabulary module + neutral types

**Objective:** the term map and neutral type aliases. Pure, no wiring yet.

**Files:**
- `src/lib/vocabulary.ts` (new):
  ```ts
  import type { VenueType } from "./settings";
  export interface Vocab {
    member: string; members: string;
    service: string; services: string;
    booking: string; bookings: string;
    plan: string; plans: string;
    bookVerb: string;
  }
  export const VOCAB: Record<VenueType, Vocab> = {
    clinic: { member:"Client", members:"Clients", service:"Therapy",
      services:"Therapies", booking:"Appointment", bookings:"Appointments",
      plan:"Package", plans:"Packages", bookVerb:"Book" },
    gym: { member:"Member", members:"Members", service:"Class",
      services:"Classes", booking:"Booking", bookings:"Bookings",
      plan:"Membership", plans:"Memberships", bookVerb:"Book" },
  };
  export function getVocab(v: VenueType): Vocab { return VOCAB[v]; }
  ```
  (Re-export `VenueType` here too if convenient. Grow the interface only as
  strings are migrated in Phase 4 — keep it minimal.)
- `src/lib/domain.ts` (new): neutral type aliases over inferred row types —
  `export type Member = Client; Service = Therapy; Booking = Appointment;
   Plan = Package;` plus `New*` variants. Types only.

**Verify:** `tsc` passes; quick import check that `getVocab("gym").members === "Members"`.

---

## Phase 3 — Vocab plumbing (server → client)

**Objective:** make the resolved vocab available everywhere, including client
components, without prop-drilling.

**Files:**
- `src/components/providers/VocabProvider.tsx` (new, `"use client"`):
  a React context holding a `Vocab`, `VocabProvider`, and `useVocab()` hook.
- `src/app/layout.tsx` (server) — read `getVocab(getVenueType())` and pass the
  `vocab` object into `AppShell` as a prop.
- `src/components/layout/AppShell.tsx` (already `"use client"`) — accept `vocab`
  prop and wrap the shell subtree (and the bare subtree) in
  `<VocabProvider value={vocab}>`.
- For **server** components/pages, add `getVocabForRequest()` to
  `src/lib/vocabulary.ts`'s server usage pattern: a one-liner
  `getVocab(getVenueType())` called directly in server pages (no context needed
  server-side). (Keep `getVocab` pure; `getVenueType` is server-only via
  settings.ts, so server pages call both.)

**Verify:** temporary `useVocab()` read in the Sidebar logs the clinic vocab;
app renders normally; toggling the seeded value to `gym` in the DB flips the
logged value after refresh.

---

## Phase 4 — Wire user-visible strings (the bulk)

**Objective:** every visible Client/Therapy/Appointment/Package label resolves
through vocab. Functional behavior unchanged.

**Method:** grep-driven sweep. Find occurrences, replace literal strings with
`vocab.*` (client: `useVocab()`; server pages: `getVocab(getVenueType())`).
```
rg -n "Client|Clients|Therap(y|ies)|Appointment|Package" src/app src/components --glob '!**/marketing/**'
```
Hit list (user-facing only — skip route paths, table names, code symbols, and
**all marketing** files):
- `components/layout/Sidebar.tsx` — nav labels: Clients→`vocab.members`,
  Appointments→`vocab.bookings`, Packages→`vocab.plans`.
- `app/dashboard/page.tsx` — KPI labels, "Today's schedule", section copy.
- `app/clients/**` (`page.tsx`, `new/page.tsx`, `[id]/page.tsx`,
  `[id]/edit/page.tsx`) + `components/clients/*` (ClientForm, ClientPicker,
  ClientSearch, FilterTabs, QuickAddClientForm, DeleteClientButton) — headers,
  buttons, empty states, labels, toasts.
- `app/appointments/**` + `components/appointments/*` (BookingForm, etc.) —
  including the word "Therapy" in booking/service pickers.
- `app/packages/**` + `components/packages/SellPackageForm.tsx`.
- `components/ui/EmptyState.tsx` usages that name these entities.
- `app/settings/therapies/*` — "Therapies" → `vocab.services` (this is the
  bookable-services editor, in scope).

**Rules:**
- Plurals/case: use the right vocab key; for sentence-case mid-string use a
  helper or store both forms (the Vocab map already carries singular+plural with
  display capitalization).
- Do **not** touch `app/marketing/**` or the embedded report (`TherapyView`,
  `TherapySwitcher`, pane-wrap) — that "therapy" is the ad library.
- Leave route paths (`/clients`), API routes, and DB/code symbols as-is.

**Verify:** with `clinic`, diff is visually identical to today across Dashboard,
Clients, Appointments, Packages, Settings. Spot-check toasts/empty states.

---

## Phase 5 — Settings → Venue type selector

**Objective:** let an admin switch clinic/gym.

**Files:**
- `src/app/settings/venue/page.tsx` (new) or a card on `app/settings/page.tsx` —
  admin-only (`requireAdminPage`), a radio/select (clinic | gym) showing current
  value.
- `src/app/settings/venue/actions.ts` (or reuse a settings actions file) —
  server action calling `setVenueType(v)` then `revalidatePath("/", "layout")`
  so the new vocab propagates app-wide.
- Add a nav/entry point to it from the Settings index.

**Verify:** flip to **gym** → Save → nav + headers + buttons + empty states read
Members/Classes/Bookings/Memberships; booking and package flows still function
identically. Flip back to **clinic** → original labels return.

---

## Phase 6 — Verification pass

- **Clinic no-op:** default install reads "Clients/Therapies/Appointments/
  Packages" everywhere (Dashboard, Clients, Appointments, Packages, Settings,
  Login unaffected).
- **Gym relabel:** switch → Members/Classes/Bookings/Memberships, no functional
  change.
- **Marketing untouched:** HBOT/IR/PEMF ad library identical in both modes.
- **Data integrity:** Renova rows intact; new columns defaulted correctly.
- **Build:** `npm run build` (or `tsc`) clean.
- Screenshot Dashboard in clinic vs gym mode (reuse
  `app/scripts/verify-screens.mjs`, toggling `venue_type` around the run) to
  confirm the relabel visually.

---

## Risk notes
- The big surface is Phase 4 (many files, easy to miss a string or mis-pluralize).
  Grep coverage + the clinic-mode visual diff catches misses.
- Keep the `Vocab` interface lean; only add keys you actually wire up, so the
  map stays a faithful inventory of what's been migrated.
- No git in repo → land in logical commits manually if/when git is initialized;
  otherwise verify per-phase before moving on.
