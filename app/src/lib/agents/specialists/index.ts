import { ORCHESTRATOR_SPECIALIST } from "./orchestrator";

export interface SpecialistConfig {
  key: string;
  toolNames: readonly string[];
  basePlaybook: string;
}

/**
 * The agent registry: `key` -> its tool slice + base playbook, keyed by the
 * same `key` used in `AGENT_CATALOG` (@/lib/agents/registry).
 * `composeAgentSystem` (@/lib/agents/context) and the agent chat route
 * (`/api/agents/[key]/chat`) both look agents up here instead of hardcoding a
 * single agent.
 *
 * Single-agent product: this map holds exactly ONE entry — Adonis
 * ("orchestrator"). The old Sales/Marketing/Operations entries (and their
 * `specialists/{sales,marketing,operations}.ts` spec files) were retired when
 * Adonis absorbed their tools + playbooks and started doing the work directly;
 * the whole `delegate_to_*` delegation subsystem went with them. The Concierge
 * never had an entry here either — its system + tools are computed at runtime
 * (buildAssistantSystem + conciergeToolSlice), already folded into Adonis's
 * own toolNames.
 *
 * Kept as a keyed map (not a lone constant) so the generic `SPECIALISTS[key]`
 * lookups in the route/context keep working unchanged, and so re-introducing a
 * specialist later is just a new `specialists/<key>.ts` file + an entry here.
 */
export const SPECIALISTS: Record<string, SpecialistConfig> = {
  orchestrator: ORCHESTRATOR_SPECIALIST,
};
