"use client";

import { useRef } from "react";
import { FileText, Image as ImageIcon, Mic, Paperclip, Video, X } from "lucide-react";

import { OUTGOING_ACCEPT } from "@/lib/attachments/outgoingModel";
import { formatBytes, type MediaKind } from "@/lib/inbox/mediaModel";
import type { Attachments } from "./useAttachments";

const KIND_ICON: Record<MediaKind, typeof FileText> = { image: ImageIcon, video: Video, audio: Mic, file: FileText };

/**
 * The paperclip for a message box: an icon button that opens the file
 * picker (hidden input, multiple, limited to the types that can be sent).
 * Sits next to the Send button; the chips go in `AttachmentTray`.
 */
export function AttachButton({ att, disabled }: { att: Attachments; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="at-clip"
        aria-label="Attach a file"
        title="Attach a file"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <Paperclip size={17} aria-hidden />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={OUTGOING_ACCEPT}
        hidden
        tabIndex={-1}
        onChange={(e) => {
          att.add(e.target.files);
          // Picking the same file again after removing it should still fire.
          e.target.value = "";
        }}
      />
    </>
  );
}

/**
 * The attached files as chips: name, size, a progress bar while uploading,
 * the reason when one was refused, and an X to take it off. Renders nothing
 * when there are no files.
 */
export function AttachmentTray({ att }: { att: Attachments }) {
  if (att.items.length === 0) return null;
  return (
    <ul className="at-tray" aria-label="Attached files">
      {att.items.map((i) => {
        const Icon = KIND_ICON[i.kind] ?? FileText;
        return (
          <li key={i.id} className={`at-chip${i.status === "error" ? " at-chip--error" : ""}`}>
            <Icon size={16} className="at-chip-icon" aria-hidden />
            <span className="at-chip-text">
              <span className="at-chip-name" title={i.name}>
                {i.name}
              </span>
              {i.status === "error" ? (
                <span className="at-chip-error" role="alert">
                  {i.error}
                </span>
              ) : (
                <span className="at-chip-meta">{i.status === "uploading" ? `Uploading ${Math.round(i.progress * 100)}%` : formatBytes(i.size)}</span>
              )}
              {i.status === "uploading" && (
                <span className="at-progress" aria-hidden>
                  <span style={{ width: `${Math.max(4, Math.round(i.progress * 100))}%` }} />
                </span>
              )}
            </span>
            <button type="button" className="at-chip-remove" aria-label={`Remove ${i.name}`} onClick={() => att.remove(i.id)}>
              <X size={15} aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The hint laid over a message box while files are dragged over it. */
export function DropHint({ att }: { att: Attachments }) {
  if (!att.dragging) return null;
  return (
    <div className="at-drop" aria-hidden>
      <Paperclip size={16} /> Drop to attach
    </div>
  );
}
