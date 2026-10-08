"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Megaphone, Sparkles, Video } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { createImageAdAction } from "@/app/content-studio/ads/actions";
import { AD_GOALS, AD_GOAL_LABEL, type AdGoal } from "@/lib/ads/adCopy";

/**
 * Start an ad. An ad is briefed differently from a post: what is being
 * sold, who to, and what you want them to do. Adonis writes three versions
 * (different angles) and designs each in the three ad sizes.
 */
export function NewAdForm({ website, hasDesignSystem }: { website: string; hasDesignSystem: boolean }) {
  const router = useRouter();
  const [kind, setKind] = useState<"image" | "video">("image");
  const [offer, setOffer] = useState("");
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState<AdGoal>("bookings");
  const [linkUrl, setLinkUrl] = useState(website && /^https:\/\//.test(website) ? website : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const needsLink = goal === "website" || goal === "bookings";

  function submit() {
    setError(null);
    start(async () => {
      const res = await createImageAdAction({ offer, audience, goal, linkUrl: needsLink ? linkUrl : "" });
      if (!res.ok) return void setError(res.error);
      router.push(`/content-studio/ads/${res.id}`);
    });
  }

  return (
    <div className="ad-new">
      <div className="ad-kind" role="radiogroup" aria-label="Kind of ad">
        <button type="button" role="radio" aria-checked={kind === "image"} className="ad-kind-opt" onClick={() => setKind("image")}>
          <ImageIcon size={20} />
          <span>
            <strong>Image ad</strong>
            <span>Three versions to test, each in feed, square and Stories sizes.</span>
          </span>
        </button>
        <button type="button" role="radio" aria-checked={kind === "video"} className="ad-kind-opt" onClick={() => setKind("video")}>
          <Video size={20} />
          <span>
            <strong>Video ad</strong>
            <span>Upload a clip; Adonis cuts it as an ad with captions and a call to action.</span>
          </span>
        </button>
      </div>

      {kind === "video" ? (
        <section className="nc-card ad-form">
          <p className="ad-hint">Video ads arrive in the next update: upload a clip and Adonis cuts it as an ad, ready for the Ads manager.</p>
        </section>
      ) : (
        <section className="nc-card ad-form">
          {!hasDesignSystem && (
            <p className="ad-warn">
              Image ads are designed in your brand&rsquo;s style. Pick one in{" "}
              <Link href="/settings/design" className="inbox-link">Settings &gt; Design direction</Link> first.
            </p>
          )}
          <label className="nc-label" htmlFor="ad-offer">What is the ad for?</label>
          <textarea
            id="ad-offer"
            className="nc-input"
            rows={3}
            value={offer}
            onChange={(e) => setOffer(e.target.value)}
            placeholder="e.g. A block of five hyperbaric oxygen sessions, guided start to finish, in Clonmel"
          />
          <div className="ad-grid">
            <div>
              <label className="nc-label" htmlFor="ad-aud">Who is it for? (optional)</label>
              <input id="ad-aud" className="field" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. People who train hard and recover slowly" />
            </div>
            <div>
              <label className="nc-label" htmlFor="ad-goal">What should people do?</label>
              <select id="ad-goal" className="field" value={goal} onChange={(e) => setGoal(e.target.value as AdGoal)}>
                {AD_GOALS.map((g) => (
                  <option key={g} value={g}>{AD_GOAL_LABEL[g]}</option>
                ))}
              </select>
            </div>
          </div>
          {needsLink && (
            <div>
              <label className="nc-label" htmlFor="ad-link">Where the button goes</label>
              <input id="ad-link" className="field" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://" />
            </div>
          )}
          {error && <p className="ad-warn">{error}</p>}
          <div className="ad-actions">
            <span className="ad-hint">
              <Megaphone size={14} /> Three versions, nine images. Adonis writes the ad text for each, ready for the Ads manager.
            </span>
            <Button onClick={submit} loading={pending} disabled={!offer.trim() || !hasDesignSystem}>
              <Sparkles size={15} /> Create the ad
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
