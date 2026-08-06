import "server-only";
import crypto from "node:crypto";

import { controlSqlite } from "@/lib/db/control";
import { getPaymentProvider } from "@/lib/payments/provider";
import { DEV_TOKENS } from "@/lib/payments/devProvider";
import { computeVat } from "./money";
import { getMonthlyPriceCents, getVatRateBp } from "./settings";
import { activateTenant, chargeOutstanding, getBilling, logEvent, saveCard } from "./engine";

export type CapturePurpose = "activate" | "update_card" | "reactivate";

/** Create a capture session + hand back the provider's redirect URL. */
export async function startCapture(
  tenantId: number,
  purpose: CapturePurpose,
): Promise<{ redirectUrl: string }> {
  const ref = `cs_${crypto.randomBytes(12).toString("hex")}`;
  const amountCents =
    purpose === "activate" ? computeVat(getMonthlyPriceCents(), getVatRateBp()).grossCents : null;
  controlSqlite
    .prepare("INSERT INTO capture_sessions (ref, tenant_id, purpose, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(ref, tenantId, purpose, amountCents, Date.now());
  const returnUrl = purpose === "update_card" ? "/settings/billing" : "/dashboard";
  const { redirectUrl } = await getPaymentProvider().createCaptureSession({
    tenantId, amountCents, returnUrl, sessionRef: ref,
  });
  return { redirectUrl };
}

export interface CaptureOutcome {
  ok: boolean;
  token?: string; last4?: string; expiry?: string; chargeRef?: string;
}

/**
 * Apply a finished capture session (called by the dev completion endpoint now,
 * the Cardstream callback later). Idempotent: a non-pending session is a no-op.
 */
export async function completeCapture(ref: string, outcome: CaptureOutcome): Promise<{ returnTo: string }> {
  const s = controlSqlite.prepare("SELECT * FROM capture_sessions WHERE ref = ?").get(ref) as
    | { ref: string; tenant_id: number; purpose: CapturePurpose; amount_cents: number | null; status: string }
    | undefined;
  if (!s) throw new Error("Unknown capture session");
  if (s.status !== "pending") return { returnTo: routeAfter(s.purpose) };

  if (!outcome.ok || !outcome.token) {
    controlSqlite.prepare("UPDATE capture_sessions SET status = 'failed' WHERE ref = ?").run(ref);
    logEvent(s.tenant_id, "capture_failed", { ref, purpose: s.purpose }, "system");
    return { returnTo: routeAfter(s.purpose) };
  }

  saveCard(s.tenant_id, {
    token: outcome.token,
    last4: outcome.last4 ?? "0000",
    expiry: outcome.expiry ?? "12/29",
  });

  if (s.purpose === "activate" && s.amount_cents != null) {
    activateTenant(s.tenant_id, outcome.chargeRef ?? "capture");
  } else if (s.purpose === "reactivate") {
    await chargeOutstanding(s.tenant_id, "system");
  }
  controlSqlite.prepare("UPDATE capture_sessions SET status = 'complete' WHERE ref = ?").run(ref);
  return { returnTo: routeAfter(s.purpose) };
}

function routeAfter(purpose: CapturePurpose): string {
  return purpose === "update_card" ? "/settings/billing" : "/dashboard";
}

export { DEV_TOKENS };
