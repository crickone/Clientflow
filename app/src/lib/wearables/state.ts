import "server-only";

import { decryptToken, encryptToken } from "@/lib/google/tokenCrypto";
import { isProviderId, type ProviderId } from "@/lib/wearables/model";

/**
 * The OAuth `state` for a wearable sign-in: who is connecting, the PKCE
 * verifier, and where to send them back (the gym's own domain, or ours).
 * Encrypted and authenticated (AES-GCM), so it can't be read or forged, and
 * it expires after 15 minutes. No cookie: the member may start on the gym's
 * domain and come back through ours.
 */
export interface WearableState {
  tenantId: number;
  clientId: number;
  provider: ProviderId;
  verifier: string | null;
  returnTo: string;
  exp: number;
}

export function sealState(s: Omit<WearableState, "exp">): string {
  return Buffer.from(encryptToken(JSON.stringify({ ...s, exp: Date.now() + 15 * 60_000 })), "utf8").toString("base64url");
}

export function openState(token: string): WearableState | null {
  try {
    const v = JSON.parse(decryptToken(Buffer.from(token, "base64url").toString("utf8"))) as WearableState;
    if (!v || typeof v.tenantId !== "number" || typeof v.clientId !== "number" || !isProviderId(v.provider) || typeof v.returnTo !== "string") return null;
    if (typeof v.exp !== "number" || v.exp < Date.now()) return null;
    if (!/^https?:\/\/[^/]+$/.test(v.returnTo)) return null;
    return v;
  } catch {
    return null;
  }
}
