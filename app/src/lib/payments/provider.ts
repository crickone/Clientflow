import "server-only";

/** Result of a merchant-initiated charge on a stored card token. */
export type ChargeResult =
  | { ok: true; gatewayRef: string }
  | { ok: false; reason: "declined" | "expired_card" | "error"; message: string };

export interface CaptureStart {
  redirectUrl: string;
  sessionRef: string;
}

/**
 * Gateway abstraction. Card capture is HOSTED (we redirect the payer to the
 * provider's page and get a token back — no PAN ever touches this codebase).
 * Recurring charges are merchant-initiated (Continuous Authority) on the token.
 */
export interface PaymentProvider {
  name: "dev" | "cardstream";
  createCaptureSession(opts: {
    tenantId: number;
    /** Gross amount to charge on completion; null = save card only. */
    amountCents: number | null;
    returnUrl: string;
    /** Caller-generated capture_sessions.ref — the provider round-trips it. */
    sessionRef: string;
  }): Promise<CaptureStart>;
  chargeToken(opts: {
    token: string;
    amountCents: number;
    currency: "EUR";
    invoiceRef: string;
  }): Promise<ChargeResult>;
  refund(gatewayRef: string, amountCents: number): Promise<{ ok: boolean }>;
}

import { devProvider } from "./devProvider";

/** Active provider. CardstreamProvider is added when CreatePay credentials arrive. */
export function getPaymentProvider(): PaymentProvider {
  const which = process.env.PAYMENT_PROVIDER ?? "dev";
  if (which === "dev") return devProvider;
  throw new Error(`Unknown PAYMENT_PROVIDER: ${which} (cardstream adapter not yet installed)`);
}
