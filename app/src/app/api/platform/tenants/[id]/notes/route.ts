import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import { addNote, deleteNote, listNotes, setNotePinned } from "@/lib/platform/notes";
import { noteBelongs, parseId, parseTenantId } from "@/lib/platform/routeTenant";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

export async function GET(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = parseTenantId(id);
  if (!tenantId) return notFound();
  return NextResponse.json({ notes: listNotes(tenantId) });
}

export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = parseTenantId(id);
  if (!tenantId) return notFound();
  const parsed = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Write something." }, { status: 400 });
  const note = addNote(tenantId, g.userId, parsed.data.body);
  recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId, action: "note.add", detail: { id: note.id }, ip: requestIp(req) });
  return NextResponse.json({ ok: true, note });
}

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = parseTenantId(id);
  if (!tenantId) return notFound();
  const parsed = z.object({ id: z.number().int().positive(), pinned: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  if (!noteBelongs(parsed.data.id, tenantId)) return notFound();
  setNotePinned(parsed.data.id, parsed.data.pinned);
  recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId, action: "note.pin", detail: { id: parsed.data.id, pinned: parsed.data.pinned }, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = parseTenantId(id);
  if (!tenantId) return notFound();
  const noteId = parseId(req.nextUrl.searchParams.get("id"));
  if (!noteId || !noteBelongs(noteId, tenantId)) return notFound();
  const r = deleteNote(noteId, g.userId, g.role === "owner");
  recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId, action: "note.delete", detail: { id: noteId }, ip: requestIp(req), ok: r.ok, error: r.ok ? null : r.error });
  return NextResponse.json(r, { status: r.ok ? 200 : 403 });
}
