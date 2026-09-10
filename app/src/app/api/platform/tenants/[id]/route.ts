import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { listEvents, listInvoices } from "@/lib/billing/engine";
import { getTenantSummary, tenantUsage } from "@/lib/platform/queries";
import { getAutoTopup, getEmailBalanceCents, isMarketingSuspended } from "@/lib/email/credits";
import { getAiBalanceCents, getAiAutoTopup, isAiSuspended, listAiLedger } from "@/lib/ai/creditsLedger";
import { getMonthlyUsageCents, getTenantCapCents } from "@/lib/ai/usage";
import { getSentThisMonth, getTenantIncludedSends } from "@/lib/email/included";
import { listTenantAddons } from "@/lib/billing/addons";
import { getVoiceBalanceCents, isVoiceSuspended, listVoiceLedger } from "@/lib/voice/credits";
import { getMonthUsage, getVoiceCapCents, includedMinutesRemaining, trialSecondsRemaining } from "@/lib/voice/usage";
import { getVoicePricePerMinuteCents } from "@/lib/voice/pricing";

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
    email: {
      includedPerMonth: getTenantIncludedSends(id),
      sentThisMonth: getSentThisMonth(id),
    },
    addons: listTenantAddons(id),
    voice: {
      balanceCents: getVoiceBalanceCents(id),
      capCents: getVoiceCapCents(id),
      pricePerMinuteCents: getVoicePricePerMinuteCents(),
      includedMinutesRemaining: includedMinutesRemaining(id),
      trialMinutesRemaining: Math.floor(trialSecondsRemaining(id) / 60),
      month: getMonthUsage(id),
      suspended: isVoiceSuspended(id),
      ledger: listVoiceLedger(id, 20),
    },
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
