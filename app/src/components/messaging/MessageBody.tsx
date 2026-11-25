"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Download, ExternalLink, FileText, X } from "lucide-react";

import { formatBytes, isMediaPlaceholder, mediaUrl, parseMedia, type MessageMedia } from "@/lib/inbox/mediaModel";

/**
 * The inside of a message bubble: its photos, videos, voice notes and files,
 * then the text (the caption). A "[Photo]" style placeholder is hidden once
 * the photo itself is there; it stays when the download failed, so the
 * bubble still says what was sent. Colours follow the bubble (currentColor),
 * so it reads on their grey bubble and your accent one, light or dark.
 */
export function MessageBody({ content, media }: { content: string; media?: MessageMedia[] | string | null }) {
  const items = typeof media === "string" || media == null ? parseMedia(media) : media;
  const [open, setOpen] = useState<MessageMedia | null>(null);
  if (!items.length) return <>{content}</>;
  const showText = content.trim() && !isMediaPlaceholder(content);
  const images = items.filter((m) => m.kind === "image");
  const others = items.filter((m) => m.kind !== "image");

  return (
    <div style={{ display: "grid", gap: 6, whiteSpace: "normal" }}>
      {images.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: images.length > 1 ? "repeat(2, minmax(0, 128px))" : "minmax(0, 240px)", gap: 4 }}>
          {images.map((m) => (
            <button
              key={m.file}
              type="button"
              onClick={() => setOpen(m)}
              aria-label="Open photo"
              style={{ padding: 0, border: 0, background: "transparent", cursor: "zoom-in", borderRadius: 12, overflow: "hidden", display: "block", lineHeight: 0, width: "100%" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-gated file; next/image would proxy it */}
              <img
                src={mediaUrl(m.file)}
                alt="Photo sent in the conversation"
                loading="lazy"
                style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block", background: "color-mix(in srgb, currentColor 10%, transparent)" }}
              />
            </button>
          ))}
        </div>
      )}
      {others.map((m) =>
        m.kind === "video" ? (
          <video
            key={m.file}
            src={mediaUrl(m.file)}
            controls
            preload="metadata"
            style={{ width: 280, maxWidth: "100%", maxHeight: 320, borderRadius: 12, display: "block", background: "#000" }}
          />
        ) : m.kind === "audio" ? (
          <audio key={m.file} src={mediaUrl(m.file)} controls preload="metadata" style={{ width: 260, maxWidth: "100%", display: "block" }} />
        ) : (
          <a
            key={m.file}
            href={mediaUrl(m.file)}
            download={m.name || true}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 12px",
              borderRadius: 12,
              border: "1px solid color-mix(in srgb, currentColor 22%, transparent)",
              background: "color-mix(in srgb, currentColor 7%, transparent)",
              color: "inherit",
              textDecoration: "none",
              minWidth: 0,
              maxWidth: 300,
            }}
          >
            <FileText size={18} style={{ flexShrink: 0 }} aria-hidden />
            <span style={{ display: "grid", minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name || "File"}</span>
              <span style={{ fontSize: 11.5, opacity: 0.7 }}>{formatBytes(m.size)}</span>
            </span>
            <Download size={16} style={{ flexShrink: 0, opacity: 0.8 }} aria-label="Download" />
          </a>
        ),
      )}
      {showText && <div style={{ whiteSpace: "pre-wrap" }}>{content}</div>}

      <DialogPrimitive.Root open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className="anim-overlay"
            style={{ position: "fixed", inset: 0, background: "rgba(5,5,5,0.86)", zIndex: 80 }}
          />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            style={{ position: "fixed", inset: 0, zIndex: 81, display: "flex", alignItems: "center", justifyContent: "center", padding: "56px 16px 24px" }}
            onClick={() => setOpen(null)}
          >
            <DialogPrimitive.Title className="sr-only">Photo</DialogPrimitive.Title>
            {open && (
              /* eslint-disable-next-line @next/next/no-img-element -- see above */
              <img
                src={mediaUrl(open.file)}
                alt="Photo sent in the conversation, full size"
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8, boxShadow: "0 10px 40px rgba(0,0,0,0.5)" }}
              />
            )}
            <div style={{ position: "fixed", top: 12, right: 12, display: "flex", gap: 8 }} onClick={(e) => e.stopPropagation()}>
              {open && (
                <a
                  href={mediaUrl(open.file)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open in a new tab"
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 999, background: "rgba(255,255,255,0.12)", color: "#fff" }}
                >
                  <ExternalLink size={17} />
                </a>
              )}
              <DialogPrimitive.Close
                aria-label="Close"
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, borderRadius: 999, border: 0, background: "rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer" }}
              >
                <X size={18} />
              </DialogPrimitive.Close>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}
