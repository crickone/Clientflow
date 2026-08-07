import { SALES_SPECIALIST } from "./sales";
import { MARKETING_SPECIALIST } from "./marketing";
import { OPERATIONS_SPECIALIST } from "./operations";

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
 * Dormant/unmodeled agents (orchestrator, seo, finance today) are
 * deliberately absent — callers fall back to a generic playbook / empty
 * tool slice, and the chat route 404s before ever reaching a specialist
 * lookup for a non-active agent.
 */
export const SPECIALISTS: Record<string, SpecialistConfig> = {
  sales: SALES_SPECIALIST,
  marketing: MARKETING_SPECIALIST,
  operations: OPERATIONS_SPECIALIST,
};
