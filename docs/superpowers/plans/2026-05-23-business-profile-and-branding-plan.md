# Implementation Plan — Business Profile + Branding Logo

**Spec:** `docs/superpowers/specs/2026-05-23-business-profile-and-branding-design.md`
**Goal:** make business identity editable data (profile + logo) instead of
hardcoded "Renova" — feeding the AI generators, the visible business name, and
the chrome logo. Defaults = Renova's current values, so an un-edited install is a
no-op.

**Sequencing principle:** data layer first (profile store + defaults = no visible
change), then consumers (AI, chrome text, logo), then verify. After every phase:
`tsc` clean and the app behaves exactly as today until the profile is edited.

---

## Phase 0 — Business Profile store + helpers

**Objective:** the profile data layer, defaulting to Renova (no behaviour change).

**Files:**
- `src/lib/businessProfile.ts` (new, `server-only`):
  - `export interface BusinessProfile { businessName: string; tagline: string; location: string; phone: string; website: string; email: string; brief: string; voiceNotes: string }`
  - `const DEFAULT_PROFILE: BusinessProfile` — Renova's current values (name
    "Renova Cellular Health", tagline "a recovery & wellness business", location
    "Ard Gaoithe Business Park, Clonmel, Co. Tipperary", phone "083 867 2844",
    website "renovacellularhealth.ie", email "", brief "", voiceNotes "").
  - `getBusinessProfile(): BusinessProfile` — `readKey<Partial<BusinessProfile>>("business_profile", {})` merged over `DEFAULT_PROFILE`.
  - `setBusinessProfile(p: BusinessProfile): void` — `setKey("business_profile", p)`.
  (Import `readKey`/`setKey` from `lib/settings` — export them there if not already; they exist.)

**Verify:** temporary call returns the Renova defaults; `tsc` clean.

---

## Phase 1 — Feed the profile into the AI generators

**Objective:** AI identity comes from the profile; brief + voice notes flow in.

**Files:**
- `src/lib/ai/businessContext.ts`:
  - Import `getBusinessProfile`.
  - Replace the `IDENTITY` constant: build it inside `getBusinessName()` from the
    profile — `${name}, ${tagline} at ${location} (${website} / ${phone})`,
    omitting empty parts.
  - In `getBusinessContext()`: after the services block, add an
    `About the business:\n${profile.brief}` block **only when `brief` is non-empty**.
    After `VENUE_VOICE[venueType]`, append `profile.voiceNotes` when non-empty.
- `src/lib/ai/refreshSlides.ts` (the 4th generator): replace its hardcoded
  "Renova … therapies" block with `getBusinessContext()` prepended to its
  slide-refresh format rules; preserve `cache_control: ephemeral`. (Mirror the
  draftBlog/generateCarousel refactor.)

**Verify:** prompt-capture (temp gated route, as before) shows identity from the
profile + an About block when a brief is set; with defaults it reads as today.
`tsc` clean.

---

## Phase 2 — Settings → Business profile page

**Objective:** admins can edit the profile.

**Files:**
- `src/app/settings/business/actions.ts` — `"use server"`; `updateBusinessProfile(p)`:
  `requireAdmin()`, `setBusinessProfile(p)`, `revalidatePath("/", "layout")`.
- `src/app/settings/business/page.tsx` — `requireAdminPage()`, read
  `getBusinessProfile()`, render a client `BusinessProfileForm`.
- `src/components/settings/BusinessProfileForm.tsx` (client) — inputs for
  name/tagline/location/phone/website/email, textareas for brief + voiceNotes;
  submit calls the action; toast + `router.refresh()`.
- `src/app/settings/page.tsx` — add a "Business profile" section entry (icon e.g.
  `Building2`/`Store`) near the top.

**Verify:** edit + save the profile; values persist; Settings index links to it.
`tsc` clean.

---

## Phase 3 — Replace the visible business name (chrome text)

**Objective:** browser tab + login + header text follow the profile name.

**Files:**
- `src/app/layout.tsx`: replace `export const metadata` with
  `export async function generateMetadata()` reading `getBusinessProfile()` →
  `title` = business name, `description` = profile/venue-derived line.
- `src/app/login/LoginForm.tsx`: subtitle "Access your clinic dashboard." →
  neutral wording ("Sign in to your dashboard."). (Business name optional here.)
- `src/components/Header.tsx`: if it renders the literal business name, switch to
  the profile name; if it's unused/dead code, leave it (note in the report).

**Verify:** browser tab shows the profile name; login subtitle no longer says
"clinic"; `tsc` clean.

---

## Phase 4 — Logo resolution (shared Logo component)

**Objective:** chrome shows the business branding logo → ClientFlow → wordmark.

**Files:**
- `src/components/ui/Logo.tsx` (new, client): props `{ src: string; alt: string; height?: number }`.
  Renders `<img src={src} alt={alt} onError={…}>`; on error sets state to show a
  "CLIENTFLOW" span in the Nebula font (`var(--font-heading)`, uppercase). One
  implementation shared by sidebar + login.
- Server-side `logoSrc` resolution (small helper or inline):
  `const logoSrc = hasBusinessLogo() ? "/api/branding/logo" : "/clientflow-logo.png"`
  where `hasBusinessLogo` uses `getBrandingLogoFilename()` + `resolveLogoPath()`
  (`lib/settings` + `lib/branding`).
- `src/app/layout.tsx`: compute `logoSrc` + business name; pass through `AppShell`
  → `Sidebar` (add props).
- `src/components/layout/AppShell.tsx`: thread `logoSrc`/`businessName` props to
  `Sidebar`.
- `src/components/layout/Sidebar.tsx`: replace the hardcoded `/renova-logo.png`
  `<Image>` with `<Logo src={logoSrc} alt={businessName} height={24} />`.
- `src/app/login/page.tsx` (server): compute `logoSrc` + name, pass to `LoginForm`.
- `src/app/login/LoginForm.tsx`: replace the hardcoded logo `<Image>` with
  `<Logo src={logoSrc} alt={businessName} height={28} />`.
- `src/app/settings/branding/page.tsx` + `BrandingForm`: update copy to
  "Your business logo — shown across the app and on your content." Use the
  business name for `alt` where shown.

**Verify:**
- Renova (has an uploaded branding logo) → chrome shows `/api/branding/logo`
  (unchanged from today's look).
- Simulate no business logo → chrome requests `/clientflow-logo.png`; with the
  file absent, the "CLIENTFLOW" wordmark renders (no broken image).
- Drop a real `app/public/clientflow-logo.png` → it renders.
- `tsc` clean.

---

## Phase 5 — Verification pass

- **No-op default:** fresh/default profile → AI header, browser tab, login, and
  chrome logo all read as today (Renova).
- **Profile edit:** change name + brief in Settings → confirm (prompt-capture) the
  AI header uses the new identity + About block with **no "Renova" leak**; browser
  tab shows the new name.
- **Logo:** business-logo path shows the upload; cleared/absent shows ClientFlow
  (or wordmark fallback).
- Screenshot login + dashboard (reuse `verify-screens.mjs`) to confirm the chrome
  logo renders in both the has-logo and fallback states.
- `npm run build` / `tsc --noEmit` clean. Remove any temp verification route.

---

## Risk notes
- `next/image` doesn't support an `onError` text swap cleanly and dislikes
  unknown dynamic sources → use a plain `<img>` in `Logo.tsx` (`images.unoptimized`
  is already set, so no optimization is lost).
- `generateMetadata` must be `async` and read the profile server-side; keep it
  cheap (one settings read).
- Keep `cache_control: ephemeral` on `refreshSlides`' system block.
- Profile defaults MUST equal today's Renova values or the "no-op until edited"
  guarantee breaks — verify in Phase 5.
- Repo not under git → verify per-phase before moving on.
