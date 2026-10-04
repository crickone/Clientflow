"use client";

import { useState } from "react";
import { Bookmark, ChevronLeft, ChevronRight, Globe2, Heart, MessageCircle, MoreHorizontal, Send, Share2, ThumbsUp } from "lucide-react";

/**
 * The live ad preview: the ad as it will look in the Facebook feed or on
 * Instagram, updated as the operator types. Drawn in each app's own dark-mode
 * colours and type (system UI font, Meta's greys and blue), deliberately NOT
 * in AdonisAgent's palette, so it reads as the real thing rather than a mock.
 */

export interface PreviewAd {
  pageName: string;
  instagramHandle: string | null;
  logoUrl: string | null;
  primaryText: string;
  headline: string;
  description?: string;
  ctaLabel: string;
  /** Image URLs in order; more than one renders as a swipeable carousel. */
  images: string[];
  linkHost: string | null;
}

const SYS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

function Avatar({ logoUrl, name, size }: { logoUrl: string | null; name: string; size: number }) {
  return logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- our own logo route
    <img src={logoUrl} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: 999, objectFit: "cover", background: "#fff", flexShrink: 0 }} />
  ) : (
    <span style={{ width: size, height: size, borderRadius: 999, background: "#3a3b3c", color: "#e4e6eb", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 700, flexShrink: 0 }}>
      {name.trim().charAt(0).toUpperCase() || "A"}
    </span>
  );
}

function Picture({ images, ratio = "1 / 1" }: { images: string[]; ratio?: string }) {
  const [i, setI] = useState(0);
  const idx = Math.min(i, Math.max(0, images.length - 1));
  if (images.length === 0) {
    return (
      <div style={{ aspectRatio: ratio, background: "#3a3b3c", color: "#b0b3b8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>
        Pick a design or photo
      </div>
    );
  }
  return (
    <div style={{ position: "relative", aspectRatio: ratio, background: "#18191a", overflow: "hidden" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- our own render/library routes */}
      <img src={images[idx]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      {images.length > 1 && (
        <>
          {idx > 0 && (
            <button type="button" aria-label="Previous image" className="adb-pv-nav" style={{ left: 8 }} onClick={() => setI(idx - 1)}>
              <ChevronLeft size={16} />
            </button>
          )}
          {idx < images.length - 1 && (
            <button type="button" aria-label="Next image" className="adb-pv-nav" style={{ right: 8 }} onClick={() => setI(idx + 1)}>
              <ChevronRight size={16} />
            </button>
          )}
          <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 4 }}>
            {images.map((_, n) => (
              <span key={n} style={{ width: 6, height: 6, borderRadius: 999, background: n === idx ? "#fff" : "rgba(255,255,255,0.45)" }} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Facebook({ ad }: { ad: PreviewAd }) {
  return (
    <div style={{ background: "#242526", color: "#e4e6eb", fontFamily: SYS, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 12px 8px" }}>
        <Avatar logoUrl={ad.logoUrl} name={ad.pageName} size={36} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ad.pageName}</div>
          <div style={{ fontSize: 12, color: "#b0b3b8", display: "flex", alignItems: "center", gap: 4 }}>
            Sponsored · <Globe2 size={11} />
          </div>
        </div>
        <MoreHorizontal size={18} color="#b0b3b8" />
      </div>
      <div style={{ padding: "0 12px 10px", fontSize: 14, lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {ad.primaryText || <span style={{ color: "#8a8d91" }}>Your main text appears here.</span>}
      </div>
      <Picture images={ad.images} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#3a3b3c" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {ad.linkHost && <div style={{ fontSize: 11.5, color: "#b0b3b8", textTransform: "uppercase", letterSpacing: "0.02em" }}>{ad.linkHost}</div>}
          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ad.headline || <span style={{ color: "#8a8d91" }}>Headline</span>}
          </div>
          {ad.description && <div style={{ fontSize: 13, color: "#b0b3b8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ad.description}</div>}
        </div>
        <span style={{ flexShrink: 0, background: "#4e4f50", color: "#e4e6eb", fontSize: 14, fontWeight: 600, padding: "8px 12px", borderRadius: 6 }}>{ad.ctaLabel}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-around", padding: "8px 4px", borderTop: "1px solid #3e4042", color: "#b0b3b8", fontSize: 13, fontWeight: 600 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><ThumbsUp size={15} /> Like</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><MessageCircle size={15} /> Comment</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Share2 size={15} /> Share</span>
      </div>
    </div>
  );
}

function Instagram({ ad }: { ad: PreviewAd }) {
  const handle = ad.instagramHandle || ad.pageName.toLowerCase().replace(/[^a-z0-9._]+/g, "");
  return (
    <div style={{ background: "#000", color: "#f5f5f5", fontFamily: SYS, borderRadius: 10, overflow: "hidden", border: "1px solid #262626" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
        <Avatar logoUrl={ad.logoUrl} name={ad.pageName} size={30} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{handle}</div>
          <div style={{ fontSize: 11.5, color: "#a8a8a8" }}>Sponsored</div>
        </div>
        <MoreHorizontal size={18} />
      </div>
      <Picture images={ad.images} ratio="4 / 5" />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 12px", background: "#0095f6", color: "#fff", fontSize: 14, fontWeight: 600 }}>
        {ad.ctaLabel}
        <ChevronRight size={16} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 12px 6px" }}>
        <Heart size={22} />
        <MessageCircle size={22} />
        <Send size={22} />
        <Bookmark size={22} style={{ marginLeft: "auto" }} />
      </div>
      <div style={{ padding: "0 12px 12px", fontSize: 13.5, lineHeight: 1.4, wordBreak: "break-word" }}>
        <strong style={{ fontWeight: 600 }}>{handle}</strong>{" "}
        {ad.primaryText || <span style={{ color: "#8e8e8e" }}>Your main text appears here.</span>}
      </div>
    </div>
  );
}

export function AdPreview({ ad }: { ad: PreviewAd }) {
  const [placement, setPlacement] = useState<"facebook" | "instagram">("facebook");
  return (
    <div className="adb-preview">
      <div className="adb-seg" role="tablist" aria-label="Where the ad appears">
        {(["facebook", "instagram"] as const).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={placement === p} className="adb-seg-btn" data-on={placement === p} onClick={() => setPlacement(p)}>
            {p === "facebook" ? "Facebook feed" : "Instagram feed"}
          </button>
        ))}
      </div>
      <div className="adb-device">{placement === "facebook" ? <Facebook ad={ad} /> : <Instagram ad={ad} />}</div>
    </div>
  );
}
