# AI Inbox — Implementation Plan (Phase 1: WhatsApp)

**Date:** 2026-05-24
**Spec:** `docs/superpowers/specs/2026-05-24-ai-inbox-design.md`
**Scope:** Phase 1 only (WhatsApp + lead/client inbox). Email = Phase 2, separate plan.
**Principle:** Each step is independently shippable and verifiable. Auto-reply lands **off by default**. Nothing blocks message ingestion.

---

## Step 0 — Schema & migrations

**Files:** `src/lib/db/schema.ts`, `src/lib/db/index.ts` (migration block)

- Add triage columns to `lead_messages` and `client_messages` (nullable, idempotent `ALTER TABLE ADD COLUMN` guarded like existing migrations): `ai_category`, `ai_priority`, `ai_summary`, `ai_confidence`, `ai_sensitive`, `ai_triaged_at`, `auto_reply_status` (default `none`), `ai_suggested_reply`.
- New `tags` table: `id`, `label`, `slug` (unique), `color`, `is_core` (bool), `created_at`.
- New `conversation_tags`: `id`, `owner_type`, `owner_id`, `tag_id` → tags, `added_by`, `created_at`; unique (`owner_type`,`owner_id`,`tag_id`).
- Seed a small **core tag vocabulary** (HBOT, PEMF, Infrared, pricing, hours, booking, urgent, upset, VIP) in `ensureSeed()` if `tags` is empty.
- Settings defaults via existing `INSERT OR IGNORE`: `auto_reply_enabled=false`, `auto_reply_categories=["faq","new_lead"]`, `auto_reply_confidence_threshold=0.8`.

**Verify:** fresh build boots; columns/tables exist; re-running migration is a no-op (no `duplicate column` failure that aborts boot).

## Step 1 — Business Brief + Business Info area

**Files:** `src/lib/businessBrief.ts` (read/write helper), new `src/app/settings/business-info/page.tsx` + form component, `src/lib/ai/buildBusinessContext.ts`, dashboard first-run prompt.

- `business_brief` stored as JSON in `settings` (sections: overview, offering, toneOfVoice, policies, faqs[], extra).
- Guided form (sections), saving to settings; "What you offer" shows auto-pulled therapies/prices read-only with a link to `/settings/therapies`.
- `buildBusinessContext()` assembles the cached grounding string from the brief + therapies + opening hours + profile. Single source used by triage **and** `draftFollowup`.
- First-run: if brief empty, show a "Complete your business brief" banner on `/dashboard`; expose `isBriefComplete()`.

**Verify:** save/reload brief round-trips; `buildBusinessContext()` returns expected text; banner shows only when empty.

## Step 2 — Triage engine

**Files:** `src/lib/ai/triageMessage.ts`, dev script `scripts/triage-replay.mjs`.

- Mirror `draftFollowup.ts`: Anthropic SDK, `claude-opus-4-7`, **cached** system prompt = instructions + category defs + core tag vocab + `buildBusinessContext()`.
- **Structured output via tool-call**: `{ category, priority, tags[], summary, confidence, sensitive, suggestedReply?, autoReplyEligible }`.
- Return token usage (like `draftFollowup`).
- `scripts/triage-replay.mjs`: run the engine over sample messages, print results — for tuning before enabling auto-reply.

**Verify:** replay script produces sensible categories/priorities/confidence on 5–10 hand-written sample messages.

## Step 3 — Triage pipeline (decision logic)

**Files:** `src/lib/inbox/triagePipeline.ts` (+ unit tests).

- `decideAutoReply(triage, settings, briefComplete)` — pure function returning `auto_send | draft | held`, applying the five gate conditions from the spec. **Unit-tested in isolation.**
- `runTriage(message)` — calls `triageMessage`, persists triage columns + `conversation_tags` (new AI tags → `is_core=false`, still linked), stages `ai_suggested_reply` or marks `held`.
- Existing-client match: sender phone/email vs `clients` table.

**Verify:** unit tests cover each gate branch (disabled, below threshold, sensitive, brief-missing, eligible) + tag persistence.

## Step 4 — Wire into WhatsApp webhook

**Files:** `src/app/api/whatsapp/webhook/route.ts`.

- After writing the inbound row and **acking** the webhook, invoke `runTriage(message)` non-blocking (fire-and-forget with error capture).
- On triage failure: leave `ai_category=null` (untriaged) — never block or error the webhook.

**Verify:** simulated inbound webhook still returns 200 immediately; triage columns populate shortly after; a forced triage error leaves the message untriaged, not lost.

## Step 5 — Conversation rollup

**Files:** `src/lib/conversations.ts`.

- Extend `listConversations()` to attach: current `category`/`priority` (from latest inbound triage), `summary`, tags (union via `conversation_tags`), and `needsAttention` (has a `drafted`/`held` message).
- Sort: priority desc → recency.

**Verify:** rollup matches seeded triage data; ordering correct.

## Step 6 — Inbox UI

**Files:** `src/components/messaging/InboxClient.tsx` (+ small subcomponents), `src/app/communication/page.tsx`.

- List row: category badge (colour) · priority dot · tag chips · AI summary · "AI auto-sent" marker.
- Filter bar: category · tag · priority · "Needs you".
- Conversation pane: staged AI draft pre-loaded in composer with **Approve & send / Edit / Discard**; auto-sent messages marked "AI"; "held for you" banner on sensitive.

**Verify (Playwright):** filters narrow the list; approving a draft sends + clears it; discarding removes it.

## Step 7 — Inbox AI settings

**Files:** new `src/app/settings/inbox-ai/page.tsx` + form/actions.

- Auto-reply master toggle (off) · auto-send categories · confidence-threshold slider.
- Tag manager: edit core vocab; approve (promote `is_core=true`) or delete AI-suggested tags.

**Verify:** toggling settings persists and changes pipeline behaviour; promoting a suggested tag flips `is_core`.

## Step 8 — Auto-reply send path

**Files:** `src/lib/inbox/triagePipeline.ts`, WhatsApp send helper, `activity_log`.

- On `auto_send`: FAQ → grounded answer from `buildBusinessContext`; new-lead → `draftFollowup`. Send via the WhatsApp bridge, log an `ai_generated` outbound (`auto_reply_status=auto_sent`) + an `activity_log` audit row.
- Transport failure → fall back to `drafted` + flag.

**Verify:** with auto-reply enabled in a test, an eligible FAQ message produces a sent outbound + audit entry; a forced send failure falls back to a draft.

## Step 9 — Error handling & re-triage

**Files:** inbox UI + a small `retriage` action.

- Untriaged messages render with a "Re-run AI" affordance.
- Confirm the brief-missing guard disables auto-reply globally.

**Verify:** re-triage on an untriaged message populates triage; auto-reply stays off while brief empty.

## Step 10 — Tests & final verification

- **Unit:** `decideAutoReply`, `buildBusinessContext`, `listConversations` rollup, tag persistence.
- **E2E (Playwright, `tests/`):** brief save + first-run prompt; inbox filters; approve-draft; settings toggle.
- **Manual:** run `triage-replay` on real-ish samples; enable auto-reply in a scratch run and confirm gating.

---

## Sequencing notes

- Steps 0–2 are foundational (schema, brief, engine). 3–5 wire it together. 6–7 are UI. 8 turns on sending. 9–10 harden.
- Ship-able checkpoints: after Step 6 you have a **read-only AI-triaged inbox** (labels/priority/tags, no sending) — usable immediately. Step 8 adds drafts/auto-reply.
- Keep total replicas = 1 (SQLite single-writer) — unchanged by this work.

## Phase 2 (separate plan, later)

Inbound email receive + outbound send (provider TBD), wired into the same `triagePipeline`; flip the Email channel tab from "Soon" to live.
