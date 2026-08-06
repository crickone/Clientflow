import { NextResponse, type NextRequest } from "next/server";

import { getCurrentMembership } from "@/lib/auth";
import { getBilling } from "@/lib/billing/engine";
import { startCapture, type CapturePurpose } from "@/lib/billing/capture";

export const dynamic = "force-dynamic";

/** Gym owner starts a card-capture (activate / update card / reactivate). */
export async function POST(req: NextRequest) {
  const m = getCurrentMembership();
  if (!m || m.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { purpose?: CapturePurpose } | null;
  const purpose = body?.purpose;
  if (!purpose || !["activate", "update_card", "reactivate"].includes(purpose)) {
    return NextResponse.json({ error: "Invalid purpose" }, { status: 400 });
  }
  const b = getBilling(m.tenant.id);
  if (!b) return NextResponse.json({ error: "Billing not enabled for this account" }, { status: 400 });
  if (purpose === "activate" && b.status !== "pending_payment") {
    return NextResponse.json({ error: "Already activated" }, { status: 400 });
  }
  const { redirectUrl } = await startCapture(m.tenant.id, purpose);
  return NextResponse.json({ ok: true, redirectUrl });
}
