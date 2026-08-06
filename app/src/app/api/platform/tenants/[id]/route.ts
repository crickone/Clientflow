import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { listEvents, listInvoices } from "@/lib/billing/engine";
import { getTenantSummary, tenantUsage } from "@/lib/platform/queries";

export const dynamic = "force-dynamic";

/** One tenant: summary + usage + full invoice/event history. */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;

  const id = Number(params.id);
  const tenant = getTenantSummary(id);
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    tenant,
    usage: tenantUsage(id),
    invoices: listInvoices(id),
    events: listEvents(id),
  });
}
