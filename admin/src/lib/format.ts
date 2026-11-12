export const fmtCents = (cents: number) =>
  `€${Math.floor(cents / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

export const fmtDate = (ms: number) =>
  new Intl.DateTimeFormat("en-IE", { dateStyle: "medium", timeZone: "Europe/Dublin" }).format(new Date(ms));

export const fmtDay = (d: string | null) => d ?? "—";

/** "YYYY-MM" → short month label ("Jul"). Falls back to the raw string. */
export const fmtMonthShort = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Intl.DateTimeFormat("en-IE", { month: "short", timeZone: "Europe/Dublin" }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
};

/** Whole-euro currency from cents (no decimals) — compact for chart axes/tooltips. */
export const fmtEurWhole = (cents: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    Math.round(cents / 100),
  );

/** Duration for people: null "—", under a second "450 ms", under a minute "4.2 s", else "1m 30s". */
export function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return s === 60 ? `${m + 1}m 0s` : `${m}m ${s}s`;
}

/** File size for people: "0 B", "512 B", "3.4 MB". Plain module so server pages and client panels can both use it. */
export function bytes(n: number): string {
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** UTC ms of 00:00 Europe/Dublin on the given "YYYY-MM-DD" day. NaN for an invalid date. */
export function dublinDayStartMs(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const naive = Date.UTC(y, mo - 1, d);
  if (new Date(naive).getUTCDate() !== d) return NaN;
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
    const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - ms;
  };
  let t = naive - offsetAt(naive);
  t = naive - offsetAt(t);
  return t;
}
