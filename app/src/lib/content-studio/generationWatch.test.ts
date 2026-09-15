// Run: npm test -- src/lib/content-studio/generationWatch.test.ts
//
// The watch list is what lets the app tell you a detached generation finished
// after you navigated away from it. These pin the three things that break the
// feature silently: an entry that never expires (polls a dead run forever), a
// decision that misreads "failed" as "ready", and a storage that throws in a
// private window taking the whole app shell down with it.
import assert from "node:assert/strict";

import {
  WATCH_TTL_MS,
  addWatch,
  decideOutcome,
  isExpired,
  readWatches,
  removeWatch,
  type GenerationWatch,
  type WatchStorage,
} from "./generationWatch";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

/** An in-memory stand-in for localStorage. */
function fakeStorage(seed?: string): WatchStorage & { raw(): string | null } {
  let value: string | null = seed ?? null;
  return {
    getItem: () => value,
    setItem: (_k, v) => {
      value = v;
    },
    raw: () => value,
  };
}

/** A storage that throws the way a private window or blocked site data does. */
const throwingStorage: WatchStorage = {
  getItem() {
    throw new Error("The operation is insecure.");
  },
  setItem() {
    throw new Error("The operation is insecure.");
  },
};

const NOW = 1_700_000_000_000;
const watch = (over: Partial<GenerationWatch> = {}): GenerationWatch => ({
  id: 42,
  name: "Why over-35s should lift",
  startedAt: NOW,
  ...over,
});

// --- add / read / remove round-trips -------------------------------------

{
  const storage = fakeStorage();
  addWatch(watch(), { storage, now: NOW });
  const list = readWatches({ storage, now: NOW });
  check("a watch added is a watch read back", list.length === 1 && list[0].id === 42);
  check("the design's name survives the round-trip", list[0].name === "Why over-35s should lift");
  check("so does when it started", list[0].startedAt === NOW);
}

{
  const storage = fakeStorage();
  addWatch(watch({ id: 1 }), { storage, now: NOW });
  addWatch(watch({ id: 2 }), { storage, now: NOW });
  check("two designs can be watched at once", readWatches({ storage, now: NOW }).length === 2);
  check("removing one reports the claim", removeWatch(1, { storage, now: NOW }) === true);
  const left = readWatches({ storage, now: NOW });
  check("and leaves the other alone", left.length === 1 && left[0].id === 2);
  check(
    "removing an id that is already gone does NOT claim it -- this is the cross-tab guard",
    removeWatch(1, { storage, now: NOW }) === false,
  );
}

{
  const storage = fakeStorage();
  addWatch(watch({ id: 7, name: "First" }), { storage, now: NOW });
  addWatch(watch({ id: 7, name: "Second", startedAt: NOW + 5000 }), { storage, now: NOW + 5000 });
  const list = readWatches({ storage, now: NOW + 5000 });
  check("re-generating the same design replaces its watch, it does not duplicate it", list.length === 1);
  check("and the clock restarts with it", list[0].startedAt === NOW + 5000);
}

// --- expiry ---------------------------------------------------------------

{
  check("a fresh watch is not expired", isExpired(watch(), NOW + 60_000) === false);
  check("one older than the TTL is", isExpired(watch(), NOW + WATCH_TTL_MS + 1) === true);
  const storage = fakeStorage();
  addWatch(watch({ id: 9 }), { storage, now: NOW });
  check(
    "reading drops an expired watch rather than polling a dead run forever",
    readWatches({ storage, now: NOW + WATCH_TTL_MS + 1 }).length === 0,
  );
}

// --- the decision ---------------------------------------------------------

{
  check(
    "still writing",
    decideOutcome(watch(), { generationStatus: "writing" }, NOW + 1000).kind === "running",
  );
  check(
    "null status means the run resolved -- the slides are there",
    decideOutcome(watch(), { generationStatus: null }, NOW + 1000).kind === "done",
  );
  const failed = decideOutcome(
    watch(),
    { generationStatus: "failed", generationError: "The model ran out of context." },
    NOW + 1000,
  );
  check("failed is reported as failed", failed.kind === "failed");
  check(
    "and carries the reason, so the toast can say what went wrong",
    failed.kind === "failed" && failed.error === "The model ran out of context.",
  );
  check(
    "a failure with no message is not faked into one",
    (() => {
      const o = decideOutcome(watch(), { generationStatus: "failed", generationError: "  " }, NOW);
      return o.kind === "failed" && o.error === null;
    })(),
  );
  check(
    "no answer at all keeps waiting -- a dropped request is not a result",
    decideOutcome(watch(), null, NOW + 1000).kind === "running",
  );
  check(
    "expiry beats status: a run wedged on 'writing' by a server restart stops being polled",
    decideOutcome(watch(), { generationStatus: "writing" }, NOW + WATCH_TTL_MS + 1).kind ===
      "expired",
  );
}

// --- storage that throws --------------------------------------------------

{
  check(
    "a throwing storage reads as an empty list, not an exception",
    readWatches({ storage: throwingStorage, now: NOW }).length === 0,
  );
  let threw = false;
  try {
    addWatch(watch(), { storage: throwingStorage, now: NOW });
    removeWatch(42, { storage: throwingStorage, now: NOW });
  } catch {
    threw = true;
  }
  check("and adding/removing against it never throws into the app shell", threw === false);
  check(
    "a claim that could not be written is not a claim",
    removeWatch(42, { storage: throwingStorage, now: NOW }) === false,
  );
  check(
    "no storage at all (SSR, or site data blocked) is simply an empty list",
    readWatches({ storage: null, now: NOW }).length === 0,
  );
}

// --- junk in storage ------------------------------------------------------

{
  check(
    "garbage in the key is ignored rather than crashing the shell",
    readWatches({ storage: fakeStorage("not json at all"), now: NOW }).length === 0,
  );
  check(
    "a non-array payload is ignored",
    readWatches({ storage: fakeStorage('{"id":1}'), now: NOW }).length === 0,
  );
  check(
    "entries without a usable id are dropped, the good one is kept",
    readWatches({
      storage: fakeStorage(
        JSON.stringify([{ id: "x" }, { name: "no id" }, { id: 5, name: "ok", startedAt: NOW }]),
      ),
      now: NOW,
    }).length === 1,
  );
}

console.log(`\ngenerationWatch: ${passed} checks passed`);
