import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { logEvent } from "@/lib/billing/engine";
import {
  getMonthlyPriceCents,
  getVatRateBp,
  setPlatformSetting,
} from "@/lib/billing/settings";

export const dynamic = "force-dynamic";

function currentSettings() {
  return {
    monthlyPriceCents: getMonthlyPriceCents(),
    vatRateBp: getVatRateBp(),
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
});

/** Update pricing + VAT rate (audited). */
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
  logEvent(null, "settings_changed", parsed.data, actor);
  return NextResponse.json(currentSettings());
}
