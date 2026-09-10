// Run: npm test -- src/lib/voice/flow.test.ts
//
// The call flow's pure decisions — the rules that decide when a machine phones
// a real person, so they are pinned hard:
//   1. normalizeFlow clamps anything a hand-crafted request could send, and
//      ships DISARMED;
//   2. the calling window is Europe/Dublin, not the server's UTC — the bug
//      that would otherwise ring Irish phones at 8am in winter and 10am in
//      summer, or (worse) at 1am;
//   3. an inverted or empty window means NEVER, never "all night";
//   4. nextWindowOpening lands inside the window, skips shut days, and gives
//      up rather than looping when the window can never open;
//   5. describeFlow's sentences are generated FROM the config — the diagram
//      cannot describe behaviour that isn't configured.
//
// NOTE: plain node:assert/strict via `npm test -- <path>` (see scripts/test.mjs).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

// ./flow -> @/lib/settings -> @/lib/db/tenant, which imports React's
// server-only `cache` at module load; under the runner's
// --conditions=react-server that entry point throws. Same shim as
// db/tenant.test.ts, installed before anything is required. The functions
// under test are pure — this only gets the module loaded.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const {
    DEFAULT_CALL_FLOW,
    describeFlow,
    dublinClock,
    isWithinWindow,
    nextAttemptAt,
    nextWindowOpening,
    normalizeFlow,
  } = requireLocal("./flow") as typeof import("./flow");

  // ── 1. defaults + clamping ──
  assert.equal(DEFAULT_CALL_FLOW.enabled, false, "ships disarmed — nothing dials until an operator says so");
  assert.deepEqual(DEFAULT_CALL_FLOW.windowDays, [1, 2, 3, 4, 5], "Mon-Fri by default, never Sundays");

  const clamped = normalizeFlow({
    triggerDelayMinutes: -5,
    retryAfterHours: 0,
    maxAttempts: 9999,
    windowDays: [1, 1, 9, -2, 3],
    windowStart: "nonsense",
    windowEnd: "25:99",
  });
  assert.equal(clamped.triggerDelayMinutes, 0, "a negative delay clamps to zero, not into the past");
  assert.equal(clamped.retryAfterHours, 1, "a zero retry gap would be a redial loop");
  assert.equal(clamped.maxAttempts, 10, "attempts are capped — nobody gets phoned 9999 times");
  assert.deepEqual(clamped.windowDays, [1, 3], "junk days are dropped and duplicates collapsed");
  assert.equal(clamped.windowStart, DEFAULT_CALL_FLOW.windowStart, "an unparseable time falls back, never to 00:00");
  assert.equal(clamped.windowEnd, DEFAULT_CALL_FLOW.windowEnd);
  assert.equal(normalizeFlow(null).enabled, false, "a missing/corrupt config reads as disarmed");
  assert.deepEqual(
    normalizeFlow({ windowDays: [] }).windowDays,
    DEFAULT_CALL_FLOW.windowDays,
    "an empty day list falls back rather than silently meaning 'never'",
  );

  // ── 2. the window is DUBLIN time, not UTC. In July, Dublin is UTC+1. ──
  const flow = normalizeFlow({ windowDays: [1, 2, 3, 4, 5], windowStart: "09:00", windowEnd: "20:00" });

  // 2026-07-06 is a Monday. 08:30 UTC = 09:30 Dublin → allowed.
  assert.equal(isWithinWindow(new Date("2026-07-06T08:30:00Z"), flow), true, "09:30 Dublin in summer is inside the window");
  // 07:30 UTC = 08:30 Dublin → too early. Reading this as UTC would wrongly allow it.
  assert.equal(
    isWithinWindow(new Date("2026-07-06T07:30:00Z"), flow),
    false,
    "08:30 Dublin is too early — the UTC reading would have rung someone's phone",
  );
  // 19:30 UTC = 20:30 Dublin → too late.
  assert.equal(isWithinWindow(new Date("2026-07-06T19:30:00Z"), flow), false, "20:30 Dublin is past the window");

  // In January, Dublin is UTC+0 — the same wall-clock rule, a different offset.
  // 2026-01-05 is a Monday. 08:30 UTC = 08:30 Dublin → too early.
  assert.equal(isWithinWindow(new Date("2026-01-05T08:30:00Z"), flow), false, "08:30 Dublin in winter is still too early");
  assert.equal(isWithinWindow(new Date("2026-01-05T09:30:00Z"), flow), true);

  const clock = dublinClock(new Date("2026-07-06T08:30:00Z"));
  assert.deepEqual(clock, { day: 1, minutes: 9 * 60 + 30 }, "Monday 09:30 Dublin");

  // ── 3. days off, and windows that mean 'never' ──
  // 2026-07-05 is a Sunday, which isn't in the day list.
  assert.equal(isWithinWindow(new Date("2026-07-05T12:00:00Z"), flow), false, "Sunday isn't a calling day");

  const inverted = { ...flow, windowStart: "20:00", windowEnd: "09:00" };
  assert.equal(
    isWithinWindow(new Date("2026-07-06T21:00:00Z"), inverted),
    false,
    "an inverted window means NEVER — reading it as an overnight window would call people at 3am",
  );
  assert.equal(nextWindowOpening(new Date("2026-07-06T21:00:00Z"), inverted), null, "and it can never open");
  assert.equal(nextWindowOpening(new Date("2026-07-06T12:00:00Z"), { ...flow, windowDays: [] }), null);

  // ── 4. finding the next opening ──
  const inside = new Date("2026-07-06T10:00:00Z"); // Mon 11:00 Dublin
  assert.equal(nextWindowOpening(inside, flow), inside, "already inside the window returns the same instant");

  // Friday 2026-07-10 at 21:00 Dublin → the next opening is Monday morning.
  const fridayNight = new Date("2026-07-10T20:00:00Z");
  const opening = nextWindowOpening(fridayNight, flow)!;
  assert.ok(opening, "an opening is found across the weekend");
  assert.equal(isWithinWindow(opening, flow), true, "and it actually lands inside the window");
  assert.equal(dublinClock(opening).day, 1, "which is Monday — the weekend is skipped, not called through");
  assert.ok(opening.getTime() > fridayNight.getTime());

  // A single-day-a-week window still resolves (the search covers 8 days).
  const sundaysOnly = normalizeFlow({ windowDays: [0], windowStart: "10:00", windowEnd: "12:00" });
  const fromMonday = nextWindowOpening(new Date("2026-07-06T12:00:00Z"), sundaysOnly)!;
  assert.ok(fromMonday, "a once-a-week window is still found");
  assert.equal(dublinClock(fromMonday).day, 0);

  // ── 5. retries ──
  const base = new Date("2026-07-06T10:00:00Z");
  assert.equal(
    nextAttemptAt(base, { ...flow, retryAfterHours: 4 }).getTime() - base.getTime(),
    4 * 60 * 60_000,
  );

  // ── 6. the diagram is generated from the config ──
  const armed = normalizeFlow({ ...flow, enabled: true, triggerDelayMinutes: 5, maxAttempts: 3, retryAfterHours: 4 });
  const steps = describeFlow(armed);
  assert.deepEqual(
    steps.map((s) => s.kind),
    ["trigger", "wait", "checks", "call", "branch"],
    "the spine is fixed",
  );
  assert.match(steps[1].detail, /5 minutes/);
  assert.match(steps[2].detail, /Mon to Fri/);
  assert.match(steps[2].detail, /09:00 and 20:00/);
  const noAnswer = steps[4].branches!.find((b) => b.label === "No answer")!;
  assert.match(noAnswer.detail, /4 hours/);
  assert.match(noAnswer.detail, /3 attempts/);

  // Change the config and the sentences change with it — this is what stops
  // the diagram describing behaviour that isn't configured.
  const once = describeFlow(normalizeFlow({ ...armed, maxAttempts: 1 }));
  assert.match(once[4].branches!.find((b) => b.label === "No answer")!.detail, /Don't try again/);

  const disarmed = describeFlow(normalizeFlow({ ...armed, enabled: false }));
  assert.match(disarmed[0].detail, /off/i, "a disarmed flow says so at the trigger, not silently");

  // The opt-out branch is not configurable, and says so.
  const optOut = steps[4].branches!.find((b) => b.label.includes("not to be called"))!;
  assert.equal(optOut.fields.length, 0, "nothing about the opt-out is editable");
  assert.match(optOut.detail, /can't be turned off/i);

  console.log("voice/flow.test.ts: all assertions passed");
})();
