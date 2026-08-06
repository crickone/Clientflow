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
