# AI Inbox (Kinso-style) — Design Spec

**Date:** 2026-05-24
**Status:** Approved (design); pending implementation plan
**Topic:** Consolidated AI-triaged inbox for `/communication`

## 1. Goal

Turn the existing `/communication` inbox into a consolidated, AI-triaged inbox. Every inbound message is read by AI and assigned a **category**, **tags**, a **priority**, and a one-line **summary**. Safe categories can be **auto-replied** (confidence-gated). All AI grounding comes from a single **Business Brief** captured at setup. The whole thing extends the already-built, already-deployed WhatsApp + lead/client inbox rather than replacing it.

## 2. Scope

**In scope (this project):**
- AI triage engine + data model.
- Auto-reply with a confidence gate (off by default).
- Business Brief + a consolidated "Business Info" settings area.
- Inbox UI upgrades (category/priority/tags/summary, filters, draft-approve).
- Channels: **WhatsApp** (Phase 1, already live) and **Email** (Phase 2, new receive+send).

**Out of scope (later):**
- Facebook / Instagram DM ingestion (Meta Graph API + app review).
- Facebook Lead Ads wired into triage (intake exists; triage wiring deferred).
- Refactoring the `lead_messages` / `client_messages` split into one unified `messages` table (noted as a future improvement; not done now to avoid a risky migration of live production data).
- A full multi-screen onboarding wizard (we ship a lightweight "complete your brief" prompt instead).

## 3. Delivery approach

**Phased (Approach ①).**
- **Phase 1:** Triage engine + data model + Business Brief/Business Info + upgraded inbox UI + auto-reply, all on the **WhatsApp** foundation. Auto-reply ships **OFF by default**; operator watches AI labels/drafts, then enables it once trusted.
- **Phase 2:** Email channel (inbound receive + outbound send) feeding the **same** triage engine. The triage layer is built channel-agnostic so email slots in with minimal change.

## 4. Behavioural requirements (decisions)

- **AI role:** Triage + auto-reply for some categories (confidence-gated).
- **Categories:** `new_lead`, `booking` (booking/reschedule/cancel), `existing_client`, `faq` (general enquiry/FAQ). Plus internal flags: `sensitive` (medical/upset/complaint) and a `spam`/`other` catch-all.
- **Auto-reply categories:** `faq` and `new_lead` auto-send; `booking` and `existing_client` produce a draft for approval; anything `sensitive` is always **held** for the operator, never drafted-for-auto.
- **Safety model:** **Confidence gate only** — auto-send instantly *only* when category ∈ auto-set AND `confidence ≥ threshold` AND `sensitive = false` AND `auto_reply_enabled = true` AND the Business Brief exists. Anything below threshold or uncertain drops to **draft-for-approval**. No timed hold window.
- **Tags:** **Hybrid** — a controlled core vocabulary the AI must use, plus AI-suggested new tags the operator can approve/promote.
- **Priority:** three levels — `high` / `normal` / `low` — derived by the AI from intent, urgency, and commercial value.
- **Grounding:** the **Business Brief** (guided sections) + structured data (therapies/prices/durations, opening hours, location/profile). FAQ auto-replies must be answerable from this grounded data; if not, confidence is low → draft.

## 5. Architecture & components

```
inbound message (WhatsApp webhook | email receive)
        │  write message row (existing path)
        ▼
  triagePipeline (src/lib/inbox/triagePipeline.ts)
        │  1. triageMessage()  → structured triage result
        │  2. persist triage (columns + tags)
        │  3. decide:
        │       auto-send?  → generate reply (grounded FAQ | draftFollowup) → send → log outbound + activity_log
        │       else        → store suggested draft (status=drafted) for approval
        │       sensitive   → status=held
        ▼
  inbox UI (InboxClient) reads conversations + triage rollup
```

- **`src/lib/ai/triageMessage.ts`** — the Claude call. Mirrors `draftFollowup.ts`: Anthropic SDK, `claude-opus-4-7`, **cached** system prompt (instructions + category defs + controlled tag vocab + Business Brief + structured facts). Returns **structured output via tool-call**. Returns token usage.
- **`src/lib/ai/buildBusinessContext.ts`** — assembles the cached grounding block from the Business Brief + therapies + opening hours + profile. Shared by triage and `draftFollowup`.
- **`src/lib/inbox/triagePipeline.ts`** — orchestrates triage → decision → (auto-send | stage draft | hold). Pure decision logic isolated for unit testing.
- **`src/lib/conversations.ts`** (existing) — extended to roll triage up to the conversation level (current category/priority from the latest inbound triage; tags as the union of conversation tags).
- **WhatsApp webhook** (`/api/whatsapp/webhook`, existing) — after writing the inbound row, invokes the pipeline **after acking** (non-blocking) so ingestion never stalls.

## 6. Data model

**Triage columns** added to both `lead_messages` and `client_messages` (inbound rows):
- `ai_category` (text enum: new_lead | booking | existing_client | faq | sensitive | spam | other | null=untriaged)
- `ai_priority` (text enum: high | normal | low | null)
- `ai_summary` (text, one line)
- `ai_confidence` (real, 0–1)
- `ai_sensitive` (boolean)
- `ai_triaged_at` (timestamp_ms, null until triaged)
- `auto_reply_status` (text enum: none | drafted | auto_sent | held)
- `ai_suggested_reply` (text, null) — the staged draft awaiting approval

**`tags`** table: `id`, `label`, `slug` (unique), `color`, `is_core` (boolean — controlled vs AI-suggested/unapproved), `created_at`.

**`conversation_tags`** (polymorphic join): `id`, `owner_type` (lead | client), `owner_id`, `tag_id` → tags.id, `added_by` (ai | user), `created_at`. Unique on (owner_type, owner_id, tag_id).

**Settings keys** (existing key/value `settings` table):
- `business_brief` — JSON of the guided brief sections (see §7).
- `auto_reply_enabled` — boolean, default **false**.
- `auto_reply_categories` — JSON array, default `["faq","new_lead"]`.
- `auto_reply_confidence_threshold` — number 0–1, default e.g. `0.8`.

*Conversation-level category/priority is computed in `listConversations()` from the latest inbound message's triage; not separately persisted (avoids denormalisation drift).*

## 7. Business Brief & "Business Info" area

**Storage:** settings key `business_brief` holding JSON:
```json
{
  "overview": "...",            // about the business
  "offering": "...",            // what you offer (therapies/prices auto-appended from data)
  "toneOfVoice": "...",         // how the AI should sound
  "policies": "...",            // cancellation, payment, etc.
  "faqs": [{ "q": "...", "a": "..." }],
  "extra": "..."                // anything else the AI should know
}
```

**Business Info settings page** — single source of truth:
- Guided form for the brief sections above.
- Surfaces / links the existing structured settings: therapies & prices, opening hours/schedule, business profile, branding (so business data isn't scattered).

**First-run capture:** if `business_brief` is empty/incomplete, a prominent "Complete your business brief" prompt appears (dashboard/login). **Auto-reply is disabled until the brief exists** — the AI must not auto-answer before it knows the business.

## 8. Triage engine details

- Structured (tool-call) output schema: `{ category, priority, tags[], summary, confidence (0–1), sensitive, suggestedReply?, autoReplyEligible }`.
- Cached system prompt carries: triage instructions, category definitions, the controlled tag vocabulary, the Business Brief, and structured facts (therapies/prices/durations, opening hours, location). Stable → caches well; per-message content is the only uncached part.
- New/unknown tags the model proposes are stored with `is_core = false` and flagged for operator approval (hybrid model); they still apply to the conversation immediately but render as "suggested" until promoted.
- Existing-client detection: match sender phone/email against the `clients` table; informs the `existing_client` category.

## 9. Auto-reply pipeline & safety

Auto-send happens **only if all** hold:
1. `auto_reply_enabled = true`
2. `business_brief` present
3. `ai_category ∈ auto_reply_categories` (default faq, new_lead)
4. `ai_confidence ≥ auto_reply_confidence_threshold`
5. `ai_sensitive = false`

- **FAQ** reply: generated grounded in the Business Brief + structured facts; if not answerable from grounded data, the engine returns low confidence → draft.
- **New-lead** reply: reuses `draftFollowup`.
- Auto-sends are logged as an `ai_generated` outbound message (`auto_reply_status = auto_sent`) and an `activity_log` audit entry.
- Everything else → `auto_reply_status = drafted` (suggested reply staged) or `held` (sensitive).

## 10. Inbox UI (extends `InboxClient`)

- **Conversation list row:** category badge (colour-coded) · priority dot (high/normal/low) · tag chips · AI one-line summary · "AI auto-sent" marker on the latest message. Default sort: **priority desc → recency**.
- **Filter bar:** category · tag · priority · **"Needs you"** (drafted-for-approval + held/sensitive).
- **Conversation pane:** any staged AI draft pre-loads in the composer with **Approve & send / Edit / Discard**; auto-sent replies render inline marked "AI"; sensitive conversations show a "held for you" banner.

## 11. "Inbox AI" settings

- Auto-reply master toggle (default **off**).
- Which categories auto-send (subset of {faq, new_lead}).
- Confidence-threshold slider.
- Tag manager: edit the core vocabulary; review/approve (promote) or delete AI-suggested tags.

## 12. Error handling

- **Triage AI failure:** message lands **untriaged** (`ai_category = null`) and flagged for manual handling; ingestion never blocked; one-click re-triage in the UI.
- **Auto-send transport failure:** fall back to a staged draft + flag; never silently drop.
- **Brief missing:** auto-reply disabled globally; AI still triages but won't auto-answer.
- **Cost/perf:** exactly one triage call per inbound message; Business Brief + instructions are prompt-cached (≈10% read cost after the first call); token usage tracked like `draftFollowup`.

## 13. Testing

- **Unit:** `triagePipeline` decision/gate logic incl. sensitive-routing and the brief-missing guard (mocked AI); `buildBusinessContext` prompt assembly; `listConversations` triage rollup.
- **E2E (Playwright, existing patterns under `tests/`):** inbox filters, approve-draft flow, auto-reply toggle, Business Brief form save + first-run prompt.
- **Dev tool:** a "triage replay" script that runs the engine over a set of sample inbound messages and prints categories/priorities/confidence — used to validate AI quality before enabling auto-reply.

## 14. Phasing summary

- **Phase 1 (WhatsApp):** data model + Business Brief/Business Info + triage engine + pipeline + inbox UI + Inbox-AI settings + auto-reply (off by default). Fully usable on the live WhatsApp inbox.
- **Phase 2 (Email):** inbound email receive + outbound send, wired into the same pipeline; inbox channel tab flips Email from "Soon" to live.

## 15. Open considerations / future

- Unified `messages` table refactor (when channel count grows).
- Facebook/Instagram DM + Lead Ads ingestion.
- Full onboarding wizard (vs the lightweight brief prompt).
- Per-tenant brief at onboarding once ClientFlow multi-tenancy lands.
