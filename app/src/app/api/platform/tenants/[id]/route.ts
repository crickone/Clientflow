import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { listEvents, listInvoices } from "@/lib/billing/engine";
import { getTenantSummary, tenantUsage } from "@/lib/platform/queries";
import { getAutoTopup, getEmailBalanceCents, isMarketingSuspended } from "@/lib/email/credits";
import { getAiBalanceCents, getAiAutoTopup, isAiSuspended, listAiLedger } from "@/lib/ai/creditsLedger";
import { getMonthlyUsageCents, getTenantCapCents } from "@/lib/ai/usage";

export const dynamic = "force-dynamic";

/** One tenant: summary + usage + full invoice/event history + email-marketing state. */
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
    emailBalanceCents: getEmailBalanceCents(id),
    marketingSuspended: isMarketingSuspended(id),
    autoTopup: getAutoTopup(id),
    ai: {
      balanceCents: getAiBalanceCents(id),
      freeTrancheCents: getTenantCapCents(id),
      monthlyUsedCents: getMonthlyUsageCents(id),
      suspended: isAiSuspended(id),
      autoTopup: getAiAutoTopup(id),
      ledger: listAiLedger(id, 20),
    },
  });
}
