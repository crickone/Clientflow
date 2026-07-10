import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { recomputeLapsed } from "@/lib/pipeline/lapse";

export const dynamic = "force-dynamic";

/** Admin-triggered lapse recompute for the caller's tenant (the daily run fans
 *  out across all tenants in-process). */
export async function POST() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = recomputeLapsed(db);
  return NextResponse.json({ ok: true, ...result });
}
