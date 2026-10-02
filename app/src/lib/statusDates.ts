/**
 * Status-date bookkeeping for the dashboard's status_dates recorder: when an
 * appointment was cancelled (or no-showed) and when a membership ended. Pure;
 * every write site spreads the returned patch into its update/insert. A key
 * is present only when the date should change.
 */
export type AppointmentStatus = "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
export type MembershipStatus = "active" | "expired" | "cancelled";

const CANCELLED: ReadonlySet<AppointmentStatus> = new Set(["cancelled", "no_show"]);

export function appointmentStatusDates(
  prev: AppointmentStatus | null,
  next: AppointmentStatus,
  now: Date,
): { cancelledAt?: Date | null; cancelledAtApprox?: boolean } {
  const was = prev !== null && CANCELLED.has(prev);
  const is = CANCELLED.has(next);
  if (is && !was) return { cancelledAt: now, cancelledAtApprox: false };
  if (!is && was) return { cancelledAt: null, cancelledAtApprox: false };
  return {};
}

export function membershipStatusDates(
  prev: MembershipStatus | null,
  next: MembershipStatus,
  now: Date,
): { endedAt?: Date | null } {
  const wasEnded = prev !== null && prev !== "active";
  const isEnded = next !== "active";
  if (isEnded && !wasEnded) return { endedAt: now };
  if (!isEnded && wasEnded) return { endedAt: null };
  return {};
}
