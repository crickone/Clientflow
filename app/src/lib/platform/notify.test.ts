// Run: npm test -- src/lib/platform/notify.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);
const { shouldNotifyInstant, digestHtml } = requireLocal("./notify") as typeof import("./notify");

assert.equal(shouldNotifyInstant({ level: "bad", notifiedAt: null, openedAt: 1 }, 2), true);
assert.equal(shouldNotifyInstant({ level: "warn", notifiedAt: null, openedAt: 1 }, 2), false, "warnings wait for the digest");
assert.equal(shouldNotifyInstant({ level: "bad", notifiedAt: 1, openedAt: 1 }, 2), false, "never twice");

const html = digestHtml(
  [
    { id: 1, tenantId: 7, tenantName: "Gym A", key: "billing:past_due", level: "bad", title: "Gym A is past due", detail: null, href: "/gyms/7/money", openedAt: 1, lastSeenAt: 1, resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null, snoozedUntil: null, assignedTo: null },
    { id: 2, tenantId: null, tenantName: null, key: "scheduler:x", level: "warn", title: "Backup late <b>", detail: null, href: "/jobs", openedAt: 1, lastSeenAt: 1, resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null, snoozedUntil: null, assignedTo: null },
  ],
  "https://admin.example",
);
assert.match(html, /1 needs action/);
assert.match(html, /1 to watch/);
assert.match(html, /href="https:\/\/admin\.example\/gyms\/7\/money"/);
assert.match(html, /Backup late &lt;b&gt;/, "titles are escaped");
console.log("notify.test.ts: ok");
