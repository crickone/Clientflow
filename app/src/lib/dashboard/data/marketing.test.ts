// Run: npm test -- src/lib/dashboard/data/marketing.test.ts
import assert from "node:assert/strict";
import { cacCents, mergeUpcoming, roasRatio, sourceLabel } from "./marketing";

assert.equal(cacCents(10000, 4), 2500);
assert.equal(cacCents(10001, 3), 3334, "rounded to whole cents");
assert.equal(cacCents(10000, 0), null);
assert.equal(cacCents(0, 3), 0);

assert.equal(roasRatio(30000, 10000), 3);
assert.equal(roasRatio(32000, 10000), 3.2);
assert.equal(roasRatio(1, 0), null);
assert.equal(roasRatio(0, 5000), 0);

assert.equal(sourceLabel("facebook", "l.facebook.com"), "facebook");
assert.equal(sourceLabel("", "google.com"), "google.com");
assert.equal(sourceLabel("", ""), "Direct");
assert.equal(sourceLabel("  ", "  "), "Direct");

const posts = [
  { name: "Post B", atMs: 2000 },
  { name: "Post A", atMs: 1000 },
];
const emails = [{ name: "Mail", atMs: 1500 }];
const merged = mergeUpcoming(posts, emails, 8);
assert.deepEqual(merged.map((m) => [m.name, m.kind]), [["Post A", "post"], ["Mail", "email"], ["Post B", "post"]]);
assert.equal(mergeUpcoming(posts, emails, 2).length, 2);

console.log("marketing.test.ts: ok");
