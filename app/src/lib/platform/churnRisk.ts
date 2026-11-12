import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { usageByModule } from "@/lib/analytics/moduleUsage";

/**
 * A number for "is this business drifting away", with the reasons, from
 * facts the control plane already holds. The rules are plain and listed in
 * the plan so an operator can argue with them; nothing here is learned.
 */
export interface RiskFacts {
  daysSinceLastLogin: number | null;
  hits30: number;
  hitsPrev30: number;
  billingStatus: string | null;
  exempt: boolean;
  failedAttempts: number;
  reconnectsNeeded: number;
  openBadAlerts: number;
  setupRequiredDone: number;
  setupRequiredTotal: number;
  ageDays: number;
}

export interface Risk { score: number; level: "low" | "medium" | "high"; reasons: string[] }

export function churnRisk(f: RiskFacts): Risk {
  let score = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => { score += n; reasons.push(why); };

  const idle = f.daysSinceLastLogin === null ? Math.max(30, f.ageDays) : f.daysSinceLastLogin;
  if (idle >= 30) add(40, f.daysSinceLastLogin === null ? "Nobody has ever signed in" : `No sign-in for ${idle} days`);
  else if (idle >= 14) add(25, `No sign-in for ${idle} days`);

  if (f.hitsPrev30 > 0 && f.hits30 < f.hitsPrev30 / 2) add(20, `Usage down ${Math.round((1 - f.hits30 / f.hitsPrev30) * 100)}% on the previous month`);

  if (!f.exempt) {
    if (f.billingStatus === "suspended") add(40, "Suspended for non-payment");
    else if (f.billingStatus === "past_due") add(f.failedAttempts >= 3 ? 30 : 20, `Past due, ${f.failedAttempts} failed ${f.failedAttempts === 1 ? "attempt" : "attempts"}`);
  }

  if (f.reconnectsNeeded > 0) add(Math.min(20, f.reconnectsNeeded * 10), `${f.reconnectsNeeded} ${f.reconnectsNeeded === 1 ? "integration needs" : "integrations need"} reconnecting`);
  if (f.openBadAlerts > 0) add(Math.min(20, f.openBadAlerts * 10), `${f.openBadAlerts} open ${f.openBadAlerts === 1 ? "alert needs" : "alerts need"} action`);
  if (f.setupRequiredTotal > 0 && f.setupRequiredDone < f.setupRequiredTotal / 2 && f.ageDays > 14) add(15, `Setup ${f.setupRequiredDone} of ${f.setupRequiredTotal} after ${f.ageDays} days`);

  score = Math.min(100, score);
  return { score, level: score >= 60 ? "high" : score >= 30 ? "medium" : "low", reasons };
}

export function riskFacts(tenantId: number, setup: { requiredDone: number; requiredTotal: number }, now: number = Date.now()): RiskFacts {
  const login = controlSqlite
    .prepare("SELECT MAX(u.last_login_at) AS last FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.tenant_id = ? AND m.is_active = 1 AND u.is_platform_admin = 0")
    .get(tenantId) as { last: number | null };
  const tenant = controlSqlite.prepare("SELECT created_at FROM tenants WHERE id = ?").get(tenantId) as { created_at: number } | undefined;
  const billing = controlSqlite.prepare("SELECT status, billing_exempt, failed_attempts FROM tenant_billing WHERE tenant_id = ?").get(tenantId) as { status: string; billing_exempt: number; failed_attempts: number } | undefined;
  const reconnects = (controlSqlite.prepare("SELECT (SELECT count(*) FROM facebook_pages WHERE tenant_id = ? AND needs_reconnect_at IS NOT NULL AND revoked_at IS NULL) + (SELECT count(*) FROM meta_grants WHERE tenant_id = ? AND needs_reconnect_at IS NOT NULL) AS n").get(tenantId, tenantId) as { n: number }).n;
  const badAlerts = (controlSqlite.prepare("SELECT count(*) AS n FROM platform_alerts WHERE tenant_id = ? AND resolved_at IS NULL AND level = 'bad'").get(tenantId) as { n: number }).n;
  const usage = usageByModule(tenantId, 30, now);
  return {
    daysSinceLastLogin: login.last ? Math.floor((now - login.last) / 86400000) : null,
    hits30: usage.reduce((n, m) => n + m.hits, 0),
    hitsPrev30: usage.reduce((n, m) => n + m.prevHits, 0),
    billingStatus: billing?.status ?? null,
    exempt: Boolean(billing?.billing_exempt),
    failedAttempts: billing?.failed_attempts ?? 0,
    reconnectsNeeded: reconnects,
    openBadAlerts: badAlerts,
    setupRequiredDone: setup.requiredDone,
    setupRequiredTotal: setup.requiredTotal,
    ageDays: tenant ? Math.floor((now - tenant.created_at) / 86400000) : 0,
  };
}
