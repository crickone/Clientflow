# Venue-Neutral Domain Refactor

**Date:** 2026-05-23
**Status:** Design approved — spec under review
**Sub-project 1 of the ClientFlow multi-tenant initiative.**

## Context & the bigger picture

The app (currently the single-clinic "Renova" app) is to become **ClientFlow**, a
multi-tenant SaaS for onboarding other clinics *and gyms*. That whole initiative
is multi-subsystem and decomposes into sequential sub-projects, each with its own
spec → plan → implementation cycle:

1. **Venue-neutral domain refactor** ← *this spec*
2. Tenancy foundation (tenant model, data isolation, tenant resolution, auth) + the **ClientFlow rename**
3. Onboarding & platform/super-admin
4. Per-tenant branding
5. Gym domain *features* (class rosters, waitlists, recurring billing, check-ins)
6. Billing/subscriptions (Stripe)
7. Deployment (persistent disk, custom domains)

User decisions that scoped this sub-project:
- **Venue-neutral first, tenancy after** — get the domain model right on a clean base, then layer tenancy.
- **Depth = "terminology + flexible model"** — generalize concepts and make the schema *able* to express gym mechanics (capacity>1, recurring plans), but keep today's clinic behaviors (1:1 bookings, prepaid packages) as the working defaults. Gym *features* come in sub-project 5.
- **Vocabulary = tailored to venue type** — one neutral internal model; a `venue_type` setting drives the labels users see.
- **Implementation = Approach A** — presentation/vocabulary layer + additive schema. No physical table/column renames, no destructive migrations.

## Goal

Make the clinic operations domain venue-neutral so neither clinics nor gyms feel
bolted on, without changing existing behavior or risking Renova's live data. A
clinic still sees Client/Therapy/Appointment/Package; a gym would see
Member/Class/Booking/Membership — backed by one neutral model that can later
express classes and recurring memberships.

## Architecture

### 1. Venue type setting

- Add a `venue_type` key to the existing `settings` key-value table. Values:
  `clinic` | `gym`. Seed default `clinic` (idempotent `INSERT OR IGNORE` in
  `ensureSeed()` in `src/lib/db/index.ts`), so Renova is unaffected.
- Read/write helpers in `src/lib/settings.ts` (alongside existing
  `getBrandingLogoFilename`): `getVenueType(): "clinic" | "gym"` and
  `setVenueType(v)`.

### 2. Vocabulary system

- New `src/lib/vocabulary.ts`:
  - A `VenueType` type and a `VOCAB: Record<VenueType, Vocab>` map.
  - `Vocab` shape (each entry has singular + plural; add a verb where useful):
    ```
    member / members          clinic: "Client" / "Clients"      gym: "Member" / "Members"
    service / services         clinic: "Therapy" / "Therapies"   gym: "Class" / "Classes"
    booking / bookings         clinic: "Appointment"/"Appointments" gym: "Booking"/"Bookings"
    plan / plans               clinic: "Package" / "Packages"    gym: "Membership"/"Memberships"
    bookVerb                   clinic: "Book"                    gym: "Book"
    ```
    (Verbs/extra keys added only where the UI needs them; keep the map minimal
    and grow it as strings are migrated.)
  - `getVocab(venueType)` returns the term set; a `term(key)` style accessor with
    a `capitalize`/plural option, or simply `vocab.members` etc. Keep it a plain
    object lookup — no i18n framework.
- **Server access:** `getVocabForRequest()` thin wrapper = `getVocab(getVenueType())`,
  callable in server components / route handlers.
- **Client access:** a `VocabProvider` context (new
  `src/components/providers/VocabProvider.tsx`) mounted in `AppShell` (or
  `layout.tsx`) seeded with the server-resolved vocab; a `useVocab()` hook for
  client components (the Sidebar, forms, etc.). The vocab value is read once on
  the server and passed down — it does not change within a session except via the
  Settings screen (which triggers a normal navigation/refresh).

### 3. Additive schema changes

All changes are `ALTER TABLE ... ADD COLUMN`, added to the idempotent
`ensureTables()` PRAGMA-guarded migration block in `src/lib/db/index.ts`, plus
the corresponding Drizzle column definitions in `src/lib/db/schema.ts`. No data
is moved or dropped.

- **`therapies`** (neutral: *services*): add
  `capacity INTEGER NOT NULL DEFAULT 1`. `1` = 1:1 service; `>1` = a class with
  multiple spots. Drives nothing new in behavior yet; it's the "express
  capacity>1" hook.
- **`packages`** and **`package_templates`** (neutral: *plans*): add
  - `plan_type TEXT NOT NULL DEFAULT 'prepaid_sessions'`
    (enum: `prepaid_sessions` | `recurring_membership` | `drop_in`)
  - `billing_interval_months INTEGER` (nullable; for recurring)
  - `recurring_price_eur REAL` (nullable; for recurring)
  Only `prepaid_sessions` is exercised by current code; the others exist for
  sub-project 5.
- **Deferred (NOT built now):** a `booking_attendees` join table for class
  rosters. Documented here as the planned extension; `appointments` (*bookings*)
  remain single-member for this sub-project.

### 4. Neutral type layer

- New `src/lib/domain.ts` re-exports neutral aliases over the existing inferred
  Drizzle types:
  `export type Member = Client; export type Service = Therapy;
   export type Booking = Appointment; export type Plan = Package;`
  (plus the `New*` insert variants). New code may import these for readability;
  existing imports are left untouched. Purely types — zero runtime change.

### 5. UI wiring

Route every **user-visible** occurrence of the clinic terms
(Client/Clients, Therapy/Therapies, Appointment/Appointments, Package/Packages)
through the vocabulary system:

- **Sidebar** (`components/layout/Sidebar.tsx`) nav labels.
- **PageHeader** eyebrows/titles and page-level copy across `app/clients`,
  `app/appointments`, `app/packages`, `app/dashboard`, plus their `new`/`[id]`
  routes.
- Buttons, empty states (`ui/EmptyState.tsx` usages), form labels, and `sonner`
  toasts that name these entities.
- **Settings → Venue type**: a new selector (radio/select) on a settings page
  (extend `app/settings/page.tsx` or add `app/settings/venue/`), admin-only,
  with a server action that calls `setVenueType` and revalidates. Switching
  re-labels the app on next render.

Mechanics that are not user-facing strings (route paths like `/clients`, API
paths, table names, code symbols) are **left as-is** under Approach A.

### Boundary: clinic domain vs. marketing ad library

The refactor covers the **clinic operations domain** only. The Marketing tab's
"therapy ad library" (HBOT / Infrared / PEMF, sourced from the HAR/ad-scrape
pipeline and embedded report) is a **separate concept** and keeps its current
naming. Do not route marketing "therapy" strings through the venue vocabulary,
and do not confuse the bookable `therapies` table (services) with the marketing
therapy categories.

## Out of scope (later sub-projects)

- Multi-tenancy, tenant resolution, data isolation, super-admin (sub-project 2).
- The **ClientFlow rename** (cookie name, product titles, replacing "Renova"
  strings) — deferred to the tenancy phase, since "ClientFlow" (product) vs
  "Renova" (a tenant) only becomes meaningful once platform ≠ tenant.
- Gym *features*: class rosters/waitlists, recurring-billing logic, drop-in
  checkout, member check-ins (sub-project 5).
- Physical table/column renames; route renames.
- Per-tenant or fully custom label overrides.

## Verification

- `npm run dev`, log in. With `venue_type=clinic` (default), confirm the app is
  visually unchanged from today — still "Clients / Therapies / Appointments /
  Packages" everywhere (Dashboard, Clients, Appointments, Packages, Settings).
- Flip Settings → Venue type to **gym**; confirm nav, page headers, buttons,
  empty states, and toasts now read "Members / Classes / Bookings / Memberships",
  with no functional change to booking/package flows.
- Confirm the Marketing tab is **unchanged** (still HBOT/IR/PEMF ad library).
- Confirm the new columns exist (`PRAGMA table_info`) and existing Renova rows
  are intact (no data loss; `capacity` defaults to 1, `plan_type` to
  `prepaid_sessions`).
- Typecheck/build passes (`npm run build` or `tsc`).

## Notes

- Repo is not under git, so this spec is saved but not committed.
- Default `venue_type=clinic` guarantees a no-op visual result for Renova until
  someone deliberately switches it — safe to ship incrementally.
