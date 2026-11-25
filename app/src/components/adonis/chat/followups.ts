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
  for (let k = Math.min(OPEN.length - 1, content.length); k >= 1; k--) {
    // Lower-case the slice, not the whole string: lower-casing can change length.
    const tail = content.slice(content.length - k).toLowerCase();
    if (!OPEN.startsWith(tail)) continue;
    const before = content.slice(0, content.length - k);
    if (before === "" || /\s$/.test(before)) return before.trimEnd();
  }
  return content;
}

/** Every complete block, any case. Matched on the original string, so indexes and slices agree. */
const BLOCK = new RegExp(`${OPEN}([\\s\\S]*?)${CLOSE}`, "gi");
const OPEN_TAG = new RegExp(OPEN, "i");

/**
 * Every complete block is hidden; the suggestions come from the last one. A
 * block still open at the end (streaming) is hidden too, and its lines so
 * far are the suggestions. Text between or after blocks stays in the answer.
 */
export function splitFollowups(content: string): SplitReply {
  const pieces: string[] = [];
  let lastInner: string | null = null;
  let from = 0;
  for (const m of content.matchAll(BLOCK)) {
    pieces.push(content.slice(from, m.index));
    lastInner = m[1];
    from = m.index + m[0].length;
  }
  let rest = content.slice(from);
  const openAt = rest.search(OPEN_TAG);
  if (lastInner === null && openAt === -1) return { body: stripPartialOpen(content), followups: [], complete: false };
  let openInner: string | null = null;
  if (openAt !== -1) {
    openInner = rest.slice(openAt + OPEN.length);
    rest = rest.slice(0, openAt);
  } else {
    rest = stripPartialOpen(rest);
  }
  pieces.push(rest);
  const body = pieces
    .map((p, i) => (i === 0 ? p.trimEnd() : p.trim()))
    .filter(Boolean)
    .join("\n\n");
  const inner = openInner ?? lastInner ?? "";
  return { body, followups: cleanLines(inner), complete: openInner === null };
}

export function stripFollowups(content: string): string {
  return splitFollowups(content).body;
}
