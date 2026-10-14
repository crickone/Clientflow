import Link from "next/link";
import { ChevronDown, Image as ImageIcon, Megaphone, MessageSquare, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { getUsageReport } from "@/lib/ai/usageReport";
import { formatSpend, type ActivityGroup } from "@/lib/ai/usageReportModel";

export const dynamic = "force-dynamic";

const KIND_ICON = { campaign: Megaphone, chat: MessageSquare, post: ImageIcon, other: Sparkles } as const;
const KIND_NAME = { campaign: "Campaign", chat: "Adonis chat", post: "Post", other: "" } as const;

function monthName(m: string, style: "long" | "short" = "long") {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString("en-IE", { month: style, year: style === "long" ? "numeric" : undefined, timeZone: "UTC" });
}

function day(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" });
}

function when(g: ActivityGroup) {
  const a = day(g.firstAt);
  const b = day(g.lastAt);
  return a === b ? a : `${a} to ${b}`;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Where the account's AI spend went: the month's total, by feature, and each piece of work. */
export default async function UsagePage({ searchParams }: { searchParams: { m?: string } }) {
  await requireAdminPage();
  const tenantId = getCurrentMembership()!.tenant.id;
  const r = getUsageReport(tenantId, searchParams.m);
  const used = r.totalCents;
  const left = r.allowanceCents - used;
  const pct = r.allowanceCents > 0 ? Math.min(100, (used / r.allowanceCents) * 100) : 100;
  const maxFeature = r.features[0]?.cents ?? 0;

  return (
    <div className="app-page">
      <PageHeader eyebrow="Account" title="AI usage" subtitle="What the AI has cost this account each month, and what it was for." />
      <div className="use">
        {r.months.length > 1 && (
          <nav className="use-months" aria-label="Month">
            {r.months.map((m) => (
              <Link key={m.month} href={`/settings/usage?m=${m.month}`} className="use-month" aria-current={m.month === r.month ? "page" : undefined}>
                <span>{monthName(m.month, "short")}</span>
                <span className="use-month-amt">{formatSpend(m.cents)}</span>
              </Link>
            ))}
          </nav>
        )}

        <section className="ui-card use-summary">
          <div className="use-total">
            <span className="use-total-num">{formatSpend(used)}</span>
            <span className="use-total-sub">
              used in {monthName(r.month)} · {plural(r.calls, "AI request", "AI requests")}
            </span>
          </div>
          <div className="use-meter" data-over={left < 0} aria-hidden>
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className="use-meter-note">
            {left >= 0
              ? `${formatSpend(left)} of the ${formatSpend(r.allowanceCents)} included each month is left.`
              : `${formatSpend(-left)} over the ${formatSpend(r.allowanceCents)} included each month. The extra comes out of AI credit.`}
          </p>
          <dl className="use-facts">
            <div>
              <dt>Included each month</dt>
              <dd>{formatSpend(r.allowanceCents)}</dd>
            </div>
            <div>
              <dt>AI credit balance</dt>
              <dd>{formatSpend(r.creditCents)}</dd>
            </div>
          </dl>
        </section>

        {r.calls === 0 ? (
          <section className="use-section">
            <p className="use-empty">No AI was used in {monthName(r.month)}.</p>
          </section>
        ) : (
          <>
            <section className="use-section" aria-labelledby="use-feat-h">
              <h3 id="use-feat-h">By feature</h3>
              <ul className="use-feats">
                {r.features.map((f) => (
                  <li key={f.feature}>
                    <span className="use-feat-name">{f.feature}</span>
                    <span className="use-feat-bar" aria-hidden>
                      <span style={{ width: `${maxFeature ? Math.max(2, (f.cents / maxFeature) * 100) : 0}%` }} />
                    </span>
                    <span className="use-feat-amt">{formatSpend(f.cents)}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="use-section" aria-labelledby="use-act-h">
              <h3 id="use-act-h">What it went on</h3>
              <ul className="use-acts">
                {r.activity.map((g) => {
                  const Icon = KIND_ICON[g.kind];
                  return (
                    <li key={g.key}>
                      <details className="use-act">
                        <summary>
                          <span className="use-act-icon" aria-hidden>
                            <Icon size={15} />
                          </span>
                          <span className="use-act-main">
                            <span className="use-act-title">{g.title}</span>
                            <span className="use-act-meta">
                              {(g.kind === "other"
                                ? [when(g), plural(g.calls, "request", "requests")]
                                : [KIND_NAME[g.kind], when(g), g.parts.map((p) => p.feature).join(", ")]
                              ).join(" · ")}
                            </span>
                          </span>
                          <span className="use-act-amt">{formatSpend(g.cents)}</span>
                          <ChevronDown size={15} className="use-act-chev" aria-hidden />
                        </summary>
                        <ul className="use-parts">
                          {g.parts.map((p) => (
                            <li key={p.feature}>
                              <span>{p.feature}</span>
                              <span className="use-part-calls">{plural(p.calls, "request", "requests")}</span>
                              <span className="use-part-amt">{formatSpend(p.cents)}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}

        <p className="use-foot">
          Costs are estimates from the AI providers&rsquo; prices. Since 14 October 2026 each cost is linked to the campaign, Adonis chat or
          post it was for. Earlier costs are grouped by feature and day.
        </p>
      </div>
    </div>
  );
}
