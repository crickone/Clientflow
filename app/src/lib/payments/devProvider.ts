import "server-only";
import crypto from "node:crypto";

import type { PaymentProvider, ChargeResult } from "./provider";

/**
 * Dev/mock provider: the "hosted page" is our own /dev/pay/[ref] screen with
 * Approve / Decline buttons. Deterministic tokens let tests and manual QA drive
 * every lifecycle path without any external gateway.
 */
export const DEV_TOKENS = {
  /** Always charges successfully. */
  ok: "tok_dev_ok",
  /** Always declines — simulates a card that fails at renewal. */
  decline: "tok_dev_decline",
} as const;

export const devProvider: PaymentProvider = {
  name: "dev",

  async createCaptureSession({ sessionRef }) {
    return { redirectUrl: `/dev/pay/${sessionRef}`, sessionRef };
  },

  async chargeToken({ token }): Promise<ChargeResult> {
    if (token === DEV_TOKENS.ok) {
      return { ok: true, gatewayRef: `dev_${crypto.randomBytes(8).toString("hex")}` };
    }
    if (token === DEV_TOKENS.decline) {
      return { ok: false, reason: "declined", message: "Card declined (dev token)" };
    }
    return { ok: false, reason: "error", message: `Unknown dev token: ${token}` };
  },

  async refund() {
    return { ok: true };
  },
};
