import { SALES_SPECIALIST } from "./sales";
import { MARKETING_SPECIALIST } from "./marketing";
import { OPERATIONS_SPECIALIST } from "./operations";
import { ORCHESTRATOR_SPECIALIST } from "./orchestrator";

export interface SpecialistConfig {
  key: string;
  toolNames: readonly string[];
  basePlaybook: string;
}

/**
 * Single source of truth for every ACTIVE agent's tool slice + base
 * playbook, keyed by the same `key` used in `AGENT_CATALOG`
 * (@/lib/agents/registry). `composeAgentSystem` (@/lib/agents/context) and
 * the specialist chat route (`/api/agents/[key]/chat`) both look up this
 * registry instead of hardcoding a single agent — adding a new specialist is
 * just a new `specialists/<key>.ts` file + an entry here (plus flipping its
 * `AGENT_CATALOG` status to "active" when it's ready to go live).
 *
 * Dormant/unmodeled agents (finance today) are deliberately absent —
 * callers fall back to a generic playbook / empty tool slice, and the chat
 * route 404s before ever reaching a specialist lookup for a non-active agent.
 *
 * Adonis ("orchestrator") is registered below exactly like any other active
 * specialist — SAME chat route, SAME `composeAgentSystem`, SAME
 * `runAgentTurn`. It used to own no domain tools of its own (just the 4
 * `delegate_to_<specialist>` tools, @/lib/agents/tools.orchestrator) and
 * route every request to a specialist instead of working it directly. The
 * Adonis merge task collapsed that into ONE working agent: its `toolNames`
 * (computed in `specialists/orchestrator.ts`) is now the deduplicated union
 * of the Concierge's general toolkit + Sales/Marketing/Operations' own
 * toolNames, so it does the work itself — no routing hop. The 4 delegate
 * tools stay registered in `TOOLS` (unused by Adonis now, left in place for
 * a small/reversible diff) — see tools.orchestrator.ts's header comment.
 */
export const SPECIALISTS: Record<string, SpecialistConfig> = {
  sales: SALES_SPECIALIST,
  marketing: MARKETING_SPECIALIST,
  operations: OPERATIONS_SPECIALIST,
  orchestrator: ORCHESTRATOR_SPECIALIST,
};
