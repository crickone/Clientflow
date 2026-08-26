// Run: npm test -- src/lib/research/keywords.test.ts
//
// Content-gap analysis's seed keyword list (lib/research/keywords.ts).
// Mirrors buildModel.test.ts exactly: keywords.ts imports `@/lib/settings`
// DYNAMICALLY inside its two async functions specifically so its PURE
// function (`sanitizeResearchKeywords`) stays importable/testable with a
// plain top-level import — no Module._load shim, no scratch tenant. The
// async `getResearchKeywords`/`setResearchKeywords` wrappers are NOT
// exercised here, for the same reason buildModel.test.ts never calls
// `getCampaignBuildModel`/`setCampaignBuildModel`: actually invoking the
// dynamic `import("@/lib/settings")` drags in react's `cache()`, whose
// react-server package entry throws under this test runner's
// `--conditions=react-server` (confirmed directly against this exact
// codepath — see keywords.ts's own doc comment). `sanitizeResearchKeywords`
// is the whole reason those two stay thin wrappers, so testing it
// thoroughly here is what actually matters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeResearchKeywords } from "./keywords";

test("sanitizeResearchKeywords: trims each entry", () => {
  assert.deepEqual(sanitizeResearchKeywords(["  sports massage  ", "deep tissue"]), ["sports massage", "deep tissue"]);
});

test("sanitizeResearchKeywords: drops empty / whitespace-only entries", () => {
  assert.deepEqual(sanitizeResearchKeywords(["sports massage", "", "   ", "deep tissue"]), ["sports massage", "deep tissue"]);
});

test("sanitizeResearchKeywords: dedupes case-insensitively, first-seen casing wins", () => {
  assert.deepEqual(sanitizeResearchKeywords(["Sports Massage", "sports massage", "SPORTS MASSAGE"]), ["Sports Massage"]);
});

test("sanitizeResearchKeywords: caps the list at 30", () => {
  const many = Array.from({ length: 50 }, (_, i) => `keyword ${i}`);
  const out = sanitizeResearchKeywords(many);
  assert.equal(out.length, 30);
  assert.deepEqual(out, many.slice(0, 30));
});

test("sanitizeResearchKeywords: caps a single very long entry's length rather than dropping it", () => {
  const long = "x".repeat(500);
  const out = sanitizeResearchKeywords([long]);
  assert.equal(out.length, 1);
  assert.ok(out[0].length < long.length, "an over-long keyword is truncated, not passed through verbatim");
  assert.equal(out[0].length, 80);
});

test("sanitizeResearchKeywords: non-string entries are ignored, never throw", () => {
  const withJunk = ["real keyword", 42, null, undefined, {}, []] as unknown as string[];
  assert.doesNotThrow(() => sanitizeResearchKeywords(withJunk));
  assert.deepEqual(sanitizeResearchKeywords(withJunk), ["real keyword"]);
});

test("sanitizeResearchKeywords: empty input -> []", () => {
  assert.deepEqual(sanitizeResearchKeywords([]), []);
});

test("sanitizeResearchKeywords: preserves given order (no re-sorting)", () => {
  assert.deepEqual(sanitizeResearchKeywords(["zebra", "apple", "mango"]), ["zebra", "apple", "mango"]);
});
