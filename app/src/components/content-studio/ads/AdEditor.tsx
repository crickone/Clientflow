"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkCheck, Download, ImageIcon, Library, Megaphone, RefreshCw, Scissors, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  adStatusAction,
  deleteAdAction,
  redesignAdImageAction,
  retryAdAction,
  saveAdCopyAction,
  saveVideoAdCopyAction,
  setAdSavedAction,
} from "@/app/content-studio/ads/actions";
import { AdPhotoDialog } from "./AdPhotoDialog";
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

  const ready = ad.status !== "writing" && (ad.kind === "video" ? !!ad.videoUrls["9:16"] : ad.versions.length > 0);
  const [saving, startSaving] = useTransition();

  function toggleSaved() {
    const next = ad.savedAt == null;
    startSaving(async () => {
      await setAdSavedAction(ad.id, next);
      setAd((a) => ({ ...a, savedAt: next ? Date.now() : null }));
      toast.success(next ? "Saved to your ad library" : "Removed from your ad library", {
        action: next ? { label: "Open library", onClick: () => router.push("/content-studio/ads") } : undefined,
      });
    });
  }

  return (
    <div className="ad-page">
      <header className="ad-head">
        <div style={{ minWidth: 0 }}>
          <div className="ad-eyebrow">
            <Megaphone size={13} /> {ad.kind === "video" ? "Video ad" : "Image ad"} · {AD_GOAL_LABEL[ad.brief.goal]}
            <span aria-hidden>·</span>
            <Link href="/content-studio/ads" className="ad-eyebrow-link">
              <Library size={13} /> Ad library
            </Link>
          </div>
          <h1 className="ad-title">{ad.name}</h1>
        </div>
        <div className="ad-head-actions">
          {ready && ad.kind === "video" && ad.videoProjectId && (
            <Link href={`/content-studio/videos/${ad.videoProjectId}`}>
              <Button variant="outline">
                <Scissors size={15} /> Adjust the cut
              </Button>
            </Link>
          )}
          {ready && isAdmin && (
            <Link href={`/marketing/ads/use/${ad.id}`}>
              <Button>
                <Megaphone size={15} /> Use in a campaign
              </Button>
            </Link>
          )}
          {ready && (
            <Button variant={ad.savedAt ? "secondary" : "outline"} onClick={toggleSaved} loading={saving} aria-pressed={ad.savedAt != null}>
              {ad.savedAt ? <BookmarkCheck size={15} /> : <Bookmark size={15} />} {ad.savedAt ? "Saved" : "Save to ad library"}
            </Button>
          )}
          {ad.status !== "writing" && (
            <Button variant="outline" onClick={retry} loading={pending}>
              <Sparkles size={15} /> {ready ? "Make it again" : "Try again"}
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

      {ad.kind === "video" && ready && (
        <section className="nc-card ad-version">
          <div className="ad-video-row">
            {(["9:16", "1:1"] as const).map((size) =>
              ad.videoUrls[size] ? (
                <figure key={size} className={`ad-video ad-video--${size.replace(":", "x")}`}>
                  <video src={ad.videoUrls[size]} controls playsInline preload="metadata" />
                  <figcaption>
                    <span>{size === "9:16" ? "Stories and Reels (9:16)" : "Feed (square)"}</span>
                    <a className="inbox-icon-btn" href={`${ad.videoUrls[size]}&download=1`} aria-label="Download">
                      <Download size={14} />
                    </a>
                  </figcaption>
                </figure>
              ) : null,
            )}
          </div>
          <p className="ad-hint">Opens on the strongest line, captioned, ending on your button. Adjust the cut in the video editor if you want a different take.</p>
        </section>
      )}
      {ad.kind === "video" &&
        ad.videoCopies.map((c, i) => (
          <section key={i} className="nc-card ad-version">
            <div className="ad-version-head">
              <h2>Ad text, version {i + 1}</h2>
              {c.angle && <span className="inbox-pill">{c.angle}</span>}
            </div>
            <CopyEditor
              initial={c}
              hint="Meta tests these text versions against each other on the same video."
              onSave={(copy) => saveVideoAdCopyAction(ad.id, i, copy)}
              onSaved={refresh}
            />
          </section>
        ))}

      {ad.versions.map((v) => (
        <VersionCard key={v.designId} adId={ad.id} version={v} onChanged={refresh} />
      ))}
    </div>
  );
}

function VersionCard({ adId, version, onChanged }: { adId: number; version: AdVersion; onChanged: () => void }) {
  const [busySlide, setBusySlide] = useState<number | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const rendered = AD_SIZES.some((s) => version.images[s]?.renderFilename);

  async function redesign(slideId: number) {
    setBusySlide(slideId);
    const res = await redesignAdImageAction(adId, slideId, null);
    setBusySlide(null);
    if (!res.ok) return void toast.error(res.error);
    onChanged();
  }

  return (
    <section className="nc-card ad-version">
      <div className="ad-version-head">
        <h2>Version {version.variant}</h2>
        {version.copy?.angle && <span className="inbox-pill">{version.copy.angle}</span>}
        {rendered && (
          <Button variant="outline" size="sm" className="ad-version-photo" onClick={() => setPhotoOpen(true)} disabled={busySlide !== null}>
            <ImageIcon size={14} /> Change photo
          </Button>
        )}
      </div>
      <AdPhotoDialog open={photoOpen} onOpenChange={setPhotoOpen} version={version} onApplied={onChanged} />

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

      {version.copy && (
        <CopyEditor
          initial={version.copy}
          hint="Changing the button here changes it on the images too. The other words on the image are part of the design; use the redesign button to change them."
          onSave={(copy) => saveAdCopyAction(adId, version.designId, copy)}
          onSaved={onChanged}
        />
      )}
    </section>
  );
}

/** Meta's text fields for one version, saved on demand. */
function CopyEditor({
  initial,
  hint,
  onSave,
  onSaved,
}: {
  initial: AdCopy;
  hint: string;
  onSave: (copy: AdCopy) => Promise<{ ok: true } | { ok: false; error: string }>;
  onSaved: () => void;
}) {
  const [copy, setCopy] = useState<AdCopy>(initial);
  const [saving, startSave] = useTransition();
  const dirty = JSON.stringify(copy) !== JSON.stringify(initial);
  const set = (k: keyof AdCopy) => (e: { target: { value: string } }) => setCopy((c) => ({ ...c, [k]: e.target.value }));

  function save() {
    startSave(async () => {
      const res = await onSave(copy);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Ad text saved");
      onSaved();
    });
  }

  return (
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
        <span className="ad-hint">{hint}</span>
        <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
          Save text
        </Button>
      </div>
    </div>
  );
}
