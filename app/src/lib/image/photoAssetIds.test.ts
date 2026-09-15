// Run: npm test -- src/lib/image/photoAssetIds.test.ts
//
// A slide's photographs have to survive a reload, or a re-render comes back
// with different pictures than the operator chose. background_asset_id holds
// one integer; this is the second slot's home, and the bridge for the tens of
// thousands of rows that predate it.
import assert from "node:assert/strict";

import { parsePhotoAssetIds, serialisePhotoAssetIds } from "./photoAssetIds";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

check(
  "an old row with no JSON reads as its background asset in slot 1",
  eq(parsePhotoAssetIds(null, 7), [7]),
);
check(
  "an old row with no photograph at all reads as empty",
  eq(parsePhotoAssetIds(null, null), []),
);
check(
  "a stored pair reads back in order",
  eq(parsePhotoAssetIds("[7,9]", 7), [7, 9]),
);
check(
  "a slot with no photograph round-trips as null",
  eq(parsePhotoAssetIds("[7,null]", 7), [7, null]),
);
check(
  "malformed JSON falls back to the background asset rather than throwing",
  eq(parsePhotoAssetIds("not json", 7), [7]),
);
check(
  "a JSON value that is not an array falls back too",
  eq(parsePhotoAssetIds('{"a":1}', 7), [7]),
);
check(
  "non-numeric entries become null rather than poisoning the render",
  eq(parsePhotoAssetIds('["x",9]', null), [null, 9]),
);
check(
  "more slots than the cap are dropped",
  eq(parsePhotoAssetIds("[1,2,3]", 1), [1, 2]),
);

check("serialising a pair gives compact JSON", serialisePhotoAssetIds([7, 9]) === "[7,9]");
check(
  "a single photograph stores null -- background_asset_id already says it",
  serialisePhotoAssetIds([7]) === null,
);
check("no photographs stores null", serialisePhotoAssetIds([]) === null);
check("a null second slot is still worth storing", serialisePhotoAssetIds([7, null]) === "[7,null]");

console.log(`\nphotoAssetIds: ${passed} checks passed`);
