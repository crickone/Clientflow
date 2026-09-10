import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { logEvent } from "@/lib/billing/engine";
import {
  getMonthlyPriceCents,
  getVatRateBp,
  setPlatformSetting,
} from "@/lib/billing/settings";
import { getEmailPricePer1000Cents, setEmailPricePer1000Cents } from "@/lib/email/credits";
import { getAiMarginBp, setAiMarginBp } from "@/lib/ai/creditsLedger";
import { getEmailIncludedPerMonth, setEmailIncludedPerMonth } from "@/lib/email/included";
import {
  getVoiceIncludedMinutes,
  getVoicePricePerMinuteCents,
  getVoiceTrialMinutes,
  setVoiceIncludedMinutes,
  setVoicePricePerMinuteCents,
  setVoiceTrialMinutes,
} from "@/lib/voice/pricing";

export const dynamic = "force-dynamic";

function currentSettings() {
  return {
    monthlyPriceCents: getMonthlyPriceCents(),
    vatRateBp: getVatRateBp(),
    emailCreditPricePer1000Cents: getEmailPricePer1000Cents(),
    emailIncludedPerMonth: getEmailIncludedPerMonth(),
    aiCreditMarginBp: getAiMarginBp(),
    voicePricePerMinuteCents: getVoicePricePerMinuteCents(),
    voiceIncludedMinutes: getVoiceIncludedMinutes(),
    voiceTrialMinutes: getVoiceTrialMinutes(),
    provider: process.env.PAYMENT_PROVIDER ?? "dev",
  };
}

/** Read platform-wide pricing/tax/provider settings. */
export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  return NextResponse.json(currentSettings());
}

const schema = z.object({
  monthlyPriceCents: z.number().int().min(0),
  vatRateBp: z.number().int().min(0).max(10000),
  // Bounds mirror MIN/MAX_EMAIL_PRICE_PER_1000_CENTS in @/lib/email/credits —
  // kept in sync here so an out-of-range value is rejected with a clean 400
  // below rather than reaching setEmailPricePer1000Cents, which throws (and
  // would otherwise surface as an unhandled 500).
  emailCreditPricePer1000Cents: z.number().int().min(0).max(10_000),
  // Optional so the admin console (a separately-deployed service) can be
  // upgraded independently of this one without its older PUT body 400ing.
  // Bounds mirror MAX_AI_MARGIN_BP in @/lib/ai/creditsLedger.
  aiCreditMarginBp: z.number().int().min(0).max(10_000).optional(),
  // All optional for the same reason as aiCreditMarginBp above: the admin
  // console is a separately-deployed service, so an older console's PUT body
  // (which knows nothing about voice) must not 400. Bounds mirror the setters
  // in @/lib/email/included and @/lib/voice/pricing.
  emailIncludedPerMonth: z.number().int().min(0).max(1_000_000).optional(),
  voicePricePerMinuteCents: z.number().int().min(0).max(2_000).optional(),
  voiceIncludedMinutes: z.number().int().min(0).max(100_000).optional(),
  voiceTrialMinutes: z.number().int().min(0).max(100_000).optional(),
});

/** Update pricing + VAT rate + email credit price (audited). */
export async function PUT(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const actor = `admin:${g.userId}`;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  setPlatformSetting("monthly_price_cents", String(parsed.data.monthlyPriceCents));
  setPlatformSetting("vat_rate_bp", String(parsed.data.vatRateBp));
  setEmailPricePer1000Cents(parsed.data.emailCreditPricePer1000Cents);
  if (parsed.data.aiCreditMarginBp !== undefined) setAiMarginBp(parsed.data.aiCreditMarginBp);
  if (parsed.data.emailIncludedPerMonth !== undefined) setEmailIncludedPerMonth(parsed.data.emailIncludedPerMonth);
  if (parsed.data.voicePricePerMinuteCents !== undefined) setVoicePricePerMinuteCents(parsed.data.voicePricePerMinuteCents);
  if (parsed.data.voiceIncludedMinutes !== undefined) setVoiceIncludedMinutes(parsed.data.voiceIncludedMinutes);
  if (parsed.data.voiceTrialMinutes !== undefined) setVoiceTrialMinutes(parsed.data.voiceTrialMinutes);
  logEvent(null, "settings_changed", parsed.data, actor);
  return NextResponse.json(currentSettings());
}
