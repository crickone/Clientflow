import { NextResponse, type NextRequest } from "next/server";

import { runWithTenant } from "@/lib/db/tenant";
import { markInBodyWebhook, tenantForWebhookSecret } from "@/lib/inbody/connection";
import { ingestNotification } from "@/lib/inbody/scans";

/**
 * LookinBody Web posts here when the gym's scanner uploads a new scan. The
 * notification carries who and when (UserID, TelHP, TestDatetimes), not the
 * results; ingestNotification stores the scan and then fetches the results.
 *
 * The path secret is the tenant's webhook_secret: it is the only thing
 * identifying the tenant, and an unknown one gets a 404 with nothing stored.
 * A known one always gets a 200 with a body -- LookinBody's "Send test" will
 * not save the webhook otherwise -- and a failure to fetch results is kept on
 * the scan for the hourly retry rather than reported back to InBody.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  const text = await req.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return (parsed[0] as Record<string, unknown>) ?? {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

export async function POST(req: NextRequest, { params }: { params: { secret: string } }) {
  const tenant = tenantForWebhookSecret(params.secret);
  if (!tenant) return NextResponse.json({ success: false }, { status: 404 });
  const payload = await readBody(req);
  const account = String(payload.Account ?? payload.account ?? "").trim();
  if (tenant.account && account && account.toLowerCase() !== tenant.account.toLowerCase()) {
    return NextResponse.json({ success: false, error: "account mismatch" }, { status: 401 });
  }
  markInBodyWebhook(tenant.tenantId);
  try {
    const r = await runWithTenant(tenant.tenantId, () => ingestNotification(tenant.tenantId, payload));
    return NextResponse.json({ success: true, stored: Boolean(r.scan), matched: r.scan?.clientId != null });
  } catch (err) {
    console.error("[inbody] webhook failed", err);
    return NextResponse.json({ success: true, stored: false });
  }
}

/** A GET answers "is this address alive" for anyone checking it in a browser. */
export async function GET(_req: NextRequest, { params }: { params: { secret: string } }) {
  const tenant = tenantForWebhookSecret(params.secret);
  return NextResponse.json({ ok: Boolean(tenant) }, { status: tenant ? 200 : 404 });
}
