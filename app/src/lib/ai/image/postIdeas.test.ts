// Run: npm test -- src/lib/ai/image/postIdeas.test.ts
//
// The post-ideas reply parser.
//
// THE BUG THIS PINS: asking for six in-depth ideas overflowed max_tokens, the
// reply was cut off mid-array, JSON.parse threw, and the whole batch was
// discarded — the operator saw "no ideas came back" while five perfectly good
// ideas sat in the response. Parsing must salvage what survived.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  if (request.endsWith("/businessContext")) return { getBusinessContext: () => "" };
  if (request.endsWith("/metered")) return { meteredCreateFailSoft: async () => [] };
  if (request.endsWith("/client")) return { CONTENT_MODEL: "test" };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const { extractIdeaObjects: extract } =
  requireLocal("./postIdeas") as typeof import("./postIdeas");

const idea = (n: number) =>
  `{"pillar":"Strength","hook":"Hook ${n}","teaches":"Teaches ${n}","basis":"Basis ${n}"}`;

// ── Clean, complete JSON ──────────────────────────────────────────────────
{
  const text = `{"ideas":[${idea(1)},${idea(2)},${idea(3)}]}`;
  const got = extract(text);
  ok("a clean reply yields every idea", got.length === 3);
  ok("fields survive the clean parse", got[0].hook === "Hook 1");
}

// ── Prose around the JSON (models like to introduce themselves) ───────────
{
  const text = `Here are your ideas:\n\n{"ideas":[${idea(1)},${idea(2)}]}\n\nHope these help.`;
  ok("JSON is found inside surrounding prose", extract(text).length === 2);
}

// ── THE REGRESSION: truncated mid-array ───────────────────────────────────
{
  // Four complete ideas, then the fifth cut off exactly as the token limit did.
  const text =
    `{"ideas":[${idea(1)},${idea(2)},${idea(3)},${idea(4)},` +
    `{"pillar":"Nutrition","hook":"Half a hook","teaches":"cut off here`;
  const got = extract(text);
  ok("a truncated reply still yields the complete ideas", got.length === 4);
  ok("the salvaged ideas are intact", got[3].hook === "Hook 4");
  ok("the half-written idea is dropped", !got.some((g) => g.hook === "Half a hook"));
}

// ── Braces inside string values must not confuse the scanner ──────────────
{
  const text =
    `{"ideas":[{"pillar":"P","hook":"Use {curly} braces","teaches":"a } inside text","basis":"b"},${idea(2)}]}`;
  const got = extract(text);
  ok("braces inside strings don't split an object", got.length === 2);
  ok("the value containing braces is preserved", got[0].hook === "Use {curly} braces");
}

// ── Escaped quotes inside values ──────────────────────────────────────────
{
  const text = `{"ideas":[{"pillar":"P","hook":"They say \\"too old\\" to lift","teaches":"t","basis":"b"}]}`;
  const got = extract(text);
  ok("escaped quotes are handled", got.length === 1 && String(got[0].hook).includes('"too old"'));
}

// ── Nothing usable ────────────────────────────────────────────────────────
ok("empty text yields nothing", extract("").length === 0);
ok("prose with no JSON yields nothing", extract("I couldn't come up with any.").length === 0);

console.log(`postIdeas.test.ts: all ${passed} assertions passed`);
