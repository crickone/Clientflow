import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { getCurrentMembership } from "@/lib/auth";
import { CATALOG_BY_KEY } from "@/lib/dashboard/catalog";
import {
  NO_RANGE_VIEWS,
  VIEW_WIDGET,
  packageUsedPct,
  packageValueLeft,
  parseMoneyView,
  revenueLines,
  spendByClient,
  sumAmounts,
  type MoneyView,
  type PaymentLine,
} from "@/lib/dashboard/metrics/breakdown";
import {
  activePackages,
  methodLabel,
  openVouchers,
  packagesWithCredit,
  paymentLines,
  serviceLines,
  serviceTotals,
} from "@/lib/dashboard/metrics/breakdownQueries";
import { methodTotals } from "@/lib/dashboard/metrics/finance";
import { dublinIso } from "@/lib/dashboard/metrics/stats";
import { RANGE_LABELS, STORED_RANGE_KEYS, parseRangeKey, resolveRange, type ResolvedRange } from "@/lib/dashboard/range";
import type { WidgetMeta } from "@/lib/dashboard/types";
import { canSee } from "@/lib/dashboard/visibility";
import { getVisibilityOverrides } from "@/lib/dashboard/visibilityStore";
import { formatEur } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TITLES: Record<MoneyView, string> = {
  payments: "Payments received",
  cash: "All payments",
  clients: "Spend per client",
  deferred: "Deferred revenue",
  services: "Completed sessions",
  packages: "Package use",
};

const SUBS: Record<MoneyView, string> = {
  payments: "Cash, card and bank transfer. Voucher and package redemptions are left out: that money was counted when the voucher or package was sold.",
  cash: "Every payment recorded, including voucher and package redemptions.",
  clients: "Money received per client: cash, card and bank transfer.",
  deferred: "Money already paid for sessions not given yet: unused package sessions plus what is left on gift vouchers.",
  services: "Completed appointments and their value.",
  packages: "Every active package and how much of it has been used.",
};

const dayFmt = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const isoDay = (iso: string) => dayFmt.format(new Date(`${iso}T12:00:00Z`));

function Summary({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="money-summary">
      {items.map((i) => (
        <div key={i.label} className="money-summary-item">
          <span className="money-summary-label">{i.label}</span>
          <span className="money-summary-value">{i.value}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="money-section">
      <div className="money-section-head">
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      {children}
    </section>
  );
}

function ClientLink({ id, name }: { id: number; name: string }) {
  return <Link href={`/clients/${id}`}>{name}</Link>;
}

function PaymentsTable({ lines, empty }: { lines: PaymentLine[]; empty: string }) {
  return (
    <div className="dt-wrap">
      <table className="dt">
        <thead>
          <tr>
            <th>Date</th>
            <th>Client</th>
            <th>For</th>
            <th>Method</th>
            <th className="dt-num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={5} className="dt-empty">{empty}</td>
            </tr>
          ) : (
            lines.map((l) => (
              <tr key={l.id}>
                <td className="dt-nowrap">
                  <div className="dt-cell">
                    <span className="dt-title">{dayFmt.format(new Date(l.atMs))}</span>
                    <span className="dt-meta">{timeFmt.format(new Date(l.atMs))}</span>
                  </div>
                </td>
                <td><ClientLink id={l.clientId} name={l.clientName} /></td>
                <td className="dt-muted">{l.forWhat}</td>
                <td className="dt-nowrap">{methodLabel(l.method)}</td>
                <td className="dt-num dt-nowrap">{formatEur(l.amount)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function RangeLinks({ view, range, tab }: { view: MoneyView; range: ResolvedRange; tab: string }) {
  const tabQ = tab ? `&tab=${tab}` : "";
  return (
    <div className="money-ranges" role="group" aria-label="Period">
      {STORED_RANGE_KEYS.map((k) => (
        <Link
          key={k}
          href={`/dashboard/money/${view}?range=${k}${tabQ}`}
          className={`btn btn--sm ${range.key === k ? "btn--secondary" : "btn--ghost"}`}
          aria-current={range.key === k ? "true" : undefined}
        >
          {RANGE_LABELS[k]}
        </Link>
      ))}
    </div>
  );
}

export default async function MoneyBreakdownPage(props: {
  params: Promise<{ view: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string; tab?: string }>;
}) {
  const [{ view: rawView }, sp] = await Promise.all([props.params, props.searchParams]);
  const view = parseMoneyView(rawView);
  if (!view) notFound();
  const membership = getCurrentMembership();
  if (!membership) redirect("/login");
  const meta = CATALOG_BY_KEY.get(VIEW_WIDGET[view]) as WidgetMeta | undefined;
  if (!meta || !canSee(meta, membership.role, getVisibilityOverrides())) redirect("/dashboard");

  const now = new Date();
  const today = dublinIso(now.getTime());
  const range = resolveRange(parseRangeKey(sp.range) ?? "30d", now, { from: sp.from, to: sp.to });
  const tab = /^\d+$/.test(sp.tab ?? "") ? sp.tab! : "";
  const ranged = !NO_RANGE_VIEWS.includes(view);

  let body: React.ReactNode;
  if (view === "payments" || view === "cash") {
    const all = paymentLines(range.fromMs, range.toMs);
    const lines = view === "payments" ? revenueLines(all) : all;
    const total = sumAmounts(lines);
    const clients = new Set(lines.map((l) => l.clientId)).size;
    const summary = [
      { label: "Total", value: formatEur(total) },
      { label: "Payments", value: String(lines.length) },
      { label: "Clients", value: String(clients) },
    ];
    if (view === "cash") {
      for (const m of methodTotals(lines.map((l) => ({ clientId: l.clientId, amount: l.amount, method: l.method, atMs: l.atMs })))) {
        summary.push({ label: m.label, value: formatEur(m.value) });
      }
    }
    const left = all.length - lines.length;
    body = (
      <>
        <Summary items={summary} />
        <Section
          title="Payments"
          note={
            view === "payments" && left > 0
              ? `${left} voucher or package ${left === 1 ? "redemption is" : "redemptions are"} not counted here.`
              : undefined
          }
        >
          <PaymentsTable lines={lines} empty="No payments in this period." />
        </Section>
        {view === "payments" && left > 0 && (
          <p className="money-foot">
            <Link href={`/dashboard/money/cash?range=${range.key}${range.key === "custom" ? `&from=${range.fromIso}&to=${range.toIso}` : ""}${tab ? `&tab=${tab}` : ""}`}>
              See every payment, redemptions included
            </Link>
          </p>
        )}
      </>
    );
  } else if (view === "clients") {
    const rows = spendByClient(paymentLines(range.fromMs, range.toMs));
    const total = sumAmounts(rows.map((r) => ({ amount: r.total })));
    body = (
      <>
        <Summary
          items={[
            { label: "Total", value: formatEur(total) },
            { label: "Clients who paid", value: String(rows.length) },
            { label: "Average per client", value: rows.length ? formatEur(total / rows.length) : "None" },
          ]}
        />
        <Section title="Clients">
          <div className="dt-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Client</th>
                  <th className="dt-num">Payments</th>
                  <th className="dt-num">Share</th>
                  <th className="dt-num">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="dt-empty">No payments in this period.</td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.clientId}>
                      <td><ClientLink id={r.clientId} name={r.clientName} /></td>
                      <td className="dt-num">{r.payments}</td>
                      <td className="dt-num dt-muted">{total > 0 ? `${Math.round((r.total / total) * 100)}%` : ""}</td>
                      <td className="dt-num dt-nowrap">{formatEur(r.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </>
    );
  } else if (view === "deferred") {
    const pkgs = packagesWithCredit(today);
    const vouchers = openVouchers(today);
    const pkgTotal = sumAmounts(pkgs.map((p) => ({ amount: packageValueLeft(p) })));
    const voucherTotal = sumAmounts(vouchers.map((v) => ({ amount: v.balance })));
    body = (
      <>
        <Summary
          items={[
            { label: "Total", value: formatEur(pkgTotal + voucherTotal) },
            { label: "Unused package sessions", value: formatEur(pkgTotal) },
            { label: "Gift voucher balances", value: formatEur(voucherTotal) },
          ]}
        />
        <Section title="Packages with sessions left" note="Value left is the price paid divided by the sessions in the package, times the sessions not used.">
          <div className="dt-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Package</th>
                  <th className="dt-num">Sessions left</th>
                  <th>Bought</th>
                  <th>Expires</th>
                  <th className="dt-num">Value left</th>
                </tr>
              </thead>
              <tbody>
                {pkgs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="dt-empty">No packages with sessions left.</td>
                  </tr>
                ) : (
                  pkgs.map((p) => (
                    <tr key={p.id}>
                      <td><ClientLink id={p.clientId} name={p.clientName} /></td>
                      <td>
                        <div className="dt-cell">
                          <span className="dt-title">{p.packageName}</span>
                          <span className="dt-meta">{formatEur(p.pricePaid)} paid</span>
                        </div>
                      </td>
                      <td className="dt-num dt-nowrap">
                        {p.totalSessions - p.sessionsUsed} of {p.totalSessions}
                      </td>
                      <td className="dt-nowrap dt-muted">{isoDay(p.purchaseDate)}</td>
                      <td className="dt-nowrap">{isoDay(p.expiryDate)}</td>
                      <td className="dt-num dt-nowrap">{formatEur(packageValueLeft(p))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="Gift vouchers with money left">
          <div className="dt-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Bought by</th>
                  <th>For</th>
                  <th>Bought</th>
                  <th>Expires</th>
                  <th className="dt-num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {vouchers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="dt-empty">No gift vouchers with money left.</td>
                  </tr>
                ) : (
                  vouchers.map((v) => (
                    <tr key={v.id}>
                      <td className="dt-mono">
                        <Link href={`/vouchers/${encodeURIComponent(v.code)}`}>{v.code}</Link>
                      </td>
                      <td>
                        <div className="dt-cell">
                          <span className="dt-title">{v.purchaserName}</span>
                          <span className="dt-meta">{v.source === "online" ? "Bought online" : "Sold at the desk"}</span>
                        </div>
                      </td>
                      <td className={v.recipientName ? undefined : "dt-muted"}>{v.recipientName || "Not set"}</td>
                      <td className="dt-nowrap dt-muted">{isoDay(v.purchaseDate)}</td>
                      <td className="dt-nowrap">{isoDay(v.expiryDate)}</td>
                      <td className="dt-num dt-nowrap">
                        <div className="dt-cell">
                          <span className="dt-title">{formatEur(v.balance)}</span>
                          {v.balance !== v.value && <span className="dt-meta" style={{ justifyContent: "flex-end" }}>of {formatEur(v.value)}</span>}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </>
    );
  } else if (view === "services") {
    const lines = serviceLines(range.fromIso, range.toIso);
    const byService = serviceTotals(range.fromIso, range.toIso);
    const total = sumAmounts(lines.map((l) => ({ amount: l.value })));
    body = (
      <>
        <Summary
          items={[
            { label: "Total value", value: formatEur(total) },
            { label: "Sessions completed", value: String(lines.length) },
          ]}
        />
        <Section title="By service" note="A booking with more than one service is split evenly across them.">
          <div className="dt-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Service</th>
                  <th className="dt-num">Sessions</th>
                  <th className="dt-num">Value</th>
                </tr>
              </thead>
              <tbody>
                {byService.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="dt-empty">No completed appointments with a price in this period.</td>
                  </tr>
                ) : (
                  byService.map((s) => (
                    <tr key={s.label}>
                      <td>{s.label}</td>
                      <td className="dt-num">{s.count}</td>
                      <td className="dt-num dt-nowrap">{formatEur(s.value)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title="Appointments">
          <div className="dt-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Services</th>
                  <th className="dt-num">Value</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="dt-empty">No completed appointments in this period.</td>
                  </tr>
                ) : (
                  lines.map((l) => (
                    <tr key={l.id}>
                      <td className="dt-nowrap">
                        <Link href={`/appointments/${l.id}`}>{isoDay(l.date)}</Link>
                      </td>
                      <td><ClientLink id={l.clientId} name={l.clientName} /></td>
                      <td className="dt-muted">{l.services}</td>
                      <td className={`dt-num dt-nowrap${l.value ? "" : " dt-muted"}`}>{formatEur(l.value)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </>
    );
  } else {
    const pkgs = activePackages();
    const sold = pkgs.reduce((s, p) => s + p.totalSessions, 0);
    const used = pkgs.reduce((s, p) => s + p.sessionsUsed, 0);
    body = (
      <>
        <Summary
          items={[
            { label: "Active packages", value: String(pkgs.length) },
            { label: "Sessions used", value: `${used} of ${sold}` },
            { label: "Average use", value: sold ? `${Math.round((used / sold) * 1000) / 10}%` : "None" },
          ]}
        />
        <Section title="Active packages">
          <div className="dt-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Package</th>
                  <th className="dt-num">Used</th>
                  <th>Bought</th>
                  <th>Expires</th>
                  <th className="dt-num">Value left</th>
                </tr>
              </thead>
              <tbody>
                {pkgs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="dt-empty">No active packages.</td>
                  </tr>
                ) : (
                  pkgs.map((p) => (
                    <tr key={p.id}>
                      <td><ClientLink id={p.clientId} name={p.clientName} /></td>
                      <td>{p.packageName}</td>
                      <td className="dt-num dt-nowrap">
                        <div className="dt-cell">
                          <span className="dt-title">{p.sessionsUsed} of {p.totalSessions}</span>
                          <span className="dt-meta" style={{ justifyContent: "flex-end" }}>{packageUsedPct(p)}%</span>
                        </div>
                      </td>
                      <td className="dt-nowrap dt-muted">{isoDay(p.purchaseDate)}</td>
                      <td className={`dt-nowrap${p.expiryDate < today ? " dt-muted" : ""}`}>
                        {isoDay(p.expiryDate)}
                        {p.expiryDate < today ? " (expired)" : ""}
                      </td>
                      <td className="dt-num dt-nowrap">{formatEur(p.expiryDate < today ? 0 : packageValueLeft(p))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </>
    );
  }

  return (
    <div className="app-page">
      <Link href={tab ? `/dashboard?tab=${tab}` : "/dashboard"} className="settings-back">
        <ChevronLeft size={15} strokeWidth={2} />
        Dashboard
      </Link>
      <PageHeader title={TITLES[view]} subtitle={ranged ? `${range.label}. ${SUBS[view]}` : SUBS[view]} actions={ranged ? <RangeLinks view={view} range={range} tab={tab} /> : undefined} />
      {body}
    </div>
  );
}
