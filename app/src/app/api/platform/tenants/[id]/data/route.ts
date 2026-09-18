import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import { backupTenant, deletePerson, exportPerson, findPeople, getTenantData, listBackups } from "@/lib/platform/data";
import { getTenantLifecycle } from "@/lib/platform/lifecycle";

export const dynamic = "force-dynamic";

/**
 * What a business holds, and the operations support performs on it.
 *
 * The split by role follows what cannot be undone. A manager can read,
 * search and take a backup. Deleting a person is an owner's act: it is
 * irreversible and it is exactly the kind of request that arrives by email
 * claiming to be from someone it is not.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return NextResponse.json({ error: "Unknown business" }, { status: 404 });
  }
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({
    ...getTenantData(tenantId),
    people: q ? findPeople(tenantId, q) : [],
    backups: listBackups(tenantId),
    lifecycle: getTenantLifecycle(tenantId),
  });
}

const bodySchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("backup") }),
  z.object({ op: z.literal("export-person"), kind: z.enum(["client", "lead"]), personId: z.number().int().positive() }),
  z.object({
    op: z.literal("delete-person"),
    kind: z.enum(["client", "lead"]),
    personId: z.number().int().positive(),
    reason: z.string().min(3).max(300),
  }),
]);

/** Deleting a person cannot be undone, so it is an owner's call. */
const OWNER_OPS = new Set(["delete-person"]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = Number(params.id);
  const ip = requestIp(req);

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  }

  const action = `data.${parsed.op}`;
  const refuse = (error: string, status: number, detail?: Record<string, unknown>) => {
    recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId, action, detail, ip, ok: false, error });
    return NextResponse.json({ ok: false, error }, { status });
  };

  if (OWNER_OPS.has(parsed.op) && g.role !== "owner") {
    return refuse("Deleting someone's data is an owner's action.", 403);
  }

  if (parsed.op === "backup") {
    const result = backupTenant(tenantId);
    recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId, action, ip, ok: result.ok, error: result.ok ? null : result.error });
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json({ ok: true, note: result.note, backups: listBackups(tenantId) });
  }

  if (parsed.op === "export-person") {
    const result = exportPerson(tenantId, parsed.kind, parsed.personId);
    recordAudit({
      actorUserId: g.userId,
      actorEmail: g.email,
      actorRole: g.role,
      tenantId,
      action,
      detail: { kind: parsed.kind, personId: parsed.personId },
      ip,
      ok: result.ok,
      error: result.ok ? null : result.error,
    });
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json({ ok: true, data: result.data });
  }

  // delete-person
  const result = deletePerson(tenantId, parsed.kind, parsed.personId);
  recordAudit({
    actorUserId: g.userId,
    actorEmail: g.email,
    actorRole: g.role,
    tenantId,
    action,
    detail: { kind: parsed.kind, personId: parsed.personId },
    reason: parsed.reason,
    ip,
    ok: result.ok,
    error: result.ok ? null : result.error,
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ ok: true, note: result.note, ...getTenantData(tenantId) });
}
