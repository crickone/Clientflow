import { conciergeToolSlice } from "@/lib/assistant/tools";

/**
 * Adonis — the single working agent behind `/adonis` and
 * `/api/agents/orchestrator/chat`. Its `key` is still "orchestrator" for
 * historical/routing reasons, but there is no routing anymore: Adonis does
 * every job directly with its own tools, in one `runAgentTurn`.
 *
 * ── HISTORY (why this file looks the way it does) ──────────────────────────
 * Adonis used to be a PURE ROUTER whose only tools were four `delegate_to_*`
 * tools; every request cost 2-3 sequential model turns (route -> a Sales/
 * Marketing/Operations/Concierge specialist works -> orchestrator summarises).
 * The Adonis-merge task collapsed that into one working agent, and the
 * follow-up single-agent cleanup then RETIRED the specialist agents entirely:
 * their `AGENT_CATALOG` cards, their `specialists/{sales,marketing,operations}.ts`
 * spec files, the whole `delegate_to_*` / `delegateTo` delegation subsystem
 * (`tools.orchestrator.ts`), and the Concierge delegate are all gone. What
 * those specialists actually contributed — their TOOL LISTS — now lives here,
 * inline, as the three domain groups below. Adonis's tool set is the
 * deduplicated union of the general assistant's own toolkit
 * (`conciergeToolSlice`, @/lib/assistant/tools) and those three groups.
 *
 * ── THE THREE DOMAIN TOOL GROUPS ───────────────────────────────────────────
 * Kept as named, commented groups (rather than one flat list) purely for
 * readability — 30-odd tools are easier to reason about grouped by what they
 * do. They are NOT separate agents; they are just how Adonis's domain tools
 * are organised. Overlap between groups (e.g. `get_client`, `business_overview`,
 * `send_client_email` appear in more than one) is fine — the union dedups.
 */
const LEAD_TOOLS = [
  "list_leads", "get_lead_health", "get_client",
  "draft_lead_reply", "send_client_email", "send_whatsapp",
  "set_lead_stage", "log_lead_touch", "create_calendar_event",
] as const;

const MARKETING_TOOLS = [
  "list_blog_posts", "draft_blog_post", "save_blog_post",
  "publish_blog_post", "draft_carousel", "business_overview",
  // Campaign Engine Slice 1: the campaign-kit build loop.
  "plan_campaign", "create_campaign", "draft_campaign_asset",
  "approve_campaign_asset", "launch_campaign",
] as const;

const OPS_TOOLS = [
  "list_no_shows", "list_lapsed_members",
  "list_classes", "list_appointments", "get_client", "business_overview",
  "send_client_email", "send_client_whatsapp",
  "reschedule_appointment", "book_client_into_class",
] as const;

/**
 * IMPORTANT: WHY `toolNames` IS A LAZY, MEMOIZED GETTER — not a plain array computed at
 * this file's top level.
 *
 * `buildOrchestratorToolNames` calls `conciergeToolSlice`, imported from
 * @/lib/assistant/tools (tools.ts). Deferring that call into the getter body
 * (run LATER, on the first real request/test that reads `.toolNames`) keeps
 * this file completely insensitive to module-load order: by the time the
 * getter runs, the whole module graph has finished loading and every export is
 * populated. (Historically this deferral was load-BEARING: tools.ts and the
 * now-deleted tools.orchestrator.ts formed a genuine require cycle, and an
 * eager top-level call to `conciergeToolSlice` could hit a not-yet-populated
 * binding and throw "conciergeToolSlice is not a function" at boot. Removing
 * `tools.orchestrator.ts` broke that cycle — tools.ts no longer imports
 * anything that leads back here — so the eager form would likely work now too.
 * The lazy+memoized getter is kept regardless: it's correct either way, costs
 * nothing after the first call, and removes any need to reason about load order
 * again if the import graph changes.)
 */
let cachedToolNames: string[] | undefined;
function buildOrchestratorToolNames(): string[] {
  if (cachedToolNames) return cachedToolNames;
  // conciergeToolSlice's two runtime gates — scheduling mode (1:1
  // Appointments vs group-class Timetable) and Google Drive connection —
  // are per-TENANT concerns; this registry entry is static (computed once,
  // shared by every tenant), so it takes the union across BOTH scheduling
  // modes with drive connected: "list every tool that could apply, let the
  // model + business context sort out which one fits this account".
  const concierge = new Set<string>();
  for (const mode of ["appointments", "timetable"] as const) {
    for (const t of conciergeToolSlice(mode, true)) concierge.add(t.name);
  }
  cachedToolNames = [
    ...new Set<string>([
      ...concierge,
      ...LEAD_TOOLS,
      ...MARKETING_TOOLS,
      ...OPS_TOOLS,
    ]),
  ].filter((n) => !n.startsWith("delegate_to_"));
  // ^ The delegate_to_* filter is belt-and-suspenders only now: the whole
  // delegation subsystem is gone, so no source above can contribute one. It
  // stays as a permanent guard — Adonis must NEVER regain a delegate_to_*
  // tool, which would reintroduce the routing hop this design removed.
  return cachedToolNames;
}

export const ORCHESTRATOR_SPECIALIST = {
  key: "orchestrator",
  get toolNames(): string[] {
    return buildOrchestratorToolNames();
  },
  basePlaybook: `You are Adonis — the operator's all-in-one AI teammate for running their gym/clinic. You handle every request end to end yourself: read it, get the facts, do the work with your tools, and come back with a short, clear result. No routing, no "let me pass this along" — you're the whole team in one.

How you work:
- Get the facts first with your read tools (leads, clients, classes, no-shows, the numbers) before you act — never guess at a name, number, or history.
- When there's a list to work — leads to chase, no-shows to win back, classes to fill — prioritise the highest-impact first (hottest / most-recent leads, biggest gaps) and say why.
- Anything that goes OUT — a message, a post, a booking, a change — you DRAFT and PROPOSE; you never send or save it yourself. Every send, publish, booking or cancellation is collected for the operator to approve with one click. Never say something happened until a tool result confirms it.
- Finish with a tight summary: what you found, what you're proposing, and the single clearest next step.
- Write like a real coach who knows them — specific and human. Never robotic, pushy, salesy, or guilt-tripping.

Leads & follow-up — speed wins:
- Reply to new leads fast and warm, and give ONE concrete next step (a tour, a trial, a call), not a menu of options.
- Work quiet leads with a short, tailored nudge that shows you know who they are; back off after a clear no or opt-out.

Marketing — on-brand content that fills the funnel:
- Write in the business's exact voice: the Marketing Brain in your business context is the authority — follow it over any instinct of your own.
- Draft blog / carousel / email copy in the chat FIRST; saving and publishing wait for approval.
- Campaign kit: call plan_campaign and show the plan (name, season, offer, asset list) for Approve / "Go again"; on approval, create_campaign; then ONE asset at a time — draft_campaign_asset → show that single draft → approve_campaign_asset only once the operator OKs it. Never draft or approve more than one asset per turn. Offer launch_campaign only when every asset is approved.
- You can't auto-post or schedule social yet — hand finished posts to the operator to publish; never imply an automatic post happened.

Operations — keep the room full, win people back:
- Surface who needs attention: recent no-shows, members gone quiet, under-filled upcoming classes. For each, propose ONE concrete recovery — a warm nudge, or a specific rebooking into a real class or slot.
- You see the no-shows the operator has already marked; you don't mark attendance yourself.

Everything else is yours too — the combined inbox (email + WhatsApp), invoices & money, nutrition & workout plans, and general admin — handled the same direct, propose-then-approve way.

Channel: if a phone number's on file, prefer WhatsApp (short, friendly); otherwise email.`,
};
