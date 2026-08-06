"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Sparkles, Send, Download, Loader2, Check, History, Plus, Trash2, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/Button";

type Artifact = { url: string; filename: string; label: string };
type Step = { label: string; done: boolean };
type PendingAction = { name: string; input: Record<string, unknown>; summary: string };
type Pending = { actions: PendingAction[]; status: "awaiting" | "approving" | "approved" | "cancelled" };
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  steps: Step[];
  artifacts: Artifact[];
  pending?: Pending | null;
};
type Conversation = { id: string; title: string; messages: ChatMessage[]; updatedAt: number };

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

const SUGGESTIONS = [
  "Give me a breakdown of everything important today",
  "Build a 3-day high-protein nutrition plan (~2000 kcal)",
  "Create a 4-day push/pull/legs workout program",
  "Pull all my invoices from the last 3 months into a download",
];

const TOOL_LABEL: Record<string, string> = {
  business_overview: "Reading business overview",
  list_recent_messages: "Scanning recent messages",
  search_messages: "Searching messages",
  list_invoices: "Finding invoices",
  bundle_invoices: "Bundling invoices",
  upload_invoices_to_drive: "Uploading to Google Drive",
  financial_summary: "Crunching the numbers",
  list_appointments: "Checking the diary",
  get_client: "Looking up client",
  create_calendar_event: "Adding to calendar",
  create_client: "Creating client",
  create_appointment: "Booking appointment",
  log_payment: "Logging payment",
  send_client_email: "Sending email",
  add_food: "Adding food",
  create_nutrition_plan: "Building nutrition plan",
  add_exercise: "Adding exercise",
  create_workout_program: "Building workout program",
  assign_nutrition_plan: "Assigning nutrition plan",
  assign_workout_program: "Assigning workout program",
  create_lead: "Adding lead",
  assign_membership: "Assigning membership",
  list_classes: "Checking the timetable",
  create_class: "Creating class",
  book_client_into_class: "Booking into class",
  update_client: "Updating client",
  cancel_appointment: "Cancelling appointment",
  reschedule_appointment: "Rescheduling appointment",
  cancel_class: "Cancelling class",
  cancel_booking: "Cancelling booking",
  cancel_membership: "Cancelling membership",
  assign_package: "Assigning package",
  create_form: "Building form",
};

export function AssistantChat({ tenantId, height }: { tenantId: number; height?: string }) {
  // Per-account chat HISTORY in localStorage (survives browser close). Each entry
  // is a saved conversation; "New chat" opens a fresh one and keeps the old ones.
  const storeKey = `cf_assistant_chats_v2_${tenantId}`;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastUserRef = useRef<HTMLDivElement | null>(null);
  const scrollPending = useRef(false);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  // Restore this account's history (survives navigation, reload + browser close).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { conversations?: Conversation[]; activeId?: string };
        const convs = Array.isArray(parsed.conversations) ? parsed.conversations : [];
        if (convs.length) {
          setConversations(convs);
          setActiveId(convs.some((c) => c.id === parsed.activeId) ? parsed.activeId! : convs[0].id);
          setLoaded(true);
          return;
        }
      }
    } catch {
      /* ignore */
    }
    const id = newId();
    setConversations([{ id, title: "New chat", messages: [], updatedAt: Date.now() }]);
    setActiveId(id);
    setLoaded(true);
  }, [storeKey]);

  // Persist (keep the 40 most-recent).
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storeKey, JSON.stringify({ conversations: conversations.slice(0, 40), activeId }));
    } catch {
      /* ignore */
    }
  }, [conversations, activeId, loaded, storeKey]);

  // After sending, bring the user's question to the TOP of the view so the reply
  // streams in below it and reads from the start (instead of pinning to bottom).
  useLayoutEffect(() => {
    if (!scrollPending.current) return;
    scrollPending.current = false;
    const el = lastUserRef.current;
    const container = scrollRef.current;
    if (el && container) {
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      container.scrollTop += eRect.top - cRect.top - 10;
    }
  }, [messages]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy || !activeId) return;
    setInput("");
    const convId = activeId; // pin updates to THIS chat, even if the user switches
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const nextUser: ChatMessage = { role: "user", content: q, steps: [], artifacts: [] };
    const assistant: ChatMessage = { role: "assistant", content: "", steps: [], artifacts: [], pending: null };
    scrollPending.current = true; // scroll this new question to the top on render
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              title: c.messages.length === 0 ? q.slice(0, 48) : c.title,
              messages: [...c.messages, nextUser, assistant],
              updatedAt: Date.now(),
            }
          : c,
      ),
    );
    setBusy(true);

    const patch = (fn: (m: ChatMessage) => ChatMessage) =>
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          const msgs = [...c.messages];
          msgs[msgs.length - 1] = fn(msgs[msgs.length - 1]);
          return { ...c, messages: msgs, updatedAt: Date.now() };
        }),
      );

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...history, { role: "user", content: q }] }),
      });
      if (!res.ok || !res.body) {
        patch((m) => ({ ...m, content: `Sorry — the assistant is unavailable (${res.status}).` }));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, idx).replace(/^data: /, "");
          buf = buf.slice(idx + 2);
          if (!raw) continue;
          let evt: { type: string; text?: string; name?: string; error?: string; actions?: PendingAction[] } & Partial<Artifact>;
          try {
            evt = JSON.parse(raw);
          } catch {
            continue;
          }
          if (evt.type === "confirm" && evt.actions?.length) {
            // The assistant proposed one or more WRITE actions. Nothing has run —
            // show an Approve/Cancel card; execution happens only on approve.
            const actions = evt.actions;
            patch((m) => ({
              ...m,
              steps: m.steps.map((s) => ({ ...s, done: true })),
              pending: { actions, status: "awaiting" },
            }));
          } else if (evt.type === "text" && evt.text) {
            // First token means tool work is done → mark all steps complete.
            patch((m) => ({
              ...m,
              content: m.content + evt.text,
              steps: m.steps.some((s) => !s.done) ? m.steps.map((s) => ({ ...s, done: true })) : m.steps,
            }));
          } else if (evt.type === "tool" && evt.name) {
            const label = TOOL_LABEL[evt.name] ?? evt.name;
            patch((m) =>
              m.steps.some((s) => s.label === label)
                ? m
                : { ...m, steps: [...m.steps.map((s) => ({ ...s, done: true })), { label, done: false }] },
            );
          } else if (evt.type === "artifact" && evt.url && evt.filename && evt.label) {
            const art = { url: evt.url, filename: evt.filename, label: evt.label };
            patch((m) => ({ ...m, artifacts: [...m.artifacts, art] }));
          } else if (evt.type === "error") {
            patch((m) => ({ ...m, content: m.content + `\n\n_Error: ${evt.error}_` }));
          } else if (evt.type === "done") {
            patch((m) => ({ ...m, steps: m.steps.map((s) => ({ ...s, done: true })) }));
          }
        }
      }
    } catch {
      patch((m) => ({ ...m, content: m.content || "Sorry — something went wrong reaching the assistant." }));
    } finally {
      setBusy(false);
    }
  }

  function patchAt(convId: string, index: number, fn: (m: ChatMessage) => ChatMessage) {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        const msgs = [...c.messages];
        if (!msgs[index]) return c;
        msgs[index] = fn(msgs[index]);
        return { ...c, messages: msgs, updatedAt: Date.now() };
      }),
    );
  }

  async function approve(convId: string, index: number, actions: PendingAction[]) {
    patchAt(convId, index, (m) => (m.pending ? { ...m, pending: { ...m.pending, status: "approving" } } : m));
    try {
      const res = await fetch("/api/assistant/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actions: actions.map((a) => ({ name: a.name, input: a.input })) }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; results?: { name: string; ok: boolean; text: string; artifact?: Artifact }[]; error?: string }
        | null;
      if (!res.ok || !data?.ok || !data.results) {
        patchAt(convId, index, (m) => ({
          ...m,
          content: m.content + `\n\n_Couldn't complete that (${data?.error ?? res.status})._`,
          pending: m.pending ? { ...m.pending, status: "cancelled" } : m.pending,
        }));
        return;
      }
      const lines = data.results.map((r) => (r.ok ? `✓ ${r.text}` : `⚠️ ${r.text}`)).join("\n\n");
      const arts = data.results.flatMap((r) => (r.artifact ? [r.artifact] : []));
      patchAt(convId, index, (m) => ({
        ...m,
        content: m.content + (m.content ? "\n\n" : "") + lines,
        artifacts: [...m.artifacts, ...arts],
        pending: m.pending ? { ...m.pending, status: "approved" } : m.pending,
      }));
    } catch {
      patchAt(convId, index, (m) => ({
        ...m,
        content: m.content + "\n\n_Something went wrong running that._",
        pending: m.pending ? { ...m.pending, status: "cancelled" } : m.pending,
      }));
    }
  }

  function cancelPending(convId: string, index: number) {
    patchAt(convId, index, (m) => ({
      ...m,
      content: m.content + (m.content ? "\n\n" : "") + "_Cancelled — nothing was changed._",
      pending: m.pending ? { ...m.pending, status: "cancelled" } : m.pending,
    }));
  }

  function newChat() {
    if (busy) return;
    setHistoryOpen(false);
    if (active && active.messages.length === 0) return; // already a fresh chat
    const id = newId();
    setConversations((prev) => [{ id, title: "New chat", messages: [], updatedAt: Date.now() }, ...prev]);
    setActiveId(id);
  }
  function openChat(id: string) {
    setActiveId(id);
    setHistoryOpen(false);
  }
  function deleteChat(id: string) {
    const next = conversations.filter((c) => c.id !== id);
    if (next.length === 0) {
      const nid = newId();
      setConversations([{ id: nid, title: "New chat", messages: [], updatedAt: Date.now() }]);
      setActiveId(nid);
    } else {
      setConversations(next);
      if (id === activeId) setActiveId(next[0].id);
    }
  }
  const historyList = [...conversations]
    .filter((c) => c.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const empty = messages.length === 0;
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { lastUserIdx = i; break; }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: height ?? "72vh",
        minHeight: 420,
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        background: "var(--surface-1)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--hairline)", display: "flex", alignItems: "center", gap: 8 }}>
        <Sparkles size={16} strokeWidth={1.75} style={{ color: "var(--accent)" }} />
        <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>Assistant</strong>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }} className="ai-subtitle">knows your emails, WhatsApp, clients & money</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 2, position: "relative" }}>
          <Button variant="ghost" size="sm" onClick={() => setHistoryOpen((v) => !v)}>
            <History size={14} /> History{historyList.length ? ` (${historyList.length})` : ""}
          </Button>
          <Button variant="ghost" size="sm" onClick={newChat} disabled={busy}>
            <Plus size={14} /> New chat
          </Button>
          {historyOpen && (
            <>
              <div onClick={() => setHistoryOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  zIndex: 41,
                  width: 300,
                  maxHeight: 360,
                  overflowY: "auto",
                  background: "var(--surface-1)",
                  border: "1px solid var(--hairline)",
                  borderRadius: "var(--radius)",
                  boxShadow: "0 12px 32px -8px rgba(0,0,0,0.5)",
                  padding: 6,
                }}
              >
                {historyList.length === 0 ? (
                  <div style={{ padding: 14, fontSize: 13, color: "var(--text-tertiary)", textAlign: "center" }}>
                    No saved chats yet.
                  </div>
                ) : (
                  historyList.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => openChat(c.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 10px",
                        borderRadius: 8,
                        cursor: "pointer",
                        background: c.id === activeId ? "var(--surface-2)" : "transparent",
                      }}
                    >
                      <MessageSquare size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.title || "Untitled"}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{ago(c.updatedAt)}</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}
                        title="Delete chat"
                        style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 2, flexShrink: 0, display: "inline-flex" }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {empty ? (
          <div style={{ margin: "auto", textAlign: "center", maxWidth: 460 }}>
            <Sparkles size={26} strokeWidth={1.5} style={{ color: "var(--accent)", marginBottom: 10 }} />
            <div style={{ fontSize: 15, color: "var(--text-primary)", fontWeight: 600, marginBottom: 6 }}>
              Ask me anything about your business
            </div>
            <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginBottom: 18, lineHeight: 1.5 }}>
              I can read your inbox and WhatsApp, summarise what matters, check your income, and bundle invoices for download.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  style={{
                    textAlign: "left",
                    padding: "10px 14px",
                    border: "1px solid var(--hairline)",
                    borderRadius: "var(--radius)",
                    background: "var(--surface-2)",
                    color: "var(--text-secondary)",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} ref={i === lastUserIdx ? lastUserRef : undefined}>
              <MessageBubble
                m={m}
                streaming={busy && i === messages.length - 1}
                onApprove={() => m.pending && approve(activeId, i, m.pending.actions)}
                onCancel={() => cancelPending(activeId, i)}
              />
            </div>
          ))
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--hairline)", padding: 12, display: "flex", gap: 8 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={1}
          placeholder="Ask your assistant…  (Enter to send)"
          disabled={busy}
          style={{
            flex: 1,
            resize: "none",
            background: "var(--bg)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius)",
            padding: "10px 14px",
            color: "var(--text-primary)",
            fontSize: 14,
            fontFamily: "inherit",
            lineHeight: 1.5,
            maxHeight: 140,
            outline: "none",
          }}
        />
        <Button onClick={() => send(input)} disabled={busy || !input.trim()}>
          {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} strokeWidth={2} />}
        </Button>
      </div>
    </div>
  );
}

function MessageBubble({
  m,
  streaming,
  onApprove,
  onCancel,
}: {
  m: ChatMessage;
  streaming: boolean;
  onApprove?: () => void;
  onCancel?: () => void;
}) {
  const isUser = m.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: isUser ? "80%" : "92%",
          // Long unspaced URLs (Drive/artifact links) must wrap, not scroll the page.
          overflowWrap: "anywhere",
          background: isUser ? "var(--accent)" : "var(--surface-2)",
          // Dark ink on the accent fill — matches primary buttons, reads on every
          // theme (the theme's --accent-ink is white-on-bg, wrong for this).
          color: isUser ? "#1a0a03" : "var(--text-primary)",
          border: isUser ? "none" : "1px solid var(--hairline)",
          borderRadius: 14,
          padding: "10px 14px",
          fontSize: 14,
          lineHeight: 1.55,
        }}
      >
        {!isUser && (m.steps.length > 0 || (streaming && !m.content)) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: m.content ? 10 : 0 }}>
            {/* Live status line while nothing has been decided/typed yet */}
            {streaming && m.steps.length === 0 && !m.content && (
              <span style={{ display: "inline-flex", alignItems: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
                <span className="ai-dot" style={{ animationDelay: "0s" }} />
                <span className="ai-dot" style={{ animationDelay: "0.2s" }} />
                <span className="ai-dot" style={{ animationDelay: "0.4s" }} />
                <span style={{ marginLeft: 4 }}>Thinking…</span>
              </span>
            )}
            {m.steps.map((s) => {
              const active = !s.done && streaming;
              return (
                <span
                  key={s.label}
                  style={{
                    fontSize: 12,
                    color: active ? "var(--accent)" : "var(--text-tertiary)",
                    border: `1px solid ${active ? "var(--accent)" : "var(--hairline)"}`,
                    borderRadius: 20,
                    padding: "3px 11px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    alignSelf: "flex-start",
                  }}
                >
                  {active ? (
                    <Loader2 size={12} className="spin" />
                  ) : (
                    <Check size={12} style={{ color: "var(--text-tertiary)" }} />
                  )}
                  {s.label}
                  {active ? "…" : ""}
                </span>
              );
            })}
            {/* Slim shimmer while a tool is running */}
            {streaming && m.steps.some((s) => !s.done) && <div className="ai-shimmer" />}
          </div>
        )}
        {m.content && (
          <RichText text={m.content} />
        )}
        {streaming && m.content && <span className="ai-caret" aria-hidden />}
        {m.pending && (m.pending.status === "awaiting" || m.pending.status === "approving") && (
          <div style={{ marginTop: 12, border: "1px solid var(--hairline)", borderRadius: "var(--radius)", background: "var(--surface-1)", padding: 12 }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace", marginBottom: 9 }}>
              {m.pending.actions.length > 1 ? `Approve ${m.pending.actions.length} actions?` : "Approve this action?"}
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px", display: "flex", flexDirection: "column", gap: 7 }}>
              {m.pending.actions.map((a, idx) => (
                <li key={idx} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "var(--text-primary)" }}>
                  <span style={{ color: "var(--accent)", flexShrink: 0 }} aria-hidden>→</span>
                  <span>{a.summary}</span>
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="ghost" size="sm" onClick={onCancel} disabled={m.pending.status === "approving"}>
                Cancel
              </Button>
              <Button size="sm" onClick={onApprove} loading={m.pending.status === "approving"}>
                Approve
              </Button>
            </div>
          </div>
        )}
        {m.artifacts.map((a) => (
          <a key={a.url} href={a.url} download={a.filename} style={{ textDecoration: "none" }}>
            <div
              style={{
                marginTop: 10,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "var(--surface-1)",
                border: "1px solid var(--accent)",
                borderRadius: "var(--radius)",
                padding: "8px 14px",
                color: "var(--accent)",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <Download size={15} /> {a.label}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

const URL_RE = /(https?:\/\/[^\s)]+)/g;
function inline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let k = 0;
  const pushText = (s: string) => {
    for (const seg of s.split(/(\*\*[^*]+\*\*)/g)) {
      if (!seg) continue;
      if (/^\*\*[^*]+\*\*$/.test(seg)) nodes.push(<strong key={`${keyBase}-${k++}`}>{seg.slice(2, -2)}</strong>);
      else nodes.push(<span key={`${keyBase}-${k++}`}>{seg}</span>);
    }
  };
  let idx = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    pushText(text.slice(idx, m.index));
    nodes.push(
      <a key={`${keyBase}-l${k++}`} href={m[0]} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
        {m[0]}
      </a>,
    );
    idx = m.index + m[0].length;
  }
  pushText(text.slice(idx));
  return nodes;
}

/** Lightweight markdown-ish renderer (bold, bullets, headings, links). */
function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {lines.map((ln, i) => {
        const t = ln.trimStart();
        if (t === "") return <div key={i} style={{ height: 6 }} />;
        const h = t.match(/^#{1,3}\s+(.*)/);
        if (h) return <div key={i} style={{ fontWeight: 700, marginTop: 4 }}>{inline(h[1], `h${i}`)}</div>;
        if (t.startsWith("- ") || t.startsWith("* ")) {
          return (
            <div key={i} style={{ display: "flex", gap: 8 }}>
              <span style={{ color: "var(--text-tertiary)" }}>•</span>
              <span>{inline(t.slice(2), `b${i}`)}</span>
            </div>
          );
        }
        return <div key={i}>{inline(ln, `p${i}`)}</div>;
      })}
    </div>
  );
}
