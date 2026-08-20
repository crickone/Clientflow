"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Sparkles, Send, Download, Loader2, Check, History, Plus, Trash2, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/Button";
import {
  campaignGoAgainMessage,
  campaignPlanEventFromActions,
  campaignProgressEventFromResult,
  deriveCampaignProgress,
  type CampaignProgressEvent,
} from "./campaignProgress";

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
type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
  /**
   * DR2 (.superpowers/sdd/durableruns-design.md): the id of this
   * conversation's in-flight specialist run, if any — captured from the
   * leading `{type:"run", runId}` SSE frame (DR1) and cleared once that run
   * reaches a terminal state (`done`/`error`). Persists with the conversation
   * in localStorage via the existing persist effect, so a reload/navigate
   * knows which run (if any) to resume by polling
   * `GET /api/agents/run/[id]`. The Communication endpoint
   * (`/api/assistant/chat`) never emits a `run` frame, so this stays
   * `undefined` for any conversation created there — resume is a no-op.
   */
  activeRunId?: string;
  /**
   * Campaign Engine Slice 1 (Task 6): a chronological log of campaign-build
   * signal seen so far in THIS conversation — one entry per proposed
   * create_campaign call ("plan") or executed create_campaign/
   * approve_campaign_asset/launch_campaign result ("progress"). Folded by
   * `deriveCampaignProgress` (@/components/messaging/campaignProgress) into
   * the compact progress-strip render model just below the header. Plain
   * JSON, so it round-trips through the existing localStorage persist/load
   * effects with zero changes there; absent entirely on any conversation
   * that predates this feature or never touched a campaign tool — reads as
   * `undefined`, which `deriveCampaignProgress([])` renders as "no strip".
   */
  campaignEvents?: CampaignProgressEvent[];
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * DR2: merge a resumed run's server-known artifacts into a message's list
 * without duplicating ones already attached from a live `artifact` SSE event
 * before the disconnect (matched by url — the same field the live path keys
 * download links on).
 */
function mergeArtifacts(existing: Artifact[], incoming: Artifact[]): Artifact[] {
  if (!incoming.length) return existing;
  const seen = new Set(existing.map((a) => a.url));
  const additions = incoming.filter((a) => a && a.url && !seen.has(a.url));
  return additions.length ? [...existing, ...additions] : existing;
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
  launch_campaign: "Launching the campaign",
};

const DEFAULT_ENDPOINT = "/api/assistant/chat";

// DR2 (.superpowers/sdd/durableruns-design.md) resume-on-reload tuning. DR1
// made the specialist chat route (/api/agents/[key]/chat) persist an
// in-flight run and survive a client disconnect; these constants control how
// this component polls `GET /api/agents/run/[id]` to pick a run back up
// after a refresh/navigate. The Communication endpoint (DEFAULT_ENDPOINT)
// never emits the `run` frame this depends on, so none of it ever engages
// for that assistant — see the `activeRunId` doc comment on `Conversation`.
const RESUME_POLL_MS = 1500;
const RESUME_MAX_MS = 2 * 60 * 1000; // belt-and-suspenders vs. the server's own ~3min stale guard
const RESUME_ERROR_RECHECK_MS = 5000; // one more look before trusting a stale-guard "error"

export function AssistantChat({
  tenantId,
  height,
  endpoint = DEFAULT_ENDPOINT,
  title = "Assistant",
  subtitle = "knows your emails, WhatsApp, clients & money",
  emptyTitle = "Ask me anything about your business",
  emptyBody = "I can read your inbox and WhatsApp, summarise what matters, check your income, and bundle invoices for download.",
  suggestions = SUGGESTIONS,
  placeholder = "Ask your assistant…  (Enter to send)",
  initialInput,
  bare = false,
}: {
  tenantId: number;
  height?: string;
  /**
   * POST target for a chat turn. Defaults to the shared Dashboard assistant
   * route, so omitting this prop leaves the Dashboard assistant's behaviour
   * 100% unchanged. A scoped specialist (e.g. the Sales agent) passes its own
   * `/api/agents/<key>/chat` here instead. The Approve flow always POSTs to
   * `/api/assistant/execute` regardless of this prop — see `approve()` below,
   * which this parameterisation does not touch.
   */
  endpoint?: string;
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
}) {
  // Per-account chat HISTORY in localStorage (survives browser close). Each entry
  // is a saved conversation; "New chat" opens a fresh one and keeps the old ones.
  // The default endpoint keeps the EXACT pre-existing key (so the Dashboard
  // assistant's saved history is untouched); a non-default endpoint — a scoped
  // specialist chat — gets its own bucket, otherwise it would silently share
  // one history with the Dashboard assistant despite using different tools
  // and a different system prompt.
  const storeKey =
    endpoint === DEFAULT_ENDPOINT
      ? `cf_assistant_chats_v2_${tenantId}`
      : `cf_assistant_chats_v2_${tenantId}_${endpoint.replace(/[^a-zA-Z0-9]+/g, "-")}`;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastUserRef = useRef<HTMLDivElement | null>(null);
  const scrollPending = useRef(false);
  // DR2 resume-on-reload: which conversation (if any) is currently being
  // polled back to life. Deliberately separate from `busy` — which still
  // gates the live-stream input exactly as before — so the input stays
  // usable while an old run resumes in the background; see resumeRun()'s
  // cancellation guard for what happens if the user sends a new message into
  // the conversation being resumed. `resumeAttempted` ensures the mount
  // effect below only ever starts (at most) one resume per component mount.
  const [resumingConvId, setResumingConvId] = useState<string | null>(null);
  const resumeAttempted = useRef(false);
  const resumeCancelRef = useRef<Record<string, boolean>>({});
  // Campaign Engine Slice 3: guards the initialInput seed effect below to
  // apply (at most) once per mount, same pattern as resumeAttempted.
  const initialInputApplied = useRef(false);

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

  // Campaign Engine Slice 3 (Task 3): prime the compose box from a
  // "Build campaign" seed, once conversations are loaded. Functional
  // setInput update (rather than reading `input` in the effect body) means
  // this never needs `input` in the dependency array, so it can't re-fire
  // just because the operator started typing. `cur || initialInput` means it
  // only ever fills a genuinely empty box.
  useEffect(() => {
    if (!loaded || initialInputApplied.current || !initialInput) return;
    initialInputApplied.current = true;
    setInput((cur) => cur || initialInput);
  }, [loaded, initialInput]);

  // Persist (keep the 40 most-recent).
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(storeKey, JSON.stringify({ conversations: conversations.slice(0, 40), activeId }));
    } catch {
      /* ignore */
    }
  }, [conversations, activeId, loaded, storeKey]);

  /**
   * DR2: pick a run back up after a refresh/navigate. `convId`/`runId` come
   * from the conversation's persisted `activeRunId` (see the mount effect
   * below) — polls `GET /api/agents/run/[id]` (tenant-scoped, membership
   * guarded server-side) until the run reaches a terminal state, growing the
   * last assistant message's text on every tick exactly like the brief
   * describes. Mirrors send()'s own `patch`/`patchConv` helpers but is a
   * free function (not a send() closure) since it can start independently of
   * any live send() call, keyed off an explicit `convId` parameter instead.
   */
  async function resumeRun(convId: string, runId: string) {
    // A new turn already started in this conversation before this resume got
    // a chance to run (e.g. the user typed and hit send within the same
    // instant the mount effect fired) — the run we'd be resuming is now
    // stale; send()'s own `run` frame has already taken over `activeRunId`.
    if (resumeCancelRef.current[convId]) return;
    setResumingConvId(convId);

    const patchLast = (fn: (m: ChatMessage) => ChatMessage) =>
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId || c.messages.length === 0) return c;
          const msgs = [...c.messages];
          msgs[msgs.length - 1] = fn(msgs[msgs.length - 1]);
          return { ...c, messages: msgs, updatedAt: Date.now() };
        }),
      );
    const clearRunId = () =>
      setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, activeRunId: undefined } : c)));

    type RunPayload = {
      status?: string;
      text?: string;
      pending?: PendingAction[];
      artifacts?: Artifact[];
      error?: string | null;
    };

    const startedAt = Date.now();
    let staleErrorSeen = false;
    try {
      for (;;) {
        if (resumeCancelRef.current[convId]) break; // user sent a new message into this conversation
        if (Date.now() - startedAt > RESUME_MAX_MS) break; // belt-and-suspenders — a future reload can try again

        let data: RunPayload | null = null;
        let notFound = false;
        try {
          const res = await fetch(`/api/agents/run/${runId}`);
          if (res.status === 404) notFound = true;
          else if (res.ok) data = await res.json().catch(() => null);
        } catch {
          /* transient network blip — retry next tick */
        }

        if (notFound) {
          // Run pruned/unknown: nothing to show beyond what's already saved.
          clearRunId();
          break;
        }
        if (!data || !data.status) {
          await sleep(RESUME_POLL_MS);
          continue;
        }

        if (typeof data.text === "string") {
          const text = data.text;
          patchLast((m) => ({ ...m, content: text }));
        }

        if (data.status === "done") {
          // A read tool (e.g. bundle_invoices) can attach an artifact to a
          // run that finishes cleanly, same as awaiting_approval/error below
          // — merge it in so a resumed client doesn't silently drop a
          // download link the server already has.
          const arts = data.artifacts ?? [];
          patchLast((m) => ({
            ...m,
            steps: m.steps.map((s) => ({ ...s, done: true })),
            artifacts: mergeArtifacts(m.artifacts, arts),
          }));
          clearRunId();
          break;
        }

        if (data.status === "awaiting_approval") {
          const actions = data.pending ?? [];
          const arts = data.artifacts ?? [];
          // Same `pending` shape a live `confirm` frame builds — the Approve
          // card this renders POSTs to /api/assistant/execute exactly like
          // the live path (approve() below doesn't know or care whether the
          // run that proposed it was live or resumed).
          patchLast((m) => ({
            ...m,
            steps: m.steps.map((s) => ({ ...s, done: true })),
            pending: actions.length ? { actions, status: "awaiting" } : m.pending,
            artifacts: mergeArtifacts(m.artifacts, arts),
          }));
          // Campaign Engine Slice 1 (Task 6): a reload/reconnect landing
          // exactly on a not-yet-approved create_campaign proposal still
          // seeds the progress strip, same as the live confirm branch below.
          if (actions.length) {
            const planEvent = campaignPlanEventFromActions(actions);
            if (planEvent) appendCampaignEvent(convId, planEvent);
          }
          clearRunId();
          break;
        }

        if (data.status === "error") {
          // DR1 review note: a genuinely slow single step (>3min, no interim
          // text) can trip the server's stale guard while the run is still
          // actually finishing. Give it one more look before surfacing the
          // error, in case the real result lands in the meantime.
          if (!staleErrorSeen) {
            staleErrorSeen = true;
            await sleep(RESUME_ERROR_RECHECK_MS);
            continue;
          }
          const arts = data.artifacts ?? [];
          const errText = data.error ?? "Assistant error";
          patchLast((m) => ({
            ...m,
            content: m.content + `\n\n_Error: ${errText}_`,
            artifacts: mergeArtifacts(m.artifacts, arts),
          }));
          clearRunId();
          break;
        }

        // status === "running" (or anything else unexpected) — keep polling.
        staleErrorSeen = false;
        await sleep(RESUME_POLL_MS);
      }
    } finally {
      setResumingConvId((cur) => (cur === convId ? null : cur));
    }
  }

  // DR2: after the initial conversations-load effect restores `conversations`
  // + `activeId` from localStorage, resume whichever run (if any) was
  // in-flight for the active conversation when the page last went away. Runs
  // at most once per mount (`resumeAttempted` ref guard) — the effect itself
  // may re-fire as `conversations` changes during any later live stream, but
  // those re-entries are no-ops. For the Communication assistant
  // (`/api/assistant/chat`), `activeRunId` is never set on any conversation
  // (that route never emits a `run` frame), so `conv?.activeRunId` is always
  // falsy there and this cleanly does nothing.
  useEffect(() => {
    if (!loaded || resumeAttempted.current) return;
    resumeAttempted.current = true;
    const conv = conversations.find((c) => c.id === activeId);
    if (conv?.activeRunId) void resumeRun(conv.id, conv.activeRunId);
  }, [loaded, activeId, conversations]);

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
    // DR2: a fresh turn supersedes any resume still polling for this same
    // conversation (e.g. the user chose not to wait) — stop it so it can't
    // later clobber the new turn's message with stale/unrelated run data.
    resumeCancelRef.current[convId] = true;
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
    // DR2: conversation-level patch (vs. `patch`'s last-message patch), used
    // to set/clear `activeRunId` as the `run`/`done`/`error` frames arrive.
    const patchConv = (fn: (c: Conversation) => Conversation) =>
      setConversations((prev) => prev.map((c) => (c.id === convId ? fn(c) : c)));

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // DR1/DR2 (.superpowers/sdd/durableruns-design.md): a stable
        // conversationId lets the specialist route (/api/agents/[key]/chat)
        // group this turn's durable run under the same conversation DR2's
        // resume flow keys off of. The Communication route
        // (/api/assistant/chat) doesn't read this field at all — an unread
        // extra body field is harmless there, so sending it unconditionally
        // for both endpoints is safe.
        body: JSON.stringify({ messages: [...history, { role: "user", content: q }], conversationId: convId }),
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
          let evt: { type: string; text?: string; name?: string; error?: string; actions?: PendingAction[]; runId?: string } & Partial<Artifact>;
          try {
            evt = JSON.parse(raw);
          } catch {
            continue;
          }
          if (evt.type === "run" && evt.runId) {
            // DR1's leading frame: capture + persist this turn's run id on
            // the conversation so a reload/navigate can resume it (DR2). The
            // live render below is completely unaffected by this — it's
            // purely bookkeeping for a future reconnect.
            const runId = evt.runId;
            patchConv((c) => ({ ...c, activeRunId: runId }));
          } else if (evt.type === "confirm" && evt.actions?.length) {
            // The assistant proposed one or more WRITE actions. Nothing has run —
            // show an Approve/Cancel card; execution happens only on approve.
            const actions = evt.actions;
            patch((m) => ({
              ...m,
              steps: m.steps.map((s) => ({ ...s, done: true })),
              pending: { actions, status: "awaiting" },
            }));
            // Campaign Engine Slice 1 (Task 6): a proposed create_campaign
            // call is the only moment the full ordered asset list is ever
            // visible client-side — seed (or replace) the progress-strip
            // model from it. A no-op (returns null) for every other action,
            // i.e. every non-campaign write in the app.
            const planEvent = campaignPlanEventFromActions(actions);
            if (planEvent) appendCampaignEvent(convId, planEvent);
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
            // DR2: the turn ended (in error) — nothing left to resume.
            patchConv((c) => ({ ...c, activeRunId: undefined }));
          } else if (evt.type === "done") {
            patch((m) => ({ ...m, steps: m.steps.map((s) => ({ ...s, done: true })) }));
            // DR2: the turn ended normally — nothing left to resume. (Also
            // reached, harmlessly, right after the `error` branch above on
            // the AiCapError path, which sends both — clearing twice is a
            // no-op.)
            patchConv((c) => ({ ...c, activeRunId: undefined }));
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

  // Campaign Engine Slice 1 (Task 6): append one entry to a conversation's
  // campaign-event log (see the `campaignEvents` doc comment on
  // Conversation). A plain function declaration (hoisted), like patchAt
  // above, so it's safe to call from resumeRun() even though that's defined
  // earlier in this file — by the time either actually RUNS (both are
  // invoked from effects/callbacks, never during the initial render), every
  // const/function in this component body has already been initialised.
  function appendCampaignEvent(convId: string, event: CampaignProgressEvent) {
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, campaignEvents: [...(c.campaignEvents ?? []), event] } : c)),
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
      // Campaign Engine Slice 1 (Task 6): fold any executed campaign write's
      // result into the progress-strip log — a no-op (returns null) for
      // every non-campaign write, so this never affects any other tool.
      for (const r of data.results) {
        if (!r.ok) continue;
        const progressEvent = campaignProgressEventFromResult(r.name, r.text);
        if (progressEvent) appendCampaignEvent(convId, progressEvent);
      }
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

  /**
   * Campaign Engine Slice 1 (Task 6): "Go again" on a campaign plan/asset
   * Approve-card. Deliberately does NOT call /api/assistant/execute (that
   * would run the write) — instead it closes this card (same terminal
   * "cancelled" status cancelPending uses — nothing here was approved
   * either) and sends a normal chat message down the EXISTING send() path,
   * containing the literal words "Go again" the Marketing agent's own
   * playbook (specialists/marketing.ts) already anchors on. This was the
   * simplest-reliable option from the task brief: zero new endpoint, zero
   * new SSE frame type, reuses every bit of send()'s existing streaming/
   * durable-run machinery untouched. Message construction (which asset,
   * which campaign, quoting the tweak) lives in the pure
   * campaignGoAgainMessage helper — see campaignProgress.ts.
   */
  function goAgain(convId: string, index: number, actions: PendingAction[], tweak: string) {
    const action = actions.find((a) => a.name === "create_campaign" || a.name === "approve_campaign_asset");
    if (!action) return; // the button only ever renders when one of these is present
    patchAt(convId, index, (m) => ({
      ...m,
      content: m.content + (m.content ? "\n\n" : "") + "_Asked for another draft…_",
      pending: m.pending ? { ...m.pending, status: "cancelled" } : m.pending,
    }));
    void send(campaignGoAgainMessage(action, tweak));
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
  // Campaign Engine Slice 1 (Task 6): purely derived from this conversation's
  // campaignEvents log (see the Conversation type's doc comment) — null on
  // every chat that hasn't touched a campaign tool, which is the overwhelming
  // majority (Sales/Operations/Communication chats, and most Marketing/
  // Orchestrator turns too), so the strip below renders nothing for them.
  const campaignProgress = deriveCampaignProgress(active?.campaignEvents ?? []);
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

      {campaignProgress && (
        <div
          aria-label={`Campaign progress: ${campaignProgress.assets.filter((a) => a.status === "done").length} of ${campaignProgress.assets.length} approved`}
          style={{
            padding: "9px 16px",
            borderBottom: "1px solid var(--hairline)",
            background: "var(--surface-2)",
            display: "flex",
            alignItems: "baseline",
            flexWrap: "wrap",
            gap: "3px 10px",
          }}
        >
          <span
            style={{
              fontSize: 10.5,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-mono), monospace",
              flexShrink: 0,
            }}
          >
            {campaignProgress.name}
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", fontSize: 12.5 }}>
            {campaignProgress.assets.map((a, idx) => (
              <span key={`${idx}-${a.kind}`} style={{ display: "inline-flex", alignItems: "baseline" }}>
                {idx > 0 && (
                  <span style={{ margin: "0 8px", color: "var(--text-tertiary)", opacity: 0.5 }} aria-hidden>
                    ·
                  </span>
                )}
                <span
                  style={{
                    color: a.status === "current" ? "var(--accent)" : "var(--text-tertiary)",
                    fontWeight: a.status === "current" ? 600 : 400,
                  }}
                >
                  {a.title}
                  <span style={{ marginLeft: 5 }} aria-hidden>
                    {a.status === "done" ? "✓" : a.status === "current" ? "●" : "…"}
                  </span>
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {empty ? (
          <div style={{ margin: "auto", textAlign: "center", maxWidth: 460 }}>
            {!bare && (
              <Sparkles size={26} strokeWidth={1.5} style={{ color: "var(--accent)", marginBottom: 10 }} />
            )}
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
        ) : (
          messages.map((m, i) => (
            <div key={i} ref={i === lastUserIdx ? lastUserRef : undefined}>
              <MessageBubble
                m={m}
                // DR2: while `resumingConvId` is null (no resume in flight —
                // the overwhelming common case, and the ONLY case for the
                // Communication assistant) this is exactly the original
                // `busy && i === messages.length - 1`, so the live-connected
                // path renders byte-for-byte as before. It only additionally
                // lights up for the last message while a reconnect poll is
                // actively resuming THIS conversation, giving it the same
                // "still working" affordance (thinking dots / caret) as a
                // live stream.
                streaming={(busy || resumingConvId === activeId) && i === messages.length - 1}
                busy={busy}
                onApprove={() => m.pending && approve(activeId, i, m.pending.actions)}
                onCancel={() => cancelPending(activeId, i)}
                onGoAgain={(tweak) => m.pending && goAgain(activeId, i, m.pending.actions, tweak)}
              />
            </div>
          ))
        )}
      </div>

      <div style={{ borderTop: bare ? "none" : "1px solid var(--hairline)", padding: bare ? "12px 0 0" : 12, display: "flex", gap: 8 }}>
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
  busy,
  onApprove,
  onCancel,
  onGoAgain,
}: {
  m: ChatMessage;
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
                <Button size="sm" onClick={submitGoAgain} disabled={busy}>
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
    for (const seg of s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
      if (!seg) continue;
      if (/^\*\*[^*]+\*\*$/.test(seg)) nodes.push(<strong key={`${keyBase}-${k++}`}>{seg.slice(2, -2)}</strong>);
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
