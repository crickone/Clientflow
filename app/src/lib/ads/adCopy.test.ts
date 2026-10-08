// Run: npx tsx src/lib/ads/adCopy.test.ts
import assert from "node:assert/strict";

import { AD_SIZES, GOAL_OBJECTIVE, coerceCopy, parseBrief, parseStoredCopy } from "./adCopy";

const b = parseBrief({ offer: "  HBOT block of five  ", goal: "nonsense", linkUrl: "https://x.ie" });
assert.equal(b.offer, "HBOT block of five");
assert.equal(b.goal, "bookings", "an unknown goal falls back to bookings");
assert.equal(GOAL_OBJECTIVE.leads, "leads");

const c = coerceCopy(
  { angle: "time", hook: "Sixty minutes, then back to your day", primaryText: "Guided start to finish.", headline: "Book a block of five", description: "Clonmel", cta: "NOT_A_CTA" },
  "bookings",
);
assert.ok(c);
assert.equal(c!.cta, "BOOK_NOW", "an invalid button becomes the goal's default");
assert.equal(coerceCopy({ hook: "x" }, "bookings"), null, "missing primary text or headline is rejected");
const long = coerceCopy({ hook: "h".repeat(200), primaryText: "p", headline: "h".repeat(80), cta: "LEARN_MORE" }, "website");
assert.equal(long!.hook.length, 60);
assert.equal(long!.headline.length, 40);
assert.equal(parseStoredCopy("not json"), null);
assert.deepEqual([...AD_SIZES], ["4:5", "1:1", "9:16"]);

console.log("adCopy: all checks passed.");
