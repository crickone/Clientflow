// Run: npm test -- src/lib/ads/adPhotoPicks.test.ts
//
// Reading which photograph goes on each ad version, and when to generate
// instead. The failure this guards: a blind rotation put a massage photo on a
// hyperbaric oxygen ad.
import assert from "node:assert/strict";
import { planAdPhotos, readPicks } from "./adPhotoPicks";

// 1-based picks become 0-based indexes; 0 means none fits.
assert.deepEqual(readPicks('{"picks":[{"version":1,"photo":3},{"version":2,"photo":0},{"version":3,"photo":1}]}', 3, 5), [2, null, 0]);
// Out of range, unknown versions and junk are ignored.
assert.deepEqual(readPicks('{"picks":[{"version":1,"photo":9},{"version":7,"photo":1}]}', 2, 5), [null, null]);
assert.deepEqual(readPicks("not json", 2, 5), [null, null]);

// Every version found a photo: use them in order, generate nothing.
assert.deepEqual(planAdPhotos(["a", "b", "c"], true), { photos: ["a", "b", "c"], generate: false });
// A gap with a generator: generate the whole set.
assert.deepEqual(planAdPhotos(["a", null, "c"], true), { photos: ["a", "c"], generate: true });
// A gap without one: fill it from what did fit, never from the blind library.
assert.deepEqual(planAdPhotos(["a", null, "c"], false), { photos: ["a", "c", "c"], generate: false });
// Nothing fits and nothing can be made: no photographs at all.
assert.deepEqual(planAdPhotos([null, null], false), { photos: [], generate: false });

console.log("adPhotoPicks: 7 checks passed.");
