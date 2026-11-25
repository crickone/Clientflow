/**
 * Adonis's suggested next questions.
 *
 * Its playbook (lib/agents/specialists/orchestrator.ts) asks it to end a
 * finished reply with
 *
 *   <followups>
 *   one suggestion per line
 *   </followups>
 *
 * The chat hides that block from the answer and shows the lines as buttons.
 * Pure string work, safe on a reply still streaming in: an open block, or
 * the first characters of the opening tag at the very end, are hidden too.
 * Anything after the closing tag stays in the answer (the server appends
 * "_Approved automatically._" and results to a card later).
 */

const OPEN = "<followups>";
const CLOSE = "</followups>";
export const MAX_FOLLOWUPS = 3;
const MAX_LINE = 140;

export type SplitReply = { body: string; followups: string[]; complete: boolean };

function cleanLines(inner: string): string[] {
  return inner
    .split("\n")
    .map((l) =>
      l
        .trim()
        .replace(/^([-*•]|\d{1,2}[.)])(\s+|$)/, "")
        .replace(/^["'“”]+|["'“”]+$/g, "")
        .trim(),
    )
    .filter((l) => l.length > 0 && l.length <= MAX_LINE && !l.includes("<"))
    .slice(0, MAX_FOLLOWUPS);
}

/** The end of `content` with a half-written opening tag removed (streaming). Only at the start of a line or after a space. */
function stripPartialOpen(content: string): string {
  const lower = content.toLowerCase();
  for (let k = Math.min(OPEN.length - 1, lower.length); k >= 1; k--) {
    const tail = lower.slice(lower.length - k);
    if (!OPEN.startsWith(tail)) continue;
    const before = content.slice(0, content.length - k);
    if (before === "" || /\s$/.test(before)) return before.trimEnd();
  }
  return content;
}

export function splitFollowups(content: string): SplitReply {
  const lower = content.toLowerCase();
  const at = lower.lastIndexOf(OPEN);
  if (at === -1) return { body: stripPartialOpen(content), followups: [], complete: false };
  const end = lower.indexOf(CLOSE, at + OPEN.length);
  const inner = content.slice(at + OPEN.length, end === -1 ? undefined : end);
  const after = end === -1 ? "" : content.slice(end + CLOSE.length).trim();
  const body = [content.slice(0, at).trimEnd(), after].filter(Boolean).join("\n\n");
  return { body, followups: cleanLines(inner), complete: end !== -1 };
}

export function stripFollowups(content: string): string {
  return splitFollowups(content).body;
}
