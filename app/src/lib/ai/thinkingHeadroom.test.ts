// Run: npm test -- src/lib/ai/thinkingHeadroom.test.ts
//
// withThinkingHeadroom: on the 5.5 models (always thinking), a call site that
// set no effort gets one sized to the job plus room for the thinking, so the
// answer is not starved (post ideas came back empty at 8,000 tokens).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};
const { withThinkingHeadroom } = createRequire(import.meta.url)("./metered") as typeof import("./metered");

const base = { messages: [{ role: "user" as const, content: "x" }] };
const big = withThinkingHeadroom({ ...base, model: "claude-sonnet-5-5", max_tokens: 8000 }) as { max_tokens: number; output_config?: { effort?: string } };
assert.equal(big.output_config?.effort, "medium", "large job: medium effort");
assert.equal(big.max_tokens, 16000, "large job: 8,000 extra for thinking");
const small = withThinkingHeadroom({ ...base, model: "claude-sonnet-5-5", max_tokens: 300 }) as { max_tokens: number; output_config?: { effort?: string } };
assert.equal(small.output_config?.effort, "low", "short answer: low effort");
assert.equal(small.max_tokens, 4300, "short answer: 4,000 extra");
const chosen = withThinkingHeadroom({ ...base, model: "claude-sonnet-5-5", max_tokens: 4096, output_config: { effort: "high" } } as never) as { max_tokens: number };
assert.equal(chosen.max_tokens, 4096, "an explicit effort is left alone");
const haiku = withThinkingHeadroom({ ...base, model: "claude-haiku-4-5", max_tokens: 300 }) as { max_tokens: number; output_config?: unknown };
assert.ok(haiku.max_tokens === 300 && !haiku.output_config, "other models untouched");
console.log("thinkingHeadroom: all checks passed.");
