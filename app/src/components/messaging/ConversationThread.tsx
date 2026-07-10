"use client";

import { useEffect, useState } from "react";
import { Send } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Textarea } from "@/components/ui/Input";
import { relativeTime } from "@/lib/utils";

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
 * Reusable conversation thread: a message list + a compose box with a
 * "Send WhatsApp" action. Presentational — the parent owns the send
 * (`onSend`) and message state. Used by the client profile; leads can adopt it
 * in a later unification.
 */
export function ConversationThread({
  messages,
  canSend,
  sending,
  onSend,
  emptyHint = "No messages yet.",
  seedText,
}: {
  messages: ThreadMessage[];
  canSend: boolean;
  sending: boolean;
  onSend: (text: string) => void;
  emptyHint?: string;
  seedText?: string;
}) {
  const [text, setText] = useState("");
  // Lets the parent drop an AI draft into the composer ("Edit" on the draft banner).
  useEffect(() => {
    if (seedText) setText(seedText);
  }, [seedText]);

  function send() {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {messages.length === 0 ? (
        <Card>
          <div
            style={{
              padding: "28px 0",
              textAlign: "center",
              color: "var(--text-tertiary)",
              fontSize: 14,
            }}
          >
            {emptyHint}
          </div>
        </Card>
      ) : (
        messages.map((m) => {
          const inbound = m.direction === "inbound";
          return (
            <Card
              key={m.id}
              style={{
                borderLeft: `3px solid ${
                  inbound ? "var(--accent-pemf)" : "var(--accent-hbot)"
                }`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono), monospace",
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    {inbound ? "Replied" : m.direction === "note" ? "Note" : "Sent"}
                  </span>
                  {m.channel && <Badge>{m.channel}</Badge>}
                  {m.status && m.status !== "sent" && (
                    <Badge tone={m.status === "failed" ? "red" : "neutral"}>
                      {m.status}
                    </Badge>
                  )}
                </div>
                <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>
                  {relativeTime((m.sentAt ?? m.createdAt) as Date)}
                </span>
              </div>
              <div
                style={{
                  color: "var(--text-primary)",
                  fontSize: 14,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                }}
              >
                {m.content}
              </div>
            </Card>
          );
        })
      )}

      <Card>
        <CardLabel>New message</CardLabel>
        <Textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            canSend ? "Type a WhatsApp message…" : "No phone number on file."
          }
          disabled={!canSend}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <Button onClick={send} disabled={!canSend || sending || !text.trim()}>
            <Send size={14} />
            {sending ? "Sending…" : "Send WhatsApp"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
