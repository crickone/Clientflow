// Run: npm test -- src/lib/dashboard/metrics/content.test.ts
import assert from "node:assert/strict";
import { channelCounts, channelsLabel, generationLabel, mergeCalendar, parseChannels, truncateText } from "./content";

assert.deepEqual(parseChannels('["facebook","instagram"]'), ["facebook", "instagram"]);
assert.deepEqual(parseChannels("not json"), []);
assert.deepEqual(parseChannels(null), []);
assert.deepEqual(parseChannels('{"a":1}'), []);

// A post on both channels counts once per channel; duplicates inside one post count once.
assert.deepEqual(
  channelCounts(['["facebook","instagram"]', '["instagram"]', '["instagram","instagram"]', "bad"]),
  [{ label: "Instagram", value: 3 }, { label: "Facebook", value: 1 }],
);
assert.deepEqual(channelCounts([]), []);

assert.equal(channelsLabel('["facebook","instagram"]'), "Instagram and Facebook");
assert.equal(channelsLabel('["facebook"]'), "Facebook");
assert.equal(channelsLabel("[]"), "no channel");

const m = mergeCalendar(
  [{ name: "P2", atMs: 20, channels: "[]" }, { name: "P1", atMs: 5, channels: "[]" }],
  [{ name: "B1", atMs: 10 }],
  3,
);
assert.deepEqual(m.map((x) => `${x.kind}:${x.name}`), ["post:P1", "blog:B1", "post:P2"]);
assert.equal(mergeCalendar([{ name: "P", atMs: 1, channels: "[]" }], [{ name: "B", atMs: 2 }], 1).length, 1);

assert.equal(truncateText("short", 90), "short");
const long = "x".repeat(200);
assert.equal(truncateText(long, 90).length, 90);
assert.ok(truncateText(long, 90).endsWith("…"));

assert.equal(generationLabel(null), "Ready");
assert.equal(generationLabel("writing"), "Generating");
assert.equal(generationLabel("failed"), "Generation failed");

console.log("content.test.ts: ok");
