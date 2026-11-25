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

export function shouldShowJump(m: ScrollMetrics): boolean {
  return distanceFromBottom(m) > JUMP_AFTER_PX;
}

/** How much of the layout the on-screen keyboard covers (visualViewport), so the composer can sit above it. */
export function keyboardInset(innerHeight: number, viewportHeight: number, offsetTop: number): number {
  return Math.max(0, Math.round(innerHeight - viewportHeight - offsetTop));
}
