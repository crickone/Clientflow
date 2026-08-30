// Run: npm test -- src/lib/ai/metered.test.ts
//
// meteredCreateFailSoft (@/lib/ai/metered) is the shared gate -> call ->
// extract -> parse -> NEVER throw -> fallback shell that research/summary.ts's
// competitorThemes/landscapeSummary/adAngle and ai/altText.ts's
// generateAltText are all built on. This proves the deep module's OWN
// contract, independent of any one caller:
//   1. No ANTHROPIC_API_KEY (this test environment's real, deliberate state
//      — same as every other AI-call test in this repo, see altText.test.ts's
//      note) -> meteredCreate's real getAnthropic() throws "ANTHROPIC_API_KEY
//      is not set" -> caught -> resolves to `fallback`, never throws.
//   2. Genuinely OVER CAP (recordUsage pushes the tenant there, same trick as
//      draftFollowup.test.ts/summary.test.ts) -> the real assertAiAllowed
//      (inside meteredCreate) throws AiCapError BEFORE any network attempt ->
//      caught -> resolves to `fallback`, never throws.
//   3. A `parseText` that itself throws (e.g. a caching write failing, as
//      competitorThemes's/adAngle's parseText do for real) also lands in the
//      SAME catch and resolves to `fallback` — exercised via a canned
//      successful reply so parseText actually gets real text to blow up on.
//      Also proves metering still ran for that call: gate+meter happen
//      BEFORE parseText, so a later parseText throw must not un-record spend
//      already incurred.
//   3b. Bonus, same canned reply: a NON-throwing parseText proves the happy
//       path too — parseText really receives the text-block-filtered,
//       newline-joined, trimmed extraction, and its return value (not
//       `fallback`) is what comes back out on success.
//
// metered.ts -> ./client (getAnthropic) -> @anthropic-ai/sdk; -> ./usage ->
// @/lib/db/control. No @/lib/db/tenant / react `cache()` / next/navigation in
// this chain — meteredCreateFailSoft takes tenantId explicitly via
// MeterContext, no ambient tenant resolution — altText.test.ts proves the
// same chain needs no react/next-navigation stubbing. Only "./client" needs a
// shim here, to swap in a canned Anthropic reply for exactly one call at a
// time (cases 3/3b) without a live API key; every other export of "./client"
// (MODELS, PRICING, estCostCents, ...) passes through to the REAL module
// untouched, so usage.ts's own `estCostCents` import (same "./client"
// specifier — usage.ts lives in this same directory) keeps working. Same
// require-interception TRICK as summary.test.ts/draftFollowup.test.ts;
// installed via a dynamic require (below) rather than a static import, since
// a static `import ... from "./metered"` would be hoisted and evaluated
// before this shim runs.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
type AnthropicMessage = {
  content: { type: string; text?: string }[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

// Cases 3/3b set this to a canned successful reply for exactly ONE call.
// `null` — the default, and what cases 1-2 run under — means "./client"'s
// getAnthropic() resolves to the REAL function, so the no-key/over-cap
// assertions exercise the genuine failures, not a stub.
let mockAnthropicCreate: (() => Promise<AnthropicMessage>) | null = null;

const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "./client") {
    const real = realLoad.call(this, request, ...rest) as Record<string, unknown>;
    const realGetAnthropic = real.getAnthropic as () => unknown;
    return {
      ...real,
      getAnthropic: () =>
        mockAnthropicCreate ? { messages: { create: mockAnthropicCreate } } : realGetAnthropic(),
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { meteredCreateFailSoft } = requireLocal("./metered") as typeof import("./metered");
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const {
    recordUsage,
    getMonthlyUsageByAgent,
    getMonthlyUsageByModel,
  } = requireLocal("./usage") as typeof import("./usage");
  const { MODELS } = requireLocal("./client") as typeof import("./client");

  function makeScratchTenant(slug: string): { tid: number; cleanup: () => void } {
    controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
    const t = controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, slug, `tenants/${slug}/void.db`) as { id: number };
    const tid = t.id;
    const cleanup = () => {
      controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(tid);
      controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    };
    return { tid, cleanup };
  }

  const buildParams = () => ({
    model: MODELS.haiku,
    max_tokens: 50,
    messages: [{ role: "user" as const, content: "test prompt" }],
  });

  // ── 1+2. No ANTHROPIC_API_KEY, then genuinely over cap ──────────────────
  {
    const { tid, cleanup } = makeScratchTenant("metered-failsoft-nokey-test");
    try {
      const fallback = "FALLBACK-NO-KEY";
      let result: string | undefined;
      await assert.doesNotReject(async () => {
        result = await meteredCreateFailSoft(
          { tenantId: tid, agentKey: "test" },
          buildParams,
          (text) => text,
          fallback,
          "metered-test",
        );
      }, "no ANTHROPIC_API_KEY must not throw out of meteredCreateFailSoft");
      assert.equal(result, fallback, "AI-unavailable (no API key) resolves to the exact fallback value");

      // Genuinely OVER cap -- 2,000,000 output tokens on sonnet ($15/1M out)
      // -> 3000c, over the 2500c default cap.
      recordUsage(tid, "sales", MODELS.sonnet, { inputTokens: 0, outputTokens: 2_000_000 });
      let overCapResult: string | undefined;
      await assert.doesNotReject(async () => {
        overCapResult = await meteredCreateFailSoft(
          { tenantId: tid, agentKey: "test" },
          buildParams,
          (text) => text,
          fallback,
          "metered-test",
        );
      }, "an over-cap tenant must not throw out of meteredCreateFailSoft");
      assert.equal(overCapResult, fallback, "over-cap (AiCapError) resolves to the exact same fallback value");

      console.log("ai/metered.test.ts: no-key + over-cap fallback assertions passed");
    } finally {
      cleanup();
    }
  }

  // ── 3 / 3b. A canned successful reply: throwing parseText -> fallback
  //    (+ metering still recorded); non-throwing parseText -> its own value ──
  {
    const { tid, cleanup } = makeScratchTenant("metered-failsoft-parsetext-test");
    try {
      mockAnthropicCreate = async () => ({
        content: [{ type: "text", text: "a real-looking model reply" }],
        usage: { input_tokens: 42, output_tokens: 7 },
      });
      const fallback = "FALLBACK-PARSE-THROWS";
      let result: string | undefined;
      try {
        await assert.doesNotReject(async () => {
          result = await meteredCreateFailSoft(
            { tenantId: tid, agentKey: "test" },
            buildParams,
            () => {
              throw new Error("parseText exploded");
            },
            fallback,
            "metered-test-parsetext",
          );
        }, "a throwing parseText must not escape meteredCreateFailSoft");
      } finally {
        mockAnthropicCreate = null; // never leak the mock past this one call
      }
      assert.equal(result, fallback, "a throwing parseText resolves to the exact fallback value");

      // The gate+call+meter already ran (and succeeded) before parseText blew
      // up -- proving the deep module's fail-soft catch doesn't silently
      // discard metering already recorded for a real, successful API call.
      const byAgent = getMonthlyUsageByAgent(tid);
      const byModel = getMonthlyUsageByModel(tid);
      assert.ok(
        "test" in byAgent,
        "meterAndCharge recorded the call under its agentKey even though parseText later threw",
      );
      assert.ok(
        byModel.some((r) => r.model === MODELS.haiku),
        "meterAndCharge recorded the call under its model even though parseText later threw",
      );

      // 3b: same canned-reply mechanism, but with a NON-throwing parseText,
      // and a multi-block reply (one text block + one non-text block + a
      // second text block) to also nail down the extraction shape: non-text
      // blocks are filtered out (not concatenated as ""), and remaining text
      // blocks are joined with "\n" and trimmed before parseText sees them.
      mockAnthropicCreate = async () => ({
        content: [
          { type: "text", text: "first block" },
          { type: "tool_use" },
          { type: "text", text: "second block" },
        ],
        usage: { input_tokens: 5, output_tokens: 3 },
      });
      let parsedResult: string | undefined;
      try {
        parsedResult = await meteredCreateFailSoft(
          { tenantId: tid, agentKey: "test" },
          buildParams,
          (text) => `parsed:${text}`,
          "SHOULD-NOT-BE-USED",
          "metered-test-parsetext-happy",
        );
      } finally {
        mockAnthropicCreate = null;
      }
      assert.equal(
        parsedResult,
        "parsed:first block\nsecond block",
        "parseText receives the text-block-filtered, newline-joined, trimmed extraction, and its return value (not fallback) wins on success",
      );

      console.log("ai/metered.test.ts: parseText fallback + happy-path assertions passed");
    } finally {
      cleanup();
    }
  }

  console.log("ai/metered.test.ts: all assertions passed");
})();
