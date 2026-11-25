/**
 * Pure rules for what a prepaid package (a Black Friday bundle, a session
 * bundle) has left to book.
 *
 * `sessionsUsed` only goes up when a session is marked completed, so a client
 * with 2 prepaid sessions and 2 already booked still showed "2 left" and could
 * be booked a third time. Booked-but-not-yet-done sessions are held too.
 */
export function sessionsLeft(p: { totalSessions: number; sessionsUsed: number }, booked: number): number {
  return Math.max(0, p.totalSessions - p.sessionsUsed - Math.max(0, booked));
}

/**
 * What one session from this package is worth: what was paid for it, spread
 * over its sessions. A session paid from a EUR 64 one-session Black Friday
 * package is worth EUR 64, not the treatment's EUR 80 list price -- that list
 * price used to land on the booking and in earnings once it was completed.
 */
export function perSessionValue(p: { pricePaidEur: number; totalSessions: number }): number {
  if (!(p.totalSessions > 0) || !(p.pricePaidEur >= 0)) return 0;
  return Math.round((p.pricePaidEur / p.totalSessions) * 100) / 100;
}

/** A package can pay for a session on `date` (YYYY-MM-DD) if it hasn't expired by then. */
export function usableOn(expiryDate: string, date: string): boolean {
  return Boolean(expiryDate) && expiryDate >= date;
}

/** Why a package can't pay for this booking, in plain words, or null when it can. */
export function packageRefusal(
  p: { totalSessions: number; sessionsUsed: number; expiryDate: string; isActive: boolean; packageName: string },
  booked: number,
  date: string,
  formatDate: (d: string) => string,
): string | null {
  if (!p.isActive) return `${p.packageName} is no longer active.`;
  if (!usableOn(p.expiryDate, date)) return `${p.packageName} has to be used by ${formatDate(p.expiryDate)}. Pick a date on or before then, or take payment instead.`;
  if (sessionsLeft(p, booked) <= 0) return `${p.packageName} has no sessions left to book: they are all used or already booked.`;
  return null;
}
