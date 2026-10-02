// Run: npm test -- src/lib/dashboard/widgets/overview.test.ts
//
// fillDays: revenue rows only exist for days that had revenue; the chart
// needs every day in the window, zero-filled, in order.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn, createElement: () => null };
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);
const { fillDays } = requireLocal("../series") as typeof import("../series");

const out = fillDays([{ day: "2026-09-02", total: 50 }], "2026-09-01", 3);
assert.deepEqual(out, [
  { day: "2026-09-01", total: 0 },
  { day: "2026-09-02", total: 50 },
  { day: "2026-09-03", total: 0 },
]);
assert.deepEqual(fillDays([], "2026-09-30", 2).map((d) => d.day), ["2026-09-30", "2026-10-01"]);

console.log("overview.test.ts: ok");
