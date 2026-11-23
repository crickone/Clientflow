// Run: npm test -- src/lib/rateLimit.test.ts
import assert from "node:assert/strict";

import { SITE_HOST_HEADER } from "./cms/proxyHost";
import { clientIp } from "./rateLimit";

const req = (h: Record<string, string>) => new Request("https://example.test/", { headers: h });

assert.equal(clientIp(req({ "x-forwarded-for": "1.1.1.1, 9.9.9.9" })), "9.9.9.9", "direct: the proxy's appended (last) address");
assert.equal(clientIp(req({ "x-forwarded-for": "1.1.1.1, 9.9.9.9", "cf-connecting-ip": "5.5.5.5" })), "9.9.9.9", "CF-Connecting-IP is ignored unless the request came through the verified Worker");
assert.equal(
  clientIp(req({ "x-forwarded-for": "5.5.5.5, 172.70.1.1", "cf-connecting-ip": "5.5.5.5", [SITE_HOST_HEADER]: "www.gym.ie" })),
  "5.5.5.5",
  "through the Worker: the visitor's own address, not Cloudflare's",
);
assert.equal(clientIp(req({ "x-real-ip": "7.7.7.7" })), "7.7.7.7");
assert.equal(clientIp(req({})), "unknown");
console.log("rateLimit clientIp: all assertions passed");
