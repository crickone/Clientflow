/**
 * The pure half of skills: the allowlist that lives on an agent's row.
 * ZERO RUNTIME IMPORTS -- ./skills.ts reaches the tenant database, which pulls
 * React in transitively and will not load under the plain tsx runner, so
 * everything testable without a database lives here. Same split as
 * lib/ai/designPost.parse.ts.
 */

/** What the operator sees in an agent's toggle list. Declared here, not in
 *  ./skills.ts, so a client component can import the type without pulling the
 *  tenant database into its bundle. */
export interface SkillToggle {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  /** Characters of instruction this adds to the agent's prompt when on. */
  size: number;
}

/**
 * A skill's body goes into the system prompt verbatim, so an unbounded one is
 * a bill and a blown context window. The same ceiling the operator-instructions
 * field already uses, for the same reason.
 */
export const MAX_SKILL_BODY = 8000;
export const MAX_SKILL_NAME = 80;
export const MAX_SKILL_DESCRIPTION = 200;

/**
 * The skill ids an agent is given, from the JSON on its row.
 *
 * TOTAL: a null column, malformed JSON, an object where an array belongs, or
 * entries that are not usable ids all mean "no skills". Never throws -- this
 * is read while composing a system prompt, and a bad row must cost an agent
 * its skills, never its ability to answer. Mirrors parseDisabledTools.
 */
export function parseEnabledSkills(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter(
          (n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0,
        ),
      ),
    ];
  } catch {
    return [];
  }
}

export function serialiseEnabledSkills(ids: number[]): string {
  return JSON.stringify([...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))]);
}
