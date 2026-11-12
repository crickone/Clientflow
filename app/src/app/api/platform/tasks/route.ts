import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { listTasks } from "@/lib/platform/tasks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const sp = req.nextUrl.searchParams;
  const assignedTo = Number(sp.get("assignedTo"));
  return NextResponse.json({
    tasks: listTasks({ assignedTo: Number.isInteger(assignedTo) && assignedTo > 0 ? assignedTo : undefined, open: sp.get("open") === "1" }),
  });
}
