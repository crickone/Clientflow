// Run: npm test -- src/lib/agents/liveBus.test.ts
//
// The in-process bus the run loop publishes to and the SSE route listens on.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import type { LiveEvent } from "./liveEvents";
import { listenerCount, liveKey, publish, subscribe } from "./liveBus";

const key = liveKey(7, "conv-a");
assert.equal(key, "7:conv-a", "the key is tenant then conversation");

const got: LiveEvent[] = [];
const after: LiveEvent[] = [];
const other: LiveEvent[] = [];
const offGot = subscribe(key, (e) => got.push(e));
const offThrow = subscribe(key, () => {
  throw new Error("listener broke");
});
const offAfter = subscribe(key, (e) => after.push(e));
const offOther = subscribe(liveKey(7, "conv-b"), (e) => other.push(e));

const realError = console.error;
console.error = () => {};
publish(key, { type: "text", index: 1, delta: "Hel" });
publish(key, { type: "tool", index: 1, name: "list_leads" });
publish(key, { type: "text", index: 1, delta: "lo" });
publish(key, {
  type: "state",
  conversation: { id: "conv-a", title: "t", updatedAt: 1, running: false, building: false, stopRequested: false, campaignEvents: [], messages: [] },
});
publish(key, { type: "end" });
console.error = realError;

const order = ["text", "tool", "text", "state", "end"];
assert.deepEqual(got.map((e) => e.type), order, "a subscriber gets every event in the order published");
assert.deepEqual(after.map((e) => e.type), order, "a listener that throws does not stop the ones after it");
assert.equal(other.length, 0, "another conversation hears nothing");

offGot();
offThrow();
offAfter();
assert.equal(listenerCount(key), 0, "unsubscribing removes the listener");
publish(key, { type: "end" });
assert.equal(got.length, 5, "nothing arrives after unsubscribing");
offOther();

const g = globalThis as unknown as Record<symbol, unknown>;
assert.ok(g[Symbol.for("adonis.liveBus")] instanceof EventEmitter, "the bus lives on globalThis so dev reloads share it");

console.log("liveBus: all checks passed");
