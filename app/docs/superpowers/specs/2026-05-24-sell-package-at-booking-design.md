# Sign Up for a Package at Booking

**Date:** 2026-05-24
**App:** ClientFlow / Renova
**Surface:** `/appointments/new` (BookingForm) + `POST /api/appointments`

## Goal

Let the operator **sell/sign a client up for a new package during booking** — one step that creates the package, records the sale, and books the client's first session against it. Complements the existing "redeem an existing package" path.

## Behaviour

In the BookingForm **Payment** section, when the **package** method is chosen, a sub-toggle:
- **Use existing package** — unchanged (lists the client's active packages for the therapy; the session attaches to it and decrements on completion).
- **Sign up for new package** —
  - **Template picker** from Settings package templates (prefills name / sessions / price / expiry), with a **Custom** fallback (manual name, total sessions, price, expiry date).
  - A payment method for the **package price** (cash / card / bank transfer).
  - On submit: create the package, record the **package-sale payment** (the price), **attach the new package to the appointment**, and set the **session line to €0** (covered). The credit decrements on appointment completion, exactly like an existing package.

Net: the client is signed up *and* their first session is booked at once.

## Architecture

- **Shared helper `sellPackage(input)`** extracted into `lib/packages.ts` (or `lib/domain.ts`) from the existing `app/packages/actions.ts` `sellPackageAction`: inserts the `packages` row + the sale `payments` row, returns the new `packageId`. Single source of truth; `sellPackageAction` is refactored to call it (no behaviour change there). Voucher-on-package stays in `sellPackageAction` only (out of scope at booking).
- **`POST /api/appointments`** gains a "sell new package" branch. New form fields: `packageMode` (`existing | new`), and for `new`: `newPackageTemplateId?` or custom `newPackageName`, `newPackageSessions`, `newPackagePriceEur`, `newPackageExpiry`, `newPackagePaymentMethod`. When `packageMode === "new"`: call `sellPackage()` → get `packageId` → use it as the appointment's `packageId`, session `totalPriceEur = 0`, session payment row €0 with that `packageId` (mirrors today's package-redeem rows). The package-sale payment (> €0) flows through the existing `onPaymentRecorded` hook → trips the **`sale`** pipeline stage automatically.
- **`app/appointments/new/page.tsx`** passes `packageTemplates` (active) to `BookingForm` as a prop, alongside `therapies`/`clients`.
- **BookingForm** state: `packageMode`, selected template / custom fields; UI rendered only when `paymentMethod === "package"`.

## Data model
No schema changes. Reuses `packages`, `payments`, `package_templates`. (Confirm `package_templates` columns at build: name, therapyId, totalSessions, priceEur, validity/expiry basis — mirror how `SellPackageForm` consumes them.)

## Error handling
- Validate the new-package fields server-side (positive sessions/price, valid expiry, a therapy selected). Reuse the slot-check-before-writes ordering already in the route; if the package creation fails, roll back the appointment (extend the existing `rollback` helper to also delete a just-created package).
- A template that no longer exists → fall back to the submitted custom values or error clearly.

## Out of scope
Voucher applied to a package purchase at booking · recurring/membership packages · editing templates from the booking form · changing the redeem-existing flow.

## Testing
- Sign up via **template** → package created (sessions/price/expiry from template), sale payment recorded, appointment attached at €0, lead's stage → `sale`; on completion sessions = 1/N.
- **Custom** fallback path.
- Existing-package **redeem** still works unchanged.
- Roll back cleanly if the slot is invalid (no orphaned package).
- `tsc` + `build:prod` green; visual check of the booking form via the local screenshot recipe.
