import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { TOOLS } from "@/lib/assistant/tools";
import { getAgent, parseDisabledTools } from "@/lib/agents/registry";
import { SPECIALISTS } from "@/lib/agents/specialists";

/**
 * The agent a chat talks to, with the tools it may use: only an agent that is
 * BOTH "active" in the registry AND has a SPECIALISTS entry (its tool slice +
 * playbook) is reachable — anything else is null, so callers 404 instead of
 * running an agent with no playbook. Tools the admin switched off on
 * /agents/[key] are left out entirely (access control, upstream of and
 * independent from the write-approval gate). Shared by the chat route and
 * the "build everything" loop so both run the same agent.
 *
 * `tenantId` is explicit (not the ambient one), so this is safe before
 * entering runWithTenant.
 */
export function resolveChatAgent(
  tenantId: number,
  key: string,
): { model: string; tools: Anthropic.Tool[] } | null {
  const agent = getAgent(tenantId, key);
  const spec = SPECIALISTS[key];
  if (!agent || agent.status !== "active" || !spec) return null;
  const allowed = new Set<string>(spec.toolNames);
  const disabled = new Set<string>(parseDisabledTools(agent.disabledTools));
  return {
    model: agent.model, // registry model: Sonnet default, Opus if upgraded — never hardcoded
    tools: TOOLS.filter((t) => allowed.has(t.name) && !disabled.has(t.name)),
  };
}
