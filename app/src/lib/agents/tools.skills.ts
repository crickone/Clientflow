import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { skillBodyByName } from "./skills";
import type { ToolContext, ToolResult } from "./toolKit";

/**
 * Reading a skill the agent decided it needs.
 *
 * READ-ONLY, which is why it needs no approval gate: it returns text the
 * operator already wrote and switched on, from this tenant's own database. It
 * changes nothing and can reach nothing else.
 *
 * WHY A TOOL AT ALL. A skill marked "always" is in the system prompt on every
 * message, which is right for a house style and wrong for a reference
 * document: measured on a real account, the base prompt is ~2,200 tokens and
 * three always-on skills take it past 9,000 -- paid on "what's on today" as
 * surely as on a campaign build. An on-demand skill costs its name and
 * description until a job actually needs it, and then costs its body once.
 */
export const SKILL_TOOLS: Anthropic.Tool[] = [
  {
    name: "load_skill",
    description:
      "Read the full instructions for one of the skills listed under AVAILABLE SKILLS in your system prompt. Call this BEFORE starting work the skill covers — a design skill before you write a page, a writing skill before you draft copy — not afterwards to check. Returns the skill's text; it changes nothing.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The skill's name, exactly as listed under AVAILABLE SKILLS.",
        },
      },
      required: ["name"],
    },
  },
];

export function loadSkillTool(
  ctx: ToolContext,
  agentKey: string,
  input: Record<string, unknown>,
): ToolResult {
  const name = typeof input.name === "string" ? input.name : "";
  if (!name.trim()) {
    return {
      text: JSON.stringify({ error: "name is required — use one listed under AVAILABLE SKILLS." }),
    };
  }
  const skill = skillBodyByName(ctx.tenantId, agentKey, name);
  if (!skill) {
    // Named rather than generic: the model picked this name off a list, so
    // being told it is not on that list is the useful correction.
    return {
      text: JSON.stringify({
        error: `No skill called "${name}" is switched on for this agent. Use one of the names under AVAILABLE SKILLS.`,
      }),
    };
  }
  return { text: JSON.stringify({ name: skill.name, instructions: skill.body }) };
}
