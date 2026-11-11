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

/** File size for people: "0 B", "512 B", "3.4 MB". Plain module so server pages and client panels can both use it. */
export function bytes(n: number): string {
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
