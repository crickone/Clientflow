"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Bookmark, BookmarkCheck, Megaphone, Plus, Video } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { setAdSavedAction } from "@/app/content-studio/ads/actions";
import { AD_GOAL_LABEL } from "@/lib/ads/adCopy";
import type { AdCreativeView } from "@/lib/ads/creatives";
import { renderFileUrl } from "@/lib/image/renderStore.client";

type Tab = "saved" | "all";

const dateFmt = new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short" });

/**
 * Every ad, with the saved ones first: a bookmark on the card or on the ad's
 * own page keeps it here under Saved. Each card shows the versions it holds,
 * so the three angles can be told apart without opening it.
 */
export function AdLibrary({ ads: initial, isAdmin }: { ads: AdCreativeView[]; isAdmin: boolean }) {
  const [ads, setAds] = useState(initial);
  const saved = useMemo(() => ads.filter((a) => a.savedAt != null).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0)), [ads]);
  const [tab, setTab] = useState<Tab>(saved.length > 0 ? "saved" : "all");
  const [, start] = useTransition();
  const shown = tab === "saved" ? saved : ads;

  function toggle(ad: AdCreativeView) {
    const next = ad.savedAt == null;
    setAds((list) => list.map((a) => (a.id === ad.id ? { ...a, savedAt: next ? Date.now() : null } : a)));
    start(async () => {
      await setAdSavedAction(ad.id, next);
      toast.success(next ? "Saved to your ad library" : "Removed from saved ads");
    });
  }

  return (
    <div className="adl">
      <header className="adl-head">
        <div>
          <h1 className="nc-title">Ad library</h1>
          <p className="adl-sub">Ads you saved to come back to, and every ad you have made.</p>
        </div>
        <Link href="/content-studio/ads/new">
          <Button>
            <Plus size={15} /> New ad
          </Button>
        </Link>
      </header>

      <div className="cs-filter" role="tablist" aria-label="Which ads">
        <button role="tab" aria-selected={tab === "saved"} onClick={() => setTab("saved")}>
          Saved<span className="cs-n">{saved.length}</span>
        </button>
        <button role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>
          All ads<span className="cs-n">{ads.length}</span>
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="adl-empty">
          <span className="adl-empty-icon">
            {tab === "saved" ? <Bookmark size={20} /> : <Megaphone size={20} />}
          </span>
          <div>
            <div className="nc-ideas-empty-title">{tab === "saved" ? "No saved ads yet" : "No ads yet"}</div>
            <div className="nc-ideas-empty-sub">
              {tab === "saved"
                ? "Open an ad you like and press Save to ad library, or use the bookmark on any ad under All ads."
                : "Make one: say what it's for and Adonis writes and designs three versions."}
            </div>
          </div>
          {tab === "saved" && ads.length > 0 ? (
            <Button variant="outline" onClick={() => setTab("all")}>
              See all ads
            </Button>
          ) : (
            <Link href="/content-studio/ads/new">
              <Button variant="outline">
                <Plus size={15} /> New ad
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="adl-grid">
          {shown.map((ad) => (
            <AdCard key={ad.id} ad={ad} isAdmin={isAdmin} onToggle={() => toggle(ad)} />
          ))}
        </div>
      )}
    </div>
  );
}

function AdCard({ ad, isAdmin, onToggle }: { ad: AdCreativeView; isAdmin: boolean; onToggle: () => void }) {
  const feeds = ad.versions.map((v) => v.images["4:5"]?.renderFilename ?? null);
  const [shown, setShown] = useState(0);
  const lead = feeds[shown] ?? feeds.find(Boolean) ?? null;
  const video = ad.kind === "video" ? (ad.videoUrls["9:16"] ?? ad.videoUrls["1:1"] ?? null) : null;
  const making = ad.status === "writing";
  const ready = !making && (ad.kind === "video" ? !!video : feeds.some(Boolean));

  return (
    <article className="adl-card">
      <Link href={`/content-studio/ads/${ad.id}`} className="adl-media" aria-label={`Open ${ad.name}`}>
        {video ? (
          <video src={`${video}#t=0.5`} preload="metadata" muted playsInline />
        ) : lead ? (
          // eslint-disable-next-line @next/next/no-img-element -- our own render route
          <img src={renderFileUrl(lead)} alt="" loading="lazy" />
        ) : (
          <span className={making ? "skeleton adl-fill" : "adl-fill adl-none"}>{making ? null : "No image yet"}</span>
        )}
        {making && <span className="adl-badge">Making</span>}
        {ad.status === "failed" && <span className="adl-badge is-failed">Not finished</span>}
        {ad.kind === "video" && (
          <span className="adl-kind">
            <Video size={12} /> Video
          </span>
        )}
      </Link>
      <button
        type="button"
        className={`adl-save${ad.savedAt ? " is-on" : ""}`}
        onClick={onToggle}
        aria-pressed={ad.savedAt != null}
        aria-label={ad.savedAt ? "Remove from saved ads" : "Save to ad library"}
        title={ad.savedAt ? "Saved. Click to remove" : "Save to ad library"}
      >
        {ad.savedAt ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
      </button>

      <div className="adl-body">
        {feeds.filter(Boolean).length > 1 && (
          <div className="adl-versions" role="group" aria-label="Versions">
            {feeds.map((f, i) =>
              f ? (
                <button key={i} type="button" className={i === shown ? "is-on" : undefined} onClick={() => setShown(i)} aria-label={`Show version ${i + 1}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- our own render route */}
                  <img src={renderFileUrl(f)} alt="" loading="lazy" />
                </button>
              ) : null,
            )}
          </div>
        )}
        <Link href={`/content-studio/ads/${ad.id}`} className="adl-title">
          {ad.name}
        </Link>
        <div className="adl-meta">
          {AD_GOAL_LABEL[ad.brief.goal]} · {dateFmt.format(new Date(ad.updatedAt))}
        </div>
        {ready && isAdmin && (
          <Link href={`/marketing/ads/use/${ad.id}`} className="adl-use">
            <Megaphone size={14} /> Use in a campaign
          </Link>
        )}
      </div>
    </article>
  );
}
