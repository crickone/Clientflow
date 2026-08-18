# Setup Guide (onboarding checklist) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A `/setup` hub with live auto-detected step status (business, AI context, branding, services, email, WhatsApp, Facebook, sending domain, import clients, invite team), driven by a dashboard progress card + a Sidebar item that vanish when complete.

**Architecture:** One server module `src/lib/setup/steps.ts` (catalog + live detection + a PURE `summarizeSetup` seam), reusing existing detection libs. No new tables — skips/ack/latch live in the tenant settings KV. A `/setup` page + `SetupChecklist` client component (one inline form for business essentials; deep-links otherwise), a dashboard card, and a Sidebar nav item.

**Tech Stack:** Next.js 14 App Router, drizzle + better-sqlite3 (sync), tsx test runner (`npm test -- <file>`), sonner, existing `Dialog`/`Button`/`Card`/`Input`.

**Spec:** `docs/superpowers/specs/2026-08-18-setup-guide-design.md`

## Global Constraints

- No new DB tables/columns. Persistence via existing settings KV (`setKey`/`readKey`/`deleteKey` from `@/lib/settings`): optional-step skip = `setup_skip_<id>` (boolean), venue ack = `setup_ack_venue` (boolean), completion/dismiss latch = `setup_complete` (boolean).
- Detection reuses EXACTLY these (verified to exist): `getBusinessProfile()`/`isBriefComplete()` (`@/lib/businessProfile`), `getBrandingLogoFilename()`/`getVenueType()`/`getSchedulingMode()`/`readKey` (`@/lib/settings`), `isEmailConfigured()` (`@/lib/email`), `isWhatsAppConfigured()` (`@/lib/whatsapp/config`), `listFacebookPages(tenantId)` (`@/lib/facebook/pages`), `getSendingDomain(tenantId)` (`@/lib/marketing/domains`), `getCurrentTenant()` (`@/lib/db/tenant`), `controlSqlite` (`@/lib/db/control`), `db`/`schema` (`@/lib/db`).
- Business-essentials save reuses the profile store: read `getBusinessProfile()`, merge, `setBusinessProfile()` (`@/lib/businessProfile`) — never write raw keys.
- All mutating server actions call `requireAdmin()` (`@/lib/auth`). Staff get read-only `/setup`; the dashboard card + Sidebar item are admin-only.
- Vocab-aware titles: step `services` → `vocab.services`, step `clients` → `vocab.members` via `getVocab(getVenueType())`.
- AppShell/layout per-page cost budget: exactly ONE `isSetupDismissed()` KV read — never run full detection on every page.
- Gate per task: `npm run typecheck` && `npm test`; UI/integration tasks also `npx next build`.
- Commit on `main` (repo convention).

---

### Task 1: Step catalog + pure summary + live wiring

**Files:**
- Create: `src/lib/setup/steps.ts`
- Test: `src/lib/setup/steps.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 2–5): the types + `SETUP_STEPS`, `summarizeSetup(defs, detections, skips, vocab): SetupSummary`, `getSetupSummary(): SetupSummary`, `isSetupDismissed()`, `setSetupDismissed(v)`, `skipStep(id)`, `ackVenue()`.

- [ ] **Step 1: Write the failing test** (pure `summarizeSetup` only — no DB):

```ts
// Run: npm test -- src/lib/setup/steps.test.ts
import assert from "node:assert/strict";
import { SETUP_STEPS, summarizeSetup } from "./steps";

const VOCAB = { services: "Classes", members: "Members" } as any;

(async () => {
  // All required detected, all optional detected → fully resolved, no next.
  const allTrue = Object.fromEntries(SETUP_STEPS.map((s) => [s.id, true]));
  const full = summarizeSetup(SETUP_STEPS, allTrue, {}, VOCAB);
  assert.equal(full.allResolved, true);
  assert.equal(full.nextHref, null);
  assert.equal(full.requiredDone, full.requiredTotal);
  assert.equal(full.resolved, full.total);

  // Nothing done → not resolved; requiredDone 0; nextHref = first step's action href-or-/setup.
  const none = summarizeSetup(SETUP_STEPS, {}, {}, VOCAB);
  assert.equal(none.allResolved, false);
  assert.equal(none.requiredDone, 0);
  assert.ok(none.nextHref, "nextHref points at the first unresolved step");
  assert.equal(none.resolved, 0);

  // An optional step SKIPPED counts as resolved but not done.
  const optional = SETUP_STEPS.find((s) => s.optional)!;
  const required = SETUP_STEPS.filter((s) => !s.optional);
  // every required done, the chosen optional skipped, other optionals still open:
  const det = Object.fromEntries(required.map((s) => [s.id, true]));
  const withSkip = summarizeSetup(SETUP_STEPS, det, { [optional.id]: true }, VOCAB);
  const row = withSkip.steps.find((s) => s.id === optional.id)!;
  assert.equal(row.skipped, true);
  assert.equal(row.done, false);
  // allResolved requires the OTHER optionals resolved too — so still false here
  // unless this is the only optional; assert the skipped one is counted resolved:
  assert.ok(withSkip.resolved >= required.length + 1);

  // requiredTotal is the count of non-optional steps; vocab overrides a title.
  assert.equal(full.requiredTotal, required.length);
  const servicesRow = full.steps.find((s) => s.id === "services")!;
  assert.equal(servicesRow.title, "Classes", "labelKey services → vocab.services");
  const clientsRow = full.steps.find((s) => s.id === "clients")!;
  assert.ok(clientsRow.title.includes("Members"), "labelKey members → vocab.members");

  console.log("steps.test.ts: all assertions passed");
})();
```

- [ ] **Step 2: Run test — verify it fails** (`Cannot find module "./steps"`).

- [ ] **Step 3: Implement `src/lib/setup/steps.ts`.** Types + catalog + pure summary + live wiring:

```ts
import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentTenant } from "@/lib/db/tenant";
import { controlSqlite } from "@/lib/db/control";
import { readKey, setKey, getBrandingLogoFilename, getVenueType, getSchedulingMode } from "@/lib/settings";
import { getBusinessProfile, isBriefComplete } from "@/lib/businessProfile";
import { isEmailConfigured } from "@/lib/email";
import { isWhatsAppConfigured } from "@/lib/whatsapp/config";
import { listFacebookPages } from "@/lib/facebook/pages";
import { getSendingDomain } from "@/lib/marketing/domains";
import { getVocab, type Vocab } from "@/lib/vocabulary";

export type SetupGroup = "foundation" | "channels" | "data";
export type SetupAction =
  | { kind: "link"; href: string; secondaryHref?: string }
  | { kind: "inline-business" }
  | { kind: "ack-venue" };
export interface SetupStepDef {
  id: string; group: SetupGroup; title: string; blurb: string;
  agencyNote?: string; optional?: boolean; action: SetupAction;
  labelKey?: "services" | "members";
}
export interface SetupStepStatus extends SetupStepDef { done: boolean; skipped: boolean }
export interface SetupSummary {
  steps: SetupStepStatus[];
  requiredDone: number; requiredTotal: number; resolved: number; total: number;
  allResolved: boolean; nextHref: string | null;
}

export const SETUP_STEPS: SetupStepDef[] = [
  { id: "business", group: "foundation", title: "Business essentials",
    blurb: "Your name, contact details and website — shown across the app and used in AI content.",
    action: { kind: "inline-business" } },
  { id: "venue", group: "foundation", title: "Venue type & scheduling",
    blurb: "Tell us whether you run a clinic or a gym, and how you schedule.",
    action: { kind: "ack-venue" } },
  { id: "ai_context", group: "foundation", title: "Teach the AI your business",
    blurb: "A brief (and optional Marketing Brain) so generated content, images and replies sound like you.",
    action: { kind: "link", href: "/settings/business" } },
  { id: "branding", group: "foundation", title: "Logo & appearance",
    blurb: "Upload your logo (used on posts, cards and the app) and set your theme.",
    action: { kind: "link", href: "/settings/branding", secondaryHref: "/settings/appearance" } },
  { id: "services", group: "foundation", title: "Services", labelKey: "services",
    blurb: "Add what you offer so it can be booked, sold and written about.",
    action: { kind: "link", href: "/settings/therapies" } },
  { id: "email", group: "channels", title: "Connect email",
    blurb: "Send from your own address — connect Gmail or your verified domain.",
    action: { kind: "link", href: "/settings/email" } },
  { id: "whatsapp", group: "channels", title: "WhatsApp", optional: true,
    blurb: "Message leads and clients from a connected WhatsApp number.",
    action: { kind: "link", href: "/settings/integrations/whatsapp" } },
  { id: "facebook", group: "channels", title: "Facebook Lead Ads", optional: true,
    blurb: "Pull Lead Ads leads in automatically once your Page is connected.",
    agencyNote: "Client Pages need our Meta app approved — your account manager connects this with you.",
    action: { kind: "link", href: "/settings/integrations/facebook" } },
  { id: "domain", group: "channels", title: "Campaign sending domain", optional: true,
    blurb: "Verify a domain to send bulk email campaigns at scale.",
    agencyNote: "Agency-managed — only needed for bulk email marketing.",
    action: { kind: "link", href: "/campaigns/domains" } },
  { id: "clients", group: "data", title: "Import your clients", labelKey: "members",
    blurb: "Bring your existing list in from a CSV (Mindbody, Glofox, TeamUp…), or add one by hand.",
    action: { kind: "link", href: "/clients/import", secondaryHref: "/clients/new" } },
  { id: "team", group: "data", title: "Invite your team", optional: true,
    blurb: "Add staff and admin accounts so your team can log in.",
    action: { kind: "link", href: "/settings/users" } },
];

/** PURE: apply detections + skips to the defs, compute counts / allResolved / nextHref. */
export function summarizeSetup(
  defs: SetupStepDef[], detections: Record<string, boolean>, skips: Record<string, boolean>, vocab: Vocab,
): SetupSummary {
  const steps: SetupStepStatus[] = defs.map((d) => ({
    ...d,
    title: d.labelKey === "services" ? vocab.services
         : d.labelKey === "members" ? `Import your ${vocab.members.toLowerCase()}`
         : d.title,
    done: detections[d.id] === true,
    skipped: !detections[d.id] && skips[d.id] === true,
  }));
  const required = steps.filter((s) => !s.optional);
  const requiredDone = required.filter((s) => s.done).length;
  const resolved = steps.filter((s) => s.done || s.skipped).length;
  const firstUnresolved = steps.find((s) => !s.done && !s.skipped);
  const nextHref = firstUnresolved
    ? (firstUnresolved.action.kind === "link" ? firstUnresolved.action.href : "/setup")
    : null;
  return {
    steps,
    requiredDone, requiredTotal: required.length,
    resolved, total: steps.length,
    allResolved: firstUnresolved === undefined,
    nextHref,
  };
}

function serviceCount(): number {
  return db.select({ id: schema.therapies.id }).from(schema.therapies).all().length;
}
function clientCount(): number {
  return db.select({ id: schema.clients.id }).from(schema.clients).all().length;
}
function membershipCount(tenantId: number): number {
  const row = controlSqlite.prepare("SELECT COUNT(*) c FROM memberships WHERE tenant_id = ?").get(tenantId) as { c: number };
  return row.c;
}

/** WIRES live detections for the current tenant → summarizeSetup. */
export function getSetupSummary(): SetupSummary {
  const tenantId = getCurrentTenant().id;
  const p = getBusinessProfile();
  const detections: Record<string, boolean> = {
    business: p.businessName.trim().length > 0 && (p.phone.trim().length > 0 || p.location.trim().length > 0),
    venue: readKey<boolean>("setup_ack_venue", false) === true,
    ai_context: isBriefComplete() || p.marketingBrain.trim().length > 0,
    branding: getBrandingLogoFilename() !== null,
    services: serviceCount() > 0,
    email: isEmailConfigured(),
    whatsapp: isWhatsAppConfigured(),
    facebook: listFacebookPages(tenantId).length > 0,
    domain: getSendingDomain(tenantId)?.state === "verified",
    clients: clientCount() > 0,
    team: membershipCount(tenantId) > 1,
  };
  const skips: Record<string, boolean> = Object.fromEntries(
    SETUP_STEPS.filter((s) => s.optional).map((s) => [s.id, readKey<boolean>(`setup_skip_${s.id}`, false) === true]),
  );
  return summarizeSetup(SETUP_STEPS, detections, skips, getVocab(getVenueType()));
}

export function isSetupDismissed(): boolean { return readKey<boolean>("setup_complete", false) === true; }
export function setSetupDismissed(v: boolean): void { setKey("setup_complete", v); }
export function ackVenue(): void { setKey("setup_ack_venue", true); }
export function skipStep(id: string): void {
  const step = SETUP_STEPS.find((s) => s.id === id);
  if (!step || !step.optional) throw new Error("Only optional steps can be skipped.");
  setKey(`setup_skip_${id}`, true);
}
```

- [ ] **Step 4: Run test — verify PASS.**
- [ ] **Step 5: Typecheck + commit** (`npm run typecheck`; `git commit -m "feat(setup): step catalog + pure summary + live detection wiring"`).

---

### Task 2: Server actions

**Files:**
- Create: `src/app/setup/actions.ts`

**Interfaces:**
- Consumes Task 1 (`skipStep`, `ackVenue`, `setSetupDismissed`), `getBusinessProfile`/`setBusinessProfile`, `requireAdmin`, `getVenueType`/`setVenueType`/`getSchedulingMode`/`setSchedulingMode`.
- Produces (Tasks 3–4 consume): `saveBusinessEssentialsAction(input)`, `ackVenueAction(input)`, `skipStepAction(id)`, `dismissSetupAction()`. Result shape `{ ok: true } | { ok: false; error: string }`.

- [ ] **Step 1: Implement** (mirror an existing settings action's `"use server"` + `requireAdmin` + result shape — read `src/app/settings/business/actions.ts` first):

```ts
"use server";
import { requireAdmin } from "@/lib/auth";
import { getBusinessProfile, setBusinessProfile } from "@/lib/businessProfile";
import { setVenueType, setSchedulingMode } from "@/lib/settings";
import type { VenueType, SchedulingMode } from "@/lib/settings"; // adjust to actual exported type names
import { ackVenue, skipStep, setSetupDismissed } from "@/lib/setup/steps";

type Res = { ok: true } | { ok: false; error: string };

export async function saveBusinessEssentialsAction(input: {
  businessName: string; tagline: string; location: string; phone: string; website: string;
}): Promise<Res> {
  await requireAdmin();
  const name = String(input?.businessName ?? "").trim();
  if (!name) return { ok: false, error: "Business name is required." };
  const current = getBusinessProfile();
  setBusinessProfile({
    ...current,
    businessName: name,
    tagline: String(input.tagline ?? "").trim(),
    location: String(input.location ?? "").trim(),
    phone: String(input.phone ?? "").trim(),
    website: String(input.website ?? "").trim(),
  });
  return { ok: true };
}

export async function ackVenueAction(input: { venue: VenueType; scheduling: SchedulingMode }): Promise<Res> {
  await requireAdmin();
  setVenueType(input.venue);
  setSchedulingMode(input.scheduling);
  ackVenue();
  return { ok: true };
}

export async function skipStepAction(id: string): Promise<Res> {
  await requireAdmin();
  try { skipStep(id); return { ok: true }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Couldn't skip." }; }
}

export async function dismissSetupAction(): Promise<Res> {
  await requireAdmin();
  setSetupDismissed(true);
  return { ok: true };
}
```

(Verify the exact exported names/types for `VenueType`/`SchedulingMode` in `@/lib/settings` and match them; if `requireAdmin` returns the user vs throws, follow its actual contract as used by sibling actions.)

- [ ] **Step 2: Typecheck + commit** (`git commit -m "feat(setup): server actions (business essentials, venue ack, skip, dismiss)"`).

---

### Task 3: SetupChecklist component + /setup page

**Files:**
- Create: `src/components/setup/SetupChecklist.tsx` (client)
- Create: `src/app/setup/page.tsx` (`force-dynamic`)

**Interfaces:**
- Consumes: `getSetupSummary()`, `getCurrentMembership()` (role), the Task 2 actions, `getVenueType`/`getSchedulingMode` (to prefill the venue control).
- Page passes `summary`, `isAdmin`, and current `venue`/`scheduling` to the component.

- [ ] **Step 1: Page** (`src/app/setup/page.tsx`):

```tsx
import { PageHeader } from "@/components/layout/PageHeader";
import { getCurrentMembership } from "@/lib/auth";
import { getSetupSummary } from "@/lib/setup/steps";
import { getVenueType, getSchedulingMode } from "@/lib/settings";
import { SetupChecklist } from "@/components/setup/SetupChecklist";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  const summary = getSetupSummary();
  const isAdmin = getCurrentMembership()?.role === "admin";
  return (
    <div className="app-page" style={{ maxWidth: 860 }}>
      <PageHeader eyebrow="Get started" title="Set up your account"
        subtitle={`${summary.requiredDone}/${summary.requiredTotal} essentials done — work through the list to get fully up and running.`} />
      <SetupChecklist summary={summary} isAdmin={isAdmin}
        venue={getVenueType()} scheduling={getSchedulingMode()} />
    </div>
  );
}
```

- [ ] **Step 2: Component** — `SetupChecklist.tsx`. Requirements (match the codebase's inline-style + `Card`/`Button`/`Dialog`/`Input`/`Textarea`/sonner idioms; read `ImageDesigner`/`BrandingForm` for the idiom):
  - Group the `summary.steps` into the three groups (`foundation`/`channels`/`data`) with headings ("The basics" / "Channels" / "Your data & team").
  - Each row: a status pill — **Done** (green ✓), **Skipped** (muted), or **To do** (amber); the title; the blurb; `agencyNote` shown only when `isAdmin` (muted, smaller).
  - Row action (admins only; staff render status only, no buttons):
    - `link`: a "Set up →" button linking to `action.href` (+ a secondary link when `secondaryHref` — e.g. "or add one by hand"). Done rows show a quiet "Review" link instead.
    - `inline-business`: a "Fill in →" button opening a `Dialog` with fields businessName/tagline/location/phone/website (prefilled from… pass current values in — extend the page to pass `businessDefaults` from `getBusinessProfile()`), Save calls `saveBusinessEssentialsAction`, on ok `toast.success` + `router.refresh()`.
    - `ack-venue`: an inline control — two small toggle groups (Clinic/Gym; Appointments/Timetable) defaulting to `venue`/`scheduling`, and a "Confirm" button calling `ackVenueAction`. On ok `router.refresh()`.
    - optional + not done + not skipped: also a quiet "Skip" text-button → `skipStepAction(id)` → `router.refresh()`.
  - A footer when `summary.allResolved`: a "You're all set 🎉 — Dismiss this guide" button → `dismissSetupAction()` → `router.push("/dashboard")`.
  - Busy states disable buttons; errors `toast.error`.

- [ ] **Step 3: Gate** (`npm run typecheck && npm test && npx next build`) **+ commit** (`git commit -m "feat(setup): /setup hub — checklist, inline business form, venue confirm, skip/dismiss"`).

---

### Task 4: Dashboard progress card

**Files:**
- Create: `src/components/dashboard/SetupProgressCard.tsx` (client — has a "Dismiss" button + Continue link)
- Modify: `src/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `getSetupSummary`, `isSetupDismissed`, `dismissSetupAction`.

- [ ] **Step 1: Card component** — props `{ requiredDone, requiredTotal, nextHref }`. Renders a `Card` (match dashboard's `Card`/`Reveal` idiom): title "Finish setting up", a `requiredDone/requiredTotal` progress bar, "Continue →" `Link` to `nextHref ?? "/setup"`, and a quiet "Dismiss" button → `dismissSetupAction()` → `router.refresh()`. Busy/err handling with sonner.

- [ ] **Step 2: Wire into dashboard** — in `src/app/dashboard/page.tsx`, near the top of the returned JSX (above the KPI grid), admin-only + not dismissed + not already all-resolved:

```tsx
// after existing imports:
import { getSetupSummary, isSetupDismissed } from "@/lib/setup/steps";
import { getCurrentMembership } from "@/lib/auth";
import { SetupProgressCard } from "@/components/dashboard/SetupProgressCard";
// in the component body:
const isAdmin = getCurrentMembership()?.role === "admin";
const setup = isAdmin && !isSetupDismissed() ? getSetupSummary() : null;
// in JSX, first child inside <div className="app-page">, before <PageHeader> or right after it:
{setup && !setup.allResolved && (
  <SetupProgressCard requiredDone={setup.requiredDone} requiredTotal={setup.requiredTotal} nextHref={setup.nextHref} />
)}
```

(Place it where it reads well — a full-width card above the KPIs. Match the existing `Reveal` wrapping if the dashboard wraps sections.)

- [ ] **Step 3: Gate + commit** (`git commit -m "feat(setup): dashboard progress card (admin-only, hidden when done/dismissed)"`).

---

### Task 5: Sidebar item + dot (threaded through layout → AppShell → Sidebar)

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/app/layout.tsx`

Read all three first. The prop name is `showSetup: boolean`.

**Interfaces:**
- `src/app/layout.tsx` computes `isSetupDismissed()` (the ONE per-page read) and passes `showSetup={!dismissed}` into `<AppShell>`. AppShell adds `showSetup` to its props type and forwards it to `<Sidebar>`. Sidebar adds `showSetup` to its props.

- [ ] **Step 1: Sidebar.** Add `dot?: boolean` to the `NavLink` type. Add a Setup link to the FIRST NAV section:

```ts
{ items: [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/setup", label: "Set up", icon: Rocket, adminOnly: true, dot: true }, // import Rocket from lucide-react
] },
```

Add `showSetup: boolean` to the Sidebar props type + destructure. Extend `linkAllowed` so the setup link is hidden when `!showSetup`:

```ts
const linkAllowed = (l: NavLink) =>
  (!l.adminOnly || isAdmin) &&
  (!l.tenants || l.tenants.includes(tenantSlug)) &&
  (!l.mode || l.mode === schedulingMode) &&
  (l.href !== "/setup" || showSetup);
```

In the NavLink render (the `<span>{item.labelKey ? vocab[item.labelKey] : item.label}</span>` line ~306), render a small amber dot after the label when `item.dot`:

```tsx
{item.dot && <span aria-hidden style={{ marginLeft: "auto", width: 7, height: 7, borderRadius: "50%", background: "var(--warning, #f59e0b)" }} />}
```

(Match the row's flex layout — if the row isn't already `display:flex; align-items:center`, place the dot so it sits at the row's right edge without breaking the existing active-state styling.)

- [ ] **Step 2: AppShell.** Add `showSetup: boolean` to the props type; forward `showSetup={showSetup}` to `<Sidebar>`.

- [ ] **Step 3: layout.tsx.** Import `isSetupDismissed` from `@/lib/setup/steps`; compute it where the other AppShell props are assembled (only meaningful when there's a signed-in user/tenant — guard the same way `schedulingMode`/`vocab` are computed, so a logged-out render doesn't call tenant-scoped reads); pass `showSetup={user ? !isSetupDismissed() : false}`.

- [ ] **Step 4: Gate + commit** (`npm run typecheck && npm test && npx next build`; `git commit -m "feat(setup): Sidebar Set-up item with nudge dot, hidden once dismissed"`).

---

## Post-plan (controller)

- Final whole-branch review (opus): tenancy (all detection + KV per-tenant), the one-read AppShell budget, role gating on every action, no cross-tenant leakage in counts, vocab correctness, and that existing tenants aren't disrupted (Renova/Inspire mostly-satisfied → card shows high progress or hidden).
- Deploy: `cd app && railway up` after the gate. No env, no migration.

## Self-review notes

- Spec coverage: catalog+detection (T1), actions (T2), hub UI (T3), dashboard nudge (T4), sidebar nudge (T5) — all steps + role-awareness + auto-detection covered.
- Type consistency: `SetupSummary`/`SetupStepStatus`/`getSetupSummary`/`isSetupDismissed` names stable across T1→T5; action names stable T2→T4.
- Per-page cost: only `layout.tsx` runs on every page and it calls only `isSetupDismissed()` (one KV read); full `getSetupSummary()` runs only on `/setup` + the dashboard (admin, not-dismissed).
