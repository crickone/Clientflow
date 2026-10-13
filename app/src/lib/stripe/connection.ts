import "server-only";
import { eq } from "drizzle-orm";

import { controlDb } from "@/lib/db/control";
import { stripeConnections } from "@/lib/db/schema";
import { signTokenPayload, readTokenPayload } from "@/lib/signedToken";
import type { StripeAccount } from "./api";

/**
 * One connected Stripe account per business (control table
 * `stripe_connections`). Connect Standard: nothing secret is stored here --
 * the platform key plus the account id is all a call needs, and the business
 * can revoke us from its own Stripe dashboard at any time.
 */

export interface StripeConnection {
  tenantId: number;
  accountId: string;
  livemode: boolean;
  displayName: string | null;
  email: string | null;
  chargesEnabled: boolean;
  connectedAt: number;
}

function toView(r: typeof stripeConnections.$inferSelect): StripeConnection {
  return {
    tenantId: r.tenantId,
    accountId: r.accountId,
    livemode: r.livemode,
    displayName: r.displayName,
    email: r.email,
    chargesEnabled: r.chargesEnabled,
    connectedAt: r.connectedAt,
  };
}

export function getStripeConnection(tenantId: number): StripeConnection | null {
  const r = controlDb.select().from(stripeConnections).where(eq(stripeConnections.tenantId, tenantId)).get();
  return r ? toView(r) : null;
}

/** Which business a connected account belongs to (webhooks name the account, not the tenant). */
export function tenantForStripeAccount(accountId: string): number | null {
  const r = controlDb.select({ t: stripeConnections.tenantId }).from(stripeConnections).where(eq(stripeConnections.accountId, accountId)).get();
  return r?.t ?? null;
}

export function accountSummary(a: StripeAccount): { displayName: string | null; email: string | null; chargesEnabled: boolean } {
  return {
    displayName: a.settings?.dashboard?.display_name || a.business_profile?.name || null,
    email: a.email ?? null,
    chargesEnabled: a.charges_enabled === true,
  };
}

export function saveStripeConnection(tenantId: number, accountId: string, livemode: boolean, a: StripeAccount | null): void {
  const now = Date.now();
  const s = a ? accountSummary(a) : { displayName: null, email: null, chargesEnabled: false };
  // One account can only belong to one business: a reconnect elsewhere moves it.
  controlDb.delete(stripeConnections).where(eq(stripeConnections.accountId, accountId)).run();
  controlDb.delete(stripeConnections).where(eq(stripeConnections.tenantId, tenantId)).run();
  controlDb
    .insert(stripeConnections)
    .values({ tenantId, accountId, livemode, displayName: s.displayName, email: s.email, chargesEnabled: s.chargesEnabled, connectedAt: now, updatedAt: now })
    .run();
}

export function updateStripeAccountStatus(tenantId: number, a: StripeAccount): void {
  const s = accountSummary(a);
  controlDb.update(stripeConnections).set({ ...s, updatedAt: Date.now() }).where(eq(stripeConnections.tenantId, tenantId)).run();
}

export function removeStripeConnection(tenantId: number): void {
  controlDb.delete(stripeConnections).where(eq(stripeConnections.tenantId, tenantId)).run();
}

// ---- OAuth state ------------------------------------------------------------
// The `state` round-trips through Stripe; signing it means the callback only
// ever saves an account for the business and admin who started the connect.

const STATE_TTL_MS = 30 * 60 * 1000;

export function signConnectState(tenantId: number, userId: number): string | null {
  return signTokenPayload({ k: "stripe-connect", t: tenantId, u: userId, e: Date.now() + STATE_TTL_MS });
}

export function readConnectState(state: string): { tenantId: number; userId: number } | null {
  const p = readTokenPayload(state);
  if (!p || p.k !== "stripe-connect") return null;
  const t = Number(p.t);
  const u = Number(p.u);
  const e = Number(p.e);
  if (!Number.isInteger(t) || !Number.isInteger(u) || !Number.isFinite(e) || e < Date.now()) return null;
  return { tenantId: t, userId: u };
}
