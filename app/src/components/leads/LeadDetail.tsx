"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CalendarPlus,
  CircleAlert,
  MousePointerClick,
  StickyNote,
  UserPlus,
  UserRound,
  Check,
  ChevronDown,
  Copy,
  MoreHorizontal,
  Pencil,
  ShoppingBag,
  PhoneCall,
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
import { addConversationAsLeadAction } from "@/app/communication/actions";
import type { Lead, LeadMessage } from "@/lib/db/schema";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/DropdownMenu";
import { Input, Textarea } from "@/components/ui/Input";
import { MessageBody } from "@/components/messaging/MessageBody";
import { AttachButton, AttachmentTray, DropHint } from "@/components/messaging/AttachmentTray";
import { useAttachments } from "@/components/messaging/useAttachments";
import { failedFilesNote } from "@/components/messaging/attachmentsModel";
import type { StageRecord } from "@/lib/pipeline/roles";
import {
  callLeadAction,
  deleteLeadAction,
  logInboundReplyAction,
  markMessageSentAction,
  sendLeadWhatsAppAction,
  sendLeadEmailAction,
  addLeadNoteAction,
  setLeadDoNotCallAction,
  setLeadStageAction,
} from "@/app/leads/actions";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { describeArrival, parseArrival } from "@/lib/arrival";
import { band, BAND_LABEL, NEXT_STEPS, type NextStep } from "@/lib/leadScoreModel";
import { LeadScoreBadge } from "./LeadScoreBadge";
import { CallDialog, type CallMode } from "./CallDialog";
import { LeadFollowUpsCard, type LeadCallView } from "./LeadFollowUpsCard";
import { buildFeed, withoutAdNumber, type ActivityEvent, type ActivityFilter } from "@/lib/leadActivityModel";
import type { LeadPurchase } from "@/lib/leadActivity";

interface Props {
  lead: Lead;
  messages: LeadMessage[];
  stages: StageRecord[];
  /** Whether this ACCOUNT can place calls at all (add-on on, provisioned, in
   *  credit) plus why not — computed server-side by `voiceAvailability` so the
   *  button explains itself instead of failing on click. Per-LEAD reasons (no
   *  number, do-not-call) are decided here from the lead itself. */
  voice: { available: boolean; reason: string | null };
  /** Staff the lead can be assigned to. */
  staff: { userId: number; name: string }[];
  /** The follow-up flow the lead is in and its next messages. */
  flow: { flow: string | null; next: { channel: string; dueAt: number }[] };
  /** Logged and scheduled calls, newest first. */
  calls: LeadCallView[];
  /** The feed's events and the client's purchases (lib/leadActivity). */
  activity: { events: ActivityEvent[]; purchases: LeadPurchase[]; paidEur: number | null };
  /** Extra cards for the side column (linked records, GoHighLevel). */
  extras?: ReactNode;
}

type Channel = "whatsapp" | "email" | "note";
type FeedEntry = { id: number; at: number; msg: LeadMessage | null; formNote?: string };

export function LeadDetail({ lead: initialLead, messages: initialMessages, stages, voice, staff, flow, calls, activity, extras }: Props) {
  const [lead, setLead] = useState(initialLead);
  // A router.refresh() (e.g. after a call moves the lead) hands in a new prop: adopt it.
  useEffect(() => {
    setLead(initialLead);
  }, [initialLead]);
  const [messages, setMessages] = useState(initialMessages);
  // A refresh (after the WhatsApp history loads) hands in new messages: adopt them.
  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);
  const router = useRouter();
  // The whole WhatsApp chat, including what was sent from the phone or GoHighLevel:
  // fill it in from the business's WhatsApp, then show it.
  useEffect(() => {
    if (!initialLead.phone) return;
    let gone = false;
    fetch(`/api/leads/${initialLead.id}/whatsapp-history`, { method: "POST" })
      .then((r) => r.json())
      .then((d: { added?: number }) => {
        if (!gone && (d.added ?? 0) > 0) router.refresh();
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [initialLead.id, initialLead.phone, router]);
  const [drafting, setDrafting] = useState(false);
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  // The subject an emailed draft goes out with; editable before sending.
  const [emailSubject, setEmailSubject] = useState(() => (lead.campaign ? `About ${lead.campaign}` : "Following up"));
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyChannel, setReplyChannel] = useState<
    "email" | "sms" | "whatsapp" | "call" | "manual"
  >("email");
  const [calling, setCalling] = useState(false);
  const [callMode, setCallMode] = useState<CallMode | null>(null);

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

  // A direct message from someone new: a conversation, not on the board until added.
  const stage = lead.inboxOnly ? null : stages.find((s) => s.id === lead.stageId) ?? null;

  function addAsLead() {
    start(async () => {
      const r = await addConversationAsLeadAction(lead.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Added to your pipeline as a lead.");
      router.refresh();
    });
  }

  const fullName =
    [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Anonymous";

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

  function sendViaEmail(messageId: number, text: string) {
    const t = text.trim();
    if (!t) {
      toast.error("Message can't be empty.");
      return;
    }
    start(async () => {
      const res = await sendLeadEmailAction(lead.id, { subject: emailSubject, text: t, draftMessageId: messageId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, id: res.messageId, content: t, channel: "email", status: "sent", sentAt: new Date() } : m,
        ),
      );
      if (lead.status === "new") setLead({ ...lead, status: "contacted" });
      setEditingId(null);
      toast.success(`Email sent to ${lead.email}.`);
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

  // ── the message box ──
  const channels: Channel[] = [...(lead.phone ? (["whatsapp"] as const) : []), ...(lead.email ? (["email"] as const) : []), "note"];
  const [channel, setChannel] = useState<Channel>(channels[0]);
  const [text, setText] = useState("");
  const [draftId, setDraftId] = useState<number | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Files in the message box (WhatsApp, email and team notes all take them).
  const att = useAttachments();

  async function draftIntoBox() {
    setDrafting(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/draft`, { method: "POST" });
      const data = await res.json();
      if (!data.ok) {
        toast.error(data.error ?? "Could not draft a message.");
        return;
      }
      if (channel === "note") setChannel(channels[0]);
      setText(data.content);
      setDraftId(data.messageId);
      boxRef.current?.focus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error.");
    } finally {
      setDrafting(false);
    }
  }

  function sendFromBox() {
    const t = text.trim();
    if (!att.readyWith(t)) return;
    const tokens = att.tokens;
    const files = tokens.length ? tokens : undefined;
    // The uploaded files' records, so the new row shows them straight away.
    const sentMedia = att.items.flatMap((i) => (i.status === "ready" && i.media ? [i.media] : []));
    const mediaJson = sentMedia.length ? JSON.stringify(sentMedia) : null;
    start(async () => {
      const now = new Date();
      if (channel === "note") {
        const res = await addLeadNoteAction(lead.id, t, files);
        if (!res.ok) return void toast.error(res.error);
        setMessages((prev) => [...prev, { id: res.messageId, leadId: lead.id, direction: "note", channel: "manual", content: t, media: mediaJson, aiGenerated: false, sentAt: now, createdAt: now } as LeadMessage]);
        setText("");
        att.clear();
        if (files) router.refresh();
        toast.success("Note saved.");
        return;
      }
      const res =
        channel === "email"
          ? await sendLeadEmailAction(lead.id, { subject: emailSubject, text: t, draftMessageId: draftId ?? undefined, ...(files ? { attachments: files } : {}) })
          : await sendLeadWhatsAppAction(lead.id, t, draftId ?? undefined, files);
      if (!res.ok) return void toast.error(res.error);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== draftId),
        { id: res.messageId, leadId: lead.id, direction: "outbound", channel, content: t, media: mediaJson, aiGenerated: draftId != null, status: "sent", sentAt: now, createdAt: now } as LeadMessage,
      ]);
      if (lead.status === "new") setLead({ ...lead, status: "contacted" });
      setText("");
      setDraftId(null);
      att.clear();
      // On WhatsApp each file is its own message; reload to show them as stored.
      if (files) router.refresh();
      const note = failedFilesNote((res as { failed?: string[] }).failed);
      if (note) toast.error(note);
      else toast.success(channel === "email" ? `Email sent to ${lead.email}.` : "Sent on WhatsApp.");
    });
  }

  const feed = useMemo(() => {
    const entries: FeedEntry[] = messages
      .filter((m) => m.id !== draftId)
      .map((m) => ({ id: m.id, at: new Date(m.sentAt ?? m.createdAt).getTime(), msg: m }));
    // A form's free text reads as their first words; an online purchase's note is in the purchases already.
    if (lead.notes && lead.source !== "offer") entries.push({ id: -1, at: new Date(lead.createdAt).getTime(), msg: null, formNote: lead.notes });
    return buildFeed(activity.events, entries, filter, Date.now());
  }, [messages, draftId, lead.notes, lead.source, lead.createdAt, activity.events, filter]);

  // Newest at the bottom, like a chat: keep the latest in view.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // Again once fonts and media have laid out.
    const id = requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
    return () => cancelAnimationFrame(id);
  }, [feed]);

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
      <>
      {lead.email && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", margin: "0 0 8px" }}>
          <label htmlFor={`subject-${m.id}`} style={{ fontSize: 12.5, color: "var(--text-tertiary)", flex: "none" }}>
            Email subject
          </label>
          <Input
            id={`subject-${m.id}`}
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
            style={{ maxWidth: 360 }}
          />
        </div>
      )}
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
        {lead.email && (
          <Button size="sm" loading={pending} onClick={() => sendViaEmail(m.id, text)}>
            <Mail size={13} /> Send email
          </Button>
        )}
        {lead.phone && (
          <Button size="sm" loading={pending} variant={lead.email ? "secondary" : undefined} onClick={() => sendViaWhatsApp(m.id, text)}>
            <Send size={13} /> Send WhatsApp
          </Button>
        )}
      </div>
      </>
    );
  }

  const sessionsToBook = activity.purchases.reduce((n, p) => n + Math.max(0, p.sessionsLeft), 0);
  const bookHref = lead.clientId ? `/appointments/new?client=${lead.clientId}` : null;
  const arrivalShort = arrival ? withoutAdNumber(arrival) : null;
  const originLine = [SOURCE_NAME[lead.source] ?? lead.source, lead.campaign, arrivalShort && arrivalShort !== "No record of how they arrived" ? `from ${arrivalShort}` : null]
    .filter(Boolean)
    .join(" · ");
  const purchaseCount = activity.events.filter((e) => e.kind === "purchase").length;

  function renderMessage(m: LeadMessage) {
    const isOutbound = m.direction === "outbound";
    const isInbound = m.direction === "inbound";
    const isDraft = isOutbound && m.aiGenerated && !m.sentAt;
    const isEditing = editingId === m.id;
    const side = isInbound ? "them" : isOutbound ? "us" : "note";
    return (
      <div key={`m-${m.id}`} className="ld-msg" data-side={side} data-draft={isDraft}>
        <div className="ld-msg-meta">
          {isInbound
            ? `${lead.firstName || "They"} replied`
            : isOutbound
              ? isDraft
                ? "Draft, not sent"
                : m.origin === "phone"
                  ? "Sent from your WhatsApp"
                  : "You"
              : "Note for the team"}
          {m.channel && m.channel !== "manual" && m.channel !== "system" && ` · ${CHANNEL_NAME[m.channel] ?? m.channel}`}
          {m.aiGenerated && " · written by Adonis"}
          {" · "}
          {formatTime(m.sentAt ?? m.createdAt)}
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
            <div className="ld-bubble">
              <MessageBody content={m.content} media={m.media} />
            </div>
            {m.status === "failed" && m.error && <div className="at-failed">Not sent: {m.error}</div>}
            {isDraft && draftActions(m, m.content)}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="ld lv">
      <Link href="/leads" className="ld-back">
        <ArrowLeft size={14} /> Leads
      </Link>

      <header className="lv-head">
        <div className="ld-who">
          <span className="ld-avatar" aria-hidden>
            {initials || "?"}
          </span>
          <div className="ld-who-text">
            <div className="lv-title">
              <h1 className="ld-name">{fullName}</h1>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="lv-stage"
                    disabled={pending}
                    aria-label={`Stage: ${stage?.name ?? "none"}. Change stage`}
                    style={{ ["--stage" as string]: stage?.colour ?? "var(--text-tertiary)" }}
                  >
                    <span className="ld-stage-dot" />
                    {lead.inboxOnly ? "Not a lead" : stage?.name ?? "No stage"}
                    <ChevronDown size={13} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {stages.map((s) => (
                    <DropdownMenuItem key={s.id} onSelect={() => s.id !== lead.stageId && setStage(s.id)}>
                      <span className="ld-stage-dot" style={{ background: s.colour }} />
                      {s.name}
                      {s.id === lead.stageId && <Check size={13} style={{ marginLeft: "auto" }} />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {lead.clientId && (
                <Link href={`/clients/${lead.clientId}`} className="lv-chip">
                  <UserRound size={13} /> Client
                </Link>
              )}
              {lead.doNotCall && <Badge tone="red">Do not call</Badge>}
            </div>
            <div className="lv-meta">
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
              <span className="lv-origin">{originLine}</span>
            </div>
          </div>
        </div>

        <div className="lv-acts">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" disabled={pending}>
                <PhoneCall size={14} /> Call <ChevronDown size={13} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setCallMode("log")}>
                <PhoneCall size={14} /> Log a call
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setCallMode("schedule")}>
                <CalendarClock size={14} /> Schedule a call
              </DropdownMenuItem>
              <DropdownMenuItem disabled={calling || !!callBlockedReason} onSelect={() => void placeCall()}>
                <PhoneOutgoing size={14} />
                <span className="lv-item">
                  {calling ? "Calling…" : "Have the voice agent call"}
                  {callBlockedReason && <small>{callBlockedReason}</small>}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {bookHref && sessionsToBook > 0 ? (
            <Link href={bookHref} className="lv-primary">
              <Button>
                <CalendarPlus size={15} /> Book a session
              </Button>
            </Link>
          ) : (
            <Button className="lv-primary" onClick={() => void draftIntoBox()} disabled={drafting || pending}>
              <Sparkles size={15} /> {drafting ? "Drafting…" : "Draft a message"}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="ld-more" aria-label="More actions">
                <MoreHorizontal size={17} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {messages.length > 0 && (
                <DropdownMenuItem asChild>
                  <Link href={`/communication?c=${encodeURIComponent(`lead-${lead.id}`)}`}>
                    <MessagesSquare size={14} /> Open in the inbox
                  </Link>
                </DropdownMenuItem>
              )}
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

      {lead.inboxOnly && (
        <div className="lv-inbox-only" role="status">
          <p>A conversation only, from the Inbox. Not on your pipeline, so no follow-ups go out and it is not in your lead figures.</p>
          <Button size="sm" onClick={addAsLead} loading={pending}>
            <UserPlus size={14} /> Add as lead
          </Button>
        </div>
      )}

      <div className="lv-grid">
        <section className="lv-feed" aria-label="Activity">
          <div className="lv-feed-head">
            <h2>Activity</h2>
            <div className="lv-filters" role="group" aria-label="Show">
              {(
                [
                  ["all", "Everything"],
                  ["messages", "Messages"],
                  ["calls", "Calls"],
                  ["purchases", "Purchases"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="lv-list" ref={listRef}>
            {feed.length === 0 && <p className="lv-none">Nothing here yet.</p>}
            {feed.map((day) => (
              <div key={day.day} className="lv-day">
                <div className="lv-day-label">{day.label}</div>
                {day.items.map((it) => {
                  if (it.type === "event") {
                    const e = it.event;
                    const Icon = EVENT_ICON[e.kind];
                    return (
                      <div key={e.key} className="lv-ev" data-kind={e.kind} data-failed={e.failed || undefined}>
                        <span className="lv-ev-ic" aria-hidden>
                          {e.failed ? <CircleAlert size={14} /> : <Icon size={14} />}
                        </span>
                        <div className="lv-ev-body">
                          <b>{e.title}</b>
                          {e.detail && <p>{e.detail}</p>}
                        </div>
                        <time className="lv-ev-t" dateTime={new Date(e.at).toISOString()}>
                          {formatTime(e.at)}
                        </time>
                      </div>
                    );
                  }
                  const entry = it.message;
                  if (entry.msg) return renderMessage(entry.msg);
                  return (
                    <div key="form-note" className="ld-msg" data-side="them">
                      <div className="ld-msg-meta">From the form · {formatTime(entry.at)}</div>
                      <div className="ld-bubble">{entry.formNote}</div>
                    </div>
                  );
                })}
              </div>
            ))}

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
          </div>

          <div className="lv-comp">
            <div className="lv-chans" role="group" aria-label="Send as">
              {channels.map((c) => (
                <button key={c} type="button" aria-pressed={channel === c} onClick={() => setChannel(c)}>
                  {c === "whatsapp" ? <MessageSquare size={13} /> : c === "email" ? <Mail size={13} /> : <StickyNote size={13} />}
                  {c === "whatsapp" ? "WhatsApp" : c === "email" ? "Email" : "Note for the team"}
                </button>
              ))}
            </div>
            {channel === "email" && (
              <div className="lv-subject">
                <label htmlFor={`lv-subject-${lead.id}`}>Subject</label>
                <Input id={`lv-subject-${lead.id}`} value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
              </div>
            )}
            <div className="lv-box at-dropzone" {...att.dropProps}>
              <DropHint att={att} />
              <label htmlFor={`lv-text-${lead.id}`} className="sr-only">
                {channel === "note" ? "Note for the team" : `Message to ${lead.firstName || fullName}`}
              </label>
              <textarea
                id={`lv-text-${lead.id}`}
                ref={boxRef}
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    sendFromBox();
                  }
                }}
                placeholder={channel === "note" ? "Only the team sees this" : `Write a message to ${lead.firstName || fullName}`}
              />
              <AttachmentTray att={att} />
              <div className="lv-box-foot">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <AttachButton att={att} disabled={pending} />
                  {channel !== "note" && (
                    <Button variant="ghost" size="sm" onClick={() => void draftIntoBox()} disabled={drafting || pending}>
                      <Sparkles size={13} /> {drafting ? "Drafting…" : text.trim() ? "Redraft with Adonis" : "Draft with Adonis"}
                    </Button>
                  )}
                </span>
                <Button size="sm" onClick={sendFromBox} loading={pending} disabled={!att.readyWith(text)}>
                  {channel === "note" ? "Save note" : "Send"} <Send size={13} />
                </Button>
              </div>
            </div>
          </div>
        </section>

        <div className="lv-side">
          {lead.clientId && (
            <Card className="ld-card lv-buy">
              <div className="lv-card-head">
                <CardLabel>Purchases</CardLabel>
                <Link href={`/clients/${lead.clientId}`}>Open client</Link>
              </div>
              {activity.paidEur != null && activity.paidEur > 0 && (
                <div className="lv-money">
                  <strong>{formatMoney(activity.paidEur)}</strong>
                  <span>
                    {purchaseCount} {purchaseCount === 1 ? "purchase" : "purchases"}
                    {sessionsToBook > 0 && `, ${sessionsToBook} ${sessionsToBook === 1 ? "session" : "sessions"} to book`}
                  </span>
                </div>
              )}
              {activity.purchases.length === 0 ? (
                <p className="ld-note">No packages. Their bookings and payments are on their client page.</p>
              ) : (
                <ul className="lv-pkgs">
                  {activity.purchases.map((p) => (
                    <li key={p.id}>
                      <div>
                        <b>{p.name}</b>
                        <small>
                          {formatMoney(p.pricePaidEur)} · use by {formatUseBy(p.expiryDate)}
                        </small>
                      </div>
                      <span className="lv-left" data-none={p.sessionsLeft <= 0 || undefined}>
                        {p.sessionsLeft > 0 ? `${p.sessionsLeft} left` : "Used"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {bookHref && sessionsToBook > 0 ? (
                <Link href={bookHref} className="lv-wide">
                  <Button variant="secondary">
                    <CalendarPlus size={14} /> Book a session
                  </Button>
                </Link>
              ) : (
                <Link href={`/clients/${lead.clientId}?tab=journey`} className="lv-link">
                  View their journey <ArrowRight size={13} />
                </Link>
              )}
            </Card>
          )}

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

          <LeadFollowUpsCard leadId={lead.id} assignedUserId={lead.assignedUserId} consentAt={lead.marketingConsentAt} staff={staff} flow={flow} calls={calls} />

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
                <dd title={arrival ?? undefined}>{arrivalShort ?? "Not recorded"}</dd>
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

          {extras}
        </div>
      </div>
      <CallDialog leadId={lead.id} leadName={fullName} open={callMode !== null} mode={callMode ?? "log"} onOpenChange={(o) => !o && setCallMode(null)} />
    </div>
  );
}

const EVENT_ICON: Record<ActivityEvent["kind"], typeof ShoppingBag> = {
  arrived: MousePointerClick,
  came_in: UserRound,
  purchase: ShoppingBag,
  stage: ArrowRight,
  call: PhoneCall,
  flow_message: Send,
};

const timeFmt = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit" });
function formatTime(at: Date | number | string): string {
  return timeFmt.format(new Date(at));
}

function formatMoney(eur: number): string {
  return `€${Number.isInteger(eur) ? eur : eur.toFixed(2)}`;
}

/** "2027-01-31" -> "31 Jan 2027". */
function formatUseBy(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : new Intl.DateTimeFormat("en-IE", { day: "numeric", month: "short", year: "numeric" }).format(d);
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
  gohighlevel: "GoHighLevel import",
};
