// Run: npm test -- src/lib/design/grammar.test.ts
//
// The grammar is the gate between a language model and a canvas. Its whole
// job is to say no: an archetype outside the vocabulary, a colour the tenant
// does not own, a span wider than the grid, a photo treatment the composition
// cannot hold. Every one of those has a test here, because every one of them
// is a way a generated slide could otherwise reach an operator broken.
import assert from "node:assert/strict";

import {
  ARCHETYPES,
  archetypeRule,
  deserializeLayoutSpec,
  isSpecError,
  parseLayoutSpec,
  serializeLayoutSpec,
  type LayoutSpec,
} from "./grammar";
import { TYPE_LEVELS } from "./parse";
import { OPTIMAL_HEALTH_DESIGN_SYSTEM as SYSTEM } from "./presets";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

/** A spec that parses, so each rejection test breaks exactly one thing. */
function valid(): Record<string, unknown> {
  return {
    archetype: "stack",
    ground: "plaster",
    photo: "none",
    align: "left",
    slots: [
      { level: "label", text: "WHERE TO START", span: 3 },
      { level: "headline", text: "Recovery is a practice, not an event", span: 4 },
      { level: "body", text: "Three sessions a week.", span: 4 },
    ],
    accentRule: { value: "timber", place: "above" },
  };
}

function parse(mutate?: (s: Record<string, any>) => void) {
  const s = valid();
  mutate?.(s);
  return parseLayoutSpec(s, SYSTEM);
}

/** Assert a mutation is rejected, and that the message names what was wrong —
 *  these strings are the model's only feedback in the repair call. */
function rejects(
  name: string,
  mutate: (s: Record<string, any>) => void,
  mustMention: string,
) {
  const r = parse(mutate);
  const failed = isSpecError(r);
  check(
    `rejects: ${name}`,
    failed && r.error.toLowerCase().includes(mustMention.toLowerCase()),
  );
}

// -- The vocabulary ------------------------------------------------------

check("six archetypes", ARCHETYPES.length === 6);
check(
  "every archetype has a rule reachable by name",
  ARCHETYPES.every((r) => archetypeRule(r.archetype) === r),
);
check("an unknown archetype has no rule", archetypeRule("collage") === null);
check(
  "every archetype's slot bounds are sane",
  ARCHETYPES.every((r) => r.slots.min >= 1 && r.slots.max >= r.slots.min),
);
check(
  "every archetype allows at least one photo treatment",
  ARCHETYPES.every((r) => r.photo.length >= 1),
);
check(
  "half-width photography belongs to split alone",
  ARCHETYPES.filter((r) => r.photo.includes("half")).map((r) => r.archetype)
    .join() === "split",
);
check(
  "a list slide never carries a photograph",
  archetypeRule("list")!.photo.join() === "none",
);

// -- The happy path ------------------------------------------------------

const ok = parse();
check("a well-formed spec parses", !isSpecError(ok));
const spec = ok as LayoutSpec;
check("the archetype survives", spec.archetype === "stack");
check("the ground survives", spec.ground === "plaster");
check("all three slots survive", spec.slots.length === 3);
check("the accent rule survives", spec.accentRule?.value === "timber");
check("alignment is flush left", spec.align === "left");
check(
  "no photoSide is invented for a non-split slide",
  spec.photoSide === undefined,
);

// Alignment is defaulted, not demanded — the model should not have to restate
// a rule with one legal answer.
check("align may be omitted", !isSpecError(parse((s) => delete s.align)));

// A split slide gets its side defaulted rather than rejected.
const split = parse((s) => {
  s.archetype = "split";
  s.photo = "half";
  delete s.accentRule;
}) as LayoutSpec;
check("a split slide defaults its photo to the right", split.photoSide === "right");
check(
  "an explicit photoSide is honoured",
  (parse((s) => {
    s.archetype = "split";
    s.photo = "half";
    s.photoSide = "left";
  }) as LayoutSpec).photoSide === "left",
);

// Every type level in the system is usable.
check(
  "every level of the type scale is a legal slot level",
  TYPE_LEVELS.every(
    (level) => !isSpecError(parse((s) => (s.slots[1].level = level))),
  ),
);

// The full column count is legal; one more is not.
check(
  "a slot may span the whole grid",
  !isSpecError(parse((s) => (s.slots[1].span = SYSTEM.grid.columns))),
);

// -- Rejections ----------------------------------------------------------

check("rejects a non-object", isSpecError(parseLayoutSpec("stack", SYSTEM)));
check("rejects null", isSpecError(parseLayoutSpec(null, SYSTEM)));
check("rejects an array", isSpecError(parseLayoutSpec([], SYSTEM)));

rejects("an archetype outside the vocabulary", (s) => (s.archetype = "collage"), "collage");
rejects("a missing archetype", (s) => delete s.archetype, "archetype");
rejects("a colour the tenant does not own", (s) => (s.ground = "moss"), "moss");
rejects(
  "a real value that is not a ground",
  (s) => (s.ground = "timber"),
  "not a ground",
);
rejects(
  "the reserved value as a ground",
  (s) => (s.ground = "navy"),
  "not a ground",
);
rejects("an unknown photo treatment", (s) => (s.photo = "background"), "photo");
rejects(
  "half-width photography on a stack",
  (s) => (s.photo = "half"),
  "cannot take",
);
rejects(
  "a photograph on a list slide",
  (s) => {
    s.archetype = "list";
    s.photo = "full";
    s.slots = [
      { level: "headline", text: "Four things", span: 4 },
      { level: "body", text: "One", span: 4 },
      { level: "body", text: "Two", span: 4 },
      { level: "body", text: "Three", span: 4 },
    ];
  },
  "cannot take",
);
rejects(
  "photoSide on a slide with no halves",
  (s) => (s.photoSide = "left"),
  "only meaningful on a split",
);
rejects("an unknown photoSide", (s) => {
  s.archetype = "split";
  s.photo = "half";
  s.photoSide = "top";
}, "photoside");
rejects("centred type", (s) => (s.align = "center"), "flush left");
rejects("no slots array", (s) => delete s.slots, "no slots");
rejects("too few slots for the archetype", (s) => (s.slots = [s.slots[0]]), "2-4");
rejects(
  "too many slots for the archetype",
  (s) => (s.slots = [...s.slots, ...s.slots]),
  "2-4",
);
rejects("a slot that is not an object", (s) => (s.slots[1] = "heading"), "slot 2");
rejects("a type level outside the scale", (s) => (s.slots[1].level = "hero"), "hero");
rejects("a slot with no text", (s) => delete s.slots[2].text, "slot 3");
rejects(
  "a span wider than the grid",
  (s) => (s.slots[1].span = SYSTEM.grid.columns + 1),
  "columns",
);
rejects("a zero span", (s) => (s.slots[1].span = 0), "columns");
rejects("a fractional span", (s) => (s.slots[1].span = 2.5), "columns");
rejects(
  "an accent rule in a colour the tenant does not own",
  (s) => (s.accentRule.value = "gold"),
  "gold",
);
rejects(
  "an accent rule placed somewhere that is not above or below",
  (s) => (s.accentRule.place = "left"),
  "placement",
);

// -- Storage round-trip --------------------------------------------------

const json = serializeLayoutSpec(spec);
const back = deserializeLayoutSpec(json, SYSTEM);
check("a spec round-trips through storage", !isSpecError(back));
check(
  "and comes back identical",
  JSON.stringify(back) === JSON.stringify(spec),
);
check(
  "a null stored layout is an error, not a crash",
  isSpecError(deserializeLayoutSpec(null, SYSTEM)),
);
check(
  "corrupt stored JSON is an error, not a crash",
  isSpecError(deserializeLayoutSpec("{not json", SYSTEM)),
);
check(
  "stored JSON that is valid but not a spec is an error",
  isSpecError(deserializeLayoutSpec('{"archetype":"collage"}', SYSTEM)),
);

// Parsing is total.
let threw = false;
for (const input of [NaN, () => {}, Symbol("x"), new Date(), { slots: null }]) {
  try {
    parseLayoutSpec(input as unknown, SYSTEM);
  } catch {
    threw = true;
  }
}
check("parsing never throws, whatever it is handed", !threw);

console.log(`\ngrammar: ${passed} checks passed`);
