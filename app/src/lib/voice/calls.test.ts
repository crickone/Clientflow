// Run: npm test -- src/lib/voice/calls.test.ts
//
// The call record and the tenant resolution behind it — the two things that
// stop a webhook (a) charging twice and (b) writing one tenant's call into
// another's database. Covers:
//   1. a call row exists BEFORE the dial, as 'dialling', so a call that never
//      connects is visible rather than vanishing;
//   2. resolveProviderCall maps a provider conversation id -> (tenant, call),
//      and an UNKNOWN id resolves to null — fail closed, never a default
//      tenant;
//   3. completeCall is a claim: the FIRST call wins and a redelivered webhook
//      gets false, which is what makes metering idempotent;
//   4. a failed dial is recorded as 'failed' with its reason.
//
// NOTE: plain node:assert/strict via `npm test -- <path>` (see scripts/test.mjs).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// ./calls -> @/lib/db/tenant, which imports React's server-only `cache` at
// module load; under the runner's --conditions=react-server that entry point
// throws. Same shim as db/tenant.test.ts and billing/engine.test.ts, installed
// before anything is required.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const {
    completeCall,
    createCall,
    getCall,
    linkProviderCall,
    listCallsForLead,
    markCallFailed,
    resolveProviderCall,
  } = requireLocal("./calls") as typeof import("./calls");

  const slug = "voice-calls-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  const abs = path.join(process.cwd(), "data", dbFile);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  for (const f of [abs, `${abs}-wal`, `${abs}-shm`]) fs.rmSync(f, { force: true });

  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Voice Calls Test", dbFile) as { id: number };
  const tid = t.id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM voice_call_index WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    for (const f of [abs, `${abs}-wal`, `${abs}-shm`]) fs.rmSync(f, { force: true });
  };

  try {
    const tdb = getTenantDbById(tid);

    // ── 1. the row exists before the dial ──
    const call = createCall(tdb, { leadId: null, toNumber: "+353871234567", startedBy: "user:1" });
    assert.equal(call.status, "dialling", "a call is recorded BEFORE the provider is asked to dial");
    assert.equal(call.toNumber, "+353871234567");
    assert.equal(call.costCents, 0);
    assert.equal(call.providerCallId, null, "no provider id until the dial is accepted");

    // ── 2. tenant resolution, and the fail-closed case ──
    assert.equal(resolveProviderCall("conv_never_seen"), null, "an unknown conversation resolves to NOTHING");

    linkProviderCall(tdb, tid, call.id, "conv_abc");
    assert.deepEqual(resolveProviderCall("conv_abc"), { tenantId: tid, callId: call.id });
    assert.equal(getCall(tdb, call.id)!.providerCallId, "conv_abc");

    // Linking twice (a retry) is a no-op, not a duplicate-key crash.
    assert.doesNotThrow(() => linkProviderCall(tdb, tid, call.id, "conv_abc"));

    // ── 3. completeCall is a CLAIM — this is what makes billing idempotent ──
    const completion = {
      status: "completed" as const,
      durationSeconds: 185,
      billedMinutes: 4,
      costCents: 180,
      outcome: "Booked a consultation for Thursday.",
      transcript: "Agent: Hi…\nThem: Sure.",
      recordingUrl: null,
    };
    assert.equal(completeCall(tdb, call.id, completion), true, "the first webhook wins");
    assert.equal(
      completeCall(tdb, call.id, completion),
      false,
      "a redelivered webhook is refused — metering keys off this, so it can't double-charge",
    );

    const done = getCall(tdb, call.id)!;
    assert.equal(done.status, "completed");
    assert.equal(done.durationSeconds, 185);
    assert.equal(done.billedMinutes, 4);
    assert.equal(done.costCents, 180);
    assert.equal(done.outcome, "Booked a consultation for Thursday.");
    assert.ok(done.endedAt, "a finished call is timestamped");

    // ── 4. a dial that never got off the ground ──
    const failed = createCall(tdb, { leadId: null, toNumber: "+353870000000", startedBy: "system" });
    markCallFailed(tdb, failed.id, "HTTP 402: out of provider credit");
    const failedRow = getCall(tdb, failed.id)!;
    assert.equal(failedRow.status, "failed");
    assert.match(failedRow.error ?? "", /402/);
    assert.equal(
      completeCall(tdb, failed.id, completion),
      false,
      "a failed call can't later be completed by a stray webhook",
    );

    // ── 5. per-lead listing is scoped to the lead ──
    assert.equal(listCallsForLead(999, tdb).length, 0);

    console.log("voice/calls.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
