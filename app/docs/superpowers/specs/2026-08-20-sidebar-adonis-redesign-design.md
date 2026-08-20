# Sidebar Redesign + Adonis Section — Design

**Date:** 2026-08-20 · **Status:** APPROVED (design)
**Reference:** the "Hermes Agent" screenshot the user shared — clean full-height chat: washed background, a big **centered wordmark**, a one-line subtitle, a **chat input pinned at the bottom**, and a **settings gear top-right**.

## Goal

Two changes to the left sidebar (`app/src/components/layout/Sidebar.tsx`) + one new view:
1. Fold the nav into **five collapsible top-level groups** — Clients · Coaching · Business · Marketing · System — so only the headings show until clicked.
2. Add a prominent **Adonis** item pinned at the very top (the product's flagship) → a clean `/adonis` chat view built to the Hermes template, with the new **ADONIS AGENT wordmark** centered and the **Orchestrator ("Adonis") chat**. A **gear top-right** opens the existing `/agents` page (agent settings). The old **"AI → Agents"** navbar item is **removed** (relocated behind that gear).

## Nav structure (top → bottom)

```
[business logo / account switcher]      (unchanged brand header)
◆ Adonis                                 NEW — pinned top, prominent (accent-styled), → /adonis
  Dashboard                              standalone link (→ /dashboard)
▸ Clients      (collapsible group)       Clients · Leads · Communication · Calendar · Appointments
▸ Coaching     (collapsible group)       Timetable · Attendance · Nutrition▸ · Workout▸ · Forms▸ · Automation
▸ Business     (collapsible group)       Products▸ · Staff · Reports
▸ Marketing    (collapsible group)       Marketing · Seasonal calendar · Sites · Content Studio · Email campaigns▸
▸ System        (collapsible group)      My App · Training · Settings · Set up
[user · sign out]                        (unchanged footer)
[date / time]                            (unchanged)
```

- The five groups are **folded by default**; the group whose child matches the current route **auto-expands** (reuse the existing `openGroups` state + `expanded = openGroups[label] ?? childActive` pattern).
- The current sub-menus (Nutrition, Workout, Forms, Products, Email campaigns) become **nested groups inside their parent** — so group rendering must become **recursive** (a group's children may be links OR sub-groups; indent per depth). Today's render only handles link children of a group; it needs to recurse.
- `Set up` (dismissible, admin, dot) moves into the **System** group. `Dashboard` becomes a standalone top link. The **"AI" section (Agents) is removed** from `NAV`.
- All existing per-item gating (`adminOnly`, `tenants`, `mode`, `labelKey` vocab, `dot`, active-state, the `nav-active-bar` motion) must keep working through the nesting.
- **Adonis item**: distinct from a normal row — accent-tinted, its own icon (the app's mark / `Sparkles`/`Bot`), active when `pathname` starts with `/adonis`. Pinned above Dashboard.

## The Adonis view (`/adonis`) — the Hermes template

- New `app/src/app/adonis/page.tsx` (+ a client view component). Full-height, clean, theme-aware. Auth-gated like the rest of the app chrome (staff-visible — the Orchestrator/"Adonis" chat is staff-facing today).
- **Empty state (no messages):** the **ADONIS AGENT wordmark centered** (reuse `/adonis-logo.svg` as a `currentColor` CSS mask, sized large, like `Logo.tsx` does) + the subtitle **"Turning Conversations Into Campaigns"** beneath it. A **chat input pinned at the bottom** ("Ask Adonis…"/"Describe what you need").
- **Active chat:** messages render above the input; the hero can shrink/hide once a conversation starts.
- The chat is the existing **Orchestrator** agent — reuse the `AssistantChat` component (and the `/api/agents/orchestrator/chat` endpoint the dashboard/agents already drive), so the specialist routing + write-approval gate are unchanged. The implementer reuses the current orchestrator-chat wiring rather than inventing a new endpoint.
- **Settings gear, top-right** → a plain link to `/agents` (the existing page: org chart, per-agent model pickers, spend cap). `/agents` stays a real route; it's just no longer in the navbar.
- Optional (only if a suitable asset exists): a very faint classical/brand background like the Hermes shot. Skip if there's no clean asset — the centered wordmark on the app background is enough.

## Non-goals
- No change to `/agents`' own content (only its nav placement).
- No change to the Orchestrator agent, its endpoint, tools, or the write-approval gate.
- No change to the dashboard (its AI daily brief stays); only the *chat* gets a dedicated home at `/adonis`.

## Tasks (for the plan)
1. **Sidebar restructure** — `NAV` rebuilt to Adonis + Dashboard + 5 collapsible groups (Setup→System, Agents removed); recursive group render (links + nested sub-groups) preserving all gating/active/motion.
2. **The `/adonis` view** — Hermes-template page: centered ADONIS AGENT wordmark + "Turning Conversations Into Campaigns" + the reused Orchestrator `AssistantChat` + gear→`/agents`.
3. **Review** (UI: typecheck + build + reasoned states; user eyeballs the visual).
