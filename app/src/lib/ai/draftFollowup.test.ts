// Run: npm test -- src/lib/ai/draftFollowup.test.ts
//
// Batch 3a (AI cap metering): draftFollowup is the INTERACTIVE representative
// site (api/leads/[id]/draft/route.ts + the Sales agent's draft_lead_reply
// tool both call it). Proves:
//   1. assertUnderCap trips BEFORE any network call once a tenant is at/over
//      its monthly cap — draftFollowup rejects with AiCapError specifically,
//      not the "ANTHROPIC_API_KEY is not set" error that would fire next if
//      the cap check were skipped or ordered after it. This environment
//      deliberately has no ANTHROPIC_API_KEY (same as every other AI-call
//      test in this repo — see tools.marketing.test.ts's note), so a pass
//      here is a genuine proof the cap check runs first, not a coincidence.
//   2. recordUsage buckets a "followup"/MODELS.opus call correctly, so a real
//      successful call (which this test environment can't make — no Claude
//      credentials) would show up right in the per-agent/per-model spend
//      dashboard.
//
// draftFollowup.ts -> @/lib/ai/businessContext -> @/lib/db (the ambient `db`
// proxy, index.ts) -> @/lib/tenants -> @/lib/auth -> `next/navigation`. Same
// two-part shim as tools.sales.test.ts / tools.marketing.test.ts, for the
// same reason: under the runner's `--conditions=react-server`, npm's react
// "react-server" entry throws on load, so `cache` needs stubbing; and
// next/navigation's real module drags in Next's client-router internals we
// don't have reason to load here (redirect() is never actually called in
// this test's code path). Installed via a dynamic require (below) rather
// than a static import, since a static `import ... from "./draftFollowup"`
// would be hoisted and evaluated before this shim runs.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import type { Lead, LeadMessage } from "../db/schema";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in draftFollowup.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as tools.sales.test.ts).
(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { draftFollowup } = requireLocal("./draftFollowup") as typeof import("./draftFollowup");
  const {
    AiCapError,
    recordUsage,
    getMonthlyUsageByAgent,
    getMonthlyUsageByModel,
  } = requireLocal("./usage") as typeof import("./usage");
  const { MODELS } = requireLocal("./client") as typeof import("./client");

  // ── scratch tenant (control row only) — same pattern as usage.test.ts ──
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'draftfollowup-test'").run();
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('draftfollowup-test','DraftFollowup Test','tenants/draftfollowup-test/void.db',1) RETURNING id",
    )
    .get() as { id: number };
  const tid = t.id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  const lead: Lead = {
    id: 1,
    source: "manual",
    sourceLeadId: null,
    campaign: null,
    firstName: "Aoife",
    lastName: "Byrne",
    email: "aoife@example.com",
    phone: null,
    therapyInterest: "HBOT",
    notes: null,
    rawPayload: null,
    status: "new",
    pipelineStage: "new_lead",
    clientId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const history: LeadMessage[] = [];

  try {
    // ── over-cap: assertUnderCap trips before any network call ──
    // 2,000,000 output tokens on sonnet ($15/1M out) -> 3000c, over the 2500c cap.
    recordUsage(tid, "sales", MODELS.sonnet, { inputTokens: 0, outputTokens: 2_000_000 });

    await assert.rejects(
      () => draftFollowup({ lead, history, tenantId: tid }),
      AiCapError,
      "an over-cap tenant's draftFollowup call rejects with AiCapError, not an API-key/network error",
    );

    // ── recordUsage buckets a "followup"/MODELS.opus call correctly (the
    // exact agentKey+model draftFollowup uses internally) — reusing the same
    // (already over-cap) tenant is fine; recordUsage itself doesn't consult
    // the cap, it just records. ──
    recordUsage(tid, "followup", MODELS.opus, { inputTokens: 1000, outputTokens: 500 });
    const byAgent = getMonthlyUsageByAgent(tid);
    const byModel = getMonthlyUsageByModel(tid);
    assert.ok(
      "followup" in byAgent,
      "recordUsage bucketed the call under the 'followup' agentKey draftFollowup uses",
    );
    assert.ok(
      byModel.some((r) => r.model === MODELS.opus),
      "recordUsage bucketed the call under MODELS.opus, the model draftFollowup calls",
    );

    console.log("ai/draftFollowup.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
