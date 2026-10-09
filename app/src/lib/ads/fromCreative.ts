import "server-only";

import { getAdCreative, type AdCreativeView } from "./creatives";
import { GOAL_OBJECTIVE } from "./adCopy";
import type { AdSpec, CampaignSpec } from "./spec";

/**
 * A Content Studio ad as Ads manager ads. An image ad becomes one ad per
 * version (its own picture and text); a video ad becomes ONE ad carrying the
 * two renders and its text versions as Meta's text options.
 */
export function adSpecsFromCreative(ad: AdCreativeView, website: string, variants?: readonly number[] | null): AdSpec[] {
  const link = ad.brief.linkUrl || (/^https:\/\//.test(website) ? website : "");
  if (ad.kind === "video") {
    const [first, ...rest] = ad.videoCopies;
    if (!first || !ad.videoUrls["9:16"]) return [];
    return [
      {
        name: ad.name,
        creative: {
          source: "video",
          designId: 0,
          adCreativeId: ad.id,
          format: "single",
          primaryText: first.primaryText,
          headline: first.headline,
          description: first.description,
          cta: first.cta,
          linkUrl: link,
          extraTexts: rest.map((c) => c.primaryText),
          extraHeadlines: rest.map((c) => c.headline),
        },
      },
    ];
  }
  // Only the versions the operator chose to run; all of them when no choice
  // was made (or the choice names none that exist).
  const chosen = variants?.length ? ad.versions.filter((v) => variants.includes(v.variant)) : [];
  return (chosen.length ? chosen : ad.versions).map((v) => ({
    name: `${ad.name} · Version ${v.variant}${v.copy?.angle ? ` (${v.copy.angle})` : ""}`.slice(0, 120),
    creative: {
      source: "design" as const,
      designId: v.designId,
      format: "single" as const,
      primaryText: v.copy?.primaryText ?? "",
      headline: v.copy?.headline ?? "",
      description: v.copy?.description ?? "",
      cta: v.copy?.cta ?? "LEARN_MORE",
      linkUrl: link,
    },
  }));
}

/** A whole new campaign around the ad: one ad set, the ad's goal as the objective. */
export function campaignSpecFromCreative(adId: number, website: string, variants?: readonly number[] | null): CampaignSpec | null {
  const ad = getAdCreative(adId);
  if (!ad) return null;
  const ads = adSpecsFromCreative(ad, website, variants);
  if (!ads.length) return null;
  const objective = GOAL_OBJECTIVE[ad.brief.goal];
  return {
    name: ad.name,
    objective,
    adSets: [
      {
        name: "Ad set 1",
        dailyBudget: 10,
        startAt: null,
        endAt: null,
        audience: { locations: [{ kind: "country", code: "IE", name: "Ireland" }], ageMin: 18, ageMax: 65, genders: [], interests: [], advantageAudience: false },
        ads,
      },
    ],
    leadForm:
      objective === "leads"
        ? { name: `${ad.name} form`, headline: "", fields: ["FULL_NAME", "EMAIL", "PHONE"], privacyPolicyUrl: "", thankYouUrl: /^https:\/\//.test(website) ? website : "" }
        : null,
  };
}

/** "1,3" from a URL into version numbers; junk is dropped. */
export function parseVariants(raw: string | null | undefined): number[] {
  return (raw ?? "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 100);
}
