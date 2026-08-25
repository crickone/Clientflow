import { conciergeToolSlice } from "@/lib/assistant/tools";
import { SALES_SPECIALIST } from "./sales";
import { MARKETING_SPECIALIST } from "./marketing";
import { OPERATIONS_SPECIALIST } from "./operations";

/**
 * Adonis merge task: Adonis (this file's "orchestrator" key — the agent
 * behind `/adonis` and `/api/agents/orchestrator/chat`) used to be a PURE
 * ROUTER — its only tools were the 4 `delegate_to_*` tools
 * (@/lib/agents/tools.orchestrator), so every request cost 2-3 sequential
 * model turns (route -> specialist works -> orchestrator summarises). It is
 * now a full WORKING agent: `toolNames` below is the deduplicated union of
 * the Concierge's general toolkit (`conciergeToolSlice`,
 * @/lib/assistant/tools) and the Sales/Marketing/Operations specialists' own
 * `toolNames` — i.e. everything those 4 agents could ever call, minus every
 * `delegate_to_*` name. One `runAgentTurn`, Adonis's own tools, no hop.
 *
 * `route.ts` (`/api/agents/[key]/chat`) and `tools.orchestrator.ts`'s
 * `delegateTo` both just do `TOOLS.filter((t) => allowed.has(t.name))` over
 * `spec.toolNames` — neither needed to change; they already treat every
 * `SPECIALISTS` entry generically. The 4 `delegate_to_*` tools themselves are
 * left registered in `TOOLS` (unused by Adonis now, not deleted — see
 * tools.orchestrator.ts's header comment) so this stays a small, reversible
 * diff; Sales/Marketing/Operations keep their own separate toolNames/
 * playbooks below unchanged, still reachable as their own agents on /agents.
 *
 * ⚠ WHY `toolNames` IS A LAZY GETTER, NOT A PLAIN ARRAY — do not "simplify"
 * this to `toolNames: [...]` computed at this file's top level; it WILL
 * crash the app at boot. `@/lib/assistant/tools` (tools.ts) has a documented
 * require cycle with this package: tools.ts's top-level `...ORCHESTRATOR_TOOLS`
 * spread imports `@/lib/agents/tools.orchestrator`, which imports
 * `@/lib/agents/context` (`composeAgentSystem`), which imports `SPECIALISTS`
 * from `./specialists` (this folder's `index.ts`), which imports THIS file.
 * So the first time `specialists/orchestrator.ts` loads, it is very likely
 * loading INSIDE tools.ts's own module evaluation — before tools.ts has
 * reached its `export function conciergeToolSlice` statement — so
 * `conciergeToolSlice` would not exist yet on the partial module object.
 * Calling it eagerly at this file's top level would therefore throw
 * "conciergeToolSlice is not a function" on the very first server boot.
 * `tools.orchestrator.ts`'s own file-level "CIRCULAR IMPORT" comment
 * documents the identical hazard for the same cycle, with the same fix:
 * never touch a cyclically-imported binding at module top level — only from
 * inside a function body that runs LATER, once the whole module graph has
 * finished loading (any real request, or a test reading `.toolNames` after
 * requiring this module). The getter below is that deferral.
 * `SALES_SPECIALIST`/`MARKETING_SPECIALIST`/`OPERATIONS_SPECIALIST` carry no
 * such risk (sales.ts/marketing.ts/operations.ts import nothing at all), so
 * those three are read eagerly, at top level, same as always.
 */
let cachedToolNames: string[] | undefined;
function buildOrchestratorToolNames(): string[] {
  if (cachedToolNames) return cachedToolNames;
  // conciergeToolSlice's two runtime gates — scheduling mode (1:1
  // Appointments vs group-class Timetable) and Google Drive connection —
  // are per-TENANT concerns; this registry entry is static (computed once,
  // shared by every tenant), so it takes the union across BOTH scheduling
  // modes with drive connected, exactly the "list both, let the model +
  // business context sort out which applies" shape OPERATIONS_SPECIALIST.
  // toolNames already uses today (it statically lists BOTH "list_classes"/
  // "book_client_into_class" [timetable-only] AND "reschedule_appointment"
  // [appointments-only] side by side).
  const concierge = new Set<string>();
  for (const mode of ["appointments", "timetable"] as const) {
    for (const t of conciergeToolSlice(mode, true)) concierge.add(t.name);
  }
  cachedToolNames = [
    ...new Set<string>([
      ...concierge,
      ...SALES_SPECIALIST.toolNames,
      ...MARKETING_SPECIALIST.toolNames,
      ...OPERATIONS_SPECIALIST.toolNames,
    ]),
  ].filter((n) => !n.startsWith("delegate_to_"));
  // ^ Belt-and-suspenders, not load-bearing today: conciergeToolSlice already
  // excludes every delegate_to_* tool, and none of the 3 specialists' own
  // toolNames hold one. But Adonis must NEVER regain a delegate_to_* tool —
  // that would reopen the routing hop this task removes — so this filter
  // stays even if one of the sources above ever changed.
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
