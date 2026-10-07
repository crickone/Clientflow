"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AlertTriangle, Check, Pencil, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { ConversationThread, type ThreadMessage } from "@/components/messaging/ConversationThread";
import { loadThreadAction, retriageAction, sendInboxMessageAction } from "@/app/communication/actions";
import type { ConversationDetail } from "@/lib/conversations";

const CHANNEL_LABELS = { whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram" } as const;

/**
 * A WhatsApp / Messenger / Instagram conversation in the reading pane: the AI
 * summary and flags, the staged AI reply (approve, edit or discard), and the
 * chat thread with its composer filling the rest of the pane.
 */
export function ConversationReader({
  kind,
  contactId,
  onSent,
  focusReplyToken,
}: {
  kind: "lead" | "client";
  contactId: number;
  onSent: (text: string, channel: "whatsapp" | "messenger" | "instagram") => void;
  focusReplyToken: number;
}) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [sending, startSend] = useTransition();
  const [retriaging, startRetriage] = useTransition();
  const [draftDismissed, setDraftDismissed] = useState(false);
  const [seedText, setSeedText] = useState<string | undefined>(undefined);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setDraftDismissed(false);
    setSeedText(undefined);
    loadThreadAction(kind, contactId).then((res) => {
      if (cancelled) return;
      if (res.ok) setDetail(res.detail);
      else toast.error(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, contactId]);

  useEffect(() => {
    if (focusReplyToken) composer.current?.focus();
  }, [focusReplyToken]);

  function handleSend(text: string, fromDraft = false) {
    startSend(async () => {
      const res = await sendInboxMessageAction(kind, contactId, text);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const now = new Date();
      const sent: ThreadMessage = { id: res.messageId, direction: "outbound", channel: res.channel, content: text, status: "sent", sentAt: now, createdAt: now };
      setDetail((prev) => (prev ? { ...prev, messages: [...prev.messages, sent], draft: null } : prev));
      setDraftDismissed(true);
      onSent(text, res.channel);
      toast.success(fromDraft ? "AI reply approved and sent." : `Sent on ${CHANNEL_LABELS[res.channel]}.`);
    });
  }

  function retriage() {
    startRetriage(async () => {
      const res = await retriageAction(kind, contactId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const t = await loadThreadAction(kind, contactId);
      if (t.ok) setDetail(t.detail);
      toast.success("Re-triaged.");
    });
  }

  if (!detail) {
    return (
      <div className="inbox-reader-body" aria-hidden>
        <div style={{ padding: 24, display: "grid", gap: 12 }}>
          <div className="skeleton" style={{ width: "60%", height: 40, borderRadius: 16 }} />
          <div className="skeleton" style={{ width: "45%", height: 40, borderRadius: 16, justifySelf: "end" }} />
          <div className="skeleton" style={{ width: "55%", height: 40, borderRadius: 16 }} />
        </div>
      </div>
    );
  }

  const channelLabel = detail.replyChannel ? CHANNEL_LABELS[detail.replyChannel] : "WhatsApp";
  const showDraft = !!detail.draft && !draftDismissed;

  return (
    <div className="inbox-reader-body">
      {(detail.aiSummary || detail.sensitive || detail.untriaged || showDraft) && (
        <div className="inbox-conv-notes">
          {detail.aiSummary && (
            <div className="inbox-summary">
              <Sparkles size={13} /> <span>{detail.aiSummary}</span>
            </div>
          )}
          {detail.sensitive && (
            <div className="inbox-flag inbox-flag--danger">
              <AlertTriangle size={15} />
              <span>Flagged sensitive and held for you. The AI will never auto-reply to this; please handle it personally.</span>
            </div>
          )}
          {detail.untriaged && (
            <div className="inbox-flag">
              <span>This message was not triaged by the AI.</span>
              <Button size="sm" variant="outline" loading={retriaging} onClick={retriage}>
                <RefreshCw size={13} /> Re-run AI
              </Button>
            </div>
          )}
          {showDraft && detail.draft && (
            <div className="inbox-draft">
              <div className="inbox-draft-label">
                <Sparkles size={13} /> Suggested reply
              </div>
              <div className="inbox-draft-text">{detail.draft.text}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <Button size="sm" disabled={!detail.canReply || sending} onClick={() => handleSend(detail.draft!.text, true)}>
                  <Check size={14} /> Approve and send
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSeedText(detail.draft!.text);
                    setDraftDismissed(true);
                  }}
                >
                  <Pencil size={14} /> Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraftDismissed(true)}>
                  <X size={14} /> Discard
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      <ConversationThread
        fill
        composerRef={composer}
        messages={detail.messages}
        canSend={detail.canReply}
        sending={sending}
        onSend={handleSend}
        seedText={seedText}
        channelLabel={channelLabel}
        note={detail.replyNote}
        emptyHint={
          detail.canReply
            ? `No messages yet. Send a ${channelLabel} message to start the conversation.`
            : `No messages yet. ${detail.replyNote ?? ""}`.trim()
        }
      />
    </div>
  );
}
