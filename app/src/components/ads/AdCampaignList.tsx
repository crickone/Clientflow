import Link from "next/link";
import { Megaphone } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
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
    <div style={{ display: "grid", gap: 10 }}>
      {campaigns.map((c) => {
        const st = AD_STATUS[c.status] ?? AD_STATUS.draft;
        return (
          <Link key={c.id} href={`/marketing/ads/${c.id}`} style={{ textDecoration: "none" }}>
            <Card style={{ padding: 16, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <div style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                <div style={{ color: "var(--text-tertiary)", fontSize: 12.5, marginTop: 2, textTransform: "capitalize" }}>
                  {c.objective} · {money(c.dailyBudget, c.currency)} a day
                </div>
                {c.error && <div style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 4 }}>{c.error}</div>}
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", textAlign: "right" }}>
                {c.spend != null ? (
                  <>
                    <div>{money(c.spend, c.currency)} spent</div>
                    <div style={{ color: "var(--text-tertiary)" }}>
                      {c.results ?? 0} {c.resultLabel?.toLowerCase()}
                    </div>
                  </>
                ) : (
                  <span style={{ color: "var(--text-tertiary)" }}>No results yet</span>
                )}
              </div>
              <Badge tone={st.tone} dot>
                {st.label}
              </Badge>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
