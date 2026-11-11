/**
 * When a lead-ad notification that could not be fetched is tried again.
 * Pure: the queue itself is lib/facebook/leadQueue.ts.
 *
 * Quick at first (a Graph hiccup clears in a minute), then hourly, because
 * the usual long cause is a Page that needs reconnecting, and that waits on a
 * person. Meta keeps a lead fetchable for 90 days; we keep trying for 7, which
 * covers a business that reconnects after a weekend away, then give up loudly.
 */
const MINUTE = 60_000;
const STEPS_MIN = [1, 2, 5, 10, 15, 30, 60] as const;

export const GIVE_UP_AFTER_MS = 7 * 24 * 60 * MINUTE;

/** After this many failed tries the business is told (about 33 minutes in). */
export const ALERT_AFTER_ATTEMPTS = 5;

/** Delay before the next try, given how many tries have failed so far (>= 1). */
export function retryDelayMs(failedAttempts: number): number {
  const i = Math.max(0, Math.min(failedAttempts - 1, STEPS_MIN.length - 1));
  return STEPS_MIN[i] * MINUTE;
}

/** Whether a notification first received at `receivedAt` is past saving. */
export function isExpired(receivedAt: number, now: number): boolean {
  return now - receivedAt >= GIVE_UP_AFTER_MS;
}
