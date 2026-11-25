"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";

import type { ConversationView } from "@/lib/agents/conversationModel";
import { applyLiveEvent, parseLiveEvent, type LivePhase } from "@/lib/agents/liveEvents";

export type { LivePhase } from "@/lib/agents/liveEvents";
export type LiveTransport = "stream" | "poll" | "idle";

/** Poll intervals: a run going without the stream; idle (another device may start one); a hidden tab. */
const FAST_MS = 700;
const IDLE_MS = 5_000;
const HIDDEN_MS = 15_000;
/** EventSource reconnects by itself; after this many errors in a row, poll for the rest of the run. */
const MAX_STREAM_ERRORS = 2;

export type LiveConversationOptions = {
  /** `/api/agents/<key>/conversations` */
  base: string;
  /** The open conversation ("" before the first load). */
  id: string;
  /** False until the chat list has loaded and an id is picked. */
  enabled: boolean;
  /** Sent as `?stamp=` on the stream (EventSource cannot send the tenant-stamp header). */
  tenantId: number;
  /** A run finished (refresh the history list). */
  onSettled?: () => void;
};

export type LiveConversation = {
  conv: ConversationView | null;
  setConv: Dispatch<SetStateAction<ConversationView | null>>;
  /** What each live reply is doing, by message index, as the stream reports it. */
  phases: Record<number, LivePhase>;
  transport: LiveTransport;
  /** The id whose first GET has answered (so "no messages" really means a new chat). */
  settledId: string | null;
  /** True while the caller's own POST is in flight. */
  holdRef: RefObject<boolean>;
  /** Fetch now (after a POST) unless the stream already has the conversation. */
  wake: () => void;
};

/**
 * Follow the open conversation.
 *
 * While Adonis is working, an EventSource on the stream route applies each
 * word and tool as it happens and replaces the whole conversation on every
 * save. When the stream is missing, refused or keeps failing, the old
 * polling loop takes over (fast while running), so a run is always followed.
 * Idle conversations are not held open: they are polled slowly, which is also
 * how a run started from another device is noticed.
 */
export function useConversationLive({ base, id, enabled, tenantId, onSettled }: LiveConversationOptions): LiveConversation {
  const [conv, setConv] = useState<ConversationView | null>(null);
  const [phases, setPhases] = useState<Record<number, LivePhase>>({});
  const [transport, setTransport] = useState<LiveTransport>("idle");
  const [settledId, setSettledId] = useState<string | null>(null);
  const convRef = useRef<ConversationView | null>(null);
  const holdRef = useRef(false);
  const esRef = useRef<EventSource | null>(null);
  const streamErrors = useRef(0);
  const streamFailed = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(id);
  // Bumped whenever the following effect starts or is cleaned up. A tick or timer
  // that began under an older generation (another id, `enabled` false, unmounted)
  // must not set state, open a stream or re-arm the poll.
  const genRef = useRef(0);
  const activeRef = useRef(false);
  const onSettledRef = useRef(onSettled);
  const tickRef = useRef<() => void>(() => {});
  idRef.current = id;
  onSettledRef.current = onSettled;

  useEffect(() => {
    convRef.current = conv;
  }, [conv]);

  const later = useCallback((ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!activeRef.current) return;
    const gen = genRef.current;
    timerRef.current = setTimeout(() => {
      if (gen === genRef.current && activeRef.current) tickRef.current();
    }, ms);
  }, []);

  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const settle = useCallback(() => {
    setPhases({});
    onSettledRef.current?.();
  }, []);

  const openStream = useCallback((): boolean => {
    if (!activeRef.current) return false;
    if (esRef.current) return true;
    const convId = idRef.current;
    if (streamFailed.current || !convId || typeof EventSource === "undefined") return false;
    const es = new EventSource(`${base}/${encodeURIComponent(convId)}/stream?stamp=${tenantId}`);
    esRef.current = es;
    streamErrors.current = 0;
    setTransport("stream");
    es.onmessage = (msg: MessageEvent<string>) => {
      if (esRef.current !== es || idRef.current !== convId) return;
      const e = parseLiveEvent(msg.data);
      if (!e) return;
      streamErrors.current = 0;
      if (e.type === "end") {
        closeStream();
        setTransport("idle");
        settle();
        later(IDLE_MS);
        return;
      }
      if (e.type === "text") setPhases((p) => (p[e.index] === "writing" ? p : { ...p, [e.index]: "writing" }));
      else if (e.type === "tool") setPhases((p) => ({ ...p, [e.index]: "tool" }));
      setConv((c) => applyLiveEvent(c, e));
    };
    es.onerror = () => {
      if (esRef.current !== es) return;
      streamErrors.current += 1;
      if (es.readyState === EventSource.CLOSED || streamErrors.current > MAX_STREAM_ERRORS) {
        closeStream();
        streamFailed.current = true;
        setTransport("poll");
        later(0);
      }
    };
    return true;
  }, [base, tenantId, closeStream, settle, later]);

  const tick = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (!activeRef.current) return;
    const gen = genRef.current;
    const convId = idRef.current;
    if (!convId || esRef.current) return;
    let next: ConversationView | null | undefined;
    try {
      const res = await fetch(`${base}/${encodeURIComponent(convId)}`, { cache: "no-store" });
      if (res.status === 404) next = null;
      else if (res.ok) next = (await res.json()) as ConversationView;
    } catch {
      /* a network blip: try again on the next tick */
    }
    if (gen !== genRef.current || !activeRef.current || idRef.current !== convId || esRef.current) return;
    if (next !== undefined) setSettledId(convId);
    if (next !== undefined && !holdRef.current) {
      const wasRunning = Boolean(convRef.current?.running);
      convRef.current = next;
      setConv(next);
      if (wasRunning && !next?.running) {
        setTransport("idle");
        settle();
      }
      if (next?.running) {
        if (openStream()) return;
        setTransport("poll");
      }
    }
    const running = Boolean(convRef.current?.running) || holdRef.current;
    later(running ? FAST_MS : document.hidden ? HIDDEN_MS : IDLE_MS);
  }, [base, openStream, settle, later]);
  tickRef.current = () => void tick();

  // A different conversation: start from nothing and fetch it.
  useEffect(() => {
    if (!enabled || !id) return;
    activeRef.current = true;
    genRef.current += 1;
    closeStream();
    streamFailed.current = false;
    convRef.current = null;
    setConv(null);
    setPhases({});
    setTransport("idle");
    void tick();
    const onVisible = () => {
      if (!document.hidden && !esRef.current) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      activeRef.current = false;
      genRef.current += 1;
      document.removeEventListener("visibilitychange", onVisible);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      closeStream();
    };
  }, [enabled, id, tick, closeStream]);

  // A run started (the answer to a send, or seen by a poll): follow it on the stream.
  const running = Boolean(conv?.running);
  useEffect(() => {
    if (!enabled) return;
    if (running) {
      // The caller's POST is in flight with an optimistic `running: true`: a stream
      // snapshot would replace it and its `end` would settle early. wake() opens it.
      if (holdRef.current) return;
      if (!openStream()) {
        setTransport("poll");
        later(FAST_MS);
      }
    } else {
      streamFailed.current = false; // the next run tries the stream again
      if (!esRef.current) setTransport("idle");
    }
  }, [enabled, running, openStream, later]);

  const wake = useCallback(() => {
    if (!esRef.current) void tick();
  }, [tick]);

  return { conv, setConv, phases, transport, settledId, holdRef, wake };
}
