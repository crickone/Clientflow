// Run: npm test -- src/lib/social/dm.test.ts
//
// Meta's reply rules for Messenger / Instagram: any reply within 24h of the
// customer's last message, a person's reply up to 7 days (HUMAN_AGENT tag),
// nothing after that and nothing to someone who never wrote.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

const { replyWindow } = requireLocal("./dm") as typeof import("./dm");
const NOW = Date.parse("2026-10-03T12:00:00Z");
const H = 60 * 60 * 1000;

assert.equal(replyWindow(null, NOW), "closed", "never wrote -> closed");
assert.equal(replyWindow(NOW - 1 * H, NOW), "open", "1h -> open");
assert.equal(replyWindow(NOW - 24 * H, NOW), "open", "exactly 24h -> still open");
assert.equal(replyWindow(NOW - 24 * H - 1, NOW), "human_only", "just past 24h -> human only");
assert.equal(replyWindow(NOW - 7 * 24 * H, NOW), "human_only", "exactly 7 days -> human only");
assert.equal(replyWindow(NOW - 7 * 24 * H - 1, NOW), "closed", "past 7 days -> closed");
console.log("dm: 6 reply-window checks passed.");
