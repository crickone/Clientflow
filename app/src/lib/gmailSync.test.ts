// Run: npm test -- src/lib/gmailSync.test.ts
//
// Batch 5a (improvement-plan-2026-08.md Theme F1/F6): unit tests for Gmail
// sync's pure decision helpers — the ~2-minute auto-sync frequency gate (F1)
// and the Gmail-label -> local read-state reconcile decision (F6). Both are
// deliberately dependency-free (see lib/gmailSync.ts) so they're tested here
// directly with plain values — no DB/network/clock needed.
import assert from "node:assert/strict";
import { GMAIL_SYNC_MIN_GAP_MS, isMessageRead, shouldSyncNow } from "./gmailSync";

// ── shouldSyncNow: the auto-sync frequency gate ──

// Never synced before -> always sync now, regardless of `now`.
assert.equal(shouldSyncNow(null, 0, 120_000), true, "never synced -> sync now");
assert.equal(shouldSyncNow(null, Date.now(), 120_000), true, "never synced -> sync now (2)");

const NOW = 1_000_000;
const GAP = 120_000; // 2 minutes

// Well within the gap -> skip.
assert.equal(shouldSyncNow(NOW - 1000, NOW, GAP), false, "synced 1s ago, gap 2min -> skip");

// Just under the gap -> still skip.
assert.equal(shouldSyncNow(NOW - (GAP - 1), NOW, GAP), false, "1ms short of the gap -> skip");

// Exactly at the gap -> sync (>= boundary, "true after").
assert.equal(shouldSyncNow(NOW - GAP, NOW, GAP), true, "exactly at the gap -> sync");

// Well past the gap -> sync.
assert.equal(shouldSyncNow(NOW - GAP - 1, NOW, GAP), true, "just past the gap -> sync");
assert.equal(shouldSyncNow(NOW - 10 * GAP, NOW, GAP), true, "long past the gap -> sync");

// Default minGapMs parameter is the exported constant.
assert.equal(GMAIL_SYNC_MIN_GAP_MS, 2 * 60 * 1000, "default gap is ~2 minutes");
assert.equal(
  shouldSyncNow(NOW - (GMAIL_SYNC_MIN_GAP_MS - 1), NOW),
  false,
  "default param matches GMAIL_SYNC_MIN_GAP_MS (just under)",
);
assert.equal(
  shouldSyncNow(NOW - GMAIL_SYNC_MIN_GAP_MS, NOW),
  true,
  "default param matches GMAIL_SYNC_MIN_GAP_MS (at boundary)",
);

// ── isMessageRead: F6's Gmail-label -> local read-state decision ──

// No labels at all -> treated as read (can't tell it's unread, so don't flag
// it forever).
assert.equal(isMessageRead(undefined), true, "no labels -> read");
assert.equal(isMessageRead([]), true, "empty labels -> read");

// UNREAD present -> unread, regardless of what else is on the message.
assert.equal(isMessageRead(["UNREAD"]), false, "UNREAD label -> unread");
assert.equal(
  isMessageRead(["INBOX", "UNREAD", "IMPORTANT"]),
  false,
  "UNREAD among other labels -> unread",
);

// UNREAD absent -> read (covers both "reconciled from unread" and "sent mail").
assert.equal(isMessageRead(["INBOX"]), true, "INBOX without UNREAD -> read");
assert.equal(isMessageRead(["SENT"]), true, "SENT (own outgoing mail) -> read");
assert.equal(
  isMessageRead(["INBOX", "IMPORTANT", "CATEGORY_PERSONAL"]),
  true,
  "no UNREAD among several other labels -> read",
);

console.log("lib/gmailSync.test.ts: all assertions passed");
