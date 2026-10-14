"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import { Sparkles, Send, Download, Loader2, Check, History, Plus, Trash2, MessageSquare, Mic, Square, Paperclip, X as XIcon } from "lucide-react";
import { toast } from "sonner";
import { EASE } from "@/lib/motion";
import { splitAttachments } from "@/components/messaging/chatText";
import type { ConversationSummary, ConversationView } from "@/lib/agents/conversationModel";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { deriveCampaignProgress, type CampaignProgress } from "./campaignProgress";
import { appendTranscript } from "./voiceInput";
import { useVoiceInput } from "./useVoiceInput";
import { Soundwave } from "./Soundwave";

type Artifact = { url: string; filename: string; label: string };
type Step = { label: string; done: boolean };
type PendingAction = { name: string; input: Record<string, unknown>; summary: string };
type Pending = { actions: PendingAction[]; status: "awaiting" | "approving" | "approved" | "cancelled" };
/** One message as MessageBubble shows it (built from the server's ConvMessage). */
type ChatMessage = {
  role: "user" | "assistant";
  /** A message the app sent for the operator (handing an approval's result back to the agent); kept in the history, not shown. */
  hidden?: boolean;
  content: string;
  steps: Step[];
  artifacts: Artifact[];
  pending?: Pending | null;
};

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
  list_leads: "Checking the pipeline",
  get_lead_health: "Checking lead health",
  draft_lead_reply: "Drafting a reply",
  send_whatsapp: "Sending WhatsApp",
  set_lead_stage: "Updating pipeline stage",
  log_lead_touch: "Logging a touch",
  plan_campaign: "Planning the campaign",
  create_campaign: "Creating the campaign",
  draft_campaign_asset: "Drafting…",
  approve_campaign_asset: "Saving…",
  get_campaign: "Checking the campaign…",
  launch_campaign: "Launching the campaign",
};


export function AssistantChat({
  tenantId,
  height,
  agentKey = "orchestrator",
  title = "Assistant",
  subtitle = "knows your emails, WhatsApp, clients & money",
  emptyTitle = "Ask me anything about your business",
  emptyBody = "I can read your inbox and WhatsApp, summarise what matters, check your income, and bundle invoices for download.",
  suggestions = SUGGESTIONS,
  placeholder = "Ask your assistant…  (Enter to send)",
  initialInput,
  bare = false,
  heroSlot,
  voiceEnabled = false,
  controlsContainer,
  composeFooter,
}: {
  tenantId: number;
  height?: string;
  /** The agent this chat talks to (its registry key). Its conversations live on the server under /api/agents/<key>/conversations. */
  agentKey?: string;
  title?: string;
  subtitle?: string;
  emptyTitle?: string;
  emptyBody?: string;
  suggestions?: string[];
  placeholder?: string;
  /**
   * Campaign Engine Slice 3 (Task 3): a starter draft to pre-fill the
   * compose box with on mount — e.g. a "Build campaign" link from the
   * Seasonal calendar (see BuildCampaignLink.tsx's campaignSeedStarterMessage,
   * read by /agents/[key]/page.tsx). Applied once, and only into an empty
   * compose box (never clobbers text the operator already typed) — and
   * never auto-sent, so the operator still reviews/edits/hits send
   * themselves, same as every other write in this app.
   */
  initialInput?: string;
  /**
   * "Bare" / chromeless mode for a host page that supplies its own frame
   * (e.g. the /adonis flagship view: a centered ADONIS AGENT wordmark hero
   * on a clean full-page background, like the Hermes reference). When true:
   *  - the internal identity header (Sparkles icon + `title` + `subtitle`)
   *    and the big empty-state icon are suppressed, so there's no second,
   *    redundant title stacked beneath the host's hero;
   *  - the root card's border / `--surface-1` fill / radius are dropped and
   *    the compose row's top divider is removed, so the chat blends into the
   *    host background instead of sitting in a grey card.
   * History + New-chat controls are PRESERVED (a slim right-aligned strip),
   * and the compose field keeps its own subtle border so it still reads as
   * an input. Defaults to false — every existing consumer (dashboard,
   * specialist chats, Communication) is byte-identical unless it opts in.
   */
  bare?: boolean;
  /**
   * Optional hero rendered at the TOP of the scrollable message area (used
   * with `bare` by the /adonis flagship view). While there are no messages
   * it's vertically centered together with the empty-state prompt (so a big
   * wordmark sits mid-window like the Hermes reference); once a conversation
   * starts it anchors to the top and scrolls up naturally with the messages —
   * it's part of the scroll content, not pinned chrome. Omitted → nothing
   * renders and every existing consumer is byte-identical.
   */
  heroSlot?: ReactNode;
  /**
   * Optional DOM node to PORTAL the History + New-chat controls into instead of
   * rendering them in this component's own header — used by /adonis to place
   * them in its top bar's top-left corner. When set, the header renders no
   * controls and the history dropdown flips to left-aligned so it opens at the
   * top-left. Undefined (every other consumer) → controls stay in the header,
   * byte-identical to before.
   */
  controlsContainer?: HTMLElement | null;
  /**
   * Voice T2: shows a mic button in the compose row (next to Send) that
   * records the operator's voice via `MediaRecorder`, POSTs it to
   * `POST /api/assistant/transcribe` (Voice T1), and appends the returned
   * transcript into `input` for them to review + send — see
   * `useVoiceInput.ts` for the recording state machine. Defaults to `false`
   * so every existing/untouched caller renders byte-identical with no mic
   * button. Each real consumer's SERVER parent computes this via
   * `transcribeConfigured()` (`@/lib/ai/voiceTranscribe` — true iff
   * `OPENAI_API_KEY` is set) and threads it down, the same pattern
   * `openRouterConfigured` uses for the model picker (AgentDetail.tsx): the
   * client never reads `process.env` itself.
   */
  voiceEnabled?: boolean;
  /**
   * Optional row rendered directly under the compose box, left-aligned — used
   * by /adonis for its model chip (ModelPicker). Omitted → nothing renders.
   */
  composeFooter?: ReactNode;
}) {
  // The conversations live on the server (lib/agents/conversation.ts), which
  // runs every turn and carries on after approvals whether or not this page
  // is open. This component only sends what the operator does and shows the
  // conversation as it changes.
  const base = `/api/agents/${agentKey}/conversations`;
  // Where an older build of this page kept chats in the browser — moved to
  // the server once, below.
  const legacyKey = `cf_assistant_chats_v2_${tenantId}_${`/api/agents/${agentKey}/chat`.replace(/[^a-zA-Z0-9]+/g, "-")}`;
  const openKey = `adonis_open_${tenantId}_${agentKey}`;
  const confirm = useConfirm();
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  // The open conversation; null while it's a new chat nothing has been sent in.
  const [conv, setConv] = useState<ConversationView | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastUserRef = useRef<HTMLDivElement | null>(null);
  const scrollPending = useRef(false);
  // The conversation the view was last opened at the bottom of. Opening a
  // chat (or coming back to the page) lands on the latest reply, once; the
  // polling that follows never yanks the view around.
  const openedAt = useRef<string | null>(null);
  // Campaign Engine Slice 3: guards the initialInput seed effect below to
  // apply (at most) once per mount.
  const initialInputApplied = useRef(false);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const sendingRef = useRef(false);
  // Polls the open conversation again straight away (after an action).
  const wakeRef = useRef<(() => void) | null>(null);

  // Voice T2: a ref on the compose textarea so a landed transcript can
  // focus it and place the caret at the end (see the effect just below) —
  // the only reason this component needs a ref on its own textarea at all.
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Files attached to the next message.
   *
   * An attachment is uploaded to the media library the moment it is picked,
   * not held in the browser until send: the library is where the business's
   * files belong anyway, and it means the assistant is handed an id it can
   * act on (place that photograph on a page, read that document) rather than
   * bytes it would have to be given a whole new channel to receive.
   *
   * What reaches the model is a plain line naming each file and its id. That
   * keeps this feature out of the transport entirely — no new message shape,
   * no change to history, nothing to migrate.
   */
  const attachRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<
    { id: number; name: string; kind: string }[]
  >([]);
  const [attaching, setAttaching] = useState(false);

  async function attachFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setAttaching(true);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("file", f);
      const res = await fetch("/api/content-studio/image-library", { method: "POST", body: form });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        assets?: { id: number; originalName: string; kind: string }[];
      };
      if (!res.ok || !json.ok || !json.assets) {
        toast.error(json.error || "Could not attach that file.");
        return;
      }
      setAttachments((prev) => [
        ...prev,
        ...json.assets!.map((a) => ({ id: a.id, name: a.originalName, kind: a.kind })),
      ]);
    } catch {
      toast.error("Could not attach that file.");
    } finally {
      setAttaching(false);
      if (attachRef.current) attachRef.current.value = "";
    }
  }
  // One-shot guard: flipped true the instant a transcript is appended,
  // consumed by the effect below on the very next render — i.e. once
  // `input`'s new value has actually committed to the textarea's DOM value —
  // so the caret lands after the appended text rather than wherever a bare
  // focus() would leave it.
  const focusAfterVoiceRef = useRef(false);
  const voice = useVoiceInput((text) => {
    setInput((cur) => appendTranscript(cur, text));
    focusAfterVoiceRef.current = true;
  });
  useEffect(() => {
    if (!focusAfterVoiceRef.current) return;
    focusAfterVoiceRef.current = false;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [input]);

  async function fetchList(): Promise<ConversationSummary[]> {
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
  }

  // First load: move any browser-kept chats to the server (once), then open
  // the chat this device had open last, or the newest.
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
        /* the old history stays in the browser; try again next load */
      }
      const summaries = await fetchList();
      if (cancelled) return;
      let last: string | null = null;
      try {
        last = localStorage.getItem(openKey);
      } catch {
        /* ignore */
      }
      // A pre-filled starter (New campaign) begins a fresh chat; otherwise
      // reopen the chat this device had open, or the newest.
      const pick = initialInput ? undefined : (summaries.find((s) => s.id === last) ?? summaries[0]);
      setActiveId(pick ? pick.id : newId());
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, legacyKey, openKey]);

  // Follow the open conversation: quickly while Adonis is working, slowly
  // otherwise (it may be running from another device).
  useEffect(() => {
    if (!loaded || !activeId) return;
    try {
      localStorage.setItem(openKey, activeId);
    } catch {
      /* ignore */
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let wasRunning = false;
    const tick = async () => {
      if (timer) clearTimeout(timer);
      timer = null;
      let next: ConversationView | null | undefined;
      try {
        const res = await fetch(`${base}/${activeId}`, { cache: "no-store" });
        if (res.status === 404) next = null;
        else if (res.ok) next = (await res.json()) as ConversationView;
      } catch {
        /* a network blip: try again next tick */
      }
      if (stopped) return;
      if (next !== undefined && !sendingRef.current) {
        setConv(next);
        if (wasRunning && next && !next.running) void fetchList();
        wasRunning = Boolean(next?.running);
      }
      const delay = next?.running || sendingRef.current ? 700 : document.hidden ? 15000 : 5000;
      timer = setTimeout(() => void tick(), delay);
    };
    wakeRef.current = () => void tick();
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      wakeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, activeId, base, openKey]);

  // Campaign Engine Slice 3 (Task 3): prime the compose box from a
  // "Build campaign" seed, once conversations are loaded. Functional
  // setInput update means this never needs `input` in the dependency array,
  // and `cur || initialInput` means it only ever fills a genuinely empty box.
  useEffect(() => {
    if (!loaded || initialInputApplied.current || !initialInput) return;
    initialInputApplied.current = true;
    setInput((cur) => cur || initialInput);
  }, [loaded, initialInput]);

  const running = Boolean(conv?.running);
  const busy = sending || running;
  // The server's messages, shaped for MessageBubble: a step is done unless
  // it's the tool the live reply is on right now.
  const messages: ChatMessage[] = (conv?.messages ?? []).map((m, i, all) => ({
    role: m.role,
    hidden: m.hidden,
    content: m.content,
    artifacts: m.artifacts,
    pending: m.pending ?? null,
    steps: m.tools.map((t, k) => ({
      label: TOOL_LABEL[t] ?? t,
      done: !(running && i === all.length - 1 && k === m.tools.length - 1),
    })),
  }));

  // After sending, bring the user's question to the TOP of the view so the reply
  // streams in below it and reads from the start (instead of pinning to bottom).
  useLayoutEffect(() => {
    if (!conv || conv.messages.length === 0 || openedAt.current === conv.id) return;
    openedAt.current = conv.id;
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [conv]);

  useLayoutEffect(() => {
    if (!scrollPending.current) return;
    scrollPending.current = false;
    const el = lastUserRef.current;
    const container = scrollRef.current;
    if (el && container) {
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      // Smoothly glide the question up to the top so the reply flows in below it
      // (the empty-state hero fades up over the same beat) — Hermes-style, not a
      // hard snap.
      container.scrollTo({ top: container.scrollTop + (eRect.top - cRect.top - 10), behavior: "smooth" });
    }
  }, [messages.length]);

  /**
   * Tell the server what the operator did. `optimistic` shows it at once;
   * the server's answer (and the polling after it) replaces that.
   */
  async function post(body: Record<string, unknown>, optimistic?: (c: ConversationView) => ConversationView): Promise<boolean> {
    const id = activeId;
    if (!id) return false;
    if (optimistic) {
      setConv((c) =>
        optimistic(
          c ?? { id, title: "New chat", updatedAt: Date.now(), running: false, messages: [], campaignEvents: [], building: false, stopRequested: false },
        ),
      );
    }
    sendingRef.current = true;
    setSending(true);
    try {
      const res = await fetch(`${base}/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; conversation?: ConversationView; error?: string } | null;
      if (!res.ok || !data?.ok || !data.conversation) {
        toast.error(data?.error ?? `Adonis couldn't do that (${res.status}).`);
        return false;
      }
      if (activeIdRef.current === id) setConv(data.conversation);
      void fetchList();
      return true;
    } catch {
      toast.error("Couldn't reach Adonis. Check your connection and try again.");
      return false;
    } finally {
      sendingRef.current = false;
      setSending(false);
      wakeRef.current?.();
    }
  }

  function send(text: string) {
    // Name the attachments in the message itself. The id is the useful part:
    // it is what every tool that touches a picture or a document takes.
    const attachLine = attachments.length
      ? attachments.map((a) => `[Attached to the library: "${a.name}" — ${a.kind} #${a.id}]`).join("\n")
      : "";
    const q = [text.trim(), attachLine].filter(Boolean).join("\n\n");
    if (!q || busy || !activeId) return;
    setInput("");
    setAttachments([]);
    scrollPending.current = true; // scroll this new question to the top on render
    openedAt.current = activeId; // sending isn't opening: keep the question-at-top scroll
    void post({ type: "message", text: q }, (c) => ({
      ...c,
      running: true,
      messages: [...c.messages, { role: "user", content: q, tools: [], artifacts: [] }, { role: "assistant", content: "", tools: [], artifacts: [] }],
    }));
  }

  const markCard = (index: number, status: "approving" | "cancelled") => (c: ConversationView): ConversationView => ({
    ...c,
    messages: c.messages.map((m, i) => (i === index && m.pending ? { ...m, pending: { ...m.pending, status } } : m)),
  });

  function approve(index: number, all = false) {
    void post({ type: "approve", index, all }, (c) => ({ ...markCard(index, "approving")(c), running: true, building: all }));
  }
  function cancelPending(index: number) {
    void post({ type: "cancel", index }, markCard(index, "cancelled"));
  }
  /**
   * Campaign Engine Slice 1 (Task 6): "Go again" on a campaign plan/asset
   * card. The server closes the card and sends Adonis a message carrying the
   * words "Go again" its playbook anchors on (campaignGoAgainMessage).
   */
  function goAgain(index: number, tweak: string) {
    void post({ type: "goAgain", index, tweak }, (c) => ({ ...markCard(index, "cancelled")(c), running: true }));
  }
  function buildRest(campaignId: number) {
    void post({ type: "buildRest", campaignId }, (c) => ({ ...c, running: true, building: true }));
  }
  function stopBuild() {
    void post({ type: "stop" }, (c) => ({ ...c, stopRequested: true }));
  }

  function newChat() {
    setHistoryOpen(false);
    if (!conv || conv.messages.length === 0) return; // already a fresh chat
    setConv(null);
    setActiveId(newId());
  }
  function openChat(id: string) {
    setHistoryOpen(false);
    if (id === activeId) return;
    setConv(null);
    setActiveId(id);
  }
  async function deleteChat(id: string) {
    const target = list.find((c) => c.id === id);
    if (
      !(await confirm({
        title: "Delete conversation?",
        body: `Delete "${target?.title || "this chat"}"? This can't be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    ) {
      return;
    }
    const res = await fetch(`${base}/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      toast.error("Adonis is still working in that chat. Delete it when it's finished.");
      return;
    }
    const next = await fetchList();
    if (id === activeId) {
      setConv(null);
      setActiveId(next[0]?.id ?? newId());
    }
  }
  const historyList = list;

  const empty = messages.length === 0;
  // Campaign Engine Slice 1 (Task 6): derived from this conversation's
  // campaign log — null on every chat that hasn't touched a campaign tool.
  const campaignProgress = deriveCampaignProgress(conv?.campaignEvents ?? []);
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" && !messages[i].hidden) { lastAssistantIdx = i; break; }
  }
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user" && !messages[i].hidden) { lastUserIdx = i; break; }
  }

  const controlsStrip = (
    <div style={{ marginLeft: controlsContainer ? 0 : "auto", display: "flex", gap: 2, position: "relative" }}>
      <Button variant="ghost" size="sm" onClick={() => setHistoryOpen((v) => !v)}>
        <History size={14} /> History{historyList.length ? ` (${historyList.length})` : ""}
      </Button>
      <Button variant="ghost" size="sm" onClick={newChat}>
        <Plus size={14} /> New chat
      </Button>
      {historyOpen && (
        <>
          <div onClick={() => setHistoryOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              left: controlsContainer ? 0 : "auto",
              right: controlsContainer ? "auto" : 0,
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
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                      {ago(c.updatedAt)}
                      {c.running && <span style={{ color: "var(--accent)" }}> · Working</span>}
                    </div>
                  </div>
                  <Tooltip label="Delete chat">
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}
                      aria-label="Delete chat"
                      style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 2, flexShrink: 0, display: "inline-flex" }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </Tooltip>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: height ?? "72vh",
        minHeight: 420,
        border: bare ? "none" : "1px solid var(--hairline)",
        borderRadius: bare ? 0 : "var(--radius)",
        background: bare ? "transparent" : "var(--surface-1)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: bare ? "8px 10px 0" : "12px 16px",
          borderBottom: bare ? "none" : "1px solid var(--hairline)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {!bare && <Sparkles size={16} strokeWidth={1.75} style={{ color: "var(--accent)" }} />}
        {!bare && <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>{title}</strong>}
        {!bare && (
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }} className="ai-subtitle">{subtitle}</span>
        )}
        {!controlsContainer && controlsStrip}
        {controlsContainer && createPortal(controlsStrip, controlsContainer)}
      </div>

      {conv?.building && running && (
        <div className="ai-autopilot" role="status">
          <span>
            {conv.stopRequested
              ? "Stopping after the step Adonis is on."
              : "Building every asset without stopping, even if you leave this page. Adonis will ask before launching, scheduling or sending anything."}
          </span>
          {!conv.stopRequested && (
            <button type="button" onClick={stopBuild}>
              Stop after this one
            </button>
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          position: "relative",
        }}
      >
        {/* Messages flow normally from the top. */}
        {!empty &&
          messages.map((m, i) => m.hidden ? null : (
            <div key={i} ref={i === lastUserIdx ? lastUserRef : undefined}>
              <MessageBubble
                m={m}
                streaming={running && i === messages.length - 1}
                busy={busy}
                onApprove={() => approve(i)}
                onApproveAll={() => approve(i, true)}
                onCancel={() => cancelPending(i)}
                onGoAgain={(tweak) => goAgain(i, tweak)}
              />
              {campaignProgress && i === lastAssistantIdx && (
                <CampaignChecklist
                  progress={campaignProgress}
                  working={busy}
                  onBuildRest={campaignProgress.campaignId !== null ? () => buildRest(campaignProgress.campaignId!) : undefined}
                />
              )}
            </div>
          ))}

        {/* Empty state = a centered overlay that fades up on the first send, so
            a big hero (the /adonis mark) gives way SMOOTHLY to the conversation
            (which flows in from the top underneath) instead of snapping. */}
        <AnimatePresence initial={false}>
          {empty && (
            <motion.div
              key="chat-empty"
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.32, ease: EASE }}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: 16,
              }}
            >
              {heroSlot}
              {/* In `bare` mode (the /adonis flagship view) the title +
                  suggestions live in the bottom cluster above the input, so the
                  centered overlay is the hero alone; other consumers show them
                  here. */}
              {!bare && (
                <div style={{ maxWidth: 460 }}>
                  <Sparkles size={26} strokeWidth={1.5} style={{ color: "var(--accent)", marginBottom: 10 }} />
                  <div style={{ fontSize: 15, color: "var(--text-primary)", fontWeight: 600, marginBottom: 6 }}>
                    {emptyTitle}
                  </div>
                  {emptyBody && (
                    <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginBottom: 18, lineHeight: 1.5 }}>
                      {emptyBody}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {suggestions.map((s) => (
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
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* bare (/adonis): the prompt + compact chips sit right above the input,
          only while empty — moved down out of the centered hero group so the
          big mark owns the centre. */}
      {bare && empty && (
        <div style={{ padding: "0 2px 12px" }}>
          <div
            style={{
              textAlign: "center",
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-primary)",
              marginBottom: 12,
            }}
          >
            {emptyTitle}
          </div>
          {suggestions.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  style={{
                    padding: "5px 11px",
                    border: "1px solid var(--hairline)",
                    borderRadius: 999,
                    background: "transparent",
                    color: "var(--text-tertiary)",
                    fontSize: 11.5,
                    lineHeight: 1.3,
                    cursor: "pointer",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {attachments.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            padding: bare ? "10px 0 0" : "10px 12px 0",
          }}
        >
          {attachments.map((a) => (
            <span
              key={a.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                maxWidth: 260,
                padding: "5px 8px 5px 10px",
                border: "1px solid var(--hairline)",
                borderRadius: 999,
                background: "var(--surface-1)",
                color: "var(--text-secondary)",
                fontSize: 12,
              }}
            >
              <Paperclip size={12} strokeWidth={2} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.name}
              </span>
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                aria-label={`Remove ${a.name}`}
                style={{
                  display: "inline-flex",
                  background: "none",
                  border: "none",
                  padding: 2,
                  color: "var(--text-tertiary)",
                  cursor: "pointer",
                }}
              >
                <XIcon size={12} strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ borderTop: bare ? "none" : "1px solid var(--hairline)", padding: bare ? "12px 0 0" : 12, display: "flex", gap: 8 }}>
        {voice.state === "recording" && voice.stream ? (
          // While recording, the wave takes the textarea's slot in the row —
          // the user is talking, not typing. `input` itself lives in this
          // component's own state (not the DOM node), so swapping the
          // textarea out and back never loses anything typed before/after;
          // Soundwave mirrors its box model (border/radius/background/height)
          // so the row's height doesn't jump either way.
          <Soundwave stream={voice.stream} />
        ) : (
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                // Voice T2: a transcript-in-flight shouldn't send a half-dictated
                // message out from under the operator — mirrors the Send
                // button's own disabled condition just below.
                if (voice.state === "idle" && (input.trim() || attachments.length > 0)) send(input);
              }
            }}
            rows={1}
            placeholder={placeholder}
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
        )}
        <input
          ref={attachRef}
          type="file"
          multiple
          hidden
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,application/pdf,text/plain,text/csv,text/markdown,application/json,.docx,.xlsx,.pptx"
          onChange={(e) => void attachFiles(e.target.files)}
        />
        <Tooltip label="Attach a file">
          <Button
            variant="secondary"
            onClick={() => attachRef.current?.click()}
            disabled={busy || attaching}
            aria-label="Attach a file"
          >
            {attaching ? <Loader2 size={15} className="spin" /> : <Paperclip size={15} strokeWidth={2} />}
          </Button>
        </Tooltip>
        {voiceEnabled && (
          <>
            {voice.state === "recording" && (
              <span
                aria-hidden
                style={{
                  alignSelf: "center",
                  fontSize: 11,
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--text-tertiary)",
                  fontFamily: "var(--font-mono), ui-monospace, monospace",
                }}
              >
                {voice.elapsedLabel}
              </span>
            )}
            <Tooltip label={voice.state === "recording" ? "Stop and transcribe" : "Start voice input"}>
              <Button
                variant="secondary"
                onClick={voice.toggle}
                disabled={voice.state === "transcribing" || (voice.state === "idle" && busy)}
                aria-label={voice.state === "recording" ? "Stop and transcribe" : "Start voice input"}
                style={
                  voice.state === "recording" ? { position: "relative", borderColor: "#dc2626", color: "#dc2626" } : undefined
                }
              >
                {voice.state === "transcribing" ? (
                  <Loader2 size={15} className="spin" />
                ) : voice.state === "recording" ? (
                  <>
                    <Square size={14} strokeWidth={2} fill="currentColor" />
                    <span className="voice-rec-dot" aria-hidden />
                  </>
                ) : (
                  <Mic size={15} strokeWidth={2} />
                )}
              </Button>
            </Tooltip>
          </>
        )}
        <Button
          onClick={() => send(input)}
          disabled={busy || (!input.trim() && attachments.length === 0) || voice.state !== "idle"}
        >
          {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} strokeWidth={2} />}
        </Button>
      </div>
      {composeFooter && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: bare ? "8px 0 0" : "0 12px 10px" }}>
          {composeFooter}
        </div>
      )}
    </div>
  );
}

/**
 * The campaign being built, as a checklist in the conversation: ticked when
 * done, spinning on the one Adonis is working on, empty for what's next.
 * Rendered under the latest reply, so it moves down the chat as work goes on.
 */
function CampaignChecklist({
  progress,
  working,
  onBuildRest,
}: {
  progress: CampaignProgress;
  working: boolean;
  /** Finish a part-built campaign on the server, without stopping (shown when nothing is running). */
  onBuildRest?: () => void;
}) {
  const done = progress.assets.filter((a) => a.status === "done").length;
  const total = progress.assets.length;
  const finished = done === total;
  return (
    <div className="ai-tasks" role="status" aria-label={`${progress.name}: ${done} of ${total} done`}>
      <div className="ai-tasks-head">
        <span className="ai-tasks-name">{progress.name}</span>
        <span className="ai-tasks-count">{finished ? "All done" : `${done} of ${total} done`}</span>
      </div>
      <div className="ai-tasks-bar" aria-hidden>
        <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <ol className="ai-tasks-list">
        {progress.assets.map((a, idx) => (
          <li key={`${idx}-${a.kind}`} data-status={a.status}>
            <span className="ai-task-icon" aria-hidden>
              {a.status === "done" ? <Check size={12} strokeWidth={3} /> : a.status === "current" && working ? <Loader2 size={13} className="spin" /> : null}
            </span>
            <span className="ai-task-title">{a.title}</span>
            {a.status === "current" && <span className="ai-task-now">{working ? "Working on it" : "Next"}</span>}
          </li>
        ))}
      </ol>
      {!finished && !working && onBuildRest && (
        <div className="ai-tasks-foot">
          <Button size="sm" variant="secondary" onClick={onBuildRest}>
            Build the rest
          </Button>
          <span>Approves each asset as it&rsquo;s written, even if you leave this page. Launching still asks you.</span>
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  m,
  streaming,
  busy,
  onApprove,
  onApproveAll,
  onCancel,
  onGoAgain,
}: {
  m: ChatMessage;
  /** "Approve and build everything" on a campaign plan: approve it and let every asset be approved automatically. */
  onApproveAll?: () => void;
  streaming: boolean;
  /** Global "a send() turn is in flight" flag — distinct from `streaming` (which is per-message and only true for the LAST message). Gates the Go-again/Regenerate buttons, since goAgain() routes through send(), which silently no-ops while busy. */
  busy?: boolean;
  onApprove?: () => void;
  onCancel?: () => void;
  /** Campaign Engine Slice 1 (Task 6): present only for a create_campaign/approve_campaign_asset pending — see `campaignAction` below. */
  onGoAgain?: (tweak: string) => void;
}) {
  const isUser = m.role === "user";
  // Campaign Engine Slice 1 (Task 6): "Go again" only ever renders for a
  // pending that is EXACTLY one campaign write — never for a plain write,
  // and never for a batch (e.g. a delegated multi-action confirm), where
  // "redo" has no single clear target. Every other pending renders the
  // Approve/Cancel row completely unchanged from before this task.
  const campaignAction =
    m.pending && m.pending.actions.length === 1 && (m.pending.actions[0].name === "create_campaign" || m.pending.actions[0].name === "approve_campaign_asset")
      ? m.pending.actions[0]
      : null;
  const [tweakOpen, setTweakOpen] = useState(false);
  const [tweak, setTweak] = useState("");
  function submitGoAgain() {
    onGoAgain?.(tweak);
    setTweakOpen(false);
    setTweak("");
  }
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div
        style={{
          maxWidth: isUser ? "80%" : "92%",
          // Long unspaced URLs (Drive/artifact links) must wrap, not scroll the page.
          overflowWrap: "anywhere",
          background: isUser ? "var(--accent)" : "var(--surface-2)",
          // Ink that sits ON the accent fill — matches .btn--primary. Uses the
          // theme-aware --accent-contrast, which flips dark/light with the
          // accent's own luminance, so it reads in BOTH light and dark mode; the
          // old hardcoded dark ink went invisible on the dark light-mode accent.
          color: isUser ? "var(--accent-contrast)" : "var(--text-primary)",
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
        {isUser ? (
          (() => {
            const { body, attached } = splitAttachments(m.content);
            return (
              <>
                {body && <RichText text={body} />}
                {attached.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      marginTop: body ? 8 : 0,
                    }}
                  >
                    {attached.map((a) => (
                      <span
                        key={a.id}
                        title={`${a.name} (${a.kind})`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          maxWidth: 240,
                          padding: "4px 9px",
                          borderRadius: 999,
                          background: "rgba(0,0,0,.14)",
                          fontSize: 12,
                        }}
                      >
                        <Paperclip size={11} strokeWidth={2} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.name}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </>
            );
          })()
        ) : (
          m.content && <RichText text={m.content} />
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
            {campaignAction && tweakOpen ? (
              // Campaign Engine Slice 1 (Task 6): the revealed one-line tweak
              // input — submitting sends a normal chat message down the
              // existing send() path (see goAgain() in the parent) instead of
              // approving; the Approve/Cancel row above never rendered this,
              // so this branch is the ONLY new UI a non-campaign write can
              // never reach (campaignAction is null for every one of those).
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  autoFocus
                  value={tweak}
                  onChange={(e) => setTweak(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (busy) return;
                      e.preventDefault();
                      submitGoAgain();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setTweakOpen(false);
                    }
                  }}
                  placeholder="Optional tweak — e.g. “make it punchier” (Enter to send)"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: "var(--bg)",
                    border: "1px solid var(--hairline)",
                    borderRadius: "var(--radius)",
                    padding: "7px 10px",
                    color: "var(--text-primary)",
                    fontSize: 13,
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
                <Button variant="ghost" size="sm" onClick={() => setTweakOpen(false)}>
                  Back
                </Button>
                <Button size="sm" onClick={submitGoAgain} loading={busy}>
                  Regenerate
                </Button>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Button variant="ghost" size="sm" onClick={onCancel} disabled={m.pending.status === "approving"}>
                  Cancel
                </Button>
                {campaignAction && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTweakOpen(true)}
                    disabled={m.pending.status === "approving" || busy}
                  >
                    Go again
                  </Button>
                )}
                {campaignAction?.name === "create_campaign" && onApproveAll && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={onApproveAll}
                    disabled={m.pending.status === "approving"}
                    title="Approve the plan and every asset as it's written. Adonis still asks before launching, scheduling or sending anything."
                  >
                    Approve and build everything
                  </Button>
                )}
                <Button size="sm" onClick={onApprove} loading={m.pending.status === "approving"}>
                  Approve
                </Button>
              </div>
            )}
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
    // _italic_ only when the underscores sit at word edges, so snake_case
    // names in tool results stay as they are.
    for (const seg of s.split(/(\*\*[^*]+\*\*|`[^`]+`|(?<![\w])_[^_\n]+_(?![\w]))/g)) {
      if (!seg) continue;
      if (/^\*\*[^*]+\*\*$/.test(seg)) nodes.push(<strong key={`${keyBase}-${k++}`}>{seg.slice(2, -2)}</strong>);
      else if (/^_[^_\n]+_$/.test(seg)) nodes.push(<em key={`${keyBase}-${k++}`} style={{ color: "var(--text-tertiary)" }}>{seg.slice(1, -1)}</em>);
      else if (/^`[^`]+`$/.test(seg))
        nodes.push(
          <code
            key={`${keyBase}-${k++}`}
            style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: "0.88em", background: "var(--surface-2)", padding: "1px 5px", borderRadius: 4 }}
          >
            {seg.slice(1, -1)}
          </code>,
        );
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

/** Lightweight markdown-ish renderer (headings w/ hierarchy, bold, inline code,
 *  bullet + numbered lists, horizontal rules, links). Builds React nodes (no
 *  raw HTML) so untrusted content the agent summarises can't inject markup. */
function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {lines.map((ln, i) => {
        const t = ln.trim();
        if (t === "") return <div key={i} style={{ height: 6 }} />;
        // Horizontal rule: ---, ***, ___ (render as a divider, not literal text).
        if (/^([-*_])\1{2,}$/.test(t)) return <div key={i} style={{ borderTop: "1px solid var(--hairline)", margin: "8px 0" }} />;
        // Headings with a visible size hierarchy.
        const h = t.match(/^(#{1,3})\s+(.*)/);
        if (h) {
          const level = h[1].length;
          const size = level === 1 ? 16 : level === 2 ? 14 : 13;
          return (
            <div key={i} style={{ fontWeight: 700, fontSize: size, color: "var(--text-primary)", marginTop: i === 0 ? 0 : 12, marginBottom: 2 }}>
              {inline(h[2], `h${i}`)}
            </div>
          );
        }
        // Bullet list.
        if (/^[-*]\s+/.test(t)) {
          return (
            <div key={i} style={{ display: "flex", gap: 8, paddingLeft: 2 }}>
              <span style={{ color: "var(--text-tertiary)", lineHeight: 1.55 }}>•</span>
              <span style={{ flex: 1, lineHeight: 1.55 }}>{inline(t.replace(/^[-*]\s+/, ""), `b${i}`)}</span>
            </div>
          );
        }
        // Numbered list.
        const num = t.match(/^(\d{1,2})\.\s+(.*)/);
        if (num) {
          return (
            <div key={i} style={{ display: "flex", gap: 8, paddingLeft: 2 }}>
              <span style={{ color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums", lineHeight: 1.55 }}>{num[1]}.</span>
              <span style={{ flex: 1, lineHeight: 1.55 }}>{inline(num[2], `n${i}`)}</span>
            </div>
          );
        }
        return <div key={i} style={{ lineHeight: 1.55 }}>{inline(t, `p${i}`)}</div>;
      })}
    </div>
  );
}
