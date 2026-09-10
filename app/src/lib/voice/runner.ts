import "server-only";

import { eq } from "drizzle-orm";

import { controlDb } from "@/lib/db/control";
import { getTenantDbById, runWithTenant } from "@/lib/db/tenant";
import { tenants } from "@/lib/db/schema";
import { getCallFlowForTenant, isWithinWindow, nextAttemptAt, nextWindowOpening } from "./flow";
import { dueItems, deferItem, recordAttempt } from "./queue";
import { dialLead } from "./dial";

/**
 * The dialler: the loop that turns a queued call into an actual one.
 *
 * A minute-granularity timer of its own, NOT part of the daily scheduler
 * (lib/automations/scheduler.ts) — speed-to-lead is the entire point of
 * automatic calling, and a lead followed up the next morning is a different
 * (worse) product. The two loops share nothing but the process.
 *
 * Everything it does is conservative by construction:
 *   - it only looks at tenants whose flow is ARMED, so a disarmed tenant costs
 *     one settings read per tick and nothing else;
 *   - outside the calling window it DEFERS rather than dials, and a deferral
 *     does not consume an attempt — a lead enrolled at 2am still gets its full
 *     three tries during business hours;
 *   - the attempt is counted when the dial is PLACED, not when it is answered,
 *     so maxAttempts holds even if every webhook is lost;
 *   - one call per tenant per tick. A dialler that fires twenty calls at once
 *     is a call centre nobody staffed, and it would blow a spend cap in a
 *     minute. Throughput is deliberately boring.
 *
 * Every gate that decides whether a specific person may be phoned still lives
 * in `dialLead` — this loop decides only WHEN to ask.
 */

let started = false;
let running = false;

const TICK_MS = 60_000;
/** Calls placed per tenant per tick — see the header on why this is 1. */
const MAX_CALLS_PER_TENANT_PER_TICK = 1;

/** One tenant's due work. Returns how many calls it actually placed. */
async function runTenant(tenantId: number): Promise<number> {
  const flow = getCallFlowForTenant(tenantId);
  if (!flow.enabled) return 0;

  const tdb = getTenantDbById(tenantId);
  const now = new Date();
  const items = dueItems(tdb, now.getTime(), 10);
  if (items.length === 0) return 0;

  // Window shut: push everything to the next opening and stop. Cheaper than
  // per-item checks, and correct — the window is a property of the clock, not
  // of the lead.
  if (!isWithinWindow(now, flow)) {
    const opening = nextWindowOpening(now, flow);
    // A window that can never open (no days selected) parks work an hour out
    // rather than spinning: the operator will fix the setting, and the items
    // are still visible as pending in the meantime.
    const until = opening ? opening.getTime() : now.getTime() + 60 * 60_000;
    for (const item of items) deferItem(tdb, item.id, until);
    return 0;
  }

  let placed = 0;
  for (const item of items) {
    if (placed >= MAX_CALLS_PER_TENANT_PER_TICK) break;

    const res = await runWithTenant(tenantId, () =>
      dialLead({ leadId: item.leadId, startedBy: "system" }),
    );

    // Whether the dial succeeded or was refused, the attempt is spent: a lead
    // whose number is unusable, or whose account is out of credit, must not be
    // retried every minute forever. The reason is kept on the row so an
    // operator can see why a lead stopped being called.
    recordAttempt(
      tdb,
      item,
      flow,
      nextAttemptAt(new Date(), flow).getTime(),
      res.ok ? null : res.error,
    );
    if (res.ok) placed++;
  }
  return placed;
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const active = controlDb
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.isActive, true))
      .all();
    for (const t of active) {
      try {
        await runTenant(t.id);
      } catch (err) {
        // One tenant's bad row must never stop the others being dialled.
        console.error(`[voice-dialler] tenant ${t.id} failed (retrying next tick):`, err);
      }
    }
  } catch (err) {
    console.error("[voice-dialler] tick failed:", err);
  } finally {
    running = false;
  }
}

/**
 * Start the dialler (self-started on server import, like the daily scheduler).
 * The first tick is delayed past boot so a deploy doesn't dial while the
 * process is still warming up.
 */
export function startVoiceDialler(): void {
  if (started) return;
  started = true;
  setTimeout(() => void tick(), 90_000);
  setInterval(() => void tick(), TICK_MS);
}

if (process.env.NEXT_PHASE !== "phase-production-build") {
  startVoiceDialler();
}
