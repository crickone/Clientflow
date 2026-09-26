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

const {
  extractIdeaObjects: extract,
  normaliseHook,
  similarHooks,
  dedupeIdeas,
  pickAngles,
  IDEA_ANGLES,
} = requireLocal("./postIdeas") as typeof import("./postIdeas");

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


// ── THE REPEAT BUG: the same ideas came back run after run ────────────────
//
// The generator sent an identical prompt every time and remembered nothing it
// had proposed, so "New ideas" returned the same angles with new wording. The
// prompt now carries an avoid list and a fresh set of angles; these pin the
// half that is a guarantee rather than a request — the reply filter.

const mk = (hook: string, pillar = "Strength") => ({
  pillar,
  hook,
  teaches: "t",
  basis: "b",
});

// normaliseHook — the "literally the same line" key
{
  ok("casing and punctuation are ignored", normaliseHook("Why Protein, Really?") === "why protein really");
  ok("whitespace is collapsed", normaliseHook("  a   b  ") === "a b");
}

// similarHooks — the repeats that actually annoy an operator are rephrasings
{
  ok(
    "a verbatim repeat is caught",
    similarHooks("Why progressive overload stalls", "why progressive overload stalls!"),
  );
  ok(
    "a rephrasing is caught",
    similarHooks(
      "Why protein timing matters less than total intake",
      "Protein timing vs total daily intake: what actually matters",
    ),
  );
  ok(
    "two genuinely different ideas are left alone",
    !similarHooks(
      "Why protein timing matters less than total intake",
      "How sleep debt blunts strength gains",
    ),
  );
  ok(
    "short hooks sharing under three content words do not trip",
    !similarHooks("Sleep and recovery", "Recovery and rest days"),
  );
  ok("an empty hook never matches", !similarHooks("", "anything at all"));
}

// dedupeIdeas — the guarantee behind the prompt's request
{
  const batch = [
    mk("Why progressive overload stalls"),
    mk("Protein timing vs total daily intake: what actually matters"),
    mk("How sleep debt blunts strength gains"),
  ];
  const kept = dedupeIdeas(batch, ["Why protein timing matters less than total intake"], 6);
  ok("an idea already proposed is dropped", kept.length === 2);
  ok("the dropped one is the rephrasing", !kept.some((k) => k.hook.startsWith("Protein timing")));
  ok("the new ideas survive", kept[0].hook === "Why progressive overload stalls");
}
{
  const batch = [mk("Why progressive overload stalls"), mk("Why progressive overload stalls")];
  ok("a duplicate INSIDE one batch is dropped too", dedupeIdeas(batch, [], 6).length === 1);
}
{
  const batch = [mk("A"), mk("B"), mk("C"), mk("D")];
  ok("the requested count is the ceiling", dedupeIdeas(batch, [], 2).length === 2);
}
{
  // Fewer-than-asked is the intended outcome, not an error: five new ideas
  // beats six of which two were seen last week.
  const batch = [mk("Why progressive overload stalls")];
  ok("everything filtered out yields nothing", dedupeIdeas(batch, ["why progressive overload stalls"], 6).length === 0);
}
{
  ok("an empty avoid list keeps everything", dedupeIdeas([mk("A"), mk("B")], [], 6).length === 2);
  ok("blank entries in the avoid list are ignored", dedupeIdeas([mk("A")], ["", "   "], 6).length === 1);
}

// pickAngles — the request itself must differ run to run
{
  const angles = pickAngles(6, () => 0.5);
  ok("the requested number of angles comes back", angles.length === 6);
  ok("angles are distinct", new Set(angles).size === 6);
  ok("angles come from the catalogue", angles.every((a) => IDEA_ANGLES.includes(a)));
  ok(
    "asking for more than the catalogue holds does not repeat one",
    pickAngles(99).length === IDEA_ANGLES.length,
  );
  // Different draws on the same catalogue: with a real shuffle two runs of six
  // out of fourteen should differ. Pinned with a counter so it cannot flake.
  let i = 0;
  const seq = () => ((i = (i + 7) % 11), i / 11);
  const a = pickAngles(6, seq);
  const b = pickAngles(6, seq);
  ok("consecutive draws are not identical", a.join("|") !== b.join("|"));
}

console.log(`postIdeas.test.ts: all ${passed} assertions passed`);
