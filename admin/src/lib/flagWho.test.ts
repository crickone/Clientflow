// Run: npm test -- src/lib/flagWho.test.ts
import assert from "node:assert/strict";

import { segmentOf, whoHasIt } from "./flagWho";
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
console.log("flagWho: ok");
