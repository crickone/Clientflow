"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ExternalLink, Pause, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardLabel, CardValue } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { refreshAdInsightsAction, setAdCampaignStatusAction, setAdSetBudgetAction } from "@/app/marketing/ads/actions";
import type { AdInsights } from "@/lib/ads/service";
import { AD_STATUS, money } from "./status";

/**
 * A launched campaign: what it has spent and achieved (pulled from Meta on
 * open and on demand), each ad set's daily budget, and pause / resume /
 * archive. Resuming and raising a budget confirm the spend first.
 */
export function AdCampaignDetail({
  id,
  status,
  objective,
  currency,
  adSets,
  insights,
  insightsAt,
  launchedAt,
  adAccountId,
  metaCampaignId,
}: {
  id: number;
  status: string;
  objective: string;
  currency: string;
  adSets: Array<{ name: string; dailyBudget: number }>;
  insights: AdInsights | null;
  insightsAt: string | null;
  launchedAt: string | null;
  adAccountId: string;
  metaCampaignId: string | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, start] = useTransition();
  const [budgets, setBudgets] = useState(adSets.map((s) => String(s.dailyBudget)));
  const st = AD_STATUS[status] ?? AD_STATUS.draft;

  function refresh(quiet = false) {
    start(async () => {
      const r = await refreshAdInsightsAction(id);
      if (!r.ok) {
        if (!quiet) toast.error(r.error);
        return;
      }
      router.refresh();
    });
  }

  // Results are fetched from Meta when the page opens if they are older than 15 minutes.
  useEffect(() => {
    if (status === "archived") return;
    if (!insightsAt || Date.now() - Date.parse(insightsAt) > 15 * 60 * 1000) refresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setStatus(next: "active" | "paused" | "archived") {
    const total = adSets.reduce((s, a) => s + a.dailyBudget, 0);
    const copy =
      next === "active"
        ? { title: "Resume this campaign?", body: `It starts spending again, up to ${money(total, currency)} a day.`, confirmLabel: "Resume" }
        : next === "paused"
          ? { title: "Pause this campaign?", body: "It stops showing and stops spending until you resume it.", confirmLabel: "Pause" }
          : { title: "Archive this campaign?", body: "It stops for good and moves out of the way. Its results stay here.", confirmLabel: "Archive", destructive: true };
    if (!(await confirm(copy))) return;
    start(async () => {
      const r = await setAdCampaignStatusAction(id, next);
      if (!r.ok) return void toast.error(r.error);
      toast.success(next === "active" ? "Campaign resumed" : next === "paused" ? "Campaign paused" : "Campaign archived");
      router.refresh();
    });
  }

  async function saveBudget(i: number) {
    const amount = Number(budgets[i]);
    if (!(amount >= 1)) return void toast.error("The daily budget must be at least 1.");
    if (amount > adSets[i].dailyBudget) {
      const ok = await confirm({
        title: "Raise this budget?",
        body: `"${adSets[i].name}" will spend up to ${money(amount, currency)} a day (was ${money(adSets[i].dailyBudget, currency)}).`,
        confirmLabel: "Raise budget",
      });
      if (!ok) return;
    }
    start(async () => {
      const r = await setAdSetBudgetAction(id, i, amount);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Budget updated");
      router.refresh();
    });
  }

  const managerUrl = metaCampaignId
    ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${adAccountId.replace(/^act_/, "")}&selected_campaign_ids=${metaCampaignId}`
    : null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card style={{ padding: 20, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Badge tone={st.tone} dot>
          {st.label}
        </Badge>
        <span style={{ fontSize: 13, color: "var(--text-tertiary)", textTransform: "capitalize" }}>
          {objective}
          {launchedAt ? ` · launched ${new Date(launchedAt).toLocaleDateString("en-IE")}` : ""}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {status === "active" && (
            <Button variant="outline" onClick={() => setStatus("paused")} disabled={busy}>
              <Pause size={14} /> Pause
            </Button>
          )}
          {status === "paused" && (
            <Button onClick={() => setStatus("active")} disabled={busy}>
              <Play size={14} /> Resume
            </Button>
          )}
          {status !== "archived" && (
            <Button variant="ghost" onClick={() => setStatus("archived")} disabled={busy}>
              <Archive size={14} /> Archive
            </Button>
          )}
        </span>
      </Card>

      <Card style={{ padding: 20, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <CardLabel>Results so far</CardLabel>
          <Button variant="ghost" size="sm" style={{ marginLeft: "auto" }} onClick={() => refresh()} disabled={busy}>
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
        {insights ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
            <Stat label="Spent" value={money(insights.spend, currency)} />
            <Stat label={insights.resultLabel} value={insights.results.toLocaleString("en-IE")} />
            <Stat label="Cost per result" value={insights.costPerResult != null ? money(insights.costPerResult, currency) : "-"} />
            <Stat label="People reached" value={insights.reach.toLocaleString("en-IE")} />
            <Stat label="Impressions" value={insights.impressions.toLocaleString("en-IE")} />
            <Stat label="Clicks" value={insights.clicks.toLocaleString("en-IE")} />
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>No results yet. Meta usually reports within a few hours of launch.</div>
        )}
        {insightsAt && <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Updated {new Date(insightsAt).toLocaleString("en-IE")}</div>}
      </Card>

      <Card style={{ padding: 20, display: "grid", gap: 10 }}>
        <CardLabel>Ad sets and daily budgets</CardLabel>
        {adSets.map((s, i) => {
          const row = insights?.adSets.find((r) => r.name === s.name);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 0", borderTop: i ? "1px solid var(--hairline)" : "none" }}>
              <div style={{ flex: "1 1 200px" }}>
                <div style={{ fontSize: 14, color: "var(--text-primary)" }}>{s.name}</div>
                {row && (
                  <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
                    {money(row.spend, currency)} spent · {row.results} {insights?.resultLabel.toLowerCase()}
                  </div>
                )}
              </div>
              {status !== "archived" && (
                <>
                  <Input aria-label={`Daily budget for ${s.name}`} type="number" min={1} value={budgets[i]} onChange={(e) => setBudgets((b) => b.map((x, j) => (j === i ? e.target.value : x)))} style={{ width: 110 }} />
                  <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>{currency} a day</span>
                  <Button variant="outline" size="sm" onClick={() => saveBudget(i)} disabled={busy || Number(budgets[i]) === s.dailyBudget}>
                    Save
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </Card>

      {managerUrl && (
        <div>
          <a href={managerUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            Open in Meta Ads Manager <ExternalLink size={13} />
          </a>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{label}</div>
      <CardValue>{value}</CardValue>
    </div>
  );
}
