"use client";

import { useEffect, useState } from "react";
import { Bookmark, ChevronRight, Heart, MessageCircle, MoreHorizontal, Play, Send } from "lucide-react";

/**
 * The ad as it will sit in an Instagram feed while it is still a brief: the
 * PostPreview of the ad composer, in the same phone frame. The hook goes on
 * the picture over a photo from the library, the button reads what the goal
 * asks for, and a video ad plays the chosen clip. A sketch of the shape;
 * Adonis writes and designs the real versions.
 */
export function AdSketch({
  kind,
  hook,
  caption,
  button,
  businessName,
  logoUrl,
  photoUrl,
  accentColor,
  clip,
}: {
  kind: "image" | "video";
  hook: string;
  caption: string;
  button: string;
  businessName: string;
  logoUrl: string | null;
  photoUrl: string | null;
  accentColor?: string;
  clip: File | null;
}) {
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  // A library file that will not load leaves the plain ground, never a broken-image icon.
  const [photoFailed, setPhotoFailed] = useState(false);
  useEffect(() => {
    if (!clip) return void setClipUrl(null);
    const url = URL.createObjectURL(clip);
    setClipUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [clip]);

  const handle = (businessName || "yourbusiness").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const video = kind === "video";

  return (
    <aside className="pp" aria-label="Preview">
      <div className="pp-label">Preview</div>
      <div className="pp-phone">
        <div className="pp-head">
          <span className="pp-avatar">
            {/* eslint-disable-next-line @next/next/no-img-element -- our own logo route */}
            {logoUrl ? <img src={logoUrl} alt="" /> : handle.charAt(0).toUpperCase()}
          </span>
          <span className="pp-who">
            <span className="pp-handle">{handle}</span>
            <span className="pp-loc">Sponsored</span>
          </span>
          <MoreHorizontal size={18} />
        </div>

        <div className={`as-media${video ? " is-video" : ""}`} style={{ ["--as-accent" as string]: accentColor ?? "#2c6ce0" }}>
          {video ? (
            clipUrl ? (
              <video key={clipUrl} src={clipUrl} muted loop autoPlay playsInline className="as-fill" />
            ) : (
              <div className="as-empty">
                <Play size={22} />
                <span>Your clip plays here</span>
              </div>
            )
          ) : photoUrl && !photoFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- our own library route
            <img src={photoUrl} alt="" className="as-fill"
              onError={() => setPhotoFailed(true)}
              // An error before hydration never reaches onError; catch it on mount.
              ref={(el) => {
                if (el && el.complete && el.naturalWidth === 0) setPhotoFailed(true);
              }}
            />
          ) : null}
          {!video || clipUrl ? <div className="as-scrim" aria-hidden /> : null}
          {(!video || clipUrl) && (
            <div className={video ? "as-caption" : "as-hook"}>
              {!video && <i className="as-rule" aria-hidden />}
              <span className={hook ? undefined : "is-placeholder"}>{hook || "Your ad's main line appears here"}</span>
            </div>
          )}
        </div>

        <div className="as-cta">
          <span>{button}</span>
          <ChevronRight size={16} />
        </div>
        <div className="pp-actions">
          <span className="pp-icons" aria-hidden>
            <Heart size={20} />
            <MessageCircle size={20} />
            <Send size={20} />
          </span>
          <Bookmark size={20} aria-hidden />
        </div>
        <div className="pp-caption as-text">
          <b>{handle}</b> {caption || <span className="is-placeholder">What the ad is for becomes the text above it.</span>}
        </div>
      </div>
      <p className="pp-note">
        {video
          ? "A sketch of the shape. Adonis cuts the clip, captions it and ends on your button, in Stories and square sizes."
          : "A sketch of the shape. Adonis writes three versions and designs each in feed, square and Stories sizes."}
      </p>
    </aside>
  );
}
