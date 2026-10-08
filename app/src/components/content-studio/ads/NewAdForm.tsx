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
  const [clip, setClip] = useState<File | null>(null);
  const [broll, setBroll] = useState<File[]>([]);
  const [seconds, setSeconds] = useState(25);
  const [uploading, setUploading] = useState(false);
  const needsLink = goal === "website" || goal === "bookings";

  async function submitVideo() {
    if (!clip) return void setError("Choose the clip for the ad.");
    setError(null);
    setUploading(true);
    const form = new FormData();
    form.set("offer", offer);
    form.set("audience", audience);
    form.set("goal", goal);
    form.set("linkUrl", needsLink ? linkUrl : "");
    form.set("seconds", String(seconds));
    form.set("main", clip);
    for (const f of broll) form.append("broll", f);
    try {
      const res = await fetch("/api/content-studio/ads/video", { method: "POST", body: form });
      const data = (await res.json()) as { ok: boolean; id?: number; error?: string };
      if (!data.ok || !data.id) {
        setUploading(false);
        return void setError(data.error ?? "The upload failed. Try again.");
      }
      router.push(`/content-studio/ads/${data.id}`);
    } catch {
      setUploading(false);
      setError("The upload failed. Check the connection and try again.");
    }
  }

  function submit() {
    if (kind === "video") return void submitVideo();
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

      {(
        <section className="nc-card ad-form">
          {kind === "image" && !hasDesignSystem && (
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
          {kind === "video" && (
            <div className="ad-grid">
              <div>
                <label className="nc-label" htmlFor="ad-clip">The clip (someone talking to camera works best)</label>
                <input id="ad-clip" className="field" type="file" accept="video/*" onChange={(e) => setClip(e.target.files?.[0] ?? null)} />
              </div>
              <div>
                <label className="nc-label" htmlFor="ad-broll">B-roll (optional)</label>
                <input id="ad-broll" className="field" type="file" accept="video/*" multiple onChange={(e) => setBroll(Array.from(e.target.files ?? []))} />
              </div>
              <div>
                <label className="nc-label" htmlFor="ad-len">Length</label>
                <select id="ad-len" className="field" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
                  <option value={15}>Up to 15 seconds</option>
                  <option value={25}>Up to 25 seconds</option>
                  <option value={40}>Up to 40 seconds</option>
                </select>
              </div>
            </div>
          )}
          {error && <p className="ad-warn">{error}</p>}
          <div className="ad-actions">
            <span className="ad-hint">
              <Megaphone size={14} />{" "}
              {kind === "image"
                ? "Three versions, nine images. Adonis writes the ad text for each, ready for the Ads manager."
                : "Adonis opens on the strongest line, cuts it short, captions it and ends on your button. Stories and square versions."}
            </span>
            <Button
              onClick={submit}
              loading={pending || uploading}
              disabled={!offer.trim() || (kind === "image" ? !hasDesignSystem : !clip)}
            >
              <Sparkles size={15} /> {uploading ? "Uploading the clip" : "Create the ad"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
