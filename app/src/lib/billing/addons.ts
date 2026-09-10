import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { getMonthlyPriceCents } from "./settings";

/**
 * Paid add-ons: the entitlement layer between the flat base subscription and
 * the per-product metering.
 *
 * The platform deliberately sells ONE base plan, not tiers. A tier is a
 * packaging decision (a named bundle at a discount) that can be expressed on
 * top of these rows whenever there are enough clients for the boundaries to be
 * evidence rather than guesswork; an ENTITLEMENT — does this tenant have voice
 * right now? — is what the runtime actually has to answer, on every call, and
 * that is what this module owns. Building tiers first would mean maintaining
 * feature gates for a fleet of two.
 *
 * Two questions, two functions, and they are NOT the same question:
 *   - `isAddonEnabled` (trial OR active) — may this tenant USE the feature?
 *     Called by the runtime gate (e.g. assertVoiceAllowed) before spending.
 *   - `billableAddons`  (active only)     — what does this tenant PAY for?
 *     Called by billing/engine's ensureInvoice when it raises the invoice.
 * A 'trial' add-on is entitled but not invoiced — that is the whole mechanism
 * behind the free evaluation minutes, and why the trial can't be expressed as
 * "active with a €0 price" (which would put a €0.00 line on the invoice and
 * lose the distinction the moment the price is set).
 *
 * price_cents is FROZEN per tenant when the add-on is activated (seeded from
 * the catalog default, admin-overridable) rather than read live: changing the
 * catalog price must never silently re-price the tenants already on it — the
 * same reason billing_invoices carries its own vat_rate_bp.
 */

export type AddonKey = "voice";
export type AddonStatus = "trial" | "active" | "cancelled";

export interface AddonDefinition {
  key: AddonKey;
  name: string;
  /** Seeded into tenant_addons.price_cents on activation; not read afterwards. */
  defaultPriceCents: number;
  /** One line, shown in the admin console and on the invoice. */
  description: string;
}

/** Every add-on the platform sells. Adding one here + a runtime gate is the whole job. */
export const ADDON_CATALOG: Record<AddonKey, AddonDefinition> = {
  voice: {
    key: "voice",
    name: "Voice Agent",
    defaultPriceCents: 5000, // €50/mo — includes VOICE_INCLUDED_MINUTES, then per-minute
    description: "AI voice agent for sales calls, including 60 minutes a month",
  },
};

export const ADDON_KEYS = Object.keys(ADDON_CATALOG) as AddonKey[];

export function isAddonKey(key: string): key is AddonKey {
  return Object.prototype.hasOwnProperty.call(ADDON_CATALOG, key);
}

export interface TenantAddon {
  tenantId: number;
  key: AddonKey;
  name: string;
  status: AddonStatus;
  priceCents: number;
  activatedAt: number;
  cancelledAt: number | null;
}

type Row = {
  tenant_id: number;
  addon_key: string;
  status: string;
  price_cents: number;
  activated_at: number;
  cancelled_at: number | null;
};

function toAddon(r: Row): TenantAddon {
  const key = r.addon_key as AddonKey;
  return {
    tenantId: r.tenant_id,
    key,
    name: ADDON_CATALOG[key]?.name ?? r.addon_key,
    status: r.status as AddonStatus,
    priceCents: r.price_cents,
    activatedAt: r.activated_at,
    cancelledAt: r.cancelled_at,
  };
}

/** Every add-on row this tenant has ever had, cancelled ones included (the console shows history). */
export function listTenantAddons(tenantId: number): TenantAddon[] {
  const rows = controlSqlite
    .prepare(
      `SELECT tenant_id, addon_key, status, price_cents, activated_at, cancelled_at
       FROM tenant_addons WHERE tenant_id = ? ORDER BY addon_key`,
    )
    .all(tenantId) as Row[];
  return rows.filter((r) => isAddonKey(r.addon_key)).map(toAddon);
}

export function getTenantAddon(tenantId: number, key: AddonKey): TenantAddon | null {
  const row = controlSqlite
    .prepare(
      `SELECT tenant_id, addon_key, status, price_cents, activated_at, cancelled_at
       FROM tenant_addons WHERE tenant_id = ? AND addon_key = ?`,
    )
    .get(tenantId, key) as Row | undefined;
  return row ? toAddon(row) : null;
}

/**
 * The RUNTIME gate: is this tenant allowed to use the feature at all? True for
 * both 'trial' and 'active' — a trialling tenant is entitled, they just aren't
 * invoiced for it (their spend is bounded by the product's own trial
 * allowance instead).
 */
export function isAddonEnabled(tenantId: number, key: AddonKey): boolean {
  const a = getTenantAddon(tenantId, key);
  return a?.status === "active" || a?.status === "trial";
}

/** True only for a fully paid, invoiced add-on — the products use this to tell "free trial minutes" from "included minutes". */
export function isAddonActive(tenantId: number, key: AddonKey): boolean {
  return getTenantAddon(tenantId, key)?.status === "active";
}

/**
 * The BILLING question: what recurring lines does this tenant's invoice carry
 * beyond the base plan? 'active' only — trials and cancellations charge nothing.
 */
export function billableAddons(tenantId: number): TenantAddon[] {
  return listTenantAddons(tenantId).filter((a) => a.status === "active");
}

/** Sum of every active add-on's monthly price (cents) — the amount ensureInvoice adds to the base plan. */
export function addonsSubtotalCents(tenantId: number): number {
  return billableAddons(tenantId).reduce((sum, a) => sum + a.priceCents, 0);
}

const MAX_ADDON_PRICE_CENTS = 100_000; // €1000/mo — sanity ceiling, same reasoning as MAX_CAP_CENTS

/**
 * Move an add-on into a status, creating the row on first touch. Bounds-checked
 * here (not in the caller) so a script/route/test all get the same guarantee.
 *
 * `priceCents` is applied only when given, and only matters for 'active'; on a
 * first activation it defaults to the catalog price. Re-activating a cancelled
 * add-on keeps whatever price it last had unless a new one is passed — the
 * tenant's frozen price survives a pause, which is the behaviour an operator
 * expects when they suspend and resume someone's voice add-on.
 */
export function setAddonStatus(
  tenantId: number,
  key: AddonKey,
  status: AddonStatus,
  opts: { priceCents?: number } = {},
): TenantAddon {
  const price = opts.priceCents ?? getTenantAddon(tenantId, key)?.priceCents ?? ADDON_CATALOG[key].defaultPriceCents;
  if (!Number.isInteger(price) || price < 0 || price > MAX_ADDON_PRICE_CENTS) {
    throw new Error(`Add-on price must be a whole number of cents between 0 and ${MAX_ADDON_PRICE_CENTS}.`);
  }
  const now = Date.now();
  controlSqlite
    .prepare(
      `INSERT INTO tenant_addons (tenant_id, addon_key, status, price_cents, activated_at, cancelled_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, addon_key) DO UPDATE SET
         status = excluded.status,
         price_cents = excluded.price_cents,
         cancelled_at = excluded.cancelled_at,
         updated_at = excluded.updated_at`,
    )
    .run(tenantId, key, status, price, now, status === "cancelled" ? now : null, now);
  return getTenantAddon(tenantId, key)!;
}

// ─── What a tenant is charged every month ────────────────────────────────────

export interface MonthlyLine {
  kind: "base" | "addon";
  /** "" for the base plan — matches billing_invoice_lines.addon_key, which is NOT NULL. */
  addonKey: string;
  description: string;
  netCents: number;
}

/**
 * The composition of one tenant's recurring charge: the base plan plus every
 * active add-on, in the order they appear on the invoice. THE one place that
 * knows an invoice is "base + add-ons" — ensureInvoice (what we bill), the
 * card-capture amount (what we authorise at activation) and the activate page
 * (what we quote) all read it, so the three can never quote different totals.
 */
export function monthlyLines(tenantId: number): MonthlyLine[] {
  const lines: MonthlyLine[] = [
    { kind: "base", addonKey: "", description: "AdonisAgent subscription", netCents: getMonthlyPriceCents() },
  ];
  for (const a of billableAddons(tenantId)) {
    lines.push({
      kind: "addon",
      addonKey: a.key,
      description: ADDON_CATALOG[a.key]?.description ?? a.name,
      netCents: a.priceCents,
    });
  }
  return lines;
}

/** Net (ex-VAT) total of `monthlyLines` — base plan + active add-ons. */
export function monthlySubtotalCents(tenantId: number): number {
  return monthlyLines(tenantId).reduce((sum, l) => sum + l.netCents, 0);
}
