"use client";

import "./chat.css";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { ArrowUp, Loader2, Mic, Paperclip, Square, X } from "lucide-react";

import { Soundwave } from "@/components/messaging/Soundwave";
import { appendTranscript } from "@/components/messaging/voiceInput";
import { useVoiceInput } from "@/components/messaging/useVoiceInput";
import { Tooltip } from "@/components/ui/Tooltip";

export type ComposerAttachment = { id: number; name: string; kind: string };

/** What the media library takes from the chat (same list as before). */
export const ATTACH_ACCEPT =
  "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,application/pdf,text/plain,text/csv,text/markdown,application/json,.docx,.xlsx,.pptx";

export type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** Shown in place of Send while Adonis is working. */
  onStop?: () => void;
  /** A run is going or a request is in flight: no sending. */
  busy: boolean;
  running: boolean;
  attachments: ComposerAttachment[];
  attaching: boolean;
  onAttach: (files: File[]) => void;
  onRemoveAttachment: (id: number) => void;
  /** Server-computed (transcribeConfigured); the mic only shows when transcription can run. */
  voiceEnabled: boolean;
  modelChip?: ReactNode;
  placeholder: string;
  variant?: "hero" | "dock";
  hint?: string;
};

/**
 * One rounded box: attachment chips above the text, then attach, voice, the
 * model chip and send (or stop). The box grows with the text up to 200px.
 * Voice records, transcribes and appends the words for the operator to
 * review; it never sends by itself.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  running,
  attachments,
  attaching,
  onAttach,
  onRemoveAttachment,
  voiceEnabled,
  modelChip,
  placeholder,
  variant = "dock",
  hint,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  // Set when a transcript lands; consumed once the new value is in the textarea, so the caret goes after it.
  const focusAfterVoice = useRef(false);
  const voice = useVoiceInput((text) => {
    onChange(appendTranscript(valueRef.current, text));
    focusAfterVoice.current = true;
  });

  useEffect(() => {
    if (!focusAfterVoice.current) return;
    focusAfterVoice.current = false;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [value]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, voice.state]);

  const recording = voice.state === "recording";
  const canSend = !busy && voice.state === "idle" && (value.trim().length > 0 || attachments.length > 0);

  return (
    <div>
      <div className={variant === "hero" ? "ax-box ax-box--hero" : "ax-box"}>
        {attachments.length > 0 && (
          <div className="ax-attachments">
            {attachments.map((a) => (
              <span key={a.id} className="ax-chip">
                <Paperclip size={12} strokeWidth={2} aria-hidden />
                <span>{a.name}</span>
                <button type="button" onClick={() => onRemoveAttachment(a.id)} aria-label={`Remove ${a.name}`}>
                  <X size={12} strokeWidth={2} />
                </button>
              </span>
            ))}
          </div>
        )}
        {recording && voice.stream ? (
          <div className="ax-wave">
            <Soundwave stream={voice.stream} />
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            className="ax-input"
            rows={1}
            value={value}
            placeholder={placeholder}
            aria-label="Message Adonis"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) onSend();
              }
            }}
          />
        )}
        <div className="ax-row">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept={ATTACH_ACCEPT}
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (files.length) onAttach(files);
            }}
          />
          <Tooltip label="Attach a file">
            <button type="button" className="ax-ic" onClick={() => fileRef.current?.click()} disabled={busy || attaching} aria-label="Attach a file">
              {attaching ? <Loader2 size={16} className="spin" /> : <Paperclip size={16} strokeWidth={1.9} />}
            </button>
          </Tooltip>
          {voiceEnabled && (
            <Tooltip label={recording ? "Stop and transcribe" : "Speak instead of typing"}>
              <button
                type="button"
                className="ax-ic"
                data-recording={recording}
                onClick={voice.toggle}
                disabled={voice.state === "transcribing" || (voice.state === "idle" && busy)}
                aria-label={recording ? "Stop and transcribe" : "Start voice input"}
              >
                {voice.state === "transcribing" ? (
                  <Loader2 size={16} className="spin" />
                ) : recording ? (
                  <Square size={13} strokeWidth={2} fill="currentColor" />
                ) : (
                  <Mic size={16} strokeWidth={1.9} />
                )}
              </button>
            </Tooltip>
          )}
          {recording && (
            <span className="ax-rec-time" aria-hidden>
              {voice.elapsedLabel}
            </span>
          )}
          {modelChip}
          {running && onStop ? (
            <Tooltip label="Stop">
              <button type="button" className="ax-send" onClick={onStop} aria-label="Stop Adonis">
                <Square size={12} strokeWidth={2} fill="currentColor" />
              </button>
            </Tooltip>
          ) : (
            <button type="button" className="ax-send" onClick={onSend} disabled={!canSend} aria-label="Send">
              {busy ? <Loader2 size={16} className="spin" /> : <ArrowUp size={17} strokeWidth={2.2} />}
            </button>
          )}
        </div>
      </div>
      {hint && <div className="ax-hint">{hint}</div>}
    </div>
  );
}
