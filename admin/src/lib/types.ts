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
  /** `null` when never set on that tenant — render as "Not set", never "clinic". */
  venueType: string | null;
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

/** A tenant's auto-topup config — mirrors `AutoTopupConfig` in
 *  app/src/lib/email/credits.ts EXACTLY. */
export interface AutoTopup {
  enabled: boolean;
  thresholdCents: number;
  amountCents: number;
}

/** One AI-credit ledger movement — mirrors `AiLedgerRow` in
 *  app/src/lib/ai/creditsLedger.ts EXACTLY. */
export interface AiLedgerRow {
  id: number;
  tenantId: number;
  deltaCents: number;
  reason: string;
  balanceAfterCents: number;
  note: string | null;
  createdAt: number;
}

/** A tenant's AI-credit add-on state — mirrors the `ai` block returned by
 *  `/tenants/:id` (app/src/app/api/platform/tenants/[id]/route.ts). The €25/mo
 *  free tranche is absorbed by the operator; overflow bills the prepaid balance. */
export interface AiCreditState {
  balanceCents: number;
  freeTrancheCents: number;
  monthlyUsedCents: number;
  suspended: boolean;
  autoTopup: AutoTopup;
  ledger: AiLedgerRow[];
}

/** One paid add-on on a tenant — mirrors `TenantAddon` in
 *  app/src/lib/billing/addons.ts EXACTLY. 'trial' is entitled but NOT
 *  invoiced; only 'active' appears on an invoice. */
export interface TenantAddon {
  tenantId: number;
  key: string;
  name: string;
  status: "trial" | "active" | "cancelled";
  priceCents: number;
  activatedAt: number;
  cancelledAt: number | null;
}

/** This month's voice usage — mirrors `VoiceMonthUsage` in app/src/lib/voice/usage.ts. */
export interface VoiceMonthUsage {
  seconds: number;
  billedMinutes: number;
  costCents: number;
  calls: number;
}

/** A tenant's Voice Agent state — mirrors the `voice` block returned by
 *  `/tenants/:id`. Minutes come out of trial, then the monthly included
 *  allowance, then prepaid credits. */
export interface VoiceState {
  balanceCents: number;
  capCents: number;
  pricePerMinuteCents: number;
  includedMinutesRemaining: number;
  trialMinutesRemaining: number;
  month: VoiceMonthUsage;
  suspended: boolean;
  ledger: AiLedgerRow[];
}

/** The tenant's monthly email allowance and what it has used of it. */
export interface EmailAllowanceState {
  includedPerMonth: number;
  sentThisMonth: number;
}

export interface TenantDetail {
  tenant: TenantSummary;
  /** Archive/purge state — drives the Money tab's danger zone. */
  lifecycle?: TenantLifecycle | null;
  usage: { clients: number; staff: number };
  invoices: InvoiceRow[];
  events: EventRow[];
  /** Email-marketing add-on state (Task 8) — prepaid credit balance, a
   *  platform-admin suspend flag, and the tenant's auto-topup config. */
  emailBalanceCents: number;
  marketingSuspended: boolean;
  autoTopup: AutoTopup;
  /** AI-credit add-on state — free-tranche usage + prepaid overflow balance. */
  ai: AiCreditState;
  /** The base plan's monthly included sends, and this month's usage of them. */
  email: EmailAllowanceState;
  /** Every paid add-on this tenant has ever had, cancelled ones included. */
  addons: TenantAddon[];
  /** Voice Agent add-on state — allowances, cap, prepaid balance, ledger. */
  voice: VoiceState;
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
  /** `null` when never set on that tenant — render as "Not set", never "clinic". */
  venueType: string | null;
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

/** Platform-console roles (see app: lib/platform/roles.ts). */
export type PlatformRole = "owner" | "manager";

export interface PlatformStaffRow {
  userId: number;
  email: string;
  name: string | null;
  role: PlatformRole;
  isActive: boolean;
  lastLoginAt: number | null;
}

export interface StaffResponse {
  staff: PlatformStaffRow[];
  you: { userId: number; role: PlatformRole };
}

/** One console action, from the platform_audit log. */
export interface AuditEntry {
  id: number;
  actorUserId: number | null;
  actorEmail: string;
  actorRole: string | null;
  tenantId: number | null;
  tenantName: string | null;
  action: string;
  detail: unknown;
  reason: string | null;
  ip: string | null;
  ok: boolean;
  error: string | null;
  createdAt: number;
}

export interface AuditResponse {
  entries: AuditEntry[];
}

/** One person with access to a business (console People tab). */
export interface TenantPerson {
  userId: number;
  email: string;
  name: string | null;
  role: "admin" | "staff";
  membershipActive: boolean;
  accountActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: number | null;
  createdAt: number;
  activeSessions: number;
  isPlatformStaff: boolean;
}

export interface PendingInvite {
  id: number;
  email: string;
  role: "admin" | "staff";
  invitedByEmail: string | null;
  expiresAt: number;
  expired: boolean;
  createdAt: number;
}

export interface OpenReset {
  userId: number;
  email: string;
  expiresAt: number;
  createdAt: number;
}

export interface TenantPeople {
  people: TenantPerson[];
  invites: PendingInvite[];
  resets: OpenReset[];
}

/** One outside connection on the console's Integrations board. Never carries a secret. */
export interface ConnectionRow {
  key: string;
  label: string;
  state: "connected" | "needs_attention" | "not_connected";
  identity: string | null;
  detail: string | null;
  connectedAt: number | null;
  lastUsedAt: number | null;
  actions: ("disconnect" | "reverify")[];
}

export interface ApiKeyView {
  id: number;
  prefix: string;
  label: string | null;
  scopes: string;
  lastUsedAt: number | null;
  createdAt: number;
  revokedAt: number | null;
}

export interface SiteDomainView {
  id: number;
  host: string;
  siteId: number;
  siteName: string | null;
  isPrimary: boolean;
  verifiedAt: number | null;
}

export interface TenantIntegrations {
  connections: ConnectionRow[];
  apiKeys: ApiKeyView[];
  siteDomains: SiteDomainView[];
}

/** Health of one business (console Health tab). */
export interface HealthAlert {
  level: "warn" | "bad";
  message: string;
}

export interface QueueDepth {
  key: string;
  label: string;
  due: number;
  waiting: number;
  failed: number;
  note: string | null;
}

export interface TenantHealth {
  tenantId: number;
  dbBytes: number;
  walBytes: number;
  dbExists: boolean;
  integrity: "ok" | "failed" | "unknown";
  integrityDetail: string | null;
  migrations: { applied: number; expected: number; missing: string[] };
  queues: QueueDepth[];
  stuckGenerations: number;
  schedulers: { key: string; label: string; lastRun: string | null }[];
  alerts: HealthAlert[];
}

export interface FleetHealthRow {
  tenantId: number;
  name: string;
  slug: string;
  dbBytes: number;
  alerts: HealthAlert[];
}

export interface FleetHealth {
  tenants: FleetHealthRow[];
  schedulers: { key: string; label: string; lastRun: string | null }[];
}

/** One switchable module (console Features tab). */
export interface ModuleView {
  key: string;
  label: string;
  blurb: string;
  paths: string[];
  on: boolean;
}

export interface TenantFeatures {
  modules: ModuleView[];
  venueType: string;
  schedulingMode: string;
}

/** Counts, storage and search results for the console Data tab. */
export interface DataCount {
  key: string;
  label: string;
  count: number;
}

export interface PersonHit {
  kind: "client" | "lead";
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: number | null;
}

export interface BackupRow {
  name: string;
  bytes: number;
  createdAt: number;
}

export interface TenantLifecycle {
  tenantId: number;
  slug: string;
  name: string;
  isActive: boolean;
  archivedAt: number | null;
  purgeAt: number | null;
  daysLeft: number | null;
}

export interface TenantData {
  counts: DataCount[];
  dbBytes: number;
  storage: { key: string; label: string; bytes: number }[];
  people: PersonHit[];
  backups: BackupRow[];
  lifecycle: TenantLifecycle | null;
}

/** A credit owed to a business (console Money tab). */
export interface CreditRow {
  id: number;
  tenantId: number;
  netCents: number;
  description: string;
  reason: string | null;
  createdBy: string;
  appliedInvoiceId: number | null;
  appliedAt: number | null;
  createdAt: number;
}

export interface TenantMoney {
  priceOverrideCents: number | null;
  platformPriceCents: number;
  credits: CreditRow[];
  outstandingCreditCents: number;
}

/** A platform-wide switch (console fleet page). */
export interface KillSwitchState {
  key: "ai" | "email" | "posting";
  label: string;
  blurb: string;
  stopped: boolean;
  reason: string | null;
  since: number | null;
  by: string | null;
}

export interface FleetTenantRow {
  id: number;
  name: string;
  slug: string;
  venueType: string | null;
  isActive: boolean;
  archivedAt: number | null;
  billingStatus: string | null;
  billingExempt: boolean;
  nextRenewalAt: string | null;
  createdAt: number;
  users: number;
}

export interface FleetResponse {
  tenants: FleetTenantRow[];
  killSwitches: KillSwitchState[];
}

