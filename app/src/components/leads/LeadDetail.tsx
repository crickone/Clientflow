"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  Mail,
  MessageSquare,
  Phone,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { Lead, LeadMessage } from "@/lib/db/schema";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Textarea } from "@/components/ui/Input";
import { StageChip } from "@/components/pipeline/StageChip";
import { STAGES, STAGE_ORDER, type PipelineStage } from "@/lib/pipeline/stages";
import {
  deleteLeadAction,
  logInboundReplyAction,
  markMessageSentAction,
  sendLeadWhatsAppAction,
  setLeadStageAction,
} from "@/app/leads/actions";
import { formatDate, formatDateTime, relativeTime } from "@/lib/utils";

interface Props {
  lead: Lead;
  messages: LeadMessage[];
}

export function LeadDetail({ lead: initialLead, messages: initialMessages }: Props) {
  const [lead, setLead] = useState(initialLead);
  const [messages, setMessages] = useState(initialMessages);
  const [drafting, setDrafting] = useState(false);
  const [pending, start] = useTransition();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyChannel, setReplyChannel] = useState<
    "email" | "sms" | "whatsapp" | "call" | "manual"
  >("email");

  const fullName =
    [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Anonymous";

  async function generateDraft() {
    setDrafting(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/draft`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        toast.error(data.error ?? "Could not draft message.");
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: data.messageId,
          leadId: lead.id,
          direction: "outbound",
          channel: lead.email ? "email" : "sms",
          content: data.content,
          aiGenerated: true,
          sentAt: null,
          createdAt: new Date(),
        } as LeadMessage,
      ]);
      toast.success("Draft ready — review and send.");
      const cacheNote =
        data.usage?.cacheReadInputTokens > 0
          ? `Cache hit (${data.usage.cacheReadInputTokens} tokens read)`
          : null;
      if (cacheNote) toast.message(cacheNote);
      // Auto-open the editor on the new draft
      setEditingId(data.messageId);
      setEditText(data.content);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error.");
    } finally {
      setDrafting(false);
    }
  }

  function setStage(s: PipelineStage) {
    start(async () => {
      await setLeadStageAction(lead.id, s);
      setLead({ ...lead, pipelineStage: s });
      toast.success(`Moved to ${STAGES[s].label}.`);
    });
  }

  function markSent(messageId: number) {
    const text = editText.trim();
    if (!text) {
      toast.error("Message can't be empty.");
      return;
    }
    start(async () => {
      await markMessageSentAction(messageId, text);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, content: text, sentAt: new Date() }
            : m,
        ),
      );
      if (lead.status === "new") setLead({ ...lead, status: "contacted" });
      setEditingId(null);
      toast.success("Marked as sent.");
    });
  }

  function sendViaWhatsApp(messageId: number, text: string) {
    const t = text.trim();
    if (!t) {
      toast.error("Message can't be empty.");
      return;
    }
    start(async () => {
      const res = await sendLeadWhatsAppAction(lead.id, t, messageId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // The draft row was replaced by a sent WhatsApp message server-side.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                id: res.messageId,
                content: t,
                channel: "whatsapp",
                status: "sent",
                sentAt: new Date(),
              }
            : m,
        ),
      );
      if (lead.status === "new") setLead({ ...lead, status: "contacted" });
      setEditingId(null);
      toast.success("Sent via WhatsApp.");
    });
  }

  function copyToClipboard(content: string) {
    navigator.clipboard.writeText(content).then(() => {
      toast.success("Copied to clipboard.");
    });
  }

  function logReply() {
    const text = replyText.trim();
    if (!text) return;
    start(async () => {
      await logInboundReplyAction(lead.id, text, replyChannel);
      setMessages((prev) => [
        ...prev,
        {
          id: -Date.now(),
          leadId: lead.id,
          direction: "inbound",
          channel: replyChannel,
          content: text,
          aiGenerated: false,
          sentAt: new Date(),
          createdAt: new Date(),
        } as LeadMessage,
      ]);
      setLead({ ...lead, status: "replied" });
      setReplyText("");
      setReplyOpen(false);
      toast.success("Reply logged.");
    });
  }

  function remove() {
    if (!confirm(`Delete lead "${fullName}"? This cannot be undone.`)) return;
    start(async () => {
      await deleteLeadAction(lead.id);
    });
  }

  const lastOutbound = messages.findLast?.((m) => m.direction === "outbound");
  const hasUnsentDraft =
    lastOutbound && lastOutbound.aiGenerated && !lastOutbound.sentAt;

  return (
    <>
      <Link
        href="/leads"
        style={{
          display: "inline-flex",
          gap: 6,
          alignItems: "center",
          color: "var(--text-tertiary)",
          fontSize: 13,
          marginBottom: 24,
        }}
      >
        <ArrowLeft size={14} />
        Back to leads
      </Link>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 24,
          marginBottom: 32,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-tertiary)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 8,
              fontWeight: 500,
            }}
          >
            Lead · {lead.source}
          </div>
          <h1
            style={{
              fontFamily: "var(--font-heading), sans-serif",
              fontSize: "clamp(28px, 3.5vw, 40px)",
              fontWeight: 400,
              textTransform: "uppercase",
              color: "var(--text-primary)",
              lineHeight: 1.05,
            }}
          >
            {fullName}
          </h1>
          <div
            style={{
              display: "flex",
              gap: 16,
              marginTop: 12,
              color: "var(--text-secondary)",
              fontSize: 14,
              flexWrap: "wrap",
            }}
          >
            {lead.email && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Mail size={14} /> {lead.email}
              </span>
            )}
            {lead.phone && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Phone size={14} /> {lead.phone}
              </span>
            )}
            <StageChip stage={lead.pipelineStage as PipelineStage} />
            {lead.therapyInterest && <Badge>{lead.therapyInterest}</Badge>}
            {lead.campaign && <Badge>{lead.campaign}</Badge>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button onClick={generateDraft} disabled={drafting || pending}>
            <Sparkles size={15} />
            {drafting ? "Drafting…" : hasUnsentDraft ? "Regenerate draft" : "AI draft"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setReplyOpen(true)}
            disabled={pending}
          >
            <MessageSquare size={14} />
            Log reply
          </Button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {lead.notes && (
            <Card>
              <CardLabel>From the form</CardLabel>
              <div style={{ color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>
                {lead.notes}
              </div>
            </Card>
          )}

          {messages.length === 0 ? (
            <Card>
              <div
                style={{
                  padding: "32px 0",
                  textAlign: "center",
                  color: "var(--text-tertiary)",
                  fontSize: 14,
                }}
              >
                No messages yet. Click <b>AI draft</b> to generate the first
                follow-up.
              </div>
            </Card>
          ) : (
            messages.map((m) => {
              const isOutbound = m.direction === "outbound";
              const isInbound = m.direction === "inbound";
              const isDraft = isOutbound && m.aiGenerated && !m.sentAt;
              const isEditing = editingId === m.id;
              return (
                <Card
                  key={m.id}
                  style={{
                    borderLeft: `3px solid ${
                      isInbound
                        ? "var(--accent-pemf)"
                        : isOutbound
                          ? "var(--accent-hbot)"
                          : "var(--hairline)"
                    }`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 10,
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: "var(--text-tertiary)",
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                        }}
                      >
                        {isInbound ? "Lead replied" : isOutbound ? "Outbound" : "Note"}
                      </span>
                      {m.channel && <Badge>{m.channel}</Badge>}
                      {m.aiGenerated && (
                        <Badge tone="amber">
                          <Bot size={11} style={{ marginRight: 4 }} />
                          AI
                        </Badge>
                      )}
                      {isDraft && <Badge tone="amber">Draft — not sent</Badge>}
                    </div>
                    <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>
                      {m.sentAt
                        ? `Sent ${relativeTime(m.sentAt)}`
                        : `Drafted ${relativeTime(m.createdAt)}`}
                    </span>
                  </div>
                  {isEditing ? (
                    <>
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={6}
                      />
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          marginTop: 10,
                          justifyContent: "flex-end",
                        }}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingId(null);
                            setEditText("");
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(editText)}
                        >
                          Copy
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() => markSent(m.id)}
                        >
                          <Check size={13} />
                          Mark sent
                        </Button>
                        {lead.phone && (
                          <Button
                            size="sm"
                            disabled={pending}
                            onClick={() => sendViaWhatsApp(m.id, editText)}
                          >
                            <Send size={13} />
                            Send WhatsApp
                          </Button>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
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
                      {isDraft && (
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            marginTop: 12,
                            justifyContent: "flex-end",
                          }}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(m.content)}
                          >
                            Copy
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingId(m.id);
                              setEditText(m.content);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={pending}
                            onClick={() => {
                              setEditText(m.content);
                              markSent(m.id);
                            }}
                          >
                            <Check size={13} />
                            Mark sent
                          </Button>
                          {lead.phone && (
                            <Button
                              size="sm"
                              disabled={pending}
                              onClick={() => sendViaWhatsApp(m.id, m.content)}
                            >
                              <Send size={13} />
                              Send WhatsApp
                            </Button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </Card>
              );
            })
          )}

          {replyOpen && (
            <Card>
              <CardLabel>Log inbound reply</CardLabel>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {(["email", "sms", "whatsapp", "call", "manual"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setReplyChannel(c)}
                    style={{
                      padding: "6px 12px",
                      fontSize: 12,
                      borderRadius: "var(--radius)",
                      border: `1px solid ${
                        replyChannel === c ? "var(--text-primary)" : "var(--hairline)"
                      }`,
                      background: replyChannel === c ? "var(--text-primary)" : "transparent",
                      color: replyChannel === c ? "var(--bg)" : "var(--text-secondary)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      textTransform: "capitalize",
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <Textarea
                rows={4}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="What did they say?"
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
                <Button variant="ghost" size="sm" onClick={() => setReplyOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" disabled={pending} onClick={logReply}>
                  Save reply
                </Button>
              </div>
            </Card>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <CardLabel>Pipeline stage</CardLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {STAGE_ORDER.map((s) => {
                const active = lead.pipelineStage === s;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={pending || active}
                    onClick={() => setStage(s)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "var(--radius)",
                      border: `1px solid ${active ? STAGES[s].colourHex : "var(--hairline)"}`,
                      background: active ? `${STAGES[s].colourHex}1f` : "transparent",
                      color: active ? STAGES[s].colourHex : "var(--text-primary)",
                      cursor: active ? "default" : "pointer",
                      textAlign: "left",
                      fontFamily: "inherit",
                      fontSize: 13,
                      fontWeight: active ? 600 : 400,
                      opacity: active ? 1 : 0.85,
                    }}
                  >
                    {STAGES[s].label}
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardLabel>Lead detail</CardLabel>
            <Row label="Source" value={lead.source} />
            {lead.sourceLeadId && (
              <Row
                label="Source ID"
                value={lead.sourceLeadId}
                mono
              />
            )}
            <Row label="Created" value={formatDateTime(lead.createdAt)} />
            <Row label="Updated" value={formatDateTime(lead.updatedAt)} />
          </Card>

          <Card>
            <CardLabel>Danger zone</CardLabel>
            <Button
              variant="ghost"
              size="sm"
              onClick={remove}
              style={{ color: "#dc2626" }}
              disabled={pending}
            >
              <Trash2 size={13} />
              Delete lead
            </Button>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 0",
        borderBottom: "1px solid var(--hairline)",
        fontSize: 13,
      }}
    >
      <span style={{ color: "var(--text-tertiary)" }}>{label}</span>
      <span
        style={{
          color: "var(--text-primary)",
          fontFamily: mono ? "ui-monospace, monospace" : undefined,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}
