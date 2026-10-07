"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Send, Sparkles, Reply } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { draftEmailReplyAction, loadEmailThreadAction, replyEmailAction } from "@/app/communication/actions";
import type { EmailMessageRow } from "@/lib/gmail";
import { cleanSnippet, decodeEntities, displaySender } from "@/lib/inbox/emailDisplay";
import { InboxAvatar } from "./ContactCard";
import { fullTime } from "./format";

/**
 * An email thread in the reading pane. Older messages fold to one line (the
 * latest, and anything unread, stay open), the reply box sits at the bottom,
 * and Adonis can write a first draft into it. Nothing sends without the Send
 * button.
 */
export function EmailReader({
  threadId,
  expectReply,
  onLoaded,
  focusReplyToken,
}: {
  threadId: string;
  /** People mail opens with the reply box ready; notifications keep it folded. */
  expectReply: boolean;
  onLoaded: () => void;
  /** Bumped by the "r" shortcut. */
  focusReplyToken: number;
}) {
  const [messages, setMessages] = useState<EmailMessageRow[] | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [composing, setComposing] = useState(expectReply);
  const [reply, setReply] = useState("");
  const [sending, startSend] = useTransition();
  const [drafting, startDraft] = useTransition();
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  async function load() {
    const res = await loadEmailThreadAction(threadId);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setMessages(res.messages);
    const keep = new Set<number>();
    res.messages.forEach((m, i) => {
      if (i === res.messages.length - 1 || (m.direction === "in" && !m.isRead)) keep.add(m.id);
    });
    setOpen(keep);
    onLoaded();
  }

  useEffect(() => {
    setMessages(null);
    setReply("");
    setComposing(expectReply);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    if (!focusReplyToken) return;
    setComposing(true);
    requestAnimationFrame(() => replyRef.current?.focus());
  }, [focusReplyToken]);

  // Land on the newest message.
  useEffect(() => {
    const el = scroller.current;
    if (el && messages) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const last = messages?.[messages.length - 1];
  const replyTo = last ? (last.direction === "in" ? displaySender(last.fromName, last.fromEmail).email : last.toEmail) : null;
  const subject = decodeEntities(last?.subject ?? "") || "(no subject)";

  function send() {
    if (!last || !reply.trim()) return;
    startSend(async () => {
      const res = await replyEmailAction(last.id, reply);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Reply sent");
      setReply("");
      await load();
    });
  }

  function draft() {
    startDraft(async () => {
      const res = await draftEmailReplyAction(threadId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setComposing(true);
      setReply(res.text);
      requestAnimationFrame(() => replyRef.current?.focus());
    });
  }

  return (
    <div className="inbox-reader-body">
      <div className="inbox-reader-scroll" ref={scroller}>
        <h2 className="inbox-subject">{subject}</h2>
        {!messages ? (
          <div style={{ display: "grid", gap: 10, marginTop: 18 }} aria-hidden>
            <div className="skeleton" style={{ height: 54, borderRadius: 12 }} />
            <div className="skeleton" style={{ height: 180, borderRadius: 12 }} />
          </div>
        ) : (
          <div className="inbox-thread">
            {messages.map((m) => (
              <EmailMessage
                key={m.id}
                m={m}
                expanded={open.has(m.id)}
                onToggle={() =>
                  setOpen((s) => {
                    const n = new Set(s);
                    if (n.has(m.id)) n.delete(m.id);
                    else n.add(m.id);
                    return n;
                  })
                }
              />
            ))}
          </div>
        )}
      </div>

      <div className="inbox-composer">
        {composing ? (
          <>
            <div className="inbox-composer-to">
              To <strong>{replyTo ?? "..."}</strong>
            </div>
            <Textarea
              ref={replyRef}
              rows={4}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Write a reply"
              disabled={sending || !messages}
              style={{ resize: "vertical", minHeight: 96 }}
            />
            <div className="inbox-composer-actions">
              <Button variant="outline" size="sm" onClick={draft} loading={drafting} disabled={!messages || sending}>
                <Sparkles size={14} /> {reply.trim() ? "Redraft with Adonis" : "Draft with Adonis"}
              </Button>
              <span className="inbox-composer-hint">Cmd + Enter to send</span>
              <Button size="sm" onClick={send} loading={sending} disabled={!reply.trim() || !messages}>
                <Send size={14} /> Send
              </Button>
            </div>
          </>
        ) : (
          <div className="inbox-composer-actions">
            <Button variant="outline" size="sm" onClick={() => setComposing(true)} disabled={!messages}>
              <Reply size={14} /> Reply
            </Button>
            <Button variant="ghost" size="sm" onClick={draft} loading={drafting} disabled={!messages}>
              <Sparkles size={14} /> Draft with Adonis
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function EmailMessage({ m, expanded, onToggle }: { m: EmailMessageRow; expanded: boolean; onToggle: () => void }) {
  const out = m.direction === "out";
  const from = out ? { name: "You", email: m.toEmail ?? "" } : displaySender(m.fromName, m.fromEmail);
  return (
    <article className={`inbox-msg${expanded ? " is-open" : ""}`}>
      <button type="button" className="inbox-msg-head" onClick={onToggle} aria-expanded={expanded}>
        <InboxAvatar name={out ? "You" : from.name} size={30} />
        <span className="inbox-msg-from">
          <strong>{from.name}</strong>
          <span>{out ? `to ${m.toEmail ?? ""}` : from.email}</span>
        </span>
        <span className="inbox-msg-time">{fullTime(m.internalDate)}</span>
      </button>
      {expanded ? (
        <MessageBody html={m.bodyHtml} text={m.bodyText} snippet={m.snippet} />
      ) : (
        <div className="inbox-msg-snippet">{cleanSnippet(m.snippet ?? "")}</div>
      )}
    </article>
  );
}

/** Force every link in the email to open in a new browser tab (via <base>). */
function withNewTabLinks(html: string): string {
  const base = '<base target="_blank">';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (x) => x + base);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (x) => `${x}<head>${base}</head>`);
  return `<head>${base}</head>${html}`;
}

function MessageBody({ html, text, snippet }: { html: string | null; text: string | null; snippet: string | null }) {
  // Real email HTML in a sandboxed iframe (no scripts run, safe against
  // tracking/XSS) on white, since emails are written for a light background.
  // allow-popups* + <base target="_blank"> open links in a real new tab.
  if (html) {
    return (
      <div className="inbox-msg-html">
        <iframe
          title="Email body"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={withNewTabLinks(html)}
          style={{ width: "100%", border: "none", display: "block", minHeight: 120 }}
          onLoad={(e) => {
            try {
              const doc = e.currentTarget.contentDocument;
              if (doc?.body) e.currentTarget.style.height = `${doc.body.scrollHeight + 24}px`;
            } catch {
              /* leave min-height */
            }
          }}
        />
      </div>
    );
  }
  return <div className="inbox-msg-text">{decodeEntities(text || snippet || "(no content)")}</div>;
}
