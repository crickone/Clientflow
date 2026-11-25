"use client";

import "./chat.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, History, Plus } from "lucide-react";
import { toast } from "sonner";

import type { ConversationSummary, ConversationView } from "@/lib/agents/conversationModel";
import type { TodayCounts } from "@/lib/adonis/todayModel";
import { deriveCampaignProgress } from "@/components/messaging/campaignProgress";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { campaignAction } from "./approvalModel";
import { CampaignChecklist } from "./CampaignChecklist";
import { Composer, type ComposerAttachment } from "./Composer";
import { EmptyState } from "./EmptyState";
import { Exchange, type ExchangeActions } from "./Exchange";
import { HistoryDrawer } from "./HistoryDrawer";
import { groupExchanges } from "./exchanges";
import { keyboardInset } from "./scrollModel";
import { useChatScroll } from "./useChatScroll";
import { useConversationLive } from "./useConversationLive";

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

const blankView = (id: string): ConversationView => ({
  id,
  title: "New chat",
  updatedAt: Date.now(),
  running: false,
  messages: [],
  campaignEvents: [],
  building: false,
  stopRequested: false,
});

export type AdonisChatProps = {
  tenantId: number;
  /** The agent's registry key; its chats live under /api/agents/<key>/conversations. */
  agentKey?: string;
  /** Approvals run writes and are admin-only. */
  isAdmin: boolean;
  firstName: string | null;
  businessName: string;
  suggestions: string[];
  /** Server-computed (transcribeConfigured). */
  voiceEnabled: boolean;
  /** A starter for the compose box (a "Build campaign" link): fills an empty box once, starts a fresh chat, never sends itself. */
  initialInput?: string;
  /** The model chip (ModelPicker) for the composer. */
  modelChip?: ReactNode;
  /** Extra controls at the right of the top bar (the settings gear). */
  headerEnd?: ReactNode;
};

/**
 * The /adonis chat: state and layout. Conversations live on the server
 * (lib/agents/conversation.ts), which runs every turn and carries on with the
 * page closed; this component sends what the operator does and shows the
 * conversation as it changes (useConversationLive: the live stream while a
 * run goes, polling otherwise).
 */
export function AdonisChat({
  tenantId,
  agentKey = "orchestrator",
  isAdmin,
  firstName,
  businessName,
  suggestions,
  voiceEnabled,
  initialInput,
  modelChip,
  headerEnd,
}: AdonisChatProps) {
  const base = `/api/agents/${agentKey}/conversations`;
  // Where an older build of this page kept chats in the browser; moved to the server once, below.
  const legacyKey = `cf_assistant_chats_v2_${tenantId}_${`/api/agents/${agentKey}/chat`.replace(/[^a-zA-Z0-9]+/g, "-")}`;
  const openKey = `adonis_open_${tenantId}_${agentKey}`;
  const confirm = useConfirm();
  const rootRef = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState("");
  const [freshId, setFreshId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [today, setToday] = useState<TodayCounts | null>(null);
  const initialInputApplied = useRef(false);
  // The conversation the view was last opened at the bottom of: opening a chat lands on its latest exchange, once.
  const openedAt = useRef<string | null>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  // POSTs in flight. The live hook is held (no poll overwrites) until the last one answers.
  const inFlight = useRef(0);
  // Conversations this page drew itself before the server answered; a refusal takes back only one of these.
  const optimisticViews = useRef(new WeakSet<ConversationView>());

  const fetchList = useCallback(async (): Promise<ConversationSummary[]> => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (!res.ok) return [];
      const data = (await res.json()) as { conversations?: ConversationSummary[] };
      const next = data.conversations ?? [];
      setList(next);
      return next;
    } catch {
      return [];
    }
  }, [base]);

  const live = useConversationLive({ base, id: activeId, enabled: loaded, tenantId, onSettled: () => void fetchList() });
  const { conv, setConv, holdRef, wake } = live;
  const convRef = useRef(conv);
  convRef.current = conv;
  // `running` comes from the server's conversation only (the stream's last state says false before it ends),
  // so a settled chat with an Approve card waiting is never busy because of an old flag.
  const running = Boolean(conv?.running);
  const busy = sending || running;
  const exchanges = useMemo(() => groupExchanges(conv?.messages ?? []), [conv?.messages]);
  const known = conv !== null || live.settledId === activeId || freshId === activeId;
  const empty = loaded && known && exchanges.length === 0;
  const chatting = known && exchanges.length > 0;
  const scroll = useChatScroll(chatting);
  const { toLatest, pinNext } = scroll;

  // First load: move any browser-kept chats to the server (once), then open
  // the chat this device had open last, or the newest. A starter (New
  // campaign) begins a fresh chat.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = localStorage.getItem(legacyKey);
        if (raw && !localStorage.getItem(`${legacyKey}_moved`)) {
          const parsed = JSON.parse(raw) as { conversations?: unknown[] };
          const res = await fetch(base, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversations: parsed.conversations ?? [] }),
          });
          if (res.ok) localStorage.setItem(`${legacyKey}_moved`, "1");
        }
      } catch {
        /* the old history stays in the browser; tried again next load */
      }
      const summaries = await fetchList();
      if (cancelled) return;
      let last: string | null = null;
      try {
        last = localStorage.getItem(openKey);
      } catch {
        /* storage blocked */
      }
      const pick = initialInput ? undefined : (summaries.find((s) => s.id === last) ?? summaries[0]);
      if (pick) {
        setActiveId(pick.id);
      } else {
        const id = newId();
        setFreshId(id);
        setActiveId(id);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, legacyKey, openKey]);

  // Remember which chat this device has open.
  useEffect(() => {
    if (!loaded || !activeId) return;
    try {
      localStorage.setItem(openKey, activeId);
    } catch {
      /* storage blocked */
    }
  }, [loaded, activeId, openKey]);

  // A "Build campaign" starter fills an empty compose box, once.
  useEffect(() => {
    if (!loaded || initialInputApplied.current || !initialInput) return;
    initialInputApplied.current = true;
    setInput((cur) => cur || initialInput);
  }, [loaded, initialInput]);

  // Opening a chat lands on its latest exchange, once; polling and streaming never move the view after that.
  // A layout effect, so the first paint is already at the latest exchange and not at the top.
  useLayoutEffect(() => {
    if (!conv || conv.messages.length === 0 || openedAt.current === conv.id) return;
    openedAt.current = conv.id;
    toLatest("auto");
  }, [conv, toLatest]);

  // "Needs you today", read when the opening screen shows.
  useEffect(() => {
    if (!empty) return;
    let off = false;
    fetch("/api/adonis/today", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; today?: TodayCounts } | null) => {
        if (!off && j?.ok && j.today) setToday(j.today);
      })
      .catch(() => {
        /* the panel stays hidden */
      });
    return () => {
      off = true;
    };
  }, [empty]);

  // Keep the composer above the on-screen keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    const root = rootRef.current;
    if (!vv || !root) return;
    const update = () => root.style.setProperty("--ax-kb", `${keyboardInset(window.innerHeight, vv.height, vv.offsetTop)}px`);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // A fresh list when the drawer opens (running tags, titles).
  useEffect(() => {
    if (historyOpen) void fetchList();
  }, [historyOpen, fetchList]);

  /**
   * An attachment is uploaded to the media library the moment it is picked,
   * so Adonis is handed an id it can act on (place that photograph, read that
   * document). The message names each file and its id on a line of its own.
   */
  async function attachFiles(files: File[]) {
    setAttaching(true);
    try {
      const form = new FormData();
      for (const f of files) form.append("file", f);
      const res = await fetch("/api/content-studio/image-library", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; assets?: { id: number; originalName: string; kind: string }[] };
      if (!res.ok || !json.ok || !json.assets) {
        toast.error(json.error || "Could not attach that file.");
        return;
      }
      const added = json.assets.map((a) => ({ id: a.id, name: a.originalName, kind: a.kind }));
      setAttachments((prev) => [...prev, ...added]);
    } catch {
      toast.error("Could not attach that file.");
    } finally {
      setAttaching(false);
    }
  }

  /**
   * Tell the server what the operator did. `optimistic` shows it at once; the
   * server's answer replaces it, or it is taken back if the server refused.
   * The live hook is held while the POST is out (useConversationLive
   * contract), then woken to fetch or stream what happens next.
   *
   * `fromLive`: the run is going and the stream (or the poll) brings the
   * result, so the answer is not drawn. A Stop's answer is a snapshot from
   * when it was asked; drawn over the stream, it would drop the words that
   * arrived since.
   */
  async function post(
    body: Record<string, unknown>,
    optimistic?: (c: ConversationView) => ConversationView,
    { fromLive = false }: { fromLive?: boolean } = {},
  ): Promise<boolean> {
    const id = activeIdRef.current;
    if (!id) return false;
    let before: ConversationView | null = null;
    holdRef.current = true;
    if (optimistic) {
      setConv((c) => {
        before = c;
        const next = optimistic(c ?? blankView(id));
        optimisticViews.current.add(next);
        return next;
      });
    }
    const undo = () => {
      if (activeIdRef.current === id) setConv((c) => (c && optimisticViews.current.has(c) ? before : c));
    };
    inFlight.current += 1;
    setSending(true);
    try {
      const res = await fetch(`${base}/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; conversation?: ConversationView; error?: string } | null;
      if (!res.ok || !data?.ok || !data.conversation) {
        undo();
        toast.error(data?.error ?? `Adonis couldn't do that (${res.status}).`);
        return false;
      }
      if (activeIdRef.current === id && !fromLive) setConv(data.conversation);
      void fetchList();
      return true;
    } catch {
      undo();
      toast.error("Couldn't reach Adonis. Check your connection and try again.");
      return false;
    } finally {
      inFlight.current -= 1;
      if (inFlight.current === 0) {
        holdRef.current = false;
        setSending(false);
      }
      wake();
    }
  }

  /** Send a question as the next message: it is shown at once and brought to the top of the view. */
  function ask(q: string): Promise<boolean> {
    pinNext(`q${convRef.current?.messages.length ?? 0}`);
    openedAt.current = activeIdRef.current; // sending is not opening: keep the question at the top
    return post({ type: "message", text: q }, (c) => ({
      ...c,
      running: true,
      messages: [
        ...c.messages,
        { role: "user", content: q, tools: [], artifacts: [] },
        { role: "assistant", content: "", tools: [], artifacts: [], startedAt: Date.now() },
      ],
    }));
  }

  /** `fromComposer`: the words were typed in the box, so a failed send puts them back there (and only then). */
  function send(text: string, fromComposer = false) {
    // The id is the useful part: it is what every tool that touches a picture or a document takes.
    const attachLine = attachments.map((a) => `[Attached to the library: "${a.name}" — ${a.kind} #${a.id}]`).join("\n");
    const q = [text.trim(), attachLine].filter(Boolean).join("\n\n");
    if (!q || busy || !activeId) return;
    const sentAttachments = attachments;
    setInput("");
    setAttachments([]);
    void ask(q).then((ok) => {
      if (ok) return;
      // Nothing was sent: give the words and files back.
      if (fromComposer) setInput((cur) => cur || text);
      setAttachments((prev) => (prev.length ? prev : sentAttachments));
    });
  }

  const markCard = (index: number, status: "approving" | "cancelled") => (c: ConversationView): ConversationView => ({
    ...c,
    messages: c.messages.map((m, i) => (i === index && m.pending ? { ...m, pending: { ...m.pending, status } } : m)),
  });

  function approve(index: number, all = false) {
    void post({ type: "approve", index, all }, (c) => ({ ...markCard(index, "approving")(c), running: true, building: all }));
  }
  function cancelCard(index: number) {
    void post({ type: "cancel", index }, markCard(index, "cancelled"));
  }
  /** "Change it": a campaign card is written again with the tweak; any other card is cancelled and the words sent. */
  async function changeCard(index: number, tweak: string) {
    const words = tweak.trim();
    const pending = convRef.current?.messages[index]?.pending;
    if (pending && campaignAction(pending.actions)) {
      void post({ type: "goAgain", index, tweak: words }, (c) => ({ ...markCard(index, "cancelled")(c), running: true }));
      return;
    }
    const id = activeIdRef.current;
    const ok = await post({ type: "cancel", index }, markCard(index, "cancelled"));
    if (ok && words && activeIdRef.current === id) void ask(`Change that before I approve it: ${words}`);
  }
  function buildRest(campaignId: number) {
    void post({ type: "buildRest", campaignId }, (c) => ({ ...c, running: true, building: true }));
  }
  /** The composer's Stop: ends the turn Adonis is on now. */
  function stopNow() {
    void post({ type: "stop", now: true }, (c) => ({ ...c, stopRequested: true }), { fromLive: true });
  }
  /** The autopilot banner: stop after the step Adonis is on. */
  function stopAfterThis() {
    void post({ type: "stop" }, (c) => ({ ...c, stopRequested: true }), { fromLive: true });
  }

  function newChat() {
    setHistoryOpen(false);
    if (empty) return; // already a fresh chat
    const id = newId();
    openedAt.current = null; // the next chat opened (this one included, later) lands on its latest exchange
    setConv(null);
    setExpanded(new Set());
    setFreshId(id);
    setActiveId(id);
  }
  function openChat(id: string) {
    setHistoryOpen(false);
    if (id === activeId) return;
    openedAt.current = null;
    setConv(null);
    setExpanded(new Set());
    setActiveId(id);
  }
  async function deleteChat(id: string) {
    const target = list.find((c) => c.id === id);
    const ok = await confirm({
      title: "Delete this chat?",
      body: `Delete "${target?.title || "this chat"}"? This cannot be undone.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    const res = await fetch(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      const data = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
      toast.error(data?.error ?? (res ? `Could not delete that chat (${res.status}).` : "Couldn't reach Adonis. Check your connection and try again."));
      void fetchList();
      return;
    }
    const next = await fetchList();
    if (id === activeIdRef.current) {
      openedAt.current = null;
      setConv(null);
      setExpanded(new Set());
      const pick = next[0]?.id;
      if (pick) {
        setActiveId(pick);
      } else {
        const fresh = newId();
        setFreshId(fresh);
        setActiveId(fresh);
      }
    }
  }
  function toggleFold(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const campaignProgress = deriveCampaignProgress(conv?.campaignEvents ?? []);
  const campaignId = campaignProgress?.campaignId ?? null;
  const campaign = campaignProgress ? (
    <CampaignChecklist
      progress={campaignProgress}
      working={busy}
      // Build the rest runs writes: admins only (the route returns 403 otherwise).
      onBuildRest={isAdmin && campaignId !== null ? () => buildRest(campaignId) : undefined}
    />
  ) : null;

  const actions: ExchangeActions = {
    onApprove: (i) => approve(i),
    onApproveAll: (i) => approve(i, true),
    onCancel: cancelCard,
    onChange: (i, tweak) => void changeCard(i, tweak),
    onFollowUp: (text) => send(text),
  };

  const composer = (variant: "hero" | "dock") => (
    <Composer
      value={input}
      onChange={setInput}
      onSend={() => send(input, true)}
      // Shown once the server has the run; while a send is still on its way the button is the spinner.
      onStop={sending ? undefined : stopNow}
      busy={busy}
      running={running}
      attachments={attachments}
      attaching={attaching}
      onAttach={(files) => void attachFiles(files)}
      onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
      voiceEnabled={voiceEnabled}
      modelChip={modelChip}
      placeholder={variant === "hero" ? "Ask Adonis anything, or tell it what to do" : "Ask a follow-up"}
      variant={variant}
      hint={variant === "dock" ? "Adonis asks before it changes anything." : undefined}
    />
  );

  return (
    <div className="ax-root" ref={rootRef}>
      <div className="ax-top">
        <button type="button" className="ax-top-btn" onClick={newChat}>
          <Plus size={15} strokeWidth={1.9} aria-hidden />
          New chat
        </button>
        <div className="ax-top-end">
          <button type="button" className="ax-top-btn" onClick={() => setHistoryOpen(true)} aria-haspopup="dialog">
            <History size={15} strokeWidth={1.9} aria-hidden />
            History
          </button>
          {headerEnd}
        </div>
      </div>

      {conv?.building && running && (
        <div className="ax-autopilot" role="status">
          <span>
            {conv.stopRequested
              ? "Stopping after the step Adonis is on."
              : "Building every asset without stopping, even if you leave this page. Adonis will ask before launching, scheduling or sending anything."}
          </span>
          {!conv.stopRequested && (
            <button type="button" className="ax-btn" onClick={stopAfterThis}>
              Stop after this one
            </button>
          )}
        </div>
      )}

      {empty && (
        <div className="ax-scroll">
          <EmptyState
            firstName={firstName}
            businessName={businessName}
            suggestions={suggestions}
            onPick={(text) => send(text)}
            disabled={busy}
            composer={composer("hero")}
            today={today}
          />
        </div>
      )}

      {chatting && (
        <>
          <div className="ax-scroll" ref={scroll.scrollRef} onScroll={scroll.onScroll}>
            <div className="ax-col" ref={scroll.contentRef}>
              {exchanges.map((x, i) => {
                const isLast = i === exchanges.length - 1;
                // An Approve card still open keeps its exchange unfolded (plan decision 8).
                const waiting = x.replies.some((r) => r.message.pending?.status === "awaiting" || r.message.pending?.status === "approving");
                return (
                  <Exchange
                    // Keyed by chat too: two chats both have a "q0", and a tab picked in one must not carry to the other.
                    key={`${activeId}:${x.key}`}
                    exchange={x}
                    live={isLast && running}
                    phases={live.phases}
                    isLast={isLast}
                    folded={!isLast && !waiting && !expanded.has(x.key)}
                    onToggleFold={isLast || waiting ? undefined : () => toggleFold(x.key)}
                    busy={busy}
                    canApprove={isAdmin}
                    campaign={isLast ? campaign : null}
                    actions={actions}
                  />
                );
              })}
            </div>
          </div>
          <div className="ax-dock">
            {scroll.showJump && (
              <button type="button" className="ax-jump" onClick={() => toLatest("smooth")}>
                <ArrowDown size={14} strokeWidth={2} aria-hidden />
                Jump to latest
              </button>
            )}
            {composer("dock")}
          </div>
        </>
      )}

      {!empty && !chatting && <div className="ax-scroll" aria-busy="true" />}

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        items={list}
        activeId={activeId}
        onOpen={openChat}
        onNew={newChat}
        onDelete={(id) => void deleteChat(id)}
      />
    </div>
  );
}
