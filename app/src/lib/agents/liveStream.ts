/**
 * One open chat page's Server-Sent Events stream: a snapshot of the
 * conversation, then every live event after it.
 *
 * Subscribing and taking the snapshot happen in the same synchronous step,
 * and the run loop publishes from synchronous code, so nothing can be
 * published in between: every event after the snapshot applies to it.
 *
 * Closes on `end` (the run finished), when the request goes away, or after
 * `maxMs` (default 10 minutes; the browser's EventSource reconnects and gets
 * a fresh snapshot). A `ping` data frame every `heartbeatMs` (default 15 s)
 * keeps proxies from closing a quiet stream and tells the page it is still
 * alive, so a silently dead socket can be noticed. Pure enough to test: no Next,
 * no database; the route hands it the bus and the snapshot.
 */

import type { ConversationView } from "@/lib/agents/conversationModel";
import { formatSse, SSE_HEARTBEAT, SSE_RETRY, type LiveEvent } from "@/lib/agents/liveEvents";

export type LiveStreamOptions = {
  subscribe: (listener: (e: LiveEvent) => void) => () => void;
  snapshot: () => ConversationView | null;
  heartbeatMs?: number;
  maxMs?: number;
  signal?: AbortSignal;
};

export function liveStream(o: LiveStreamOptions): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let cleanup = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let unsubscribe = () => {};
      const send = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          // The reader went away between checks: stop for good.
          close();
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed by the reader */
        }
      };
      const heartbeat = setInterval(() => send(SSE_HEARTBEAT), o.heartbeatMs ?? 15_000);
      const cap = setTimeout(close, o.maxMs ?? 10 * 60_000);
      const onAbort = () => close();
      cleanup = () => {
        unsubscribe();
        clearInterval(heartbeat);
        clearTimeout(cap);
        o.signal?.removeEventListener("abort", onAbort);
      };
      o.signal?.addEventListener("abort", onAbort);

      // A throwing subscribe or snapshot must not leave the heartbeat, the
      // cap or a bus listener behind.
      try {
        send(SSE_RETRY);
        unsubscribe = o.subscribe((e) => {
          send(formatSse(e));
          if (e.type === "end") close();
        });
        const snap = o.snapshot();
        if (!snap) {
          send(formatSse({ type: "end" }));
          close();
          return;
        }
        send(formatSse({ type: "state", conversation: snap }));
        if (!snap.running) {
          send(formatSse({ type: "end" }));
          close();
          return;
        }
        if (o.signal?.aborted) close();
      } catch (err) {
        close();
        throw err;
      }
    },
    cancel() {
      cleanup();
    },
  });
}
