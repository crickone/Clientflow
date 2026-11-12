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
import { getTenantLifecycle } from "@/lib/platform/lifecycle";
import { getSetupSummaryForTenant } from "@/lib/setup/steps";
import { churnRisk, riskFacts, type Risk } from "@/lib/platform/churnRisk";
import { getTenantMeta } from "@/lib/platform/tenantMeta";

export const dynamic = "force-dynamic";

/** One tenant: summary + usage + full invoice/event history + email-marketing state. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;

  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const tenant = getTenantSummary(id);
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let setup = { requiredDone: 0, requiredTotal: 0, resolved: 0, total: 0, nextTitle: null as string | null, steps: [] as Array<{ id: string; title: string; done: boolean; skipped: boolean; optional: boolean }> };
  try {
    const s = getSetupSummaryForTenant(id);
    setup = {
      requiredDone: s.requiredDone,
      requiredTotal: s.requiredTotal,
      resolved: s.resolved,
      total: s.total,
      nextTitle: s.nextTitle,
      steps: s.steps.map((x) => ({ id: x.id, title: x.title, done: x.done, skipped: x.skipped, optional: Boolean(x.optional) })),
    };
  } catch {
    // setup is unreadable for this business; the console shows blanks
  }
  let risk: Risk = { score: 0, level: "low", reasons: [] };
  try {
    risk = churnRisk(riskFacts(id, { requiredDone: setup.requiredDone, requiredTotal: setup.requiredTotal }));
  } catch {
    // keep the safe fallback
  }
  let meta: ReturnType<typeof getTenantMeta> | null = null;
  try {
    meta = getTenantMeta(id, {
      archived: Boolean(getTenantLifecycle(id)?.archivedAt),
      billingStatus: tenant.billing?.status ?? null,
      exempt: Boolean(tenant.billing?.billingExempt),
      setupRequiredDone: setup.requiredDone,
      setupRequiredTotal: setup.requiredTotal,
      riskScore: risk.score,
    });
  } catch {
    meta = null;
  }

  return NextResponse.json({
    tenant,
    meta,
    setup,
    risk,
    usage: tenantUsage(id),
    // Archive/purge state: the console's danger zone is entirely driven by
    // whether this business is inside its 30-day window.
    lifecycle: getTenantLifecycle(id),
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
