/**
 * Wire types for the Task-7 platform API. Field names here must match the
 * server's JSON exactly (see app/src/lib/platform/queries.ts) — do NOT rename.
 */

export interface TenantBilling {
  status: string;
  billingExempt: boolean;
  nextRenewalAt: string | null;
  cardLast4: string | null;
}

export interface TenantSummary {
  id: number;
  slug: string;
  name: string;
  venueType: string;
  isActive: boolean;
  createdAt: number;
  billing: TenantBilling | null;
}

/**
 * The `events` list embedded in `/overview` is a raw passthrough of the
 * `billing_events` table (unlike the tenant-detail `listEvents()` helper,
 * which maps to camelCase) — so its keys are snake_case as they come off
 * the row, not `tenantId`/`createdAt`. Confirmed against the live endpoint.
 */
export interface OverviewEvent {
  id: number;
  tenant_id: number | null;
  type: string;
  detail: string | null;
  actor: string;
  created_at: number;
}

export interface Overview {
  mrrCents: number;
  counts: {
    pending_payment: number;
    active: number;
    past_due: number;
    suspended: number;
    cancelled: number;
  };
  attention: TenantSummary[];
  events: OverviewEvent[];
}

export interface TenantsResponse {
  tenants: TenantSummary[];
}

/**
 * `/tenants/:id` returns its history helpers in **camelCase** — unlike
 * `/overview`, whose `events` are a raw snake_case passthrough (`OverviewEvent`).
 * These mirror `listInvoices()` / `listEvents()` in the billing engine exactly.
 */
export interface InvoiceRow {
  id: number;
  tenantId: number;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string; // YYYY-MM-DD
  netCents: number;
  vatCents: number;
  grossCents: number;
  vatRateBp: number;
  status: "pending" | "paid" | "failed" | "waived" | "refunded";
  gatewayRef: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  paidAt: number | null;
  createdAt: number;
}

export interface EventRow {
  id: number;
  tenantId: number | null;
  type: string;
  detail: string | null;
  actor: string;
  createdAt: number;
}

export interface TenantDetail {
  tenant: TenantSummary;
  usage: { clients: number; staff: number };
  invoices: InvoiceRow[];
  events: EventRow[];
}

/**
 * `/analytics` wire contract — mirrors `PlatformAnalytics` in
 * app/src/lib/platform/analytics.ts EXACTLY. Do NOT rename fields; the server
 * treats these names as a contract the admin dashboard is built to.
 */
export interface PerGymRow {
  tenantId: number;
  name: string;
  slug: string;
  venueType: string;
  status: string;
  exempt: boolean;
  members: number;
  activeMembers: number;
  gmvCentsMonthly: number;
  revenueCentsThisMonth: number;
}

export interface PlatformAnalytics {
  generatedAt: number;
  platform: {
    mrrCents: number;
    arrCents: number;
    gyms: {
      total: number;
      active: number;
      pastDue: number;
      suspended: number;
      pendingPayment: number;
      cancelled: number;
      exempt: number;
      paying: number;
    };
    collectedByMonth: Array<{ month: string; cents: number }>;
    gymsByMonth: Array<{ month: string; total: number; added: number }>;
  };
  gyms: {
    tenantsCounted: number;
    members: number;
    activeMembers: number;
    gmvCentsMonthly: number;
    estResidualCentsMonthly: number;
    revenueCentsThisMonth: number;
    leads: number;
    classesThisWeek: number;
    perGym: PerGymRow[];
  };
}
