// Run: npm test -- src/lib/agents/specialists/orchestratorFollowups.test.ts
//
// The example block in Adonis's playbook must parse with the chat's own
// parser, or the model would learn a format the page cannot read.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called in orchestratorFollowups.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);
const { ORCHESTRATOR_SPECIALIST } = requireLocal("./orchestrator") as typeof import("./orchestrator");
const { splitFollowups } = requireLocal("../../../components/adonis/chat/followups") as typeof import("@/components/adonis/chat/followups");

const pb = ORCHESTRATOR_SPECIALIST.basePlaybook;
const start = pb.indexOf("<followups>");
const end = pb.indexOf("</followups>");
assert.ok(start !== -1 && end > start, "the playbook shows the block");
const parsed = splitFollowups(`Answer.\n${pb.slice(start, end + "</followups>".length)}`);
assert.equal(parsed.body, "Answer.", "the example block is hidden");
assert.equal(parsed.followups.length, 2, "and its two lines read back");
assert.ok(parsed.complete);
assert.ok(pb.includes("Leave the block out when an Approve card is waiting"), "no suggestions under an Approve card");

console.log("orchestrator follow-ups: all checks passed");
