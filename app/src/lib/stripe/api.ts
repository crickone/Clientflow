import "server-only";

import { formEncode } from "./encode";

/**
 * Raw Stripe API calls for Stripe Connect (Standard accounts). The platform's
 * own secret key authenticates every call; a call made FOR a business sends
 * its connected account id in the Stripe-Account header, so the charge, the
 * customer and the payout all belong to the business's own Stripe. Every
 * function returns a typed result and never throws (same posture as
 * lib/marketing/sender). Deliberately no `stripe` npm dependency.
 *
 * Environment (Railway):
 *   STRIPE_SECRET_KEY         the platform account's secret key (sk_live_...)
 *   STRIPE_CONNECT_CLIENT_ID  Connect > Settings > OAuth client id (ca_...)
 *   STRIPE_WEBHOOK_SECRET     signing secret of the Connect webhook endpoint
 * See docs/stripe-connect.md.
 */

export type StripeResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_CONNECT_CLIENT_ID);
}

async function call<T>(
  url: string,
  opts: { method?: "GET" | "POST" | "DELETE"; params?: Record<string, unknown>; account?: string; idempotencyKey?: string } = {},
): Promise<StripeResult<T>> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, error: "Stripe isn't set up on the platform yet." };
  const method = opts.method ?? "GET";
  const body = opts.params ? formEncode(opts.params) : "";
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (opts.account) headers["Stripe-Account"] = opts.account;
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  let target = url;
  if (method === "GET" && body) target += `${url.includes("?") ? "&" : "?"}${body}`;
  if (method !== "GET") headers["Content-Type"] = "application/x-www-form-urlencoded";
  try {
    const res = await fetch(target, { method, headers, body: method === "GET" ? undefined : body, cache: "no-store", signal: AbortSignal.timeout(20000) });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const err = (json?.error ?? null) as { message?: string } | string | null;
      const message = typeof err === "string" ? (json?.error_description as string) || err : err?.message;
      return { ok: false, error: message || `Stripe returned HTTP ${res.status}.`, status: res.status };
    }
    return { ok: true, data: json as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "Stripe didn't answer in time." : "Couldn't reach Stripe." };
  }
}

// STRIPE_API_BASE / STRIPE_CONNECT_BASE exist only to point local tests at a
// mock; production leaves them unset.
const API = `${process.env.STRIPE_API_BASE || "https://api.stripe.com"}/v1`;
const CONNECT = process.env.STRIPE_CONNECT_BASE || "https://connect.stripe.com";

/** The page a business owner is sent to, to approve the connection. */
export function oauthAuthorizeUrl(state: string, redirectUri: string): string | null {
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!clientId) return null;
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, scope: "read_write", state, redirect_uri: redirectUri, stripe_landing: "login" });
  return `${CONNECT}/oauth/authorize?${q.toString()}`;
}

export function exchangeOAuthCode(code: string): Promise<StripeResult<{ stripe_user_id: string; livemode: boolean }>> {
  return call(`${CONNECT}/oauth/token`, { method: "POST", params: { grant_type: "authorization_code", code } });
}

export function deauthorizeAccount(accountId: string): Promise<StripeResult<{ stripe_user_id: string }>> {
  return call(`${CONNECT}/oauth/deauthorize`, { method: "POST", params: { client_id: process.env.STRIPE_CONNECT_CLIENT_ID, stripe_user_id: accountId } });
}

export interface StripeAccount {
  id: string;
  email?: string | null;
  charges_enabled?: boolean;
  default_currency?: string;
  business_profile?: { name?: string | null } | null;
  settings?: { dashboard?: { display_name?: string | null } | null } | null;
}

export function getAccount(accountId: string): Promise<StripeResult<StripeAccount>> {
  return call(`${API}/accounts/${encodeURIComponent(accountId)}`);
}

export interface CheckoutSession {
  id: string;
  url?: string | null;
  status?: "open" | "complete" | "expired";
  payment_status?: "paid" | "unpaid" | "no_payment_required";
  amount_total?: number | null;
  currency?: string | null;
  payment_intent?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string>;
  customer_details?: { email?: string | null; name?: string | null; phone?: string | null } | null;
}

export function createCheckoutSession(account: string, params: Record<string, unknown>, idempotencyKey: string): Promise<StripeResult<CheckoutSession>> {
  return call(`${API}/checkout/sessions`, { method: "POST", params, account, idempotencyKey });
}

export function getCheckoutSession(account: string, sessionId: string): Promise<StripeResult<CheckoutSession>> {
  return call(`${API}/checkout/sessions/${encodeURIComponent(sessionId)}`, { account });
}

export function expireCheckoutSession(account: string, sessionId: string): Promise<StripeResult<CheckoutSession>> {
  return call(`${API}/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, { method: "POST", account });
}
