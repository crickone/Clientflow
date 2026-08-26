// Run: npm test -- src/lib/research/gaps.test.ts
//
// Content-gap analysis — pure gap math (lib/research/gaps.ts's
// computeContentGaps + normaliseTopic). Zero imports in gaps.ts itself, so
// this file needs no Module._load shim — a plain top-level import, mirroring
// buildModel.test.ts's simplicity for a pure module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeContentGaps, normaliseTopic, type GapCompetitorInput } from "./gaps";

const self = (topics: string[]): GapCompetitorInput => ({ name: "Your Site", isSelf: true, topics });
const comp = (name: string, topics: string[]): GapCompetitorInput => ({ name, isSelf: false, topics });

test("normaliseTopic: lowercase, trim, collapse whitespace, loose trailing-s singularise", () => {
  assert.equal(normaliseTopic("  Sports   Massage  "), "sports massage");
  assert.equal(normaliseTopic("Memberships"), "membership");
  assert.equal(normaliseTopic("membership"), "membership", "already-singular input is unaffected");
  assert.equal(normaliseTopic("Glass"), "glass", "a word ending 'ss' is never stripped");
  assert.equal(normaliseTopic("Gas"), "gas", "a short (<=3 char) word ending 's' is left alone");
  assert.equal(normaliseTopic("YOGA CLASSES"), "yoga classe", "documented simple rule — not a real stemmer");
});

test("computeContentGaps: empty inputs -> []", () => {
  assert.deepEqual(computeContentGaps({ competitors: [], seedKeywords: [] }), []);
  assert.deepEqual(computeContentGaps({ competitors: [self([])], seedKeywords: [] }), [], "self-only, no competitors, no keywords");
});

test("computeContentGaps: a topic you already cover is excluded, even if competitors have it too", () => {
  const gaps = computeContentGaps({
    competitors: [self(["Sports Massage"]), comp("Alpha Gym", ["Sports Massage", "Deep Tissue"])],
    seedKeywords: [],
  });
  assert.deepEqual(
    gaps.map((g) => g.topic),
    ["Deep Tissue"],
    "Sports Massage is covered by you -> excluded; Deep Tissue is not -> a gap",
  );
  assert.equal(gaps[0].coveredByYou, false);
  assert.equal(gaps[0].source, "competitors");
  assert.equal(gaps[0].exampleCompetitor, "Alpha Gym");
  assert.equal(gaps[0].competitorCount, 1);
  assert.equal(gaps[0].totalCompetitors, 1);
});

test("computeContentGaps: coverage match is case-insensitive and loosely-plural-tolerant", () => {
  const gaps = computeContentGaps({
    competitors: [self(["sports massage"]), comp("Alpha Gym", ["SPORTS MASSAGE", "Nutrition Plans"])],
    seedKeywords: [],
  });
  assert.deepEqual(gaps.map((g) => g.topic), ["Nutrition Plans"], "case differences alone don't create a false gap");

  const pluralGaps = computeContentGaps({
    competitors: [self(["nutrition plan"]), comp("Alpha Gym", ["Nutrition Plans"])],
    seedKeywords: [],
  });
  assert.deepEqual(pluralGaps, [], "a loose singular/plural match is still treated as covered");
});

test("computeContentGaps: ranked by competitorCount descending", () => {
  const gaps = computeContentGaps({
    competitors: [
      self([]),
      comp("Alpha", ["Yoga", "Pilates"]),
      comp("Beta", ["Yoga"]),
      comp("Gamma", ["Yoga", "Pilates", "Spin"]),
    ],
    seedKeywords: [],
  });
  assert.deepEqual(
    gaps.map((g) => g.topic),
    ["Yoga", "Pilates", "Spin"],
    "Yoga (3 competitors) > Pilates (2) > Spin (1)",
  );
  assert.equal(gaps[0].competitorCount, 3);
  assert.equal(gaps[1].competitorCount, 2);
  assert.equal(gaps[2].competitorCount, 1);
  assert.ok(gaps.every((g) => g.totalCompetitors === 3), "totalCompetitors is the non-self competitor count for every row");
});

test("computeContentGaps: a tie in competitorCount ranks alphabetically by display topic", () => {
  const gaps = computeContentGaps({
    competitors: [self([]), comp("Alpha", ["Zebra Topic", "Alpha Topic"])],
    seedKeywords: [],
  });
  assert.deepEqual(gaps.map((g) => g.topic), ["Alpha Topic", "Zebra Topic"]);
});

test("computeContentGaps: a competitor's own duplicate/near-duplicate topics count once", () => {
  const gaps = computeContentGaps({
    competitors: [self([]), comp("Alpha", ["Yoga", "yoga", "YOGA "])],
    seedKeywords: [],
  });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].competitorCount, 1, "one competitor repeating a topic 3 ways still counts as 1");
});

test("computeContentGaps: keyword-sourced gaps — not covered by you, regardless of competitor coverage", () => {
  const gaps = computeContentGaps({
    competitors: [self(["Sports Massage"]), comp("Alpha", ["Deep Tissue"])],
    seedKeywords: ["Sports Injury Clinic", "Sports Massage"],
  });
  // "Sports Massage" is already covered by you -> not a gap at all (even
  // though it's a seed keyword). "Sports Injury Clinic" is not covered by
  // you or any competitor -> still a gap, competitorCount 0.
  assert.deepEqual(gaps.map((g) => g.topic).sort(), ["Deep Tissue", "Sports Injury Clinic"]);
  const keywordGap = gaps.find((g) => g.topic === "Sports Injury Clinic")!;
  assert.equal(keywordGap.source, "keyword");
  assert.equal(keywordGap.competitorCount, 0, "no competitor covers it either — still a valid gap");
  assert.equal(keywordGap.exampleCompetitor, undefined, "no example when no competitor covers it");
});

test("computeContentGaps: keyword-sourced gap counts covering competitors when some do", () => {
  const gaps = computeContentGaps({
    competitors: [self([]), comp("Alpha", ["Sports Injury Clinic"]), comp("Beta", ["Something Else"])],
    seedKeywords: ["Sports Injury Clinic"],
  });
  const g = gaps.find((x) => x.topic === "Sports Injury Clinic")!;
  assert.equal(g.source, "competitors", "a keyword that ALSO happens to be a competitor topic is reported as competitors-sourced");
  assert.equal(g.competitorCount, 1);
  assert.equal(g.exampleCompetitor, "Alpha");
});

test("computeContentGaps: dedupe — a keyword matching a competitor topic merges into ONE row, source:'competitors' wins", () => {
  const gaps = computeContentGaps({
    competitors: [self([]), comp("Alpha", ["Sports Massage"]), comp("Beta", ["Sports Massage"])],
    seedKeywords: ["sports massage"], // same topic, different casing
  });
  const matches = gaps.filter((g) => normaliseSameAs(g.topic, "Sports Massage"));
  assert.equal(matches.length, 1, "no duplicate row for the same normalised topic across both sources");
  assert.equal(matches[0].source, "competitors");
  assert.equal(matches[0].competitorCount, 2, "the competitors-sourced count is unaffected by the merge");
});
function normaliseSameAs(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

test("computeContentGaps: no dupes even with overlapping seed keywords", () => {
  const gaps = computeContentGaps({
    competitors: [self([])],
    seedKeywords: ["Yoga", "yoga", "YOGA", "Pilates"],
  });
  assert.deepEqual(gaps.map((g) => g.topic).sort(), ["Pilates", "Yoga"], "seed-keyword duplicates collapse to one gap each");
});

test("computeContentGaps: empty/whitespace-only competitor topics and seed keywords are ignored, never crash", () => {
  const gaps = computeContentGaps({
    competitors: [self([]), comp("Alpha", ["", "   ", "Real Topic"])],
    seedKeywords: ["", "   ", "Real Keyword"],
  });
  assert.deepEqual(gaps.map((g) => g.topic).sort(), ["Real Keyword", "Real Topic"]);
});

test("computeContentGaps: only the isSelf-flagged row counts as 'you' — a non-self row is never treated as your own coverage", () => {
  const gaps = computeContentGaps({
    competitors: [comp("Alpha", ["Sports Massage"]), comp("Beta", ["Sports Massage"])],
    seedKeywords: [],
  });
  // No isSelf row at all -> nothing is "covered by you"; Sports Massage
  // still shows as a gap (2 competitors have it).
  assert.deepEqual(gaps.map((g) => g.topic), ["Sports Massage"]);
  assert.equal(gaps[0].competitorCount, 2);
});

test("computeContentGaps: result is capped at 40", () => {
  const manyTopics = Array.from({ length: 60 }, (_, i) => `Topic ${i}`);
  const gaps = computeContentGaps({ competitors: [self([]), comp("Alpha", manyTopics)], seedKeywords: [] });
  assert.equal(gaps.length, 40);
});

test("computeContentGaps: coveredByYou is always false on every returned gap (by construction — a covered topic never becomes a ContentGap)", () => {
  const gaps = computeContentGaps({
    competitors: [self(["Sports Massage"]), comp("Alpha", ["Sports Massage", "Deep Tissue"])],
    seedKeywords: ["Sports Massage", "Nutrition"],
  });
  assert.ok(gaps.every((g) => g.coveredByYou === false));
  assert.deepEqual(gaps.map((g) => g.topic).sort(), ["Deep Tissue", "Nutrition"]);
});

test("computeContentGaps: display topic keeps original casing/spacing even though comparison is normalised", () => {
  const gaps = computeContentGaps({
    competitors: [self([]), comp("Alpha", ["  Deep Tissue Massage  "])],
    seedKeywords: [],
  });
  assert.equal(gaps[0].topic, "Deep Tissue Massage", "leading/trailing whitespace trimmed, internal casing preserved");
});
