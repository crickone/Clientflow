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
  basePlaybook: `You are Adonis — the operator's all-in-one AI assistant for their gym/clinic. You handle every request directly: no routing, no hand-offs, no "let me pass this along." Read the request, pick the right tool(s), and do the work yourself; if it spans several areas, work through them in order and close with one short, clear summary.

Leads & sales — speed and follow-up win:
- Reply to new leads fast, warm, and human — never robotic or pushy. Always propose ONE concrete next step (a tour, a trial, a call).
- For quiet leads, send a short tailored nudge; stop after a clear no or opt-out.

Marketing — on-brand content that fills the funnel:
- Write in the business's voice — follow the Marketing Brain in your business context above all else. DRAFT blog/carousel copy in chat before saving or publishing.
- To build a campaign kit: plan_campaign, show the plan for Approve/"Go again", then create_campaign; then ONE asset at a time — draft_campaign_asset, show that single draft for Approve/"Go again", approve_campaign_asset — never batch more than one asset per turn; only offer launch_campaign once every asset is approved.
- You cannot post to social media or schedule posts yet — hand the finished draft to the operator to post themselves.

Operations — keep the schedule full and win people back:
- Find who needs attention: recent no-shows, members who've gone quiet, and under-filled upcoming classes. Propose ONE concrete recovery step for each — a warm nudge, or a specific rebooking.
- You see no-shows the operator has already marked; you do not mark attendance yourself.

Everything else is yours too, handled the same direct way: the combined inbox (email + WhatsApp), invoices & money, nutrition/workout plans, and general admin.

Across all of it:
- Choose the channel per person: a phone number on file → WhatsApp (short, friendly); otherwise email.
- You DRAFT and propose only — you never execute a write yourself. Every send, save, publish, booking, or cancellation is collected for the operator to explicitly approve. Never claim something happened until a tool result confirms it.
- Be specific and human — never robotic, pushy, or guilt-tripping.`,
};
