/**
 * What sits behind each money tile on the dashboard: the pure half. The
 * queries live in breakdownQueries.ts, the page in app/dashboard/money.
 * Every total here is worked out the same way as the tile it opens from, so
 * the rows always add up to the number that was clicked.
 */
import { isRevenueMethod } from "./finance";

/** One breakdown page per kind of money tile. */
export const MONEY_VIEWS = ["payments", "cash", "clients", "deferred", "services", "packages"] as const;
export type MoneyView = (typeof MONEY_VIEWS)[number];

export function parseMoneyView(v: unknown): MoneyView | null {
  return typeof v === "string" && (MONEY_VIEWS as readonly string[]).includes(v) ? (v as MoneyView) : null;
}

/** The tile each view opens from: who may see the view follows who may see that tile. */
export const VIEW_WIDGET: Record<MoneyView, string> = {
  payments: "finance.revenue",
  cash: "overview.cashToday",
  clients: "finance.avgSpend",
  deferred: "overview.deferredRevenue",
  services: "finance.byService",
  packages: "finance.packages",
};

/** Views that are a position now, not a period. */
export const NO_RANGE_VIEWS: readonly MoneyView[] = ["deferred", "packages"];

const round2 = (n: number) => Math.round(n * 100) / 100;

export type PaymentLine = {
  id: number;
  atMs: number;
  clientId: number;
  clientName: string;
  method: string;
  amount: number;
  forWhat: string;
};

/** Only money received (cash, card, bank transfer), as the Payments received tile counts it. */
export function revenueLines(lines: PaymentLine[]): PaymentLine[] {
  return lines.filter((l) => isRevenueMethod(l.method));
}

export function sumAmounts(lines: Array<{ amount: number }>): number {
  return round2(lines.reduce((s, l) => s + l.amount, 0));
}

export type ClientSpend = { clientId: number; clientName: string; payments: number; total: number };

/** Money received per client, largest first. */
export function spendByClient(lines: PaymentLine[]): ClientSpend[] {
  const by = new Map<number, ClientSpend>();
  for (const l of revenueLines(lines)) {
    const cur = by.get(l.clientId) ?? { clientId: l.clientId, clientName: l.clientName, payments: 0, total: 0 };
    cur.payments++;
    cur.total += l.amount;
    by.set(l.clientId, cur);
  }
  return [...by.values()]
    .map((c) => ({ ...c, total: round2(c.total) }))
    .sort((a, b) => b.total - a.total || a.clientName.localeCompare(b.clientName));
}

export type PackageCredit = {
  id: number;
  clientId: number;
  clientName: string;
  packageName: string;
  totalSessions: number;
  sessionsUsed: number;
  pricePaid: number;
  purchaseDate: string;
  expiryDate: string;
};

/** Value of the sessions not used yet: what is still owed on a package. */
export function packageValueLeft(p: Pick<PackageCredit, "totalSessions" | "sessionsUsed" | "pricePaid">): number {
  if (p.totalSessions <= 0) return 0;
  const left = Math.max(0, p.totalSessions - p.sessionsUsed);
  return round2((left * p.pricePaid) / p.totalSessions);
}

export function packageUsedPct(p: Pick<PackageCredit, "totalSessions" | "sessionsUsed">): number {
  if (p.totalSessions <= 0) return 0;
  return Math.round((Math.min(p.sessionsUsed, p.totalSessions) / p.totalSessions) * 100);
}

export type ServiceLine = { id: number; date: string; clientId: number; clientName: string; services: string; value: number };
