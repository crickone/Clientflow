/** Small display helpers for the inbox list, in Irish time. */

const TZ = "Europe/Dublin";
const DAY = 86_400_000;

const dayKey = (ms: number) => new Date(ms).toLocaleDateString("en-IE", { timeZone: TZ });

/** "13:56" today, "Yesterday", "Mon" this week, "7 Oct", "7 Oct 2025". */
export function listTime(ms: number, now = Date.now()): string {
  if (!ms) return "";
  const d = new Date(ms);
  if (dayKey(ms) === dayKey(now)) return d.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  if (dayKey(ms) === dayKey(now - DAY)) return "Yesterday";
  if (now - ms < 6 * DAY) return d.toLocaleDateString("en-IE", { weekday: "short", timeZone: TZ });
  const sameYear = d.toLocaleDateString("en-IE", { year: "numeric", timeZone: TZ }) === new Date(now).toLocaleDateString("en-IE", { year: "numeric", timeZone: TZ });
  return d.toLocaleDateString("en-IE", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: TZ });
}

/** Full date and time, for a message header. */
export function fullTime(ms: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export type DayGroup = "Today" | "Yesterday" | "This week" | "Earlier";

export function dayGroup(ms: number, now = Date.now()): DayGroup {
  if (dayKey(ms) === dayKey(now)) return "Today";
  if (dayKey(ms) === dayKey(now - DAY)) return "Yesterday";
  if (now - ms < 7 * DAY) return "This week";
  return "Earlier";
}

/** Stable hue per name, so a person keeps their avatar colour. */
export function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s'-]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
