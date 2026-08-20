// src/lib/marketing/campaignRadar.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRadarFromFraming } from "./campaignRadar";
import { upcomingDates } from "./seasonalCalendar";

const upcoming = upcomingDates("2026-03-01", 60, 2026).slice(0, 5);

test("buildRadarFromFraming: uses AI framing when present", () => {
  const framed = { "st-patricks": { name: "Lucky 7 Kickstart", hook: "Seven days to a fresh start." } };
  const out = buildRadarFromFraming(upcoming, "2026-03-01", framed);
  const stp = out.find((r) => r.dateId === "st-patricks")!;
  assert.equal(stp.suggestionName, "Lucky 7 Kickstart");
  assert.equal(stp.suggestionHook, "Seven days to a fresh start.");
  assert.ok(stp.daysAway >= 0);
});

test("buildRadarFromFraming: falls back to the catalog angle when framing is null/missing", () => {
  const out = buildRadarFromFraming(upcoming, "2026-03-01", null);
  assert.equal(out.length, upcoming.length);
  for (const r of out) {
    assert.ok(r.suggestionHook.trim().length > 0, "hook falls back to the date angle");
    assert.ok(r.suggestionName.trim().length > 0);
  }
});

test("buildRadarFromFraming: daysAway is correct + non-negative", () => {
  const out = buildRadarFromFraming(upcoming, "2026-03-01", null);
  const stp = out.find((r) => r.dateId === "st-patricks")!; // 2026-03-17
  assert.equal(stp.daysAway, 16);
});

test("buildRadarFromFraming: never throws on a malformed AI shape (non-string leaves)", () => {
  // Simulates what a real (but misbehaving) model response looks like after
  // JSON.parse: valid JSON, wrong leaf types. framed's declared type claims
  // { name: string; hook: string }, but JSON.parse really returns `any`, so
  // this is a legitimate runtime shape the type system can't rule out.
  const framed = { "st-patricks": { name: 42, hook: ["nope"] } } as any;

  let out: ReturnType<typeof buildRadarFromFraming> = [];
  assert.doesNotThrow(() => {
    out = buildRadarFromFraming(upcoming, "2026-03-01", framed);
  });

  const stpCatalog = upcoming.find((d) => d.id === "st-patricks")!;
  const stp = out.find((r) => r.dateId === "st-patricks")!;
  assert.equal(stp.suggestionName, stpCatalog.name, "non-string name leaf falls back to the catalog name");
  assert.equal(stp.suggestionHook, stpCatalog.angle, "non-string hook leaf falls back to the catalog angle");

  assert.equal(out.length, upcoming.length);
  for (const r of out) {
    assert.equal(typeof r.suggestionName, "string");
    assert.equal(typeof r.suggestionHook, "string");
    assert.ok(r.suggestionName.trim().length > 0, "every row has a non-empty suggestionName");
    assert.ok(r.suggestionHook.trim().length > 0, "every row has a non-empty suggestionHook");
  }
});
