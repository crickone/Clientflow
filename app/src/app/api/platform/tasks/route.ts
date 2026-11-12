import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { parseId } from "@/lib/platform/routeTenant";
import { listTasks } from "@/lib/platform/tasks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const sp = req.nextUrl.searchParams;
  const raw = sp.get("assignedTo");
  const assignedTo = raw === null ? undefined : parseId(raw);
  if (assignedTo === null) return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  return NextResponse.json({ tasks: listTasks({ assignedTo, open: sp.get("open") === "1" }) });
}
