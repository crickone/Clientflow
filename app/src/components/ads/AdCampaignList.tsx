import Link from "next/link";
import { Eye, Heart, Megaphone, MessageCircle, MousePointerClick, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { AD_STATUS, money } from "./status";

export interface AdCampaignListItem {
  id: number;
  name: string;
  objective: string;
  status: string;
  dailyBudget: number;
  currency: string;
  spend: number | null;
  results: number | null;
  resultLabel: string | null;
  error: string | null;
}

const OBJECTIVE_ICON: Record<string, typeof Megaphone> = { awareness: Eye, traffic: MousePointerClick, engagement: Heart, leads: UserPlus, messages: MessageCircle };

export function AdCampaignList({ campaigns }: { campaigns: AdCampaignListItem[] }) {
  if (campaigns.length === 0) {
    return (
      <EmptyState
        icon={<Megaphone size={22} strokeWidth={1.75} />}
        title="No ad campaigns yet"
        message="Build one here, or ask Adonis to draft a campaign from a Content Studio design."
      />
    );
  }
  return (
    <div className="adc-grid">
      {campaigns.map((c) => {
        const st = AD_STATUS[c.status] ?? AD_STATUS.draft;
        const Icon = OBJECTIVE_ICON[c.objective] ?? Megaphone;
        return (
          <Link key={c.id} href={`/marketing/ads/${c.id}`} className="adc-card">
            <div className="adc-card-top">
              <span className="adc-card-icon">
                <Icon size={17} strokeWidth={1.9} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="adc-card-name">{c.name}</div>
                <div className="adc-card-sub" style={{ textTransform: "capitalize" }}>
                  {c.objective} · {money(c.dailyBudget, c.currency)} a day
                </div>
              </div>
              <Badge tone={st.tone} dot>
                {st.label}
              </Badge>
            </div>
            {c.error && <div style={{ color: "var(--danger)", fontSize: 12.5, lineHeight: 1.45 }}>{c.error}</div>}
            <dl className="adc-stats">
              <div className="adc-stat">
                <dt>Spent</dt>
                <dd>{c.spend != null ? money(c.spend, c.currency) : "–"}</dd>
              </div>
              <div className="adc-stat">
                <dt>{c.resultLabel ?? "Results"}</dt>
                <dd>{c.spend != null ? (c.results ?? 0) : "–"}</dd>
              </div>
              <div className="adc-stat">
                <dt>Per result</dt>
                <dd>{c.spend != null && c.results ? money(c.spend / c.results, c.currency) : "–"}</dd>
              </div>
            </dl>
          </Link>
        );
      })}
    </div>
  );
}
