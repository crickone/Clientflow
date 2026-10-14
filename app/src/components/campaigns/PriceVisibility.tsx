"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { setAdOnlyAction } from "@/app/marketing/campaigns/actions";

/**
 * Who sees the prices on the campaign page: everyone who opens it (the
 * default), or only people who arrive through the ad link.
 */
export function PriceVisibility({ campaignId, landingUrl, accessKey }: { campaignId: number; landingUrl: string; accessKey: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const adLink = accessKey ? `${landingUrl}${landingUrl.includes("?") ? "&" : "?"}k=${accessKey}` : null;

  function set(adOnly: boolean) {
    if (adOnly === Boolean(accessKey)) return;
    start(async () => {
      const r = await setAdOnlyAction(campaignId, adOnly);
      if (!r.ok) return void toast.error(r.error);
      toast.success(adOnly ? "Prices now show only through the ad link" : "Prices now show to everyone on the page");
      router.refresh();
    });
  }
  async function copy() {
    if (!adLink) return;
    try {
      await navigator.clipboard.writeText(adLink.startsWith("/") ? `${window.location.origin}${adLink}` : adLink);
      toast.success("Ad link copied");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it instead.");
    }
  }

  return (
    <div className="ch-vis">
      <span className="ch-label">Who sees the prices</span>
      <div className="ch-seg" role="radiogroup" aria-label="Who sees the prices">
        <button type="button" role="radio" aria-checked={!accessKey} onClick={() => set(false)} disabled={pending}>
          Everyone
        </button>
        <button type="button" role="radio" aria-checked={Boolean(accessKey)} onClick={() => set(true)} disabled={pending}>
          Ad link only
        </button>
      </div>
      <p className="ch-note">
        {accessKey
          ? "Only people who arrive through the ad link see prices and Buy buttons. Everyone else sees the enquiry form."
          : "Anyone with the page link sees prices. The page isn't in your website's menu or on Google."}
      </p>
      {adLink && (
        <button type="button" className="ch-linkbtn" onClick={copy}>
          <Copy size={13} /> Copy ad link
        </button>
      )}
    </div>
  );
}
