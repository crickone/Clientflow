// Run: npm test -- src/lib/dashboard/metrics/social.test.ts
import assert from "node:assert/strict";
import { followerChange, followerSeries, postTotals, topPosts } from "./social";

const rows = [
  { day: "2026-09-01", channel: "facebook", followers: 100 },
  { day: "2026-09-10", channel: "facebook", followers: 110 },
  { day: "2026-09-20", channel: "facebook", followers: 125 },
  { day: "2026-09-12", channel: "instagram", followers: 300 },
  { day: "2026-09-20", channel: "instagram", followers: 320 },
];

const fb = followerChange(rows, "facebook", "2026-09-05", "2026-09-30")!;
assert.deepEqual(fb, { now: 125, change: 25, sinceDay: "2026-09-01" }, "change against the last snapshot before the window");
const ig = followerChange(rows, "instagram", "2026-09-05", "2026-09-30")!;
assert.deepEqual(ig, { now: 320, change: 20, sinceDay: "2026-09-12" }, "tracking started mid-window: change since the first snapshot");
assert.equal(followerChange(rows, "instagram", "2026-09-05", "2026-09-12")!.change, null, "one snapshot only -> no change");
assert.equal(followerChange(rows, "tiktok", "2026-09-01", "2026-09-30"), null, "no snapshots -> null");

const series = followerSeries(rows, "2026-09-10", "2026-09-20");
assert.equal(series.length, 3);
assert.deepEqual(series[2], { label: "09-20", facebook: 125, instagram: 320 }, "both channels share a day point");

const posts = [
  { channel: "facebook" as const, engagement: 10, createdAt: 1 },
  { channel: "instagram" as const, engagement: 30, createdAt: 2 },
  { channel: "instagram" as const, engagement: 30, createdAt: 3 },
];
const t = postTotals(posts);
assert.equal(t.engagement, 70);
assert.equal(t.average, 23.3);
assert.deepEqual(t.byChannel.instagram, { posts: 2, engagement: 60 });
assert.equal(postTotals([]).average, null);
assert.deepEqual(topPosts(posts, 2).map((p) => p.createdAt), [3, 2], "top by engagement, newest wins a tie");
console.log("social metrics: 11 checks passed.");
