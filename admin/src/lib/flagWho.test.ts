// Run: npm test -- src/lib/flagWho.test.ts
import assert from "node:assert/strict";

import { lostCount, segmentOf, whoHasIt } from "./flagWho";
import type { PlatformFlag } from "./types";

const name = (id: number) => `B${id}`;
const f = (mode: PlatformFlag["mode"], percent = 0, allow: number[] = []): PlatformFlag => ({ key: "x", mode, percent, allow });

assert.deepEqual(whoHasIt(f("all", 100), 5, name), { text: "All 5", names: [], more: 0 });
assert.equal(whoHasIt(f("none"), 5, name).text, "Nobody");
assert.equal(whoHasIt(f("allow"), 5, name).text, "Nobody");
assert.equal(whoHasIt(f("percent", 40), 5, name).text, "40% of businesses");

const many = whoHasIt(f("allow", 0, [1, 2, 3, 4, 5, 6]), 9, name);
assert.deepEqual(many.names, ["B1", "B2", "B3", "B4"]);
assert.equal(many.more, 2);
assert.equal(many.text, null);

assert.equal(segmentOf(f("all")), "everyone");
assert.equal(segmentOf(f("none")), "nobody");
assert.equal(segmentOf(f("allow", 0, [1])), "some");
assert.equal(segmentOf(f("percent", 10)), "some");
assert.equal(segmentOf(f("allow", 0, [])), "nobody");

const ids = [1, 2, 3, 4, 5];
// From Everyone.
assert.equal(lostCount(f("all", 100), f("allow", 0, [1, 2]), ids), 3);
assert.equal(lostCount(f("all", 100), f("allow", 0, ids), ids), 0);
assert.equal(lostCount(f("all", 100), f("percent", 50), ids), null);
assert.equal(lostCount(f("all", 100), f("percent", 100), ids), 0);
assert.equal(lostCount(f("all", 100), f("none"), ids), 5);
// From a named list.
assert.equal(lostCount(f("allow", 0, [1, 2, 3]), f("allow", 0, [1, 2, 3, 4]), ids), 0);
assert.equal(lostCount(f("allow", 0, [1, 2, 3]), f("allow", 0, [1]), ids), 2);
assert.equal(lostCount(f("allow", 0, [1, 2, 3]), f("percent", 40), ids), null);
assert.equal(lostCount(f("allow", 0, [1, 2, 3]), f("all", 100), ids), 0);
// From a percentage.
assert.equal(lostCount(f("percent", 50), f("percent", 60), ids), 0);
assert.equal(lostCount(f("percent", 50), f("percent", 50), ids), 0);
assert.equal(lostCount(f("percent", 50), f("percent", 20), ids), null);
assert.equal(lostCount(f("percent", 50), f("allow", 0, [1]), ids), null);
assert.equal(lostCount(f("percent", 0), f("allow", 0, [1]), ids), 0);
// From nothing: nobody can lose it.
assert.equal(lostCount(f("none"), f("allow", 0, [1]), ids), 0);
assert.equal(lostCount(f("allow", 0, []), f("percent", 10), ids), 0);
console.log("flagWho: ok");
