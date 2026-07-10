import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/auth";
import { runBackup } from "@/lib/backup/runBackup";

export const dynamic = "force-dynamic";

/** Admin-triggered, on-demand backup (the nightly run is handled in-process). */
export async function POST() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await runBackup();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
