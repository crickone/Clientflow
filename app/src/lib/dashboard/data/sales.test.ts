// Run: npm test -- src/lib/dashboard/data/sales.test.ts
import assert from "node:assert/strict";
import { conversionByGroup, topNWithOther, wonLostCounts } from "./sales";
import { seriesBuckets } from "./stats";

const rows = [
  ...Array.from({ length: 4 }, (_, i) => ({ group: "Facebook", won: i < 1 })),
  ...Array.from({ length: 3 }, (_, i) => ({ group: "Google", won: i < 3 })),
  { group: "Tiny", won: true },
  { group: "Tiny", won: false },
  { group: null, won: false },
  { group: null, won: true },
  { group: null, won: false },
];
const out = conversionByGroup(rows);
assert.deepEqual(out, [
  { label: "Google", won: 3, total: 3, pct: 100 },
  { label: "Facebook", won: 1, total: 4, pct: 25 },
  { label: "Not stated", won: 1, total: 3, pct: 33.3 },
].sort((a, b) => b.pct - a.pct), "min size 3, null -> Not stated, sorted by pct desc");
assert.equal(conversionByGroup(rows, 5).length, 0);

const many = Array.from({ length: 10 }, (_, i) => ({ label: `s${i}`, value: 10 - i }));
const top = topNWithOther(many, 8);
assert.equal(top.length, 9);
assert.deepEqual(top[8], { label: "Other", value: 2 + 1 });
assert.deepEqual(top[0], { label: "s0", value: 10 });
assert.deepEqual(topNWithOther(many.slice(0, 3), 8).length, 3, "no Other when within n");
assert.deepEqual(topNWithOther([{ label: "a", value: 1 }, { label: "b", value: 5 }], 8)[0].label, "b", "sorted desc");

{
  const DAY = 86_400_000;
  const from = Date.UTC(2026, 8, 1);
  const buckets = seriesBuckets(from, from + 3 * DAY);
  const won = new Set([10, 11]);
  const lost = new Set([20]);
  const ev = (leadId: number, fromStageId: number | null, toStageId: number, day: number) => ({ leadId, fromStageId, toStageId, atMs: from + day * DAY + 1000 });
  const out = wonLostCounts(
    [
      ev(1, 5, 10, 0), // won
      ev(1, 10, 11, 0), // won -> repeat: already won, skipped
      ev(2, 5, 10, 1), // won
      ev(2, 10, 5, 1), // back out
      ev(2, 5, 10, 1), // won again same bucket: de-duplicated
      ev(3, 5, 20, 2), // lost
      ev(3, 20, 5, 2),
      ev(3, 5, 20, 2), // lost twice same bucket: de-duplicated
    ],
    won,
    lost,
    buckets,
  );
  assert.deepEqual(out.map((b) => [b.Won, b.Lost]), [[1, 0], [1, 0], [0, 1]]);
}

console.log("sales.test.ts: ok");
