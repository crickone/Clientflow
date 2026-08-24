// Run: npm test -- src/lib/research/themesJson.test.ts
//
// Task 11 (Market Research P1) — the shared `themes_json` cache parser
// (extracted from CompetitorDetail.tsx's T10 private helper). Pure, zero
// imports beyond the module under test (same style as distance.test.ts): no
// Module shim needed.
import assert from "node:assert/strict";

import { parseStoredThemes } from "./themesJson";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

(async () => {
  check("parseStoredThemes: null -> null", parseStoredThemes(null) === null);
  check("parseStoredThemes: empty string -> null", parseStoredThemes("") === null);
  check("parseStoredThemes: invalid JSON -> null, never throws", parseStoredThemes("{not json") === null);
  check("parseStoredThemes: valid JSON but not an object (e.g. a bare number) -> null", parseStoredThemes("42") === null);
  check(
    "parseStoredThemes: an object missing `at` -> null",
    parseStoredThemes(JSON.stringify({ themes: ["Great staff"] })) === null,
  );
  check(
    "parseStoredThemes: an object where `themes` isn't an array -> null",
    parseStoredThemes(JSON.stringify({ themes: "Great staff", at: "2026-08-24T00:00:00.000Z" })) === null,
  );
  check(
    "parseStoredThemes: an empty themes array -> null (nothing to show)",
    parseStoredThemes(JSON.stringify({ themes: [], at: "2026-08-24T00:00:00.000Z" })) === null,
  );
  check(
    "parseStoredThemes: a themes array of only blank/whitespace strings -> null",
    parseStoredThemes(JSON.stringify({ themes: ["", "   "], at: "2026-08-24T00:00:00.000Z" })) === null,
  );

  const happy = parseStoredThemes(
    JSON.stringify({ themes: ["Friendly staff", "Clean equipment"], at: "2026-08-24T09:00:00.000Z" }),
  );
  check("parseStoredThemes: happy path -> non-null", happy !== null);
  check("parseStoredThemes: happy path -> themes round-trip", JSON.stringify(happy?.themes) === JSON.stringify(["Friendly staff", "Clean equipment"]));
  check("parseStoredThemes: happy path -> at round-trips", happy?.at === "2026-08-24T09:00:00.000Z");

  const mixedTypes = parseStoredThemes(
    JSON.stringify({ themes: ["Real theme", 42, null, "  ", "Another real one"], at: "2026-08-24T09:00:00.000Z" }),
  );
  check(
    "parseStoredThemes: non-string / blank entries are filtered out, real ones kept",
    JSON.stringify(mixedTypes?.themes) === JSON.stringify(["Real theme", "Another real one"]),
  );

  console.log(`\nthemesJson: ${passed} checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
