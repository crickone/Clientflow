/**
 * Pure formatting for the booking screen: money, clock times and dates.
 * Dates are ISO calendar dates (YYYY-MM-DD), read in UTC so the server and a
 * browser in Dublin always name the same weekday for the same date.
 */

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function ymd(dateIso: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateIso.split("-").map(Number);
  return { y, m, d };
}

/** 0 = Sunday .. 6 = Saturday. */
export function weekdayIndex(dateIso: string): number {
  const { y, m, d } = ymd(dateIso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "Thu" */
export function weekdayShort(dateIso: string): string {
  return WEEKDAY_SHORT[weekdayIndex(dateIso)];
}

/** "Thursday" */
export function weekdayLong(dateIso: string): string {
  return WEEKDAY_LONG[weekdayIndex(dateIso)];
}

/** "Thu 26 Nov" */
export function shortDate(dateIso: string): string {
  const { m, d } = ymd(dateIso);
  return `${weekdayShort(dateIso)} ${d} ${MONTH_SHORT[m - 1]}`;
}

/** "1 Mar 2027" */
export function fullDate(dateIso: string): string {
  const { y, m, d } = ymd(dateIso);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}

/** "€80", "€64.50". Whole euros drop the cents. */
export function euro(amount: number): string {
  const cents = Math.round((Number.isFinite(amount) ? amount : 0) * 100);
  return cents % 100 === 0 ? `€${cents / 100}` : `€${(cents / 100).toFixed(2)}`;
}

/** "12:45" plus 60 minutes is "13:45". Wraps past midnight. */
export function addMinutes(hm: string, mins: number): string {
  const [h, m] = hm.split(":").map(Number);
  const total = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** "09:00" -> "9:00" (the time buttons). */
export function chipTime(hm: string): string {
  return hm.replace(/^0(\d)/, "$1");
}

/** "09:00" -> "9am", "19:30" -> "7:30pm", "12:00" -> "12pm", "00:00" -> "12am". */
export function clock12(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}
