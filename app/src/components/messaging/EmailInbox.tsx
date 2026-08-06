"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { RefreshCw, CornerUpLeft, Send, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  loadEmailThreadAction,
  refreshInboxAction,
  replyEmailAction,
} from "@/app/communication/actions";
import type { EmailMessageRow } from "@/lib/gmail";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmt(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}

export function EmailInbox({
  threads,
  connectedEmail,
}: {
  threads: EmailMessageRow[];
  connectedEmail: string;
}) {
  const [refreshing, startRefresh] = useTransition();
  const [openThread, setOpenThread] = useState<{
    id: string;
    subject: string;
    messages: EmailMessageRow[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  function refresh() {
    startRefresh(async () => {
      const res = await refreshInboxAction();
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(res.synced > 0 ? `Synced ${res.synced} new message${res.synced === 1 ? "" : "s"}` : "Up to date");
    });
  }

  async function open(t: EmailMessageRow) {
    if (!t.gmailThreadId) return;
    setLoading(true);
    const res = await loadEmailThreadAction(t.gmailThreadId);
    setLoading(false);
    if (!res.ok) { toast.error(res.error); return; }
    setOpenThread({ id: t.gmailThreadId, subject: t.subject || "(no subject)", messages: res.messages });
  }

  async function reloadOpen() {
    if (!openThread) return;
    const res = await loadEmailThreadAction(openThread.id);
    if (res.ok) setOpenThread({ ...openThread, messages: res.messages });
  }

  if (openThread) {
    return (
      <ThreadView
        subject={openThread.subject}
        messages={openThread.messages}
        onBack={() => setOpenThread(null)}
        onReplied={reloadOpen}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          Inbox for <strong style={{ color: "var(--text-secondary)" }}>{connectedEmail}</strong>
        </span>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing} style={{ marginLeft: "auto" }}>
          <RefreshCw size={14} strokeWidth={1.75} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {threads.length === 0 ? (
        <Card style={{ padding: 20, color: "var(--text-tertiary)", fontSize: 14 }}>
          No emails yet. Click Refresh to pull your latest Gmail messages.
        </Card>
      ) : (
        threads.map((m) => (
          <ThreadRow key={m.id} m={m} onOpen={() => open(m)} loading={loading} />
        ))
      )}
    </div>
  );
}

function ThreadRow({
  m,
  onOpen,
  loading,
}: {
  m: EmailMessageRow;
  onOpen: () => void;
  loading: boolean;
}) {
  const unread = m.direction === "in" && !m.isRead;
  const who =
    m.direction === "in"
      ? m.fromName || m.fromEmail || "Unknown"
      : `To: ${m.toEmail ?? ""}`;

  return (
    <Card
      onClick={loading ? undefined : onOpen}
      style={{ padding: 16, cursor: loading ? "default" : "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {unread && (
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
        )}
        <strong style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: unread ? 700 : 500 }}>
          {who}
        </strong>
        {m.direction === "out" && (
          <span style={{ fontSize: 11, color: "var(--text-tertiary)", border: "1px solid var(--hairline)", borderRadius: 4, padding: "1px 6px" }}>
            Sent
          </span>
        )}
        {m.clientId && (
          <Link href={`/clients/${m.clientId}`} onClick={(e) => e.stopPropagation()} style={{ fontSize: 12, color: "var(--accent)" }}>
            View client
          </Link>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-tertiary)" }}>
          {fmt(m.internalDate)}
        </span>
      </div>
      <div style={{ marginTop: 4, fontSize: 14, color: "var(--text-secondary)", fontWeight: unread ? 600 : 400 }}>
        {m.subject || "(no subject)"}
      </div>
      <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {m.snippet}
      </div>
    </Card>
  );
}

function ThreadView({
  subject,
  messages,
  onBack,
  onReplied,
}: {
  subject: string;
  messages: EmailMessageRow[];
  onBack: () => void;
  onReplied: () => void;
}) {
  const [reply, setReply] = useState("");
  const [pending, start] = useTransition();
  const last = messages[messages.length - 1];

  function send() {
    if (!reply.trim()) { toast.error("Write a reply first."); return; }
    if (!last) return;
    start(async () => {
      const res = await replyEmailAction(last.id, reply);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Reply sent");
      setReply("");
      onReplied();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.75} /> Inbox
        </Button>
        <strong style={{ fontSize: 16, color: "var(--text-primary)" }}>{subject}</strong>
      </div>

      {messages.map((m) => <MessageCard key={m.id} m={m} />)}

      {/* Reply composer */}
      <Card style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          Reply to <strong style={{ color: "var(--text-secondary)" }}>
            {last?.direction === "in" ? last?.fromEmail : last?.toEmail}
          </strong>
        </div>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={5}
          placeholder="Write your reply…"
          disabled={pending}
          style={{
            width: "100%",
            background: "var(--bg)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius)",
            padding: "10px 14px",
            color: "var(--text-primary)",
            fontSize: 14,
            fontFamily: "inherit",
            lineHeight: 1.55,
            resize: "vertical",
            outline: "none",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button size="sm" onClick={send} disabled={pending}>
            <Send size={14} strokeWidth={2} />
            {pending ? "Sending…" : "Send reply"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function MessageCard({ m }: { m: EmailMessageRow }) {
  const isOut = m.direction === "out";
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--hairline)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          background: isOut ? "var(--surface-2)" : "transparent",
        }}
      >
        <CornerUpLeft
          size={13}
          strokeWidth={1.75}
          style={{ color: "var(--text-tertiary)", transform: isOut ? "scaleX(-1)" : "none" }}
        />
        <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>
          {isOut ? "You" : m.fromName || m.fromEmail}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          {isOut ? `to ${m.toEmail ?? ""}` : m.fromEmail}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-tertiary)" }}>
          {fmt(m.internalDate)}
        </span>
      </div>
      <MessageBody html={m.bodyHtml} text={m.bodyText} snippet={m.snippet} />
    </Card>
  );
}

/** Force every link in the email to open in a new browser tab (via <base>). */
function withNewTabLinks(html: string): string {
  const base = '<base target="_blank">';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + base);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${base}</head>`);
  return `<head>${base}</head>${html}`;
}

function MessageBody({
  html,
  text,
  snippet,
}: {
  html: string | null;
  text: string | null;
  snippet: string | null;
}) {
  // Render the real email HTML inside a sandboxed iframe (no scripts run — safe
  // against tracking/XSS) on a white surface, since emails assume a light bg.
  // `allow-popups*` + a <base target="_blank"> make links open in a real new tab
  // instead of navigating inside the frame (which broke on relative links).
  if (html) {
    return (
      <div style={{ background: "#ffffff", padding: 4 }}>
        <iframe
          title="Email body"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={withNewTabLinks(html)}
          style={{ width: "100%", border: "none", display: "block", minHeight: 120 }}
          onLoad={(e) => {
            try {
              const doc = e.currentTarget.contentDocument;
              if (doc?.body) {
                e.currentTarget.style.height = `${doc.body.scrollHeight + 24}px`;
              }
            } catch {
              // cross-origin (shouldn't happen with srcDoc) — leave min-height
            }
          }}
        />
      </div>
    );
  }
  return (
    <div style={{ padding: "14px 16px", fontSize: 14, color: "var(--text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
      {text || snippet || "(no content)"}
    </div>
  );
}
