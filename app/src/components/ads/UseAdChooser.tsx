"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Layers, Plus, Radio } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { AdPreview } from "@/components/ads/builder/AdPreview";
import { addCreativeToCampaignAction } from "@/app/marketing/ads/actions";
import type { Objective } from "@/lib/ads/spec";

export interface ChooserVersion {
  /** The version number (1-based) the server knows it by; 0 for a video ad's text options. */
  variant: number;
  label: string;
  angle: string;
  primaryText: string;
  headline: string;
  description: string;
  ctaLabel: string;
  images: string[];
  video: string | null;
  story: { kind: "image" | "video"; url: string } | null;
}

export interface ChooserCampaign {
  id: number;
  name: string;
  status: "draft" | "error" | "active" | "paused";
  objective: Objective;
  currency: string;
  adSets: { name: string; ads: number; dailyBudget: number }[];
}

const OBJECTIVE_SHORT: Record<Objective, string> = {
  awareness: "Awareness",
  traffic: "Website visits",
  engagement: "Engagement",
  leads: "Leads",
  messages: "Messages",
};
const STATUS: Record<ChooserCampaign["status"], { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "draft" },
  error: { label: "Draft", tone: "draft" },
  active: { label: "Live", tone: "live" },
  paused: { label: "Paused", tone: "paused" },
};
const MAX_ADS = 6;

const money = (n: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-IE", { style: "currency", currency: currency || "EUR", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n}`;
  }
};

/**
 * Where a finished ad goes to work. The ad on the left, exactly as people
 * will see it; on the right the two ways to run it: a new campaign built
 * around it, or into an ad set of a campaign you already have.
 */
export function UseAdChooser({
  ad,
  versions,
  brand,
  campaigns,
  initialRun,
}: {
  ad: { id: number; name: string; kind: "image" | "video"; goalObjective: Objective; finished: boolean };
  /** Versions to start ticked, from "Run only this version" on the ad page. All when empty. */
  initialRun?: number[];
  versions: ChooserVersion[];
  brand: { pageName: string; instagramHandle: string | null; logoUrl: string | null; linkHost: string | null };
  campaigns: ChooserCampaign[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [v, setV] = useState(0);
  const [campaignId, setCampaignId] = useState<number | null>(campaigns[0]?.id ?? null);
  const [setIndex, setSetIndex] = useState(0);
  const [pending, start] = useTransition();
  const version = versions[Math.min(v, versions.length - 1)];
  const all = versions.map((x) => x.variant);
  const [run, setRun] = useState<number[]>(() => {
    const picked = (initialRun ?? []).filter((n) => all.includes(n));
    return picked.length ? picked : all;
  });
  const choosing = ad.kind === "image" && versions.length > 1;
  const adCount = ad.kind === "video" ? 1 : run.length;
  const variants = ad.kind === "image" && run.length < versions.length ? [...run].sort((a, b) => a - b) : null;
  function toggleRun(n: number) {
    setRun((r) => (r.includes(n) ? (r.length > 1 ? r.filter((x) => x !== n) : r) : [...r, n]));
  }
  const campaign = campaigns.find((c) => c.id === campaignId) ?? null;
  const set = campaign?.adSets[setIndex] ?? null;
  const live = campaign?.status === "active" || campaign?.status === "paused";
  const full = set ? set.ads + adCount > MAX_ADS : false;

  const summary = useMemo(() => {
    if (!campaign || !set) return null;
    const what = adCount === 1 ? "1 ad" : `${adCount} ads`;
    return `Adds ${what} to “${set.name}” in “${campaign.name}”.`;
  }, [campaign, set, adCount]);

  async function add() {
    if (!campaign || !set) return;
    if (live) {
      const ok = await confirm({
        title: `Add to a ${campaign.status === "active" ? "live" : "paused"} campaign?`,
        body:
          campaign.status === "active"
            ? `The ${adCount === 1 ? "ad starts" : "ads start"} running inside “${set.name}” as soon as Meta approves ${adCount === 1 ? "it" : "them"}, from the ad set's existing budget of ${money(set.dailyBudget, campaign.currency)} a day.`
            : `The ${adCount === 1 ? "ad is" : "ads are"} added to “${set.name}” and run when you resume the campaign.`,
        confirmLabel: "Add to campaign",
      });
      if (!ok) return;
    }
    start(async () => {
      const res = await addCreativeToCampaignAction(ad.id, campaign.id, setIndex, variants);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data.live ? "Added and sent to Meta for review" : "Added to the campaign");
      router.push(`/marketing/ads/${campaign.id}`);
    });
  }

  return (
    <div className="use-ad">
      <Link href={`/content-studio/ads/${ad.id}`} className="use-ad-back">
        <ArrowLeft size={14} /> Back to the ad
      </Link>
      <header className="use-ad-head">
        <h1>Run this ad</h1>
        <p>
          <strong>{ad.name}</strong> · {ad.kind === "video" ? "Video ad" : `Image ad, ${versions.length} versions`}
        </p>
      </header>

      {!ad.finished ? (
        <section className="ui-card use-ad-wait">Adonis is still making this ad. Come back once it is finished.</section>
      ) : (
        <div className="use-ad-grid">
          <aside className="use-ad-preview">
            {versions.length > 1 && (
              <div className="use-ad-versions" role="tablist" aria-label={ad.kind === "video" ? "Text versions" : "Versions"}>
                {versions.map((x, i) => (
                  <button key={i} type="button" role="tab" aria-selected={i === v} data-on={i === v} onClick={() => setV(i)}>
                    <span>{x.label}</span>
                    {x.angle && <em>{x.angle}</em>}
                  </button>
                ))}
              </div>
            )}
            <AdPreview
              ad={{
                pageName: brand.pageName,
                instagramHandle: brand.instagramHandle,
                logoUrl: brand.logoUrl,
                primaryText: version.primaryText,
                headline: version.headline,
                description: version.description,
                ctaLabel: version.ctaLabel,
                images: version.images,
                linkHost: brand.linkHost,
                video: version.video,
                story: version.story,
              }}
            />
          </aside>

          <div className="use-ad-paths">
            {choosing && (
              <section className="ui-card use-ad-run" aria-labelledby="use-ad-run-h">
                <div className="use-ad-run-head">
                  <h2 id="use-ad-run-h">Which versions to run</h2>
                  <span>{run.length} of {versions.length}</span>
                </div>
                <p>Run one, or several to test them against each other. With more than one, Meta shares the budget and puts more behind the version that works best.</p>
                <div className="use-ad-run-list">
                  {versions.map((x, i) => {
                    const on = run.includes(x.variant);
                    const last = on && run.length === 1;
                    return (
                      <div key={x.variant} className="use-ad-run-row" data-on={on} data-viewing={i === v}>
                        <button type="button" className="use-ad-run-view" onClick={() => setV(i)} aria-label={`Preview ${x.label}`}>
                          {x.images[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element -- our own render route
                            <img src={x.images[0]} alt="" />
                          ) : (
                            <span />
                          )}
                        </button>
                        <button type="button" className="use-ad-run-text" onClick={() => setV(i)}>
                          <strong>{x.label}</strong>
                          {x.angle && <em>{x.angle}</em>}
                        </button>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={`Run ${x.label}`}
                          className="use-ad-run-toggle"
                          onClick={() => toggleRun(x.variant)}
                          disabled={last}
                          title={last ? "At least one version has to run" : on ? "Leave this version out" : "Run this version"}
                        >
                          {on && <Check size={13} strokeWidth={3} />}
                          {on ? "Running" : "Run"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
            <section className="ui-card use-ad-path">
              <div className="use-ad-path-head">
                <span className="use-ad-path-ic"><Plus size={17} /></span>
                <div>
                  <h2>Start a new campaign</h2>
                  <p>
                    Built around this ad: {ad.kind === "video" ? "the ad" : adCount === versions.length && adCount > 1 ? `all ${adCount} versions` : adCount === 1 ? `version ${run[0]}` : `versions ${[...run].sort((a, b) => a - b).join(" and ")}`} in one ad set, aimed at {OBJECTIVE_SHORT[ad.goalObjective].toLowerCase()}. You choose the audience, budget and dates before anything goes live.
                  </p>
                </div>
              </div>
              <Link href={`/marketing/ads/new?fromAd=${ad.id}${variants ? `&versions=${variants.join(",")}` : ""}`} className="use-ad-path-cta">
                <Button>
                  Start a new campaign <ArrowRight size={15} />
                </Button>
              </Link>
            </section>

            <section className="ui-card use-ad-path">
              <div className="use-ad-path-head">
                <span className="use-ad-path-ic"><Layers size={17} /></span>
                <div>
                  <h2>Add to a campaign</h2>
                  <p>Put {adCount === 1 ? "it" : `the ${adCount} versions`} into an ad set you already run, alongside the ads there.</p>
                </div>
              </div>

              {campaigns.length === 0 ? (
                <p className="use-ad-empty">You have no campaigns yet. Start a new one with this ad.</p>
              ) : (
                <>
                  <div className="use-ad-campaigns" role="radiogroup" aria-label="Campaign">
                    {campaigns.map((c) => {
                      const on = c.id === campaignId;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          className="use-ad-campaign"
                          data-on={on}
                          onClick={() => {
                            setCampaignId(c.id);
                            setSetIndex(0);
                          }}
                        >
                          <span className="use-ad-radio" aria-hidden>{on && <Check size={12} strokeWidth={3} />}</span>
                          <span className="use-ad-campaign-main">
                            <span className="use-ad-campaign-name">{c.name}</span>
                            <span className="use-ad-campaign-meta">
                              {OBJECTIVE_SHORT[c.objective]} · {c.adSets.length} ad set{c.adSets.length === 1 ? "" : "s"} · {money(c.adSets.reduce((a, s) => a + s.dailyBudget, 0), c.currency)} a day
                            </span>
                          </span>
                          <span className={`use-ad-status is-${STATUS[c.status].tone}`}>
                            {c.status === "active" && <Radio size={11} />}
                            {STATUS[c.status].label}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {campaign && (
                    <div className="use-ad-sets">
                      <div className="use-ad-sets-label">Ad set</div>
                      <div className="use-ad-sets-row" role="radiogroup" aria-label="Ad set">
                        {campaign.adSets.map((s, i) => {
                          const tooMany = s.ads + adCount > MAX_ADS;
                          return (
                            <button key={i} type="button" role="radio" aria-checked={i === setIndex} data-on={i === setIndex} data-full={tooMany} onClick={() => setSetIndex(i)}>
                              <span>{s.name}</span>
                              <em>{s.ads} of {MAX_ADS} ads</em>
                            </button>
                          );
                        })}
                      </div>
                      {campaign.objective !== ad.goalObjective && (
                        <p className="use-ad-note">This campaign is for {OBJECTIVE_SHORT[campaign.objective].toLowerCase()}; the ads take its goal and button behaviour.</p>
                      )}
                      {full && <p className="use-ad-note is-warn">That ad set has room for {Math.max(0, MAX_ADS - (set?.ads ?? 0))} more. Pick another ad set or start a new campaign.</p>}
                    </div>
                  )}

                  <div className="use-ad-foot">
                    <span>{summary}{live ? " It goes to Meta straight away." : ""}</span>
                    <Button onClick={add} loading={pending} disabled={!campaign || !set || full}>
                      Add to campaign
                    </Button>
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
