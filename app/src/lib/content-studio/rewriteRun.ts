/**
 * Rewriting ONE piece of text on a designed slide.
 * ZERO RUNTIME IMPORTS — the metered call lives in the rewrite route.
 *
 * WHY LENGTH IS THE WHOLE PROBLEM. The slide's composition was written around
 * the words that are on it: a heading sized to fill two lines at 50px, a
 * paragraph whose `top` was chosen for the heading above it. Hand that heading
 * a rewrite half again as long and it wraps to three lines and lands on its own
 * body copy -- the exact defect lib/design/layoutBoxes exists to catch. So the
 * instruction is not "write something better", it is "write something the same
 * SIZE that is better", and the length budget is stated as characters because
 * that is what the model can actually count against.
 *
 * The render still measures afterwards. This is the cheap guard that stops
 * most of it; the measurement is the one that cannot be talked out of.
 */

/** One text element on the slide, in the order they appear in the markup. */
export interface RunSummary {
  index: number;
  text: string;
}

/**
 * How far from the original length a rewrite may stray.
 *
 * Generous enough that the model is not writing to a character count and
 * producing stilted copy, tight enough that a two-line heading stays two
 * lines. A short run gets an absolute floor: ±25% of "HBOT" is nothing, and
 * refusing every alternative to a four-character word is worse than letting
 * it become "Infrared".
 */
export function lengthBudget(original: string): { min: number; max: number } {
  const n = original.trim().length;
  const slack = Math.max(12, Math.round(n * 0.25));
  return { min: Math.max(1, n - slack), max: n + slack };
}

export function rewritePrompt(input: {
  /** The run being rewritten. */
  text: string;
  /** Every run on the slide, so the rewrite fits what surrounds it. */
  runs: RunSummary[];
  /** The index of the run being rewritten. */
  index: number;
  /** What the whole post is about. */
  topic: string;
  /** The business context block (voice, services, facts). */
  business: string;
  /** What the operator asked for, if they said anything. */
  note?: string | null;
  /**
   * Lines already shown for this run — the words on the slide, and whatever
   * the last press produced. Without this the model hands back the line it
   * was given (it is, after all, a good line), and a button whose first press
   * reports "that came back the same" reads as broken.
   */
  avoid?: string[];
}): string {
  const { min, max } = lengthBudget(input.text);
  const slide = input.runs
    .map((r) => `${r.index === input.index ? "-> " : "   "}${JSON.stringify(r.text)}`)
    .join("\n");

  return [
    input.business,
    "",
    `You are rewriting ONE line of text on a finished social slide. The post is about: ${input.topic}`,
    "",
    "Every text element on this slide, in order. The one to rewrite is marked ->",
    slide,
    "",
    `Write a replacement for the marked line ONLY.`,
    "",
    "RULES",
    `- Between ${min} and ${max} characters. This is not a style preference: the slide's layout was built around the length of the line you are replacing, and a longer one wraps onto an extra line and collides with the text beneath it.`,
    "- Keep its job on the slide. A heading stays a heading; a supporting line stays supporting. Do not turn one into the other.",
    "- Do not repeat what the other lines on this slide already say.",
    "- It MUST be different from the line it replaces. Say the same thing another way, or find a better angle on it -- but do not hand back what you were given.",
    "- Plain text. No markdown, no emojis, no hashtags, no quotation marks around the whole line.",
    "- NEVER INVENT A FACT. Prices, session lengths, opening times, offers, phone numbers, addresses and statistics all count. If a number is not in the business context above, write the line without it.",
    "- That covers the EQUIPMENT too, not only the numbers: what a machine looks like, whether it encloses someone, what a room feels like, what a client can do during a session. Unless the business context above says so, you do not know it. A slide called an infrared BED \"open, no seal\" to sharpen a contrast -- invented, plausible, and wrong.",
    input.note ? `- What the operator asked for: ${input.note}` : "",
    (input.avoid ?? []).filter((a) => a.trim()).length > 0
      ? `- Already tried, so do not return any of these:\n${(input.avoid ?? [])
          .filter((a) => a.trim())
          .map((a) => `    ${JSON.stringify(a)}`)
          .join("\n")}`
      : "",
    "",
    "Reply with the replacement line and nothing else -- no preamble, no options, no explanation.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/**
 * The model's reply, reduced to a line that can go on a slide.
 *
 * Returns null when nothing usable came back, which the caller reports rather
 * than silently pasting an apology into the design. A model that returns its
 * own reasoning, a markdown bullet, or the line wrapped in quotes is common
 * enough to be worth stripping rather than rejecting.
 */
export function parseRewrite(
  reply: string,
  original: string,
  avoid: string[] = [],
): string | null {
  let text = reply.trim();
  if (!text) return null;

  // A single line. Anything that came back as a list or an explanation gets
  // its first non-empty line taken, which is the reply in practice.
  const firstLine = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)[0];
  if (!firstLine) return null;
  text = firstLine;

  // Leading markdown bullet or numbering.
  text = text.replace(/^([-*•]|\d+[.)])\s+/, "");
  // Wrapped in quotes as a whole -- but never strip an apostrophe or a quote
  // that is part of the line.
  const wrapped = /^"(.*)"$/.exec(text) ?? /^'(.*)'$/.exec(text);
  if (wrapped) text = wrapped[1];
  text = text.trim();

  if (!text) return null;
  // Identical to what is already there is not a rewrite; the caller treats it
  // as "try again" rather than showing a no-op as a result.
  if (text === original.trim()) return null;
  // Same for anything already shown this session: handing back the line the
  // operator just rejected is a press that did nothing.
  if (avoid.some((a) => a.trim() === text)) return null;
  // A wildly over-long reply means the length rule was ignored, and pasting it
  // in would break the layout the rule exists to protect.
  if (text.length > lengthBudget(original).max * 2) return null;
  return text;
}
