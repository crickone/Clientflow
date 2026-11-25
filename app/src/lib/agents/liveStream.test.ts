// Run: npm test -- src/lib/agents/liveStream.test.ts
//
// The bridge from the live bus to an SSE response: snapshot first, every
// event after it, a heartbeat while quiet, closed on `end`, on abort, or
// after its time cap; never left subscribed.
import assert from "node:assert/strict";

import type { ConversationView } from "./conversationModel";
import type { LiveEvent } from "./liveEvents";
import { liveStream } from "./liveStream";

function hub() {
  const listeners = new Set<(e: LiveEvent) => void>();
  return {
    subscribe: (fn: (e: LiveEvent) => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    emit: (e: LiveEvent) => {
      for (const l of [...listeners]) l(e);
    },
    count: () => listeners.size,
  };
}

const view = (running: boolean): ConversationView => ({
  id: "c1",
  title: "t",
  updatedAt: 1,
  running,
  building: false,
  stopRequested: false,
  campaignEvents: [],
  messages: [{ role: "assistant", content: "Hi", tools: [], artifacts: [] }],
});

async function collect(stream: ReadableStream<Uint8Array>, timeoutMs = 2000): Promise<{ frames: string[]; closed: boolean }> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let text = "";
  let closed = false;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    const r = await Promise.race([
      reader.read(),
      new Promise<"timeout">((res) => setTimeout(() => res("timeout"), left)),
    ]);
    if (r === "timeout") break;
    if (r.done) {
      closed = true;
      break;
    }
    text += dec.decode(r.value, { stream: true });
  }
  reader.releaseLock();
  return { frames: text.split("\n\n").filter(Boolean), closed };
}

const dataTypes = (frames: string[]) =>
  frames.filter((f) => f.startsWith("data: ")).map((f) => (JSON.parse(f.slice(6)) as LiveEvent).type);

(async () => {
  // A running conversation: snapshot, then events, closed on end.
  {
    const h = hub();
    const s = liveStream({ subscribe: h.subscribe, snapshot: () => view(true) });
    h.emit({ type: "text", index: 0, delta: " there" });
    h.emit({ type: "tool", index: 0, name: "list_leads" });
    h.emit({ type: "state", conversation: view(true) });
    h.emit({ type: "end" });
    const { frames, closed } = await collect(s);
    assert.ok(frames[0].startsWith("retry: "), "the retry hint goes first");
    assert.deepEqual(dataTypes(frames), ["state", "text", "tool", "state", "end"], "snapshot first, then every event in order");
    assert.ok(closed, "the stream closes after end");
    assert.equal(h.count(), 0, "and stops listening");
  }
  // An idle conversation: snapshot and end straight away.
  {
    const h = hub();
    const { frames, closed } = await collect(liveStream({ subscribe: h.subscribe, snapshot: () => view(false) }));
    assert.deepEqual(dataTypes(frames), ["state", "end"], "an idle chat gets its snapshot and end");
    assert.ok(closed && h.count() === 0, "and is not held open");
  }
  // A conversation that is gone.
  {
    const h = hub();
    const { frames, closed } = await collect(liveStream({ subscribe: h.subscribe, snapshot: () => null }));
    assert.deepEqual(dataTypes(frames), ["end"], "a missing chat just ends");
    assert.ok(closed && h.count() === 0);
  }
  // Quiet: heartbeats, then the time cap closes it (the page reconnects).
  {
    const h = hub();
    const { frames, closed } = await collect(liveStream({ subscribe: h.subscribe, snapshot: () => view(true), heartbeatMs: 20, maxMs: 120 }));
    assert.ok(dataTypes(frames).includes("ping"), "a quiet stream sends heartbeats as ping data frames, which the page can see");
    assert.ok(!frames.some((f) => f.startsWith(":")), "no comment frames: EventSource would hide them from the page");
    assert.ok(closed, "the time cap closes it");
    assert.ok(!dataTypes(frames).includes("end"), "the cap is not an end: the page reconnects");
    assert.equal(h.count(), 0);
  }
  // The page goes away.
  {
    const h = hub();
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    const { closed } = await collect(liveStream({ subscribe: h.subscribe, snapshot: () => view(true), signal: ac.signal }));
    assert.ok(closed && h.count() === 0, "an aborted request closes and unsubscribes");
  }
  // A snapshot that throws: the error surfaces and nothing is left behind.
  // (A leaked heartbeat interval would also keep this script from exiting.)
  {
    const h = hub();
    assert.throws(
      () =>
        liveStream({
          subscribe: h.subscribe,
          snapshot: () => {
            throw new Error("db gone");
          },
          heartbeatMs: 10,
        }),
      /db gone/,
    );
    assert.equal(h.count(), 0, "a throwing snapshot leaves no listener on the bus");
  }
  // A subscribe that throws: same.
  {
    assert.throws(
      () =>
        liveStream({
          subscribe: () => {
            throw new Error("bus gone");
          },
          snapshot: () => view(true),
          heartbeatMs: 10,
        }),
      /bus gone/,
    );
  }
  console.log("liveStream: all checks passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
