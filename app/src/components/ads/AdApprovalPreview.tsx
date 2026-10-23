"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { AdPreview, type PreviewAd } from "./builder/AdPreview";
import { CTA_LABEL } from "./ctaLabel";
import { PLATFORM_LABEL, platformsOf, type AdSpec, type CampaignSpec } from "@/lib/ads/spec";

type Brand = { pageName: string; instagramHandle: string | null; logoUrl: string | null };

/** The ads an approval card is about to save or add, with the context each runs in. */
function adsOf(name: string, input: Record<string, unknown>, money: (n: number) => string): Array<{ ad: AdSpec; where: string; objective: string | null; platforms: "both" | "facebook" | "instagram" }> {
  if (name === "draft_ad_campaign") {
    const spec = (input.spec ?? {}) as Partial<CampaignSpec>;
    const p = platformsOf(spec as CampaignSpec);
    const platforms = PLATFORM_LABEL[p];
    return (spec.adSets ?? []).flatMap((set) => {
      const a = set.audience;
      const places = (a?.locations ?? []).map((l) => (l.kind === "country" ? l.name : `${l.name} + ${l.radiusKm} km`)).join(", ");
      const who = a?.genders?.length === 1 ? (a.genders[0] === "female" ? "Women" : "Men") : "Everyone";
      const where = [platforms, set.dailyBudget ? `${money(set.dailyBudget)} a day` : null, places || null, a ? `${who} ${a.ageMin}–${a.ageMax >= 65 ? "65+" : a.ageMax}` : null].filter(Boolean).join(" · ");
      return (set.ads ?? []).map((ad) => ({ ad, where, objective: spec.objective ?? null, platforms: p }));
    });
  }
  if (name === "add_ad_to_campaign" && input.ad) {
    return [{ ad: input.ad as AdSpec, where: `Ad set ${Number(input.adSetIndex ?? 0) + 1} of campaign #${String(input.campaignId ?? "?")}`, objective: null, platforms: "both" }];
  }
  return [];
}

const hostOf = (url?: string) => {
  try {
    return url ? new URL(url).host.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

/**
 * The ad itself inside Adonis's approval card: the same Facebook / Instagram
 * mock-up the ads builder shows, built from the plan Adonis wants to save, so
 * the operator approves what people will actually see.
 */
export function AdApprovalPreview({ name, input }: { name: string; input: Record<string, unknown> }) {
  const [data, setData] = useState<{ brand: Brand; designs: Record<number, string[]>; currency: string; socialPosts: number[] } | null>(null);
  const currency = data?.currency ?? "EUR";
  const ads = useMemo(
    () => adsOf(name, input, (n) => new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n)),
    [name, input, currency],
  );
  const designIds = useMemo(() => [...new Set(ads.map((a) => Number(a.ad.creative?.designId)).filter((n) => n > 0))], [ads]);
  const designKey = designIds.join(",");
  const account = typeof input.adAccountId === "string" ? input.adAccountId : "";
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!designKey && name !== "draft_ad_campaign" && name !== "add_ad_to_campaign") return;
    let live = true;
    fetch(`/api/ads/preview?designs=${designKey}&account=${encodeURIComponent(account)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && d && setData(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [designKey, account, name]);

  if (!ads.length) return null;
  const cur = ads[Math.min(i, ads.length - 1)];
  const c = cur.ad.creative;
  const images = data?.designs[Number(c?.designId)] ?? [];
  const shown = c?.format === "single" ? images.slice(0, 1) : images;
  const preview: PreviewAd = {
    pageName: data?.brand.pageName ?? "Your Page",
    instagramHandle: data?.brand.instagramHandle ?? null,
    logoUrl: data?.brand.logoUrl ?? null,
    primaryText: c?.primaryText ?? "",
    headline: c?.headline ?? "",
    description: c?.description,
    ctaLabel: cur.objective === "messages" ? "Send message" : CTA_LABEL[c?.cta ?? "LEARN_MORE"] ?? "Learn more",
    images: shown,
    linkHost: cur.objective === "leads" || cur.objective === "messages" ? null : hostOf(c?.linkUrl),
  };

  return (
    <div className="aap">
      <div className="aap-head">
        <span>
          {ads.length > 1 ? `Ad ${i + 1} of ${ads.length}: ` : ""}
          {cur.ad.name}
        </span>
        {ads.length > 1 && (
          <span className="aap-nav">
            <button type="button" onClick={() => setI((i + ads.length - 1) % ads.length)} aria-label="Previous ad">
              <ChevronLeft size={15} />
            </button>
            <button type="button" onClick={() => setI((i + 1) % ads.length)} aria-label="Next ad">
              <ChevronRight size={15} />
            </button>
          </span>
        )}
      </div>
      <div className="aap-where">{cur.where}</div>
      <div className="aap-mock">{data ? <AdPreview ad={preview} platforms={cur.platforms} /> : <div className="aap-loading">Loading the ad…</div>}</div>
      {data && images.length === 0 && <div className="aap-warn">This design has no images yet. Generate it in Content Studio first, or the ad can't launch.</div>}
      {data && images.length > 0 && data.socialPosts.includes(Number(c?.designId)) && (
        <div className="aap-warn">
          This picture was made as a social post, not an ad, so its words can be wrong for an ad (for example &ldquo;link in bio&rdquo;). Ask Adonis to make a new ad instead.
        </div>
      )}
    </div>
  );
}
