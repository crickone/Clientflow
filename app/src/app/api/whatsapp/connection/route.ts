import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { getWhatsAppBridge, isWhatsAppConfigured } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/** Backs the Settings connection panel: live status + QR for linking. */
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  if (!isWhatsAppConfigured()) {
    return NextResponse.json({ ok: true, configured: false });
  }
  try {
    const bridge = getWhatsAppBridge();
    const status = await bridge.connectionStatus();
    // Only fetch a QR when not yet linked.
    const qr = status.connected ? null : (await bridge.getQrCode()).qr;
    return NextResponse.json({
      ok: true,
      configured: true,
      connected: status.connected,
      phone: status.phone,
      qr,
    });
  } catch (err) {
    return NextResponse.json({
      ok: true,
      configured: true,
      connected: false,
      phone: null,
      qr: null,
      error: err instanceof Error ? err.message : "Provider error",
    });
  }
}
