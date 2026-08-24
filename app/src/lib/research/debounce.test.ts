// Run: npm test -- src/lib/research/debounce.test.ts
//
// Task 11 (Market Research P1) — the manual "Rescan now" debounce guard.
// Pure, zero imports beyond the module under test (same style as
// distance.test.ts): no Module shim needed.
import assert from "node:assert/strict";

import { RESCAN_DEBOUNCE_MS, mostRecentRefreshAt, wasRecentlyScanned } from "./debounce";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

(async () => {
  // ── mostRecentRefreshAt ──────────────────────────────────────────────
  check("mostRecentRefreshAt: empty list -> null", mostRecentRefreshAt([]) === null);

  check(
    "mostRecentRefreshAt: a single never-refreshed competitor -> null",
    mostRecentRefreshAt([{ lastRefreshedAt: null }]) === null,
  );

  check(
    "mostRecentRefreshAt: picks the MAX across a mixed list (order-independent)",
    mostRecentRefreshAt([
      { lastRefreshedAt: "2026-08-20T10:00:00.000Z" },
      { lastRefreshedAt: null },
      { lastRefreshedAt: "2026-08-24T09:00:00.000Z" }, // latest
      { lastRefreshedAt: "2026-08-01T00:00:00.000Z" },
    ]) === "2026-08-24T09:00:00.000Z",
  );

  check(
    "mostRecentRefreshAt: a malformed timestamp is ignored, never picked, never throws",
    mostRecentRefreshAt([{ lastRefreshedAt: "not-a-real-date" }, { lastRefreshedAt: "2026-08-01T00:00:00.000Z" }]) ===
      "2026-08-01T00:00:00.000Z",
  );

  check(
    "mostRecentRefreshAt: ALL malformed -> null (never a garbage fallback)",
    mostRecentRefreshAt([{ lastRefreshedAt: "nope" }, { lastRefreshedAt: "also nope" }]) === null,
  );

  // ── wasRecentlyScanned ───────────────────────────────────────────────
  const now = new Date("2026-08-24T12:00:00.000Z");

  check("wasRecentlyScanned: null timestamp -> false (never blocks a first-ever scan)", wasRecentlyScanned(null, now) === false);

  check(
    "wasRecentlyScanned: a malformed timestamp -> false, never throws",
    wasRecentlyScanned("garbage", now) === false,
  );

  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000).toISOString();
  check("wasRecentlyScanned: 1 minute ago -> true (within the ~5min window)", wasRecentlyScanned(oneMinuteAgo, now) === true);

  const fourMin59Ago = new Date(now.getTime() - (RESCAN_DEBOUNCE_MS - 1)).toISOString();
  check("wasRecentlyScanned: 1ms inside the window -> true", wasRecentlyScanned(fourMin59Ago, now) === true);

  const exactlyAtBoundary = new Date(now.getTime() - RESCAN_DEBOUNCE_MS).toISOString();
  check(
    "wasRecentlyScanned: exactly AT the boundary (elapsed === windowMs) -> false (strict <, boundary allows a rescan)",
    wasRecentlyScanned(exactlyAtBoundary, now) === false,
  );

  const sixMinutesAgo = new Date(now.getTime() - 6 * 60 * 1000).toISOString();
  check("wasRecentlyScanned: 6 minutes ago -> false (outside the window)", wasRecentlyScanned(sixMinutesAgo, now) === false);

  check(
    "wasRecentlyScanned: a custom windowMs is honoured (30s window, 10s ago -> true)",
    wasRecentlyScanned(new Date(now.getTime() - 10_000).toISOString(), now, 30_000) === true,
  );
  check(
    "wasRecentlyScanned: a custom windowMs is honoured (30s window, 40s ago -> false)",
    wasRecentlyScanned(new Date(now.getTime() - 40_000).toISOString(), now, 30_000) === false,
  );

  // default `now` parameter genuinely defaults to the real clock (doesn't throw when omitted)
  check(
    "wasRecentlyScanned: `now` defaults to the current time when omitted",
    wasRecentlyScanned(new Date().toISOString()) === true,
  );

  console.log(`\ndebounce: ${passed} checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
