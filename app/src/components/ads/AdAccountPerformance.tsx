import Link from "next/link";
import { ExternalLink, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import type { AdsOverview, AccountPerformance } from "@/lib/ads/accountInsights";
import { RANGES } from "@/lib/ads/accountInsightsModel";
import { money } from "./status";

const STATE: Record<string, { label: string; tone: "success" | "neutral" | "warning" }> = {
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "neutral" },
  issue: { label: "Needs attention", tone: "warning" },
  ended: { label: "Ended", tone: "neutral" },
  other: { label: "Not running", tone: "neutral" },
};

const int = (n: number) => new Intl.NumberFormat("en-IE").format(Math.round(n));
const pct = (n: number | null) => (n == null ? "-" : `${n.toFixed(2)}%`);

/**
 * Every campaign on the business's ad account with Meta's numbers for a date
 * range, including campaigns made in Meta Ads Manager (lib/ads/accountInsights).
 * Server-rendered; the range is a link (?range=), so the page is shareable
 * and needs no client state.
 */
export function AdAccountPerformance({ overview }: { overview: AdsOverview }) {
  const fetched = new Date(overview.fetchedAt).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
  return (
    <section style={{ display: "grid", gap: 16, marginBottom: 32 }} aria-labelledby="adp-title">
      <div className="adp-head">
        <h2 id="adp-title" className="adp-title">
          Ad account performance
        </h2>
        <nav className="adp-range" aria-label="Date range">
          {RANGES.map((r) => (
            <Link key={r.key} href={`/marketing/ads?range=${r.key}`} className="adp-range-a" aria-current={r.key === overview.range.key ? "page" : undefined}>
              {r.label}
            </Link>
          ))}
        </nav>
      </div>
      {overview.accounts.map((a) => (
        <Account key={a.adAccountId} account={a} several={overview.accounts.length > 1} />
      ))}
      <div className="adp-foot">
        From Meta at {fetched}. Numbers can take a few hours to settle, as in Ads Manager.{" "}
        <Link href={`/marketing/ads?range=${overview.range.key}&fresh=1`} className="adp-refresh">
          <RefreshCw size={12} /> Refresh
        </Link>
      </div>
    </section>
  );
}

function Account({ account: a, several }: { account: AccountPerformance; several: boolean }) {
  if (a.error) {
    return (
      <Card style={{ padding: "16px 18px", fontSize: 13.5, lineHeight: 1.55 }}>
        {several && <div style={{ fontWeight: 600, marginBottom: 4 }}>{a.name}</div>}
        Meta did not return this ad account&apos;s numbers: {a.error}
      </Card>
    );
  }
  const m = (n: number | null) => (n == null ? "-" : money(n, a.currency));
  const t = a.totals;
  const tiles: Array<[string, string]> = [
    ["Spent", m(t.spend)],
    ["People reached", int(t.reach)],
    ["Impressions", int(t.impressions)],
    ["Link clicks", int(t.linkClicks)],
    ["Click rate", pct(t.ctr)],
  ];
  if (a.leads > 0) tiles.push(["Leads", int(a.leads)], ["Cost per lead", m(a.costPerLead)]);
  if (a.conversations > 0) tiles.push(["Conversations", int(a.conversations)]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {several && <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{a.name}</div>}
      <div className="bs-tiles">
        {tiles.map(([label, value]) => (
          <div key={label} className="bs-tile">
            <span className="bs-tile-label">{label}</span>
            <span className="bs-tile-value">{value}</span>
          </div>
        ))}
      </div>

      {a.campaigns.length === 0 ? (
        <Card style={{ padding: "16px 18px", fontSize: 13.5, color: "var(--text-secondary)" }}>
          No campaign spent anything in this period.{a.quiet ? ` ${a.quiet} paused or ended campaign${a.quiet === 1 ? " is" : "s are"} on the account.` : ""}
        </Card>
      ) : (
        <div className="adp-table-wrap">
          <table className="ib-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Spent</th>
                <th style={{ textAlign: "right" }}>Results</th>
                <th style={{ textAlign: "right" }}>Per result</th>
                <th style={{ textAlign: "right" }}>Reach</th>
                <th style={{ textAlign: "right" }}>Link clicks</th>
                <th style={{ textAlign: "right" }}>Click rate</th>
              </tr>
            </thead>
            <tbody>
              {a.campaigns.map((c) => {
                const st = STATE[c.state] ?? STATE.other;
                return (
                  <tr key={c.id}>
                    <td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.builtHere ? (
                        <Link href={c.href} className="adp-link">
                          {c.name}
                        </Link>
                      ) : (
                        <a href={c.href} target="_blank" rel="noopener noreferrer" className="adp-link" title="Open in Meta Ads Manager">
                          {c.name} <ExternalLink size={11} aria-hidden />
                        </a>
                      )}
                    </td>
                    <td>
                      <Badge tone={st.tone} dot>
                        {st.label}
                      </Badge>
                    </td>
                    <td style={{ textAlign: "right" }}>{m(c.numbers.spend)}</td>
                    <td style={{ textAlign: "right" }}>
                      {int(c.results)} <span className="adp-muted">{c.resultLabel.toLowerCase()}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>{m(c.costPerResult)}</td>
                    <td style={{ textAlign: "right" }}>{int(c.numbers.reach)}</td>
                    <td style={{ textAlign: "right" }}>{int(c.numbers.linkClicks)}</td>
                    <td style={{ textAlign: "right" }}>{pct(c.numbers.ctr)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {a.campaigns.length > 0 && a.quiet > 0 && (
        <div className="adp-foot">
          {a.quiet} paused or ended campaign{a.quiet === 1 ? "" : "s"} with no spend in this period {a.quiet === 1 ? "is" : "are"} not shown.
        </div>
      )}
    </div>
  );
}
