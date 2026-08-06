# ClientFlow Agentic OS — Design Spec (v2)

## Sub-project 1 of N: Foundation + Agents Tab + Sales Agent

**Date:** 2026-08-06 (v2 — supersedes v1 of same date)
**Status:** Design — pending user review, then `writing-plans`

---

## Context & goal

ClientFlow evolves from one generalist AI assistant (the Dashboard chat: 33-tool loop with a
write-approval safety model) into an **agentic gym operating system**: a main orchestrator plus
domain specialists — **SEO, Sales, Marketing, Operations, Finance** — that first assist
reactively and later run the gym proactively.

**Locked decisions (this session):**
- **Autonomy:** *both, sequenced* — reactive first (operator approves every action), proactivity
  layered per-specialist once its guardrails are proven.
- **First live specialist:** **Sales**, flagship job = **Speed + Follow-up engine** (instant
  first-reply to new leads + multi-touch follow-up until booked or opted out).
- **Channels:** email + WhatsApp from day one (agent picks per lead). SMS deferred (no provider).
- **Home:** a **dedicated Agents tab** — a beautifully designed structure view of the agent
  org (orchestrator → 5 specialists), click into any agent to view/edit its context.
- **Cost:** **$25/gym/month hard cap**, metered **centrally in the control DB** (cross-gym
  visibility now; a billable/upsellable line item later).
- **Models:** 3-tier by task — **Haiku 4.5** (cheap sub-tasks) · **Sonnet 5** (default brain) ·
  **Opus 4.8** (hard-task escalation + max-quality option). **No Fable** for gym-facing agents.

This spec covers Sub-project 1 only: **shared foundation + the Agents tab + the reactive Sales
agent**. Later sub-projects: proactivity engine (queue + sequencer + trust), orchestrator routing,
activating the other four specialists.

---

## Existing assets (build on, never rebuild)

| Asset | Where | Role here |
|---|---|---|
| Tool-loop agent + SSE | `src/app/api/assistant/chat/route.ts` (8-turn manual loop, streaming) | Chassis for every specialist |
| **Write-approval model** | reads inline; writes → Approve card → re-validated at `/api/assistant/execute` under `runWithTenant` | **Preserved exactly** — the safety gate |
| Tool registry | `src/lib/assistant/tools.ts` (`TOOLS`, `WRITE_TOOLS`, `executeTool(name,input,ctx)`) | Extended with namespaced `sales_*` tools |
| Marketing Brain | per-tenant master prompt via `getBusinessContext()` | Auto-injected into every agent's context |
| Lead drafter | `src/lib/ai/draftFollowup.ts` | Sales agent's drafting primitive (exists!) |
| Email send | `send_client_email` tool | Channel #1 |
| WhatsApp send | `src/lib/whatsapp/send.ts` → `sendWhatsApp()` | Channel #2 — needs only a tool wrapper |
| Leads pipeline | `leads` table (`pipelineStage`: new/contacted/lost) | The Sales agent's working surface |
| Injection defence | `<untrusted_external_content>` fencing (`fenceUntrusted`) | Applied to all lead/inbox content |
| Motion/design system | `lib/motion.ts` tokens, `Reveal`/`RevealGroup`, interactive `Card`, dark-premium tokens in `globals.css`, Space Grotesk headings | The Agents tab is built in this language |

**Gaps this sub-project closes:** no shared Claude client/model constants; no usage capture; no
per-tenant cost cap; no agent registry/config surface.

---

## Architecture

### The specialist pattern
A specialist = **persona** (base playbook in code + tenant-editable instructions) + **scoped tool
slice** + **the shared loop**. Callable reactively (chat in its agent page → Approve card) now, and
headlessly (job layer → same draft-actions → approvals queue) in the proactivity sub-project.

### Agent registry (new, tenant DB)
Table `agents` — one row per agent per tenant, seeded on first visit:
`key` (`orchestrator | sales | seo | marketing | operations | finance`), `name`, `status`
(`active | dormant`), `instructions` (tenant-editable text), `model` (from `MODELS`), `updatedAt`.
- v1: **Sales = active**; the other five seeded **dormant** — visible, editable, not yet runnable.
- The **orchestrator node is representational in v1** (the Dashboard assistant remains the de-facto
  generalist); formal delegation routing lands with specialist #2.

### Context composition (what "editing an agent's context" means)
Each agent's live system prompt is composed, in order:
1. **Base playbook** — code, locked (e.g. the Sales SDR playbook)
2. **Business context + Marketing Brain** — auto-injected, linked "edit in Settings"
3. **Custom instructions** — the tenant-editable field from the Agents tab
4. **Safety rails** — code, locked, appended last (tenant isolation, approve-gate protocol,
   injection defence) — **never editable, never overridable by 1–3**

The agent detail page *shows* this composition honestly (locked sections visibly locked), so the
operator sees exactly what their agent knows.

### Foundation layer (new)
- `src/lib/ai/client.ts`: `getAnthropic()` factory + `MODELS` constants
  (`sonnet = claude-sonnet-5`, `haiku = claude-haiku-4-5-20251001`, `opus = claude-opus-4-8`) —
  **Fable is deliberately excluded from gym-facing agents** ($50/1M output eats the cap) — plus a
  call/stream wrapper that **records usage and enforces the cap** on every call.
- **Model tiering — route by task complexity (the cost strategy):**
  - **Tier 1 · `claude-haiku-4-5`** ($5/1M out) — mechanical, high-volume: lead triage,
    classification, lead-health scoring, extraction, short summaries.
  - **Tier 2 · `claude-sonnet-5`** ($15/1M out; $10 intro to 2026-08-31) — **the default agent
    brain**: the loop, message drafting, tool orchestration, everyday operator interactions.
    Frontier-class at this workload; a gym owner won't hit a wall.
  - **Tier 3 · `claude-opus-4-8`** ($25/1M out) — escalation for genuinely hard tasks (complex
    multi-step planning, nuanced judgement) and the operator-selectable "max quality" per-agent model.
  - The shared wrapper selects the tier by task; the Agents-tab picker exposes the per-agent brain
    (**Sonnet 5 default / Opus 4.8 upgrade**). **Fable excluded.** Keeping Sonnet (not Opus) as the
    default brain is what preserves ~2× the runs under the $25 cap.
- **`ai_usage` (control DB):** `tenantId, agentKey/feature, model, inputTokens, outputTokens,
  cacheReadTokens, cacheCreateTokens, estCostCents, createdAt` + `recordUsage()`,
  `getMonthlyUsageCents(tenantId)`, `assertUnderCap(tenantId)` (hard-block at **$25/mo**, clear
  in-app message when hit). Existing ~9 AI call sites migrate onto the wrapper incrementally
  (assistant + sales first).

---

## The Agents tab (new module, `/agents`, admin nav)

**Structure view** — the "AI staff org chart," in the app's dark-premium language (motion tokens,
`Reveal` stagger, SVG connector lines, Space Grotesk):
- Orchestrator node top; SEO · Sales · Marketing · Operations · Finance beneath.
- Each card: agent name, one-line mandate, status pill (**Active** / **Dormant**), model chip,
  this-month usage strip (from `ai_usage`).
- Tenant-wide $25 meter visible on the page.

**Agent detail** (click any card):
- **Context panel** — the 4-layer composition above; *Custom instructions* editable (save =
  visible action per user prefs); locked layers rendered read-only.
- **Model picker** — Sonnet 5 (default) / Opus 4.8 (upgrade); Fable excluded.
- **Tools list** — read-only chips in v1 (the agent's scoped slice).
- **Usage** — this month's spend for this agent.
- **Sales only:** the working **chat** (same SSE UI as the Dashboard assistant, scoped to the
  sales loop) + the Approve card. This page *is* the Sales agent's home; the approvals queue lands
  here when proactivity ships.

---

## Sales agent v1 (reactive)

- **Specialist config** `src/lib/agents/specialists/sales.ts` (playbook: speed-to-lead, consult
  don't pressure, always propose the next concrete step — tour/trial/call).
- **Tools** (namespaced, extending the registry):
  - *Reuse:* `send_client_email`, `create_calendar_event`, `update_client`, `draftFollowup` logic.
  - *New:* `list_leads` / `get_lead_health` (stage, last touch, days stale), `send_whatsapp`
    (**write, Approve-gated**, wraps `sendWhatsApp()`), `set_lead_stage`, `log_lead_touch`.
  - Channel pick: phone on file → prefer WhatsApp; else email. Every send passes the Approve card.
- **Flagship flow:** "work my leads" → agent reviews pipeline → per-lead draft (first-reply for
  new, tailored nudge for stale) with channel chosen → operator approves → sends, logs touch,
  advances stage.

## Out of scope (later sub-projects)
Proactive runs · durable job queue · multi-step sequencer (day-1/3/7) · per-action trust/auto-send ·
formal orchestrator routing · activating SEO/Marketing/Ops/Finance · SMS · push/chat channels ·
platform-console spend dashboard (data model supports it from day one).

## Safety & cost (non-negotiables)
Tenant isolation server-side in tools (`getTenantDbById`/`runWithTenant`) · Approve card preserved,
`/execute` re-validates · lead content always fenced as untrusted · **cap enforced in the wrapper
before any proactivity ever ships** · editable instructions can never override the locked rails.

## Success criteria
1. `/agents` renders the six-agent structure with live status/usage; feels native to the app's
   design system.
2. Editing Sales' custom instructions persists and demonstrably changes its behaviour next run.
3. In the Sales agent page: "work my leads" → drafts across email *and* WhatsApp → Approve →
   real sends (verified on Inspire in prod) → touch logged, stage advanced.
4. Every AI call writes an `ai_usage` row (control DB); simulated overage hard-blocks at $25 with
   a clear message; per-agent + per-tenant meters render from real data.
