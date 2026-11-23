import "server-only";

import { formEncode } from "./encode";

/**
 * Raw Stripe API calls for Stripe Connect. The platform's own secret key
 * authenticates every call; a call made FOR a business sends its connected
 * account id in the Stripe-Account header, so the charge, the customer and
 * the payout all belong to the business's own Stripe. Every function returns
 * a typed result and never throws (same posture as lib/marketing/sender).
 * Deliberately no `stripe` npm dependency.
 *
 * Connecting is Stripe-hosted onboarding (the live platform profile is
 * "Onboarding hosted by Stripe", which has no OAuth client id): the platform
 * creates the business's account with Standard-style controller settings
 * (its own full Stripe dashboard, Stripe carries losses, the business pays
 * its own fees) and sends the owner to an account link to fill it in.
 *
 * Environment (Railway):
 *   STRIPE_SECRET_KEY         the platform account's secret key (sk_live_...)
 *   STRIPE_WEBHOOK_SECRET     signing secret of the Connect webhook endpoint
 *   STRIPE_CONNECT_CLIENT_ID  Connect > Onboarding options > OAuth client id (ca_...);
 *                             optional, turns on "Connect your existing Stripe account"
 * See docs/stripe-connect.md.
 */

export type StripeResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

/**
 * A Stripe setting from the environment, trimmed: a value pasted into
 * Railway with a trailing newline (it happened with the webhook secret)
 * otherwise fails every signature check without a visible difference.
 */
export function stripeEnv(name: "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET" | "STRIPE_CONNECT_CLIENT_ID"): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function stripeConfigured(): boolean {
  return Boolean(stripeEnv("STRIPE_SECRET_KEY"));
}

/** Live or test, read from the platform key. An account made with one can't be used with the other. */
export function stripeKeyMode(): "live" | "test" | null {
  return keyMode(stripeEnv("STRIPE_SECRET_KEY"));
}

export function keyMode(key: string | undefined): "live" | "test" | null {
  if (!key) return null;
  return /^(sk|rk)_live_/.test(key) ? "live" : "test";
}

async function call<T>(
  url: string,
  opts: { method?: "GET" | "POST" | "DELETE"; params?: Record<string, unknown>; account?: string; idempotencyKey?: string } = {},
): Promise<StripeResult<T>> {
  const key = stripeEnv("STRIPE_SECRET_KEY");
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

// STRIPE_API_BASE exists only to point local tests at a mock; production leaves it unset.
const API = `${process.env.STRIPE_API_BASE || "https://api.stripe.com"}/v1`;
const CONNECT = process.env.STRIPE_CONNECT_BASE || "https://connect.stripe.com";

/** Whether a business can attach a Stripe account it already has (OAuth), not only make a new one. */
export function oauthConfigured(): boolean {
  return Boolean(stripeEnv("STRIPE_SECRET_KEY") && stripeEnv("STRIPE_CONNECT_CLIENT_ID"));
}

/** Stripe's sign-in page, where the owner picks the existing account to connect. */
export function oauthAuthorizeUrl(state: string, redirectUri: string): string | null {
  const clientId = stripeEnv("STRIPE_CONNECT_CLIENT_ID");
  if (!clientId) return null;
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, scope: "read_write", state, redirect_uri: redirectUri, stripe_landing: "login" });
  return `${CONNECT}/oauth/authorize?${q.toString()}`;
}

/** Swap the one-time code Stripe sends back for the connected account id. */
export function exchangeOAuthCode(code: string): Promise<StripeResult<{ stripe_user_id: string; livemode: boolean }>> {
  return call(`${CONNECT}/oauth/token`, { method: "POST", params: { grant_type: "authorization_code", code } });
}

/**
 * The controller settings that make a platform-created account behave like a
 * Standard account: the business gets the full Stripe dashboard, Stripe (not
 * the platform) carries negative balances, the business pays Stripe's fees,
 * and Stripe collects the identity and bank details itself.
 */
export const STANDARD_CONTROLLER = {
  stripe_dashboard: { type: "full" },
  losses: { payments: "stripe" },
  fees: { payer: "account" },
  requirement_collection: "stripe",
} as const;

export function accountCreateParams(input: { email: string | null; businessName: string | null; tenantId: number }): Record<string, unknown> {
  return {
    controller: STANDARD_CONTROLLER,
    email: input.email || undefined,
    business_profile: input.businessName ? { name: input.businessName } : undefined,
    metadata: { tenant_id: String(input.tenantId) },
  };
}

/** A new connected account for one business. The idempotency key stops a double click making two. */
export function createConnectedAccount(params: Record<string, unknown>, idempotencyKey: string): Promise<StripeResult<StripeAccount>> {
  return call(`${API}/accounts`, { method: "POST", params, idempotencyKey });
}

/** A one-time link to Stripe's own onboarding for that account. It expires in minutes; refreshUrl makes a new one. */
export function createAccountLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<StripeResult<{ url: string; expires_at: number }>> {
  return call(`${API}/account_links`, { method: "POST", params: { account: accountId, refresh_url: refreshUrl, return_url: returnUrl, type: "account_onboarding" } });
}

export interface StripeAccount {
  id: string;
  email?: string | null;
  charges_enabled?: boolean;
  details_submitted?: boolean;
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
