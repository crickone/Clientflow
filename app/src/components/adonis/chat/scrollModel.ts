/**
 * The chat's scroll rules, as arithmetic. Pure.
 *
 * The view follows new content only while the operator has put it at the
 * bottom themselves; anything the page scrolls by itself (bringing a new
 * question to the top) never changes that. "Jump to latest" shows when there
 * is more than a little below the view.
 */

export const NEAR_BOTTOM_PX = 32;
export const JUMP_AFTER_PX = 160;

export type ScrollMetrics = { scrollTop: number; clientHeight: number; scrollHeight: number };

export function distanceFromBottom(m: ScrollMetrics): number {
  return Math.max(0, m.scrollHeight - m.clientHeight - m.scrollTop);
}

export function stickAfterScroll(distance: number, stuck: boolean, userDriven: boolean): boolean {
  return userDriven ? distance <= NEAR_BOTTOM_PX : stuck;
}

/**
 * Whether a scroll event is the operator's own: their wheel, touch, drag or key
 * was seen within `intentMs`, and no scroll the page started itself (the pin
 * glide, "Jump to latest") is still running. Page-started scrolls win until the
 * operator does something new, which the caller records by clearing
 * `programmaticUntil`.
 */
export function isUserScroll(now: number, intentAt: number, programmaticUntil: number, intentMs: number): boolean {
  if (now < programmaticUntil) return false;
  return now - intentAt < intentMs;
}

/** A pin for an exchange that has not rendered yet stops mattering after `ttlMs`. */
export function pinLive(now: number, pinnedAt: number, ttlMs: number): boolean {
  return now - pinnedAt < ttlMs;
}

export function shouldShowJump(m: ScrollMetrics): boolean {
  return distanceFromBottom(m) > JUMP_AFTER_PX;
}

/** How much of the layout the on-screen keyboard covers (visualViewport), so the composer can sit above it. */
export function keyboardInset(innerHeight: number, viewportHeight: number, offsetTop: number): number {
  return Math.max(0, Math.round(innerHeight - viewportHeight - offsetTop));
}
