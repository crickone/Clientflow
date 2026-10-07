"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { Send } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Textarea } from "@/components/ui/Input";

export interface ThreadMessage {
  id: number;
  direction: "outbound" | "inbound" | "note";
  channel: string | null;
  content: string;
  status?: string | null;
  aiGenerated?: boolean;
  sentAt?: Date | string | null;
  createdAt: Date | string;
}

/**
 * Reusable conversation thread, laid out like the chat apps it mirrors: their
 * messages on the left, yours on the right, notes centred, a day divider when
 * the date changes, newest at the bottom with the composer under it.
 * Presentational -- the parent owns the send (`onSend`) and message state.
 * Used by the inbox and the client profile.
 */
const dayKey = (d: Date) => d.toLocaleDateString("en-IE", { timeZone: "Europe/Dublin" });
const dayLabel = (d: Date) => {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const k = dayKey(d);
  if (k === today) return "Today";
  if (k === yesterday) return "Yesterday";
  return d.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
};
const timeLabel = (d: Date) => d.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });

export function ConversationThread({
  messages,
  canSend,
  sending,
  onSend,
  emptyHint = "No messages yet.",
  seedText,
  channelLabel = "WhatsApp",
  note,
  fill = false,
  composerRef,
}: {
  messages: ThreadMessage[];
  canSend: boolean;
  sending: boolean;
  onSend: (text: string) => void;
  emptyHint?: string;
  seedText?: string;
  /** The channel the reply goes out on, for the placeholder and button. */
  channelLabel?: string;
  /** Shown under the composer: why sending is off, or a channel caveat. */
  note?: string | null;
  /** Fill the parent's height (the inbox reading pane) instead of capping at 62vh. */
  fill?: boolean;
  /** Lets the inbox focus the composer from a keyboard shortcut. */
  composerRef?: Ref<HTMLTextAreaElement>;
}) {
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  // Lets the parent drop an AI draft into the composer ("Edit" on the draft banner).
  useEffect(() => {
    if (seedText) setText(seedText);
  }, [seedText]);
  // Newest at the bottom, like the apps: land there, and follow new messages.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function send() {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  }

  let lastDay = "";

  return (
    <Card
      style={{
        padding: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        ...(fill ? { flex: 1, minHeight: 0, border: 0, borderRadius: 0, boxShadow: "none", background: "transparent" } : {}),
      }}
    >
      <div
        ref={scroller}
        style={{
          ...(fill ? { flex: 1, minHeight: 0 } : { maxHeight: "min(62vh, 640px)", minHeight: 240 }),
          overflowY: "auto",
          padding: "18px 18px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {messages.length === 0 ? (
          <div style={{ margin: "auto", color: "var(--text-tertiary)", fontSize: 14 }}>{emptyHint}</div>
        ) : (
          messages.map((m) => {
            const at = new Date((m.sentAt ?? m.createdAt) as string | Date);
            const k = dayKey(at);
            const divider = k !== lastDay ? dayLabel(at) : null;
            lastDay = k;
            const inbound = m.direction === "inbound";
            const isNote = m.direction === "note";
            const failed = m.status === "failed";
            return (
              <div key={m.id} style={{ display: "contents" }}>
                {divider && (
                  <div style={{ alignSelf: "center", margin: "10px 0 6px", fontSize: 11, color: "var(--text-tertiary)", letterSpacing: "0.04em" }}>{divider}</div>
                )}
                {isNote ? (
                  <div style={{ alignSelf: "center", maxWidth: "80%", margin: "6px 0", fontSize: 12.5, color: "var(--text-tertiary)", textAlign: "center", whiteSpace: "pre-wrap" }}>
                    {m.content}
                  </div>
                ) : (
                  <div style={{ alignSelf: inbound ? "flex-start" : "flex-end", maxWidth: "78%", display: "flex", flexDirection: "column", alignItems: inbound ? "flex-start" : "flex-end", margin: "3px 0" }}>
                    <div
                      style={{
                        padding: "9px 13px",
                        borderRadius: 18,
                        borderBottomLeftRadius: inbound ? 6 : 18,
                        borderBottomRightRadius: inbound ? 18 : 6,
                        background: inbound ? "var(--surface-2)" : "var(--accent)",
                        color: inbound ? "var(--text-primary)" : "var(--accent-contrast)",
                        fontSize: 14,
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        opacity: failed ? 0.6 : 1,
                      }}
                    >
                      {m.content}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3, fontSize: 10.5, color: "var(--text-tertiary)" }}>
                      {m.aiGenerated && !inbound && <span>AI</span>}
                      <span>{timeLabel(at)}</span>
                      {m.status && m.status !== "sent" && !inbound && (
                        <Badge tone={failed ? "red" : "neutral"}>{failed ? "Not delivered" : m.status}</Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--hairline)", padding: 12, display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <Textarea
            ref={composerRef}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter is a new line -- as in the chat apps.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend && !sending) send();
              }
            }}
            placeholder={canSend ? `Message on ${channelLabel}` : note ?? "No phone number on file."}
            disabled={!canSend}
            style={{ flex: 1, resize: "none" }}
          />
          <Button onClick={send} disabled={!canSend || sending || !text.trim()} aria-label={`Send on ${channelLabel}`}>
            <Send size={14} />
            {sending ? "Sending" : "Send"}
          </Button>
        </div>
        {note && <span style={{ fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.5 }}>{note}</span>}
      </div>
    </Card>
  );
}
