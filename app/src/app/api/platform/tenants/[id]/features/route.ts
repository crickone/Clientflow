import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import { MODULE_CATALOG, MODULE_KEYS, isModuleOn, type FeatureFlags } from "@/lib/features";
import { getFeatureFlagsForTenant, getSchedulingModeForTenant, getVenueTypeForTenant, setFeatureFlags } from "@/lib/settings";
import { runWithTenant } from "@/lib/db/tenant";

export const dynamic = "force-dynamic";

/**
 * Which modules a business has, and the venue settings that sit beside them.
 *
 * Read returns the whole catalog with each module's current state, so the
 * console never has to keep its own copy of the list -- add a module to
 * MODULE_CATALOG and it appears here.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return NextResponse.json({ error: "Unknown business" }, { status: 404 });
  }
  const flags = getFeatureFlagsForTenant(tenantId);
  return NextResponse.json({
    modules: MODULE_CATALOG.map((m) => ({ ...m, on: isModuleOn(flags, m.key) })),
    venueType: getVenueTypeForTenant(tenantId),
    schedulingMode: getSchedulingModeForTenant(tenantId),
  });
}

const bodySchema = z.object({
  key: z.string().refine((k) => MODULE_KEYS.includes(k), { message: "Unknown module" }),
  on: z.boolean(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = Number(params.id);
  const ip = requestIp(req);

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Pick a module and a state." }, { status: 400 });
  }

  const before = getFeatureFlagsForTenant(tenantId);
  // Only an explicit `false` is stored: switching a module back ON removes
  // its key rather than writing `true`, so the stored object stays the list
  // of exceptions it is meant to be.
  const next: FeatureFlags = { ...before };
  if (parsed.on) delete next[parsed.key];
  else next[parsed.key] = false;

  runWithTenant(tenantId, () => setFeatureFlags(next));

  recordAudit({
    actorUserId: g.userId,
    actorEmail: g.email,
    actorRole: g.role,
    tenantId,
    action: "features.set",
    detail: { key: parsed.key, on: parsed.on, before: isModuleOn(before, parsed.key) },
    ip,
  });

  const flags = getFeatureFlagsForTenant(tenantId);
  return NextResponse.json({
    ok: true,
    note: `${MODULE_CATALOG.find((m) => m.key === parsed.key)?.label ?? parsed.key} is now ${parsed.on ? "on" : "off"}.`,
    modules: MODULE_CATALOG.map((m) => ({ ...m, on: isModuleOn(flags, m.key) })),
  });
}
