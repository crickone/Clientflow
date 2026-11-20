import "server-only";
import { eq } from "drizzle-orm";

import { controlDb } from "@/lib/db/control";
import { stripeConnections } from "@/lib/db/schema";
import { stripeKeyMode, type StripeAccount } from "./api";

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

/**
 * The business's connected account, or null. An account from the other mode
 * (a test account once the platform runs on its live key, or the reverse)
 * counts as not connected: no call can reach it, so the business connects again.
 */
export function getStripeConnection(tenantId: number): StripeConnection | null {
  const r = controlDb.select().from(stripeConnections).where(eq(stripeConnections.tenantId, tenantId)).get();
  if (!r) return null;
  return usableInMode(r.livemode, stripeKeyMode()) ? toView(r) : null;
}

export function usableInMode(livemode: boolean, mode: "live" | "test" | null): boolean {
  return mode === null || livemode === (mode === "live");
}

/**
 * Whether Buy buttons can work. A live account takes payments only once
 * Stripe has switched charges on (onboarding finished and checked); a test
 * account can always take test cards.
 */
export function canTakePayments(conn: Pick<StripeConnection, "livemode" | "chargesEnabled"> | null): boolean {
  return !!conn && (!conn.livemode || conn.chargesEnabled);
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
