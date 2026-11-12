import "server-only";

import { controlSqlite } from "@/lib/db/control";

/**
 * The platform's own view of a business: where it is in its life, who on
 * the platform side looks after it, and free tags. The stage is computed
 * from facts unless somebody has set it by hand; the console shows both.
 */
export type Stage = "trial" | "onboarding" | "active" | "at_risk" | "churned";
export const STAGES: Stage[] = ["trial", "onboarding", "active", "at_risk", "churned"];

export interface TenantMeta {
  tenantId: number;
  stage: Stage | null;
  stageAuto: Stage;
  ownerUserId: number | null;
  tags: string[];
  updatedAt: number | null;
}

export interface StageFacts {
  archived: boolean;
  billingStatus: string | null;
  exempt: boolean;
  setupRequiredDone: number;
  setupRequiredTotal: number;
  riskScore: number;
}

export function defaultStage(f: StageFacts): Stage {
  if (f.archived || f.billingStatus === "cancelled") return "churned";
  if (!f.exempt && f.billingStatus === "pending_payment") return "trial";
  if (f.setupRequiredDone < f.setupRequiredTotal) return "onboarding";
  if (f.riskScore >= 60 || f.billingStatus === "suspended" || f.billingStatus === "past_due") return "at_risk";
  return "active";
}

export function cleanTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().toLowerCase().slice(0, 30);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 20);
}

export function getTenantMeta(tenantId: number, facts: StageFacts): TenantMeta {
  const row = controlSqlite.prepare("SELECT stage, owner_user_id, tags, updated_at FROM tenant_meta WHERE tenant_id = ?").get(tenantId) as
    | { stage: Stage | null; owner_user_id: number | null; tags: string; updated_at: number | null }
    | undefined;
  let tags: string[] = [];
  try { tags = row ? cleanTags(JSON.parse(row.tags) as string[]) : []; } catch { tags = []; }
  return { tenantId, stage: row?.stage ?? null, stageAuto: defaultStage(facts), ownerUserId: row?.owner_user_id ?? null, tags, updatedAt: row?.updated_at ?? null };
}

export function setTenantMeta(tenantId: number, patch: { stage?: Stage | null; ownerUserId?: number | null; tags?: string[] }): void {
  controlSqlite.prepare("INSERT OR IGNORE INTO tenant_meta (tenant_id, updated_at) VALUES (?, ?)").run(tenantId, Date.now());
  const sets: string[] = ["updated_at = ?"];
  const args: unknown[] = [Date.now()];
  if (patch.stage !== undefined) { sets.push("stage = ?"); args.push(patch.stage); }
  if (patch.ownerUserId !== undefined) { sets.push("owner_user_id = ?"); args.push(patch.ownerUserId); }
  if (patch.tags !== undefined) { sets.push("tags = ?"); args.push(JSON.stringify(cleanTags(patch.tags))); }
  args.push(tenantId);
  controlSqlite.prepare(`UPDATE tenant_meta SET ${sets.join(", ")} WHERE tenant_id = ?`).run(...args);
}
