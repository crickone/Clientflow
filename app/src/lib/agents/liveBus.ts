import { EventEmitter } from "node:events";

import type { LiveEvent } from "@/lib/agents/liveEvents";

/**
 * The run loop's live events, in this process.
 *
 * lib/agents/conversation.ts publishes every text delta, tool start, save and
 * run end here, keyed by tenant and conversation; the SSE route
 * (/api/agents/[key]/conversations/[id]/stream) subscribes. Railway runs one
 * persistent `next start` instance, so every listener is in this process. If
 * the app is ever scaled out, a page on another instance hears nothing and
 * its polling fallback carries on (less smooth, still correct).
 *
 * The emitter lives on globalThis so dev reloads and separately bundled route
 * modules share one bus. Listeners run synchronously inside publish(): they
 * must not hold on to an event's objects (a state carries the live
 * conversation the run is still writing to), so serialise straight away.
 */

const BUS = Symbol.for("adonis.liveBus");

function bus(): EventEmitter {
  const g = globalThis as unknown as Record<symbol, EventEmitter | undefined>;
  let b = g[BUS];
  if (!b) {
    b = new EventEmitter();
    b.setMaxListeners(0); // one per open chat tab; no fixed ceiling
    g[BUS] = b;
  }
  return b;
}

export function liveKey(tenantId: number, convId: string): string {
  return `${tenantId}:${convId}`;
}

export function publish(key: string, event: LiveEvent): void {
  bus().emit(key, event);
}

/** Listen to one conversation. A listener that throws is logged and never breaks the run or the other listeners. */
export function subscribe(key: string, listener: (event: LiveEvent) => void): () => void {
  const safe = (event: LiveEvent) => {
    try {
      listener(event);
    } catch (err) {
      console.error("[liveBus] listener failed", err);
    }
  };
  bus().on(key, safe);
  return () => {
    bus().off(key, safe);
  };
}

export function listenerCount(key: string): number {
  return bus().listenerCount(key);
}
