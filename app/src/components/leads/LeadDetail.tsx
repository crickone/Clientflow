"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  MoreHorizontal,
  Pencil,
  ShoppingBag,
  PhoneOff,
  PhoneOutgoing,
  Mail,
  MessageSquare,
  MessagesSquare,
  Phone,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { Lead, LeadMessage } from "@/lib/db/schema";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/DropdownMenu";
import { Textarea } from "@/components/ui/Input";
import type { StageRecord } from "@/lib/pipeline/roles";
import {
  callLeadAction,
  deleteLeadAction,
  logInboundReplyAction,
  markMessageSentAction,
  sendLeadWhatsAppAction,
  setLeadDoNotCallAction,
  setLeadStageAction,
} from "@/app/leads/actions";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { describeArrival, parseArrival } from "@/lib/arrival";
import { band, BAND_LABEL, NEXT_STEPS, type NextStep } from "@/lib/leadScoreModel";
import { LeadScoreBadge } from "./LeadScoreBadge";

interface Props {
  lead: Lead;
  messages: LeadMessage[];
  stages: StageRecord[];
  /** Whether this ACCOUNT can place calls at all (add-on on, provisioned, in
   *  credit) plus why not — computed server-side by `voiceAvailability` so the
   *  button explains itself instead of failing on click. Per-LEAD reasons (no
   *  number, do-not-call) are decided here from the lead itself. */
  voice: { available: boolean; reason: string | null };
}

export function LeadDetail({ lead: initialLead, messages: initialMessages, stages, voice }: Props) {
  const [lead, setLead] = useState(initialLead);
  const [messages, setMessages] = useState(initialMessages);
  const [drafting, setDrafting] = useState(false);
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyChannel, setReplyChannel] = useState<
    "email" | "sms" | "whatsapp" | "call" | "manual"
  >("email");
  const [calling, setCalling] = useState(false);

  // Why the Call button can't be pressed, in the order an operator would want
  // to hear it: the lead's own blockers first (they're specific and fixable
  // here), then the account-wide one.
  const callBlockedReason = lead.doNotCall
    ? "This lead is marked do-not-call."
    : !lead.phone
      ? "This lead has no phone number."
      : voice.available
        ? null
        : voice.reason;

  async function placeCall() {
    if (callBlockedReason) return;
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "this lead";
    const ok = await confirm({
      title: `Call ${name}?`,
      body:
        "The voice agent will phone them now, say it is an AI, and that the call is recorded. " +
        "The call is charged to this account's voice minutes.",
      confirmLabel: "Call now",
    });
    if (!ok) return;
    setCalling(true);
    try {
      const res = await callLeadAction(lead.id);
      if (res.ok) {
        toast.success("Calling now — the transcript lands here when the call ends.");
      } else {
        toast.error(res.error);
      }
    } finally {
      setCalling(false);
    }
  }

  async function toggleDoNotCall() {
    const next = !lead.doNotCall;
    if (next) {
      const ok = await confirm({
        title: "Mark do-not-call?",
        body: "The voice agent will never phone this lead again. You can undo this here.",
        confirmLabel: "Mark do-not-call",
      });
      if (!ok) return;
    }
    start(async () => {
      const res = await setLeadDoNotCallAction(lead.id, next);
      if (res.ok) {
        setLead({ ...lead, doNotCall: next });
        toast.success(next ? "Marked do-not-call." : "Do-not-call cleared.");
      } else {
        toast.error(res.error);
      }
    });
  }

  const stage = stages.find((s) => s.id === lead.stageId) ?? null;

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

  function setStage(stageId: number) {
    const target = stages.find((s) => s.id === stageId);
    if (!target) return;
    start(async () => {
      const r = await setLeadStageAction(lead.id, stageId);
      setLead({ ...lead, stageId, ...(r?.score ? { leadScore: r.score.score, leadNextStep: r.score.next, leadScoredAt: Date.now() } : {}) });
      toast.success(`Moved to ${target.name}.`);
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

  async function remove() {
    if (!(await confirm({ title: `Delete lead "${fullName}"?`, body: "This cannot be undone.", destructive: true }))) return;
    start(async () => {
      await deleteLeadAction(lead.id);
    });
  }

  const lastOutbound = messages.findLast?.((m) => m.direction === "outbound");
  const hasUnsentDraft =
    lastOutbound && lastOutbound.aiGenerated && !lastOutbound.sentAt;
  const initials = fullName
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const arrival = lead.arrival ? describeArrival(parseArrival(lead.arrival)) : null;
  const origin = [SOURCE_NAME[lead.source] ?? lead.source, lead.campaign].filter(Boolean).join(" · ");
  // An online purchase's note is written by the system; it reads as an event, not a message from them.
  const systemNote = lead.source === "offer";

  function draftActions(m: LeadMessage, text: string) {
    return (
      <div className="ld-draft-actions">
        <Button variant="ghost" size="sm" onClick={() => copyToClipboard(text)}>
          <Copy size={13} /> Copy
        </Button>
        {editingId !== m.id && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditingId(m.id);
              setEditText(m.content);
            }}
          >
            <Pencil size={13} /> Edit
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => {
            if (editingId !== m.id) setEditText(m.content);
            markSent(m.id);
          }}
          title="You sent it yourself (email, text); record it here"
        >
          <Check size={13} /> Mark sent
        </Button>
        {lead.phone && (
          <Button size="sm" loading={pending} onClick={() => sendViaWhatsApp(m.id, text)}>
            <Send size={13} /> Send WhatsApp
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="ld">
      <Link href="/leads" className="ld-back">
        <ArrowLeft size={14} /> Leads
      </Link>

      <header className="ld-head">
        <div className="ld-who">
          <span className="ld-avatar" aria-hidden>
            {initials || "?"}
          </span>
          <div className="ld-who-text">
            <h1 className="ld-name">{fullName}</h1>
            <p className="ld-origin">
              {origin}
              {arrival && <span> · arrived from {arrival}</span>}
            </p>
            <div className="ld-contact">
              {lead.phone && (
                <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>
                  <Phone size={13} /> {lead.phone}
                </a>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`}>
                  <Mail size={13} /> {lead.email}
                </a>
              )}
              {lead.doNotCall && <Badge tone="red">Do not call</Badge>}
            </div>
          </div>
        </div>

        <div className="ld-actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="ld-stage" disabled={pending}>
                <span className="ld-stage-dot" style={{ background: stage?.colour ?? "var(--text-tertiary)" }} />
                {stage?.name ?? "No stage"}
                <ChevronDown size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {stages.map((s) => (
                <DropdownMenuItem key={s.id} onSelect={() => s.id !== lead.stageId && setStage(s.id)}>
                  <span className="ld-stage-dot" style={{ background: s.colour }} />
                  {s.name}
                  {s.id === lead.stageId && <Check size={13} style={{ marginLeft: "auto" }} />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={generateDraft} disabled={drafting || pending}>
            <Sparkles size={15} />
            {drafting ? "Drafting…" : hasUnsentDraft ? "Redo the draft" : "Draft a message"}
          </Button>
          <Button
            variant="secondary"
            onClick={placeCall}
            disabled={calling || pending || !!callBlockedReason}
            title={callBlockedReason ?? "Have the voice agent phone this lead now"}
          >
            <PhoneOutgoing size={14} />
            {calling ? "Calling…" : "Call"}
          </Button>
          {messages.length > 0 && (
            <Link href={`/communication?c=${encodeURIComponent(`lead-${lead.id}`)}`}>
              <Button variant="secondary">
                <MessagesSquare size={14} /> Open chat
              </Button>
            </Link>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="ld-more" aria-label="More actions">
                <MoreHorizontal size={17} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setReplyOpen(true)}>
                <MessageSquare size={14} /> Log a reply they gave elsewhere
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void toggleDoNotCall()}>
                <PhoneOff size={14} /> {lead.doNotCall ? "Allow calls again" : "Mark do not call"}
              </DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={() => void remove()}>
                <Trash2 size={14} /> Delete lead
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="ld-grid">
        <section className="ld-thread" aria-label="Conversation">
          {lead.notes && systemNote && (
            <div className="ld-event">
              <ShoppingBag size={13} /> {lead.notes}
              <span>{formatDateTime(lead.createdAt)}</span>
            </div>
          )}
          {lead.notes && !systemNote && (
            <div className="ld-msg" data-side="them">
              <div className="ld-msg-meta">From the form · {formatDateTime(lead.createdAt)}</div>
              <div className="ld-bubble">{lead.notes}</div>
            </div>
          )}

          {messages.length === 0 && (
            <div className="ld-empty">
              <p>No messages yet.</p>
              <Button onClick={generateDraft} disabled={drafting || pending}>
                <Sparkles size={15} /> {drafting ? "Drafting…" : "Draft a first message"}
              </Button>
            </div>
          )}

          {messages.map((m) => {
            const isOutbound = m.direction === "outbound";
            const isInbound = m.direction === "inbound";
            const isDraft = isOutbound && m.aiGenerated && !m.sentAt;
            const isEditing = editingId === m.id;
            const side = isInbound ? "them" : isOutbound ? "us" : "note";
            return (
              <div key={m.id} className="ld-msg" data-side={side} data-draft={isDraft}>
                <div className="ld-msg-meta">
                  {isInbound ? "They replied" : isOutbound ? (isDraft ? "Draft, not sent" : "You") : "Note"}
                  {m.channel && ` · ${CHANNEL_NAME[m.channel] ?? m.channel}`}
                  {m.aiGenerated && " · written by Adonis"}
                  {" · "}
                  {m.sentAt ? relativeTime(m.sentAt) : relativeTime(m.createdAt)}
                </div>
                {isEditing ? (
                  <div className="ld-edit">
                    <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={6} />
                    <div className="ld-draft-actions">
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
                      {draftActions(m, editText)}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="ld-bubble">{m.content}</div>
                    {isDraft && draftActions(m, m.content)}
                  </>
                )}
              </div>
            );
          })}

          {replyOpen && (
            <div className="ld-log">
              <div className="ld-log-head">
                <strong>Log a reply they gave elsewhere</strong>
                <span>A phone call, your own email, in person.</span>
              </div>
              <div className="ld-log-channels">
                {(["email", "sms", "whatsapp", "call", "manual"] as const).map((c) => (
                  <button key={c} type="button" data-on={replyChannel === c} onClick={() => setReplyChannel(c)}>
                    {c === "manual" ? "In person" : c === "sms" ? "Text" : c.charAt(0).toUpperCase() + c.slice(1)}
                  </button>
                ))}
              </div>
              <Textarea rows={4} value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="What did they say?" />
              <div className="ld-draft-actions">
                <Button variant="ghost" size="sm" onClick={() => setReplyOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" loading={pending} onClick={logReply}>
                  Save reply
                </Button>
              </div>
            </div>
          )}
        </section>

        <aside className="ld-side">
          {lead.leadScore !== null && (
            <Card className="ld-card ls-card" data-band={band(lead.leadScore)}>
              <CardLabel>Lead score</CardLabel>
              <div className="ls-top">
                <LeadScoreBadge score={lead.leadScore} next={lead.leadNextStep} size="lg" />
                <div className="ls-top-text">
                  <span className="lsb" data-band={band(lead.leadScore)}>
                    <span className="lsb-dot" aria-hidden />
                    {BAND_LABEL[band(lead.leadScore)]} lead
                  </span>
                  <span className="ls-of">{lead.leadScore} out of 100</span>
                </div>
              </div>
              {lead.leadNextStep && lead.leadNextStep in NEXT_STEPS && (
                <div className="ls-next">
                  <b>Next: {NEXT_STEPS[lead.leadNextStep as NextStep].label}</b>
                  <span>{NEXT_STEPS[lead.leadNextStep as NextStep].what}</span>
                </div>
              )}
              <span className="ls-when">
                Scored {lead.leadScoredAt ? relativeTime(lead.leadScoredAt) : "recently"} from their messages and details. It updates as things change.
              </span>
            </Card>
          )}
          <Card className="ld-card">
            <CardLabel>Details</CardLabel>
            <dl className="ld-facts">
              <div>
                <dt>Came in</dt>
                <dd>{SOURCE_NAME[lead.source] ?? lead.source}</dd>
              </div>
              {lead.campaign && (
                <div>
                  <dt>Campaign</dt>
                  <dd>{lead.campaign}</dd>
                </div>
              )}
              <div>
                <dt>Arrived from</dt>
                <dd>{arrival ?? "Not recorded"}</dd>
              </div>
              {lead.therapyInterest && (
                <div>
                  <dt>Interested in</dt>
                  <dd>{lead.therapyInterest}</dd>
                </div>
              )}
              <div>
                <dt>First contact</dt>
                <dd>{formatDateTime(lead.createdAt)}</dd>
              </div>
              <div>
                <dt>Last activity</dt>
                <dd>{relativeTime(lead.updatedAt)}</dd>
              </div>
            </dl>
          </Card>

          {lead.clientId && (
            <Card className="ld-card">
              <CardLabel>Client</CardLabel>
              <p className="ld-note">{fullName.split(" ")[0]} is a client now: their bookings, treatments and payments are on their client page.</p>
              <div className="ld-links">
                <Link href={`/clients/${lead.clientId}?tab=journey`}>View their journey</Link>
                <Link href={`/clients/${lead.clientId}`}>Open client</Link>
              </div>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

const CHANNEL_NAME: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  sms: "Text",
  call: "Phone call",
  manual: "In person",
  instagram: "Instagram",
  messenger: "Messenger",
  facebook: "Facebook",
};

const SOURCE_NAME: Record<string, string> = {
  offer: "Bought online",
  landing: "Campaign page sign-up",
  website: "Website enquiry",
  facebook: "Facebook Lead Ad",
  meta: "Facebook Lead Ad",
  whatsapp: "WhatsApp",
  manual: "Added by the team",
  voice: "Phone call",
};
