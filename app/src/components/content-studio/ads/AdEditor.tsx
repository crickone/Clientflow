"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Megaphone, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  adStatusAction,
  deleteAdAction,
  redesignAdImageAction,
  retryAdAction,
  saveAdCopyAction,
} from "@/app/content-studio/ads/actions";
import { AD_GOAL_LABEL, AD_SIZES, AD_SIZE_LABEL, LIMITS, type AdCopy } from "@/lib/ads/adCopy";
import { CTAS } from "@/lib/ads/spec";
import type { AdCreativeView, AdVersion } from "@/lib/ads/creatives";
import { renderFileUrl } from "@/lib/image/renderStore.client";

const CTA_LABEL: Record<string, string> = {
  LEARN_MORE: "Learn more",
  BOOK_NOW: "Book now",
  SIGN_UP: "Sign up",
  CONTACT_US: "Contact us",
  GET_OFFER: "Get offer",
  SHOP_NOW: "Shop now",
  MESSAGE_PAGE: "Send message",
  APPLY_NOW: "Apply now",
  SUBSCRIBE: "Subscribe",
};

/**
 * One ad: three versions side by side, each with its images in the three
 * placement sizes and the ad text Meta shows around them. While Adonis is
 * still making it, the page polls and shows where it has got to.
 */
export function AdEditor({ initial, isAdmin }: { initial: AdCreativeView; isAdmin: boolean }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [ad, setAd] = useState(initial);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (ad.status !== "writing") return;
    const t = setInterval(async () => {
      const next = await adStatusAction(ad.id);
      if (next) setAd(next);
    }, 3000);
    return () => clearInterval(t);
  }, [ad.id, ad.status]);

  const refresh = async () => {
    const next = await adStatusAction(ad.id);
    if (next) setAd(next);
  };

  function retry() {
    start(async () => {
      const res = await retryAdAction(ad.id);
      if (!res.ok) return void toast.error(res.error);
      await refresh();
    });
  }

  async function remove() {
    const ok = await confirm({ title: "Delete this ad?", body: "All three versions and their images go.", destructive: true, confirmLabel: "Delete" });
    if (!ok) return;
    await deleteAdAction(ad.id);
    router.push("/content-studio");
  }

  const ready = ad.status !== "writing" && ad.versions.length > 0;

  return (
    <div className="ad-page">
      <header className="ad-head">
        <div style={{ minWidth: 0 }}>
          <div className="ad-eyebrow">
            <Megaphone size={13} /> Image ad · {AD_GOAL_LABEL[ad.brief.goal]}
          </div>
          <h1 className="ad-title">{ad.name}</h1>
        </div>
        <div className="ad-head-actions">
          {ready && isAdmin && (
            <Link href={`/marketing/ads/new?fromAd=${ad.id}`}>
              <Button>
                <Megaphone size={15} /> Create a campaign with it
              </Button>
            </Link>
          )}
          {ad.status !== "writing" && (
            <Button variant="outline" onClick={retry} loading={pending}>
              <Sparkles size={15} /> {ad.versions.length ? "Make it again" : "Try again"}
            </Button>
          )}
          <Button variant="ghost" onClick={remove} aria-label="Delete ad">
            <Trash2 size={15} />
          </Button>
        </div>
      </header>

      {ad.status === "writing" && (
        <section className="nc-card ad-progress" aria-live="polite">
          <RefreshCw size={16} className="spin" />
          <div>
            <strong>Adonis is making this ad.</strong>
            <span>{ad.stage ?? "Getting started"}. This takes a few minutes and keeps going if you leave the page.</span>
          </div>
        </section>
      )}
      {ad.status === "failed" && (
        <section className="nc-card ad-progress is-failed">
          <div>
            <strong>The ad was not finished.</strong>
            <span>{ad.error}</span>
          </div>
        </section>
      )}

      {ad.versions.map((v) => (
        <VersionCard key={v.designId} adId={ad.id} version={v} onChanged={refresh} />
      ))}
    </div>
  );
}

function VersionCard({ adId, version, onChanged }: { adId: number; version: AdVersion; onChanged: () => void }) {
  const [copy, setCopy] = useState<AdCopy | null>(version.copy);
  const [saving, startSave] = useTransition();
  const [busySlide, setBusySlide] = useState<number | null>(null);
  const dirty = JSON.stringify(copy) !== JSON.stringify(version.copy);

  function save() {
    if (!copy) return;
    startSave(async () => {
      const res = await saveAdCopyAction(adId, version.designId, copy);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Ad text saved");
      onChanged();
    });
  }

  async function redesign(slideId: number) {
    setBusySlide(slideId);
    const res = await redesignAdImageAction(adId, slideId, null);
    setBusySlide(null);
    if (!res.ok) return void toast.error(res.error);
    onChanged();
  }

  const set = (k: keyof AdCopy) => (e: { target: { value: string } }) => setCopy((c) => (c ? { ...c, [k]: e.target.value } : c));

  return (
    <section className="nc-card ad-version">
      <div className="ad-version-head">
        <h2>Version {version.variant}</h2>
        {copy?.angle && <span className="inbox-pill">{copy.angle}</span>}
      </div>

      <div className="ad-sizes">
        {AD_SIZES.map((size) => {
          const img = version.images[size];
          return (
            <figure key={size} className={`ad-size ad-size--${size.replace(":", "x")}`}>
              <div className="ad-size-frame">
                {img?.renderFilename ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={renderFileUrl(img.renderFilename)} alt={`Version ${version.variant}, ${AD_SIZE_LABEL[size]}`} />
                ) : (
                  <div className="skeleton" style={{ position: "absolute", inset: 0 }} />
                )}
                {img && busySlide === img.slideId && <div className="ad-size-busy"><RefreshCw size={18} className="spin" /></div>}
              </div>
              <figcaption>
                <span>{AD_SIZE_LABEL[size]}</span>
                {img?.renderFilename && (
                  <span className="ad-size-actions">
                    <button type="button" className="inbox-icon-btn" onClick={() => redesign(img.slideId)} disabled={busySlide !== null} aria-label="Try another design">
                      <RefreshCw size={14} />
                    </button>
                    <a className="inbox-icon-btn" href={renderFileUrl(img.renderFilename)} download aria-label="Download">
                      <Download size={14} />
                    </a>
                  </span>
                )}
              </figcaption>
            </figure>
          );
        })}
      </div>

      {copy && (
        <div className="ad-copy">
          <label className="nc-label">
            Main text <span className="ad-count">{copy.primaryText.length}/{LIMITS.primaryText}</span>
          </label>
          <textarea className="nc-input" rows={4} value={copy.primaryText} onChange={set("primaryText")} maxLength={LIMITS.primaryText} />
          <div className="ad-grid">
            <div>
              <label className="nc-label">
                Headline <span className="ad-count">{copy.headline.length}/{LIMITS.headline}</span>
              </label>
              <input className="field" value={copy.headline} onChange={set("headline")} maxLength={LIMITS.headline} />
            </div>
            <div>
              <label className="nc-label">
                Description <span className="ad-count">{copy.description.length}/{LIMITS.description}</span>
              </label>
              <input className="field" value={copy.description} onChange={set("description")} maxLength={LIMITS.description} />
            </div>
            <div>
              <label className="nc-label">Button</label>
              <select className="field" value={copy.cta} onChange={set("cta")}>
                {CTAS.map((c) => (
                  <option key={c} value={c}>{CTA_LABEL[c]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="ad-actions">
            <span className="ad-hint">The words on the image are part of the design; use the redesign button to change them.</span>
            <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
              Save text
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
