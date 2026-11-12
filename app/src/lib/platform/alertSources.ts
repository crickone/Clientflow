import "server-only";

import { controlSqlite, getCronState } from "@/lib/db/control";
import { getMonthlyUsageCents, getTenantCapCents } from "@/lib/ai/usage";
import { dublinToday } from "@/lib/billing/dates";
import { getFleetHealth } from "./health";
import { latestJobRuns, type JobRunRow } from "./jobRuns";
import type { AlertCandidate } from "./healthHistory";

/**
 * Everything that can need a platform operator, as alert candidates for
 * syncPlatformAlerts. The rules are pure functions over plain facts so they
 * can be tested without a database; collectAlertCandidates gathers the
 * facts. Keys are stable per problem, so one problem is one open alert.
 */

export interface BillingFacts {
  tenantId: number;
  name: string;
  status: string | null;
  exempt: boolean;
  archived: boolean;
  nextRenewalAt: string | null;
  failedAttempts: number;
  /** "MM/YY" as stored on the card row. */
  cardExpiry: string | null;
}

function monthsAhead(today: string, n: number): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCFullYear()).slice(2)}`;
}

export function billingAlerts(f: BillingFacts, today: string): AlertCandidate[] {
  if (f.archived || f.exempt || !f.status) return [];
  const out: AlertCandidate[] = [];
  const href = `/gyms/${f.tenantId}/money`;
  if (f.status === "past_due") {
    out.push({
      tenantId: f.tenantId,
      key: "billing:past_due",
      level: f.failedAttempts >= 3 ? "bad" : "warn",
      title: `${f.name} is past due (${f.failedAttempts} failed ${f.failedAttempts === 1 ? "attempt" : "attempts"})`,
      href,
    });
  } else if (f.status === "suspended") {
    out.push({ tenantId: f.tenantId, key: "billing:suspended", level: "bad", title: `${f.name} is suspended for non-payment`, href });
  } else if (f.status === "pending_payment" && !f.nextRenewalAt) {
    out.push({ tenantId: f.tenantId, key: "billing:pending_long", level: "warn", title: `${f.name} has never paid; no card on file`, href });
  }
  if (f.cardExpiry && (f.cardExpiry === monthsAhead(today, 0) || f.cardExpiry === monthsAhead(today, 1))) {
    out.push({ tenantId: f.tenantId, key: "billing:card_expiring", level: "warn", title: `${f.name}'s card expires ${f.cardExpiry}`, href });
  }
  return out;
}

export function aiCapAlert(tenantId: number, name: string, usedCents: number, capCents: number): AlertCandidate | null {
  if (capCents <= 0) return null;
  const ratio = usedCents / capCents;
  if (ratio < 0.9) return null;
  return {
    tenantId,
    key: "ai:cap",
    level: ratio >= 1 ? "bad" : "warn",
    title: ratio >= 1 ? `${name} has hit its AI cap; Adonis is refusing paid calls` : `${name} is at ${Math.round(ratio * 100)}% of its AI cap`,
    href: `/gyms/${tenantId}/money`,
  };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function schedulerAlerts(schedulers: { key: string; label: string; lastRun: string | null }[], today: string): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const s of schedulers) {
    const late = s.lastRun ? daysBetween(s.lastRun, today) : Infinity;
    if (late <= 1) continue;
    out.push({
      tenantId: null,
      key: `scheduler:${s.key}`,
      level: late >= 2 ? "bad" : "warn",
      title: s.lastRun ? `${s.label} last ran ${s.lastRun}, ${late} days ago` : `${s.label} has never run`,
      href: "/jobs",
    });
  }
  return out;
}

export function jobAlerts(latest: JobRunRow[]): AlertCandidate[] {
  return latest
    .filter((r) => r.ok === false)
    .map((r) => ({ tenantId: null, key: `job:${r.key}`, level: "bad" as const, title: `${r.label} failed: ${r.error ?? "unknown error"}`, href: "/jobs" }));
}

/** Alert candidates from one fleet sweep: each business's own alerts (an unreadable business raises health:unreadable) plus platform-wide ones. */
export function buildFleetCandidates(fleet: ReturnType<typeof getFleetHealth>): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  for (const row of fleet.tenants) {
    for (const a of row.alerts) {
      candidates.push({
        tenantId: row.tenantId,
        key: `health:${a.key}`,
        level: a.level,
        title: a.message,
        href: `/gyms/${row.tenantId}/health`,
      });
    }
  }
  for (const d of fleet.duplicateSiteSlugs) {
    candidates.push({
      tenantId: null,
      key: `site_slug:${d.slug}`,
      level: "bad",
      title: `Site slug "${d.slug}" is used by ${d.owners.length} businesses; only ${d.servedBy} is reachable.`,
      href: "/health",
    });
  }
  return candidates;
}

/**
 * What one fleet sweep feeds the alert sync. The resolve scope is READABLE
 * businesses only: a failed read yields just health:unreadable, and must never
 * resolve that business's other open alerts. Once it reads again it is in
 * scope, health:unreadable is no longer a candidate, and it resolves itself.
 */
export function planFleetSync(fleet: ReturnType<typeof getFleetHealth>): { candidates: AlertCandidate[]; tenantIds: number[] } {
  return {
    candidates: buildFleetCandidates(fleet),
    tenantIds: fleet.tenants.filter((t) => t.readable).map((t) => t.tenantId),
  };
}

/**
 * All alert candidates for one sweep. Takes the fleet already read, so no
 * business is health-checked twice. Billing, AI cap and integration facts come
 * from the control database, so they are emitted even for an unreadable
 * business, but only for businesses in the fleet list.
 */
export function collectAlertCandidates(
  fleet: ReturnType<typeof getFleetHealth>,
  now: number = Date.now(),
): { candidates: AlertCandidate[]; tenantIds: number[] } {
  const today = dublinToday(new Date(now));
  const plan = planFleetSync(fleet);
  const candidates = plan.candidates;
  const inFleet = new Set(fleet.tenants.map((t) => t.tenantId));
  const fleetScoped = <T extends { tenantId: number }>(xs: T[]) => xs.filter((x) => inFleet.has(x.tenantId));

  // Billing and AI cap.
  const billing = controlSqlite
    .prepare(
      `SELECT t.id, t.name, t.archived_at, b.status, b.billing_exempt, b.next_renewal_at, b.failed_attempts, b.card_expiry
       FROM tenants t LEFT JOIN tenant_billing b ON b.tenant_id = t.id WHERE t.is_active = 1`,
    )
    .all() as Array<{ id: number; name: string; archived_at: number | null; status: string | null; billing_exempt: number | null; next_renewal_at: string | null; failed_attempts: number | null; card_expiry: string | null }>;
  for (const b of billing) {
    if (!inFleet.has(b.id)) continue;
    candidates.push(...billingAlerts({ tenantId: b.id, name: b.name, status: b.status, exempt: Boolean(b.billing_exempt), archived: b.archived_at !== null, nextRenewalAt: b.next_renewal_at, failedAttempts: b.failed_attempts ?? 0, cardExpiry: b.card_expiry }, today));
    if (b.archived_at !== null) continue;
    try {
      const a = aiCapAlert(b.id, b.name, getMonthlyUsageCents(b.id), getTenantCapCents(b.id));
      if (a) candidates.push(a);
    } catch {
      // a tenant whose usage cannot be read is not an AI-cap problem
    }
  }

  // Integrations that asked to be reconnected.
  const fb = controlSqlite
    .prepare(`SELECT p.tenant_id AS tenantId, t.name, p.page_name, p.needs_reconnect_reason FROM facebook_pages p JOIN tenants t ON t.id = p.tenant_id WHERE p.needs_reconnect_at IS NOT NULL AND p.revoked_at IS NULL`)
    .all() as Array<{ tenantId: number; name: string; page_name: string; needs_reconnect_reason: string | null }>;
  for (const p of fleetScoped(fb)) candidates.push({ tenantId: p.tenantId, key: "integration:facebook", level: "warn", title: `${p.name}: Facebook Page "${p.page_name}" needs reconnecting${p.needs_reconnect_reason ? ` (${p.needs_reconnect_reason})` : ""}`, href: `/gyms/${p.tenantId}/integrations` });
  const meta = controlSqlite
    .prepare(`SELECT g.tenant_id AS tenantId, t.name, g.needs_reconnect_reason FROM meta_grants g JOIN tenants t ON t.id = g.tenant_id WHERE g.needs_reconnect_at IS NOT NULL`)
    .all() as Array<{ tenantId: number; name: string; needs_reconnect_reason: string | null }>;
  for (const g of fleetScoped(meta)) candidates.push({ tenantId: g.tenantId, key: "integration:meta", level: "warn", title: `${g.name}: the Meta connection needs reconnecting${g.needs_reconnect_reason ? ` (${g.needs_reconnect_reason})` : ""}`, href: `/gyms/${g.tenantId}/integrations` });

  // Platform-wide: stale schedulers and failed jobs (a run still in progress has ok === null and raises nothing).
  const schedulers = [
    { key: "last_daily_run", label: "Daily jobs", lastRun: safe("last_daily_run") },
    { key: "lapse_last_run", label: "Lapsed-member sweep", lastRun: safe("lapse_last_run") },
    { key: "billing_last_run", label: "Billing run", lastRun: safe("billing_last_run") },
    { key: "backup_last_run", label: "Nightly backup", lastRun: safe("backup_last_run") },
  ];
  candidates.push(...schedulerAlerts(schedulers, today));
  candidates.push(...jobAlerts(latestJobRuns()));

  return { candidates, tenantIds: plan.tenantIds };
}

function safe(key: string): string | null {
  try { return getCronState(key); } catch { return null; }
}