// Run: npm test -- src/lib/research/topics.test.ts
//
// Content-gap analysis's one AI step (lib/research/topics.ts).
// deriveSiteTopics takes `tenantId` as an explicit parameter (unlike
// summary.ts's helpers, which derive it via getCurrentTenant()) and topics.ts
// itself only imports @/lib/ai/client + @/lib/ai/metered — NEITHER of which
// touches react's cache() or next/navigation (metered.ts -> usage.ts ->
// @/lib/db/control, a plain better-sqlite3/drizzle connection with no
// tenant-cookie machinery at all) — so this file needs no Module._load shim,
// a plain top-level import, same reasoning as places.test.ts being shim-free.
//
// Covers:
//   1. parseTopicsResponse — pure, plain literals.
//   2. deriveSiteTopics's short-circuit (no pages -> [] with no AI call) and
//      its real fail-soft path: this test environment deliberately has no
//      ANTHROPIC_API_KEY (same reality summary.test.ts's competitorThemes/
//      landscapeSummary tests already rely on), so a real call exercises the
//      genuine "AI unavailable" branch -> [], never throws — matching
//      summary.ts's exact contract, just with `[]` as the neutral fallback
//      instead of a fallback string (topics.ts's own doc comment explains
//      why there's no equivalent fallback STRING to compute here).
import assert from "node:assert/strict";
import { parseTopicsResponse, deriveSiteTopics, type SiteTopicsPageInput } from "./topics";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

(async () => {
  // ════════════════════════════════════════════════════════════════════
  // 1. parseTopicsResponse
  // ════════════════════════════════════════════════════════════════════
  check(
    "parseTopicsResponse: a clean JSON array parses straight through",
    JSON.stringify(parseTopicsResponse('["sports massage","deep tissue massage"]')) ===
      JSON.stringify(["sports massage", "deep tissue massage"]),
  );

  check(
    "parseTopicsResponse: strips a ```json fence the model added despite being asked not to",
    JSON.stringify(parseTopicsResponse('```json\n["yoga","pilates"]\n```')) === JSON.stringify(["yoga", "pilates"]),
  );

  check(
    "parseTopicsResponse: strips a bare ``` fence too",
    JSON.stringify(parseTopicsResponse('```\n["yoga"]\n```')) === JSON.stringify(["yoga"]),
  );

  check(
    "parseTopicsResponse: dedupes case-insensitively, first-seen casing wins",
    JSON.stringify(parseTopicsResponse('["Yoga","yoga","YOGA","Pilates"]')) === JSON.stringify(["Yoga", "Pilates"]),
  );

  check("parseTopicsResponse: trims whitespace on each entry", JSON.stringify(parseTopicsResponse('["  yoga  "]')) === JSON.stringify(["yoga"]));

  check("parseTopicsResponse: drops empty/whitespace-only entries", JSON.stringify(parseTopicsResponse('["yoga","","   "]')) === JSON.stringify(["yoga"]));

  check("parseTopicsResponse: drops non-string entries without throwing", JSON.stringify(parseTopicsResponse('["yoga",42,null,{"a":1}]')) === JSON.stringify(["yoga"]));

  check("parseTopicsResponse: caps at 15", parseTopicsResponse(JSON.stringify(Array.from({ length: 30 }, (_, i) => `topic ${i}`))).length === 15);

  check("parseTopicsResponse: malformed JSON -> []", parseTopicsResponse("not json at all").length === 0);
  check("parseTopicsResponse: a JSON object (not array) -> []", parseTopicsResponse('{"topics":["yoga"]}').length === 0);
  check("parseTopicsResponse: empty string -> []", parseTopicsResponse("").length === 0);
  check("parseTopicsResponse: an empty array -> []", parseTopicsResponse("[]").length === 0);

  assert.doesNotThrow(() => parseTopicsResponse("<<<garbage>>>"));

  // ════════════════════════════════════════════════════════════════════
  // 2. deriveSiteTopics
  // ════════════════════════════════════════════════════════════════════

  const noPagesResult = await deriveSiteTopics(999999, "Empty Site", []);
  check("deriveSiteTopics: no pages -> [] with no AI call attempted", Array.isArray(noPagesResult) && noPagesResult.length === 0);

  const pages: SiteTopicsPageInput[] = [
    { title: "Sports Massage Clonmel", h1: "Sports Massage & Recovery" },
    { title: "Deep Tissue Massage", h1: null },
  ];

  // This test environment deliberately has no ANTHROPIC_API_KEY (see this
  // file's own header comment) — meteredCreate's real getAnthropic() throws
  // "AI unavailable", caught by deriveSiteTopics's own try/catch -> [].
  await assert.doesNotReject(async () => {
    const result = await deriveSiteTopics(999999, "Testable Site", pages);
    check("deriveSiteTopics: AI-unavailable in this test env falls back to [] (never throws)", Array.isArray(result) && result.length === 0);
  });

  console.log(`\ntopics: ${passed} checks passed.`);
})();
