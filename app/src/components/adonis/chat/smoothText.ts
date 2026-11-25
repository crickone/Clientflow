/**
 * How fast a streaming answer is revealed. Pure, so the pacing is tested
 * without a browser; useSmoothText drives it on requestAnimationFrame.
 *
 * Each frame earns a character budget at `max(BASE_CPS, backlog / lag)`
 * characters a second, so the reveal catches up faster the further behind it
 * is, and settles about `lag` (1.5 s) behind a steady stream. Words come out
 * whole; while streaming, the last word waits until a space shows it is
 * complete. A backlog over MAX_BACKLOG_CHARS (a reconnect, a big save) jumps
 * forward rather than crawling through it.
 */

export const BASE_CPS = 90;
export const MAX_LAG_MS = 1500;
export const FINISH_LAG_MS = 350;
export const MAX_BACKLOG_CHARS = 800;
export const MAX_FRAME_MS = 250;
/** While a word is held back, the budget saved for it is capped so it does not release a burst. */
const MAX_HELD_CARRY = 24;

export type RevealState = { shown: number; carry: number };
export type RevealOptions = { lagMs?: number; holdTail?: boolean };

const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);

/** The end of the next word after `from` (skipping any spaces first). */
export function nextWordEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length && isSpace(text[i])) i++;
  while (i < text.length && !isSpace(text[i])) i++;
  return i;
}

export function wordStartAtOrBefore(text: string, at: number): number {
  let i = Math.max(0, Math.min(at, text.length));
  while (i > 0 && !isSpace(text[i - 1])) i--;
  return i;
}

export function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

export function advance(text: string, state: RevealState, dtMs: number, opts: RevealOptions = {}): RevealState {
  const total = text.length;
  let shown = Math.max(0, Math.min(state.shown, total));
  if (shown >= total) return { shown: total, carry: 0 };
  if (total - shown > MAX_BACKLOG_CHARS) shown = Math.max(shown, wordStartAtOrBefore(text, total - MAX_BACKLOG_CHARS));
  const lag = opts.lagMs ?? MAX_LAG_MS;
  const cps = Math.max(BASE_CPS, ((total - shown) * 1000) / lag);
  let budget = state.carry + (cps * Math.min(Math.max(dtMs, 0), MAX_FRAME_MS)) / 1000;
  let held = false;
  while (shown < total) {
    const next = nextWordEnd(text, shown);
    if (opts.holdTail && next === total && !isSpace(text[total - 1])) {
      held = true;
      break;
    }
    if (next - shown > budget) break;
    budget -= next - shown;
    shown = next;
  }
  if (shown >= total) return { shown: total, carry: 0 };
  return { shown, carry: held ? Math.min(budget, MAX_HELD_CARRY) : budget };
}
