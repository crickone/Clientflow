# Setup Guide (onboarding checklist) — Design

**Date:** 2026-08-18 · **Status:** approved by user (role-aware · auto-detecting checklist hub · dashboard banner + nav)

## Goal

A new tenant can self-onboard end-to-end: business essentials, teaching the AI its context, logo/appearance, services, email, WhatsApp, Facebook Lead Ads, sending domain, importing clients, inviting team. A `/setup` hub shows each step with **live auto-detected status** (done / pending / skipped) — no manual checkboxes to lie — and each step opens the REAL settings surface (one inline quick-form for business essentials; deep-links for everything else, especially OAuth flows that must redirect anyway). A dashboard progress card + a Sidebar item drive tenants to finish; both vanish once complete.

## Non-goals (v1)

- Forced first-login flow (persistent nudge, never blocking).
- Embedding OAuth flows (Gmail/Facebook/WhatsApp) inline — they redirect; the hub deep-links to the existing connect screens.
- Duplicating settings forms — only ONE inline form (business essentials); every other step links out.
- Product/plan setup, client-mobile-app onboarding.

## Architecture

One new server module `src/lib/setup/steps.ts` (server-only) — the step catalog + live detection + status summary, reusing existing libs. **No new tables:** skip acks + the completion latch live in the existing tenant settings KV (`setKey`/`readKey`). A pure `summarizeSetup(steps, detections, skips)` seam makes the grouping/counting/allDone logic unit-testable without a DB.

### Detection map (each step → an existing signal)

| # | Group | id | Step (venue-aware label) | `detect(ctx)` returns true when | Action |
|---|-------|-----|------|------|--------|
| 1 | Foundation | `business` | Business essentials | `p.businessName.trim() && (p.phone.trim() \|\| p.location.trim())` | **inline** quick-form (name, tagline, location, phone, website) |
| 2 | Foundation | `venue` | Venue type & scheduling | KV `setup_ack_venue === true` | **inline** confirm (venue + scheduling buttons; writes `setVenueType`/`setSchedulingMode` + the ack) |
| 3 | Foundation | `ai_context` | Teach the AI your business | `isBriefComplete()` OR `p.marketingBrain.trim().length > 0` | link `/settings/business` |
| 4 | Foundation | `branding` | Logo & appearance | `getBrandingLogoFilename() !== null` | link `/settings/branding` |
| 5 | Foundation | `services` | Services / classes (vocab) | active-service count `> 0` | link `/settings/therapies` |
| 6 | Channels | `email` | Connect email | `isEmailConfigured()` | link `/settings/email` |
| 7 | Channels | `whatsapp` | WhatsApp *(optional)* | `isWhatsAppConfigured()` | link `/settings/integrations/whatsapp` |
| 8 | Channels | `facebook` | Facebook Lead Ads *(optional)* | `listFacebookPages(tenantId).length > 0` | link `/settings/integrations/facebook` |
| 9 | Channels | `domain` | Campaign sending domain *(optional, admin)* | `getSendingDomain(tenantId)?.state === "verified"` | link `/campaigns/domains` |
| 10 | Data & team | `clients` | Import your clients/members (vocab) | client count `> 0` | link `/clients/import` (+ secondary `/clients/new`) |
| 11 | Data & team | `team` | Invite your team *(optional)* | tenant membership count `> 1` | link `/settings/users` |

- **Optional steps** (`whatsapp`, `facebook`, `domain`, `team`) carry a **Skip** action → writes KV `setup_skip_<id> = true`; skipped counts as "resolved" for completion but renders distinctly.
- **Required** = the other 7. `allRequiredResolved` = every required step `detect` true. `allResolved` = every step done-or-skipped.
- **Completion latch:** once `allResolved` (or the user hits "Dismiss"), write KV `setup_complete = true`. `isSetupDismissed()` reads that one boolean — this is what AppShell checks per-page (cheap) so it doesn't run 11 detections on every render. The `/setup` page + dashboard card recompute full live status (their own cost) and can *clear* the latch if a signal regresses is NOT required — latch is one-way "finished", re-openable only via the always-present Settings entry.

### Module API (`src/lib/setup/steps.ts`)

```ts
export type SetupGroup = "foundation" | "channels" | "data";
export interface SetupStepDef {
  id: string; group: SetupGroup; title: string; blurb: string;
  agencyNote?: string;              // shown to admins where agency plumbing is involved
  optional?: boolean;
  action: { kind: "link"; href: string; secondaryHref?: string }
        | { kind: "inline-business" } | { kind: "ack-venue" };
  labelKey?: "services" | "members";// venue-aware title override
}
export interface SetupStepStatus extends SetupStepDef {
  done: boolean; skipped: boolean;
}
export interface SetupSummary {
  steps: SetupStepStatus[];
  requiredDone: number; requiredTotal: number;
  resolved: number; total: number;
  allResolved: boolean;
  nextHref: string | null;          // first unresolved step's action href (for "Continue")
}
export const SETUP_STEPS: SetupStepDef[];
// PURE — unit-tested: applies detections+skips to defs, computes counts/allResolved/nextHref
export function summarizeSetup(
  defs: SetupStepDef[], detections: Record<string, boolean>, skips: Record<string, boolean>, vocab: Vocab,
): SetupSummary;
// WIRES live detections (reads db/settings/control for the current tenant) → summarizeSetup
export function getSetupSummary(): SetupSummary;
export function isSetupDismissed(): boolean;          // reads setup_complete latch
export function setSetupDismissed(v: boolean): void;
export function skipStep(id: string): void;           // optional steps only; setKey setup_skip_<id>
export function ackVenue(): void;                      // setKey setup_ack_venue = true
```

- `getSetupSummary()` builds `detections` by calling each real signal (imports: `getBusinessProfile`/`isBriefComplete`, `getBrandingLogoFilename`, `isEmailConfigured`, `isWhatsAppConfigured`, `listFacebookPages`, `getSendingDomain`, `getVenueType`/`getSchedulingMode`/`readKey`, plus two small counts). Service count + client count via request-scoped `db` (`schema.therapies`, `schema.clients`); membership count via `controlSqlite` (`SELECT COUNT(*) FROM memberships WHERE tenant_id = ?`).

## Pages, components, entry points

- **`/setup`** (`src/app/setup/page.tsx`, `force-dynamic`) — `getCurrentMembership()` for role; renders `<SetupChecklist summary role/>`. Server actions in `src/app/setup/actions.ts` (all `requireAdmin`): `saveBusinessEssentialsAction`, `ackVenueAction`, `skipStepAction`, `dismissSetupAction`. Staff see the checklist **read-only** (status only, no action buttons).
- **`SetupChecklist`** (`src/components/setup/SetupChecklist.tsx`, client) — three group cards; each row = icon + title + blurb (+ agencyNote for admins) + a status pill (Done ✓ / To do / Skipped) + the action (link button, or the inline Business dialog, or the venue-confirm inline control, or Skip for optional). Uses the existing `Dialog`, `Button`, `Card`, `Input`/`Textarea`, sonner.
- **Dashboard card** `SetupProgressCard` (`src/components/dashboard/SetupProgressCard.tsx`) — admin-only, rendered near the top of `src/app/dashboard/page.tsx` when `!isSetupDismissed()`: "Finish setting up — {requiredDone}/{requiredTotal}" + progress bar + "Continue →" (→ `nextHref` or `/setup`) + a "Dismiss" (→ `dismissSetupAction`). Dashboard already computes cheap things; it calls `getSetupSummary()` once.
- **Sidebar** — a `Setup` `NavLink` (`href:/setup`, admin-only) in the top section, shown only while `!setupDismissed`; a small amber dot when incomplete. `AppShell` computes `const setupDismissed = isSetupDismissed()` (ONE KV read) and threads a `showSetup` boolean into `Sidebar`; `NavLink` gains an optional `dot?: boolean` rendered as a tiny amber circle.

## Role-awareness

- Admin: full actions; agencyNotes visible (e.g. Facebook: "Client Pages need our Meta app approved — your account manager connects this with you"; Sending domain: "Agency-managed — needed only for bulk email").
- Staff: `/setup` + dashboard card render status only (no buttons, no dot-nudge to a page they can't action) — actually the Sidebar Setup item is admin-only, and the dashboard card is admin-only; staff simply don't see the nudges. `/setup` remains viewable read-only if navigated to.

## Testing

- `summarizeSetup` pure tests: required/optional counting, skip resolves an optional, `allResolved` only when every required done + every optional done-or-skipped, `nextHref` = first unresolved, vocab label override. (tsx runner, no DB.)
- Gate: `npm run typecheck` && `npm test` && `npx next build`.

## Rollout

Ships behaviourally additive — existing tenants (Renova/Inspire) will see the nudges until they've done/skipped each step (most already satisfied → card shows high completion or, if all resolved, stays hidden). No migration. No env. Deploy = `railway up` from `app/`.
