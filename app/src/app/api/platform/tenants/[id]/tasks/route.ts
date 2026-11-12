import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import { parseId, parseTenantId, taskBelongs } from "@/lib/platform/routeTenant";
import { addTask, deleteTask, listTasks, setTaskDone } from "@/lib/platform/tasks";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

export async function GET(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = parseTenantId(id);
  if (!tenantId) return notFound();
  return NextResponse.json({ tasks: listTasks({ tenantId }) });
}

export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = parseTenantId(id);
  if (!tenantId) return notFound();
  const parsed = z
    .object({ title: z.string().trim().min(1).max(200), dueAt: z.number().int().nullable(), assignedTo: z.number().int().positive().nullable() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Give the task a title." }, { status: 400 });
  const task = addTask({ tenantId, ...parsed.data, createdBy: g.userId });
  recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId, action: "task.add", detail: { id: task.id }, ip: requestIp(req) });
  return NextResponse.json({ ok: true, task });
}

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = parseTenantId(id);
  if (!tenantId) return notFound();
  const parsed = z.object({ id: z.number().int().positive(), done: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  if (!taskBelongs(parsed.data.id, tenantId)) return notFound();
  setTaskDone(parsed.data.id, parsed.data.done);
  recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId, action: "task.done", detail: { id: parsed.data.id, done: parsed.data.done }, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = parseTenantId(id);
  if (!tenantId) return notFound();
  const taskId = parseId(req.nextUrl.searchParams.get("id"));
  if (!taskId || !taskBelongs(taskId, tenantId)) return notFound();
  deleteTask(taskId);
  recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId, action: "task.delete", detail: { id: taskId }, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}
