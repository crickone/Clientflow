// Run: npm test -- src/lib/design/safeZones.test.ts
//
// The Instagram and Facebook safe zones: where the apps draw their own
// interface over a post or ad, so text, buttons and the logo stay out.
import assert from "node:assert/strict";
import { safeRect, safeZone, safeZoneRule, safeZoneViolation } from "./safeZones";

// Stories and Reels: top 14%, bottom 35%, sides 6%.
assert.deepEqual(safeZone(1080, 1920), { top: 269, bottom: 672, left: 65, right: 65 });
assert.deepEqual(safeRect(1080, 1920), { left: 65, top: 269, width: 950, height: 979 });
// Feed 4:5: sides clear of the profile grid's 3:4 crop (about 34px a side).
const feed = safeZone(1080, 1350);
assert.ok(feed.left > 34 && feed.right > 34);
// Square: 5% all round.
assert.deepEqual(safeZone(1080, 1080), { top: 54, bottom: 54, left: 54, right: 54 });

// The prompt names the exact box, and the Stories wording names what covers it.
const tall = safeZoneRule(1080, 1920);
assert.ok(tall.includes("x=65 to x=1015") && tall.includes("y=269 to y=1248"));
assert.ok(tall.includes("call-to-action button"));
assert.ok(safeZoneRule(1080, 1350).includes("profile grid"));
assert.ok(safeZoneViolation(["Book now"], 1080, 1920).includes('"Book now"'));

console.log("safeZones: 8 checks passed.");
