/**
 * The pure half of skills: the allowlist that lives on an agent's row.
 * ZERO RUNTIME IMPORTS -- ./skills.ts reaches the tenant database, which pulls
 * React in transitively and will not load under the plain tsx runner, so
 * everything testable without a database lives here. Same split as
 * lib/ai/designPost.parse.ts.
 */


/**
 * The ceiling on one skill's body.
 *
 * 16,000 rather than the 8,000 it started at, because the skills worth having
 * are bigger than that: a real design-guidelines document is ~7,800
 * characters and a writing-style skill ~10,900. A ceiling that excludes the
 * useful ones is not protecting anything.
 *
 * The ceiling was never the real cost control, and it is worth being clear
 * about why. An ALWAYS-loaded skill is paid for on every message the agent
 * handles: measured on this account, the base prompt is ~2,200 tokens and
 * three always-on skills take it past 9,000 -- five times the price of a
 * message that needed none of them. What actually controls that is
 * `loadMode`: a skill marked "onDemand" contributes only its name and
 * description until the agent asks for it. See SkillLoadMode.
 */
export const MAX_SKILL_BODY = 16000;

/**
 * When a skill's body reaches the model.
 *
 * "always" -- injected into the system prompt on every message. Right for
 * standing rules the agent must follow whether or not it thinks to look them
 * up: a house writing style is no use if the model has to decide it is
 * relevant before applying it.
 *
 * "onDemand" -- only its name and description are in the prompt, and the body
 * arrives when the agent calls load_skill. Right for big reference material
 * that matters to some jobs and not others: design guidelines earn their
 * tokens on a landing page and waste them on "what's on today".
 */
export type SkillLoadMode = "always" | "onDemand";

/** What the operator sees in an agent's toggle list. Declared here, not in
 *  ./skills.ts, so a client component can import the type without pulling the
 *  tenant database into its bundle. */
export interface SkillToggle {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  /** Characters of instruction this adds when on. Only charged on every
   *  message when loadMode is "always". */
  size: number;
  loadMode: SkillLoadMode;
}

export function parseLoadMode(raw: string | null | undefined): SkillLoadMode {
  return raw === "onDemand" ? "onDemand" : "always";
}
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
