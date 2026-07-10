# Business Profile + Branding Logo

**Date:** 2026-05-23
**Status:** Design approved — spec under review
**Follows:** the venue-aware Content Studio work (`2026-05-23-venue-aware-content-studio-design.md`). Part of the ClientFlow roadmap; a pre-tenancy step that removes hardcoded "Renova" from the AI prompts and the app chrome.

## Context & problem

The AI generators were de-clinic'd but still carry a **hardcoded business identity** ("Renova Cellular Health, Clonmel…") in `lib/ai/businessContext.ts`, and the app **chrome hardcodes the Renova logo** (`/renova-logo.png`) and the literal "Renova Cellular Health" in the browser-tab title + login screen. For a multi-tenant product, no tenant should have Renova baked in.

This makes business identity **editable data** rather than constants, ahead of full tenancy:
- A **Business Profile** (name, location, contact, a free-text brief, voice notes) feeds the AI generators and replaces the visible business name.
- A **resolved chrome logo**: each business's uploaded branding logo, falling back to a **ClientFlow** product logo.

When tenancy lands, the profile + branding simply become per-tenant and get captured at signup. This is the data layer for that.

Approved decisions:
- Profile reach = **AI content generation AND the visible business name** (titles/tab/login). Logo image included.
- ClientFlow default logo = **a file the user will provide** (`app/public/clientflow-logo.png`); graceful text-wordmark fallback until it exists.
- Chrome logo = **business branding logo if uploaded, else ClientFlow**. (Renova already has an uploaded branding logo, so it keeps showing its own.)

## Architecture

### 1. Business Profile storage + helpers

- Stored as a single `business_profile` JSON value in the existing **settings** table (same pattern as `venue_type`; becomes per-tenant in the tenancy phase). Uses the existing `setKey`/`readKey` helpers.
- New `src/lib/businessProfile.ts` (`server-only`):
  - `interface BusinessProfile { businessName; tagline; location; phone; website; email; brief; voiceNotes }` (all strings; `email`/`voiceNotes` may be empty).
  - `DEFAULT_PROFILE` — Renova's current values (so an un-set profile behaves exactly as today):
    name "Renova Cellular Health", tagline "a recovery & wellness business", location "Ard Gaoithe Business Park, Clonmel, Co. Tipperary", phone "083 867 2844", website "renovacellularhealth.ie", brief "" (empty until edited), voiceNotes "".
  - `getBusinessProfile(): BusinessProfile` — reads the key, merges over `DEFAULT_PROFILE` (missing fields fall back to defaults).
  - `setBusinessProfile(p: BusinessProfile): void`.

### 2. Settings → Business profile page

- `src/app/settings/business/page.tsx` (admin-only via `requireAdminPage`) — a form for all profile fields (`brief` and `voiceNotes` as textareas; the rest inputs).
- `src/app/settings/business/actions.ts` — `updateBusinessProfile` server action: `requireAdmin()`, `setBusinessProfile()`, `revalidatePath("/", "layout")` (so the new name/identity propagates to chrome + metadata).
- Add a "Business profile" entry to the Settings index (`settings/page.tsx`).

### 3. Feed the profile into the AI generators

- `lib/ai/businessContext.ts`:
  - Replace the `IDENTITY` constant with a value composed from `getBusinessProfile()`:
    `${name}, ${tagline} at ${location} (${website} / ${phone})` (omit empty parts gracefully).
  - `getBusinessName()` returns this composed identity.
  - In `getBusinessContext()`, after the services block, inject an **"About the business:"** section containing `profile.brief` (only when non-empty).
  - The venue-type voice block still applies; append `profile.voiceNotes` after it when non-empty.
- **Refactor `lib/ai/refreshSlides.ts`** (the 4th Content Studio generator, missed earlier) to prepend `getBusinessContext()` like the other three — replacing its hardcoded Renova/therapies block, keeping its slide-refresh format rules, preserving `cache_control`.

### 4. Replace the visible business name (chrome text)

- `src/app/layout.tsx`: convert the static `export const metadata` to an async `export function generateMetadata()` that reads `getBusinessProfile()` → `title` = business name, `description` = a profile/venue-derived line (drop the hardcoded "Clinic management for Renova…").
- `src/app/login/LoginForm.tsx`: the subtitle "Access your **clinic** dashboard." → neutral / business-name wording (e.g. "Sign in to your dashboard."). Passed the business name if needed.
- `src/components/Header.tsx`: if it renders the literal business name, switch it to the profile name (confirm during build; if it's unused/dead, leave it).

### 5. Logo handling

- **Resolved chrome logo** (server-computed, passed to client components):
  - `hasBusinessLogo = getBrandingLogoFilename() !== null && resolveLogoPath() !== null` (existing helpers in `lib/settings` + `lib/branding`).
  - `logoSrc = hasBusinessLogo ? "/api/branding/logo" : "/clientflow-logo.png"`.
  - `layout.tsx` computes `logoSrc` + the business name and passes them through `AppShell` → `Sidebar`. `login/page.tsx` (server) computes and passes to `LoginForm`.
- `Sidebar.tsx` and `LoginForm.tsx`: replace the hardcoded `/renova-logo.png` `<Image>`/`<img>` with `logoSrc`; `alt` = business name. Add an `onError` handler that swaps to a **"CLIENTFLOW" Nebula wordmark** (a styled text span) so a missing `clientflow-logo.png` never shows a broken image.
  - Note: `next/image` is awkward for an `onError` text swap and for an unknown dynamic file; use a plain `<img>` (the app already sets `images.unoptimized`, so there's no loss), or a small client `Logo` component encapsulating the load-then-fallback logic. A shared `src/components/ui/Logo.tsx` is preferred so sidebar + login share one implementation.
- **ClientFlow default asset:** the user drops `clientflow-logo.png` into `app/public/`. Until then the `onError` wordmark renders.
- **Settings → Branding** (`settings/branding/page.tsx` + `BrandingForm`): update copy from "logo used on Content Studio intro/outro cards" to "Your business logo — shown across the app and on your content." No change to the upload route/storage (`/api/branding/logo`, `data/branding/`).

## Out of scope

- **Per-tenant** storage of profile/branding — tenancy phase (this is the single-instance data layer that becomes per-tenant).
- The **ClientFlow product brand** beyond the chrome fallback logo (marketing site, etc.).
- `draftFollowup.ts` (Leads AI drafter) — still hardcoded; folds into the Leads/Zapier or tenancy work, not here.
- Training / voucher / video-template / image-template "Renova" references — their own later phases.
- Deleting the now-unused `public/renova-logo.png` and `/logo/*` source files (harmless; optional cleanup).

## Verification

- **Defaults unchanged:** with no profile edits, the AI header, browser-tab title, and login read exactly as today (Renova); Renova's uploaded branding logo still shows in chrome.
- **Edit the profile** (change name + add a brief) in Settings → Business profile: confirm via the prompt-capture method that `getBusinessContext()` shows the new name + an "About the business" block and **no "Renova" leaks**; the browser tab + login show the new name.
- **Logo fallback:** temporarily point `hasBusinessLogo` to false (or test on a fresh state) → chrome shows `/clientflow-logo.png`; with the file absent, the "CLIENTFLOW" wordmark renders rather than a broken image.
- `npm run build` / `tsc --noEmit` clean.

## Notes

- Repo is not under git, so this spec is saved but not committed.
- This + venue-aware Content Studio together mean the AI prompts contain **zero hardcoded business identity** — only editable profile data + DB services + venue voice.
