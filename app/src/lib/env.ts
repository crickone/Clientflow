import "server-only";

import { isBackupConfigured } from "./backup/config";

/**
 * Startup env validation (Batch 6a — improvement-plan-2026-08.md Theme E5).
 * Buckets the app's env vars into two severities and logs a loud, grouped
 * summary from instrumentation.ts's register() — see logEnvCheck below. This
 * is a "shout, don't crash" check: a missing var degrades or breaks the ONE
 * dependent feature at the point of use, which is recoverable by setting the
 * var and redeploying; a boot-time hard crash on the same condition would
 * instead crash-loop the whole multi-tenant process for every tenant. See
 * `checkEnv`'s doc for why it takes plain data rather than reading env itself.
 *
 * Required vs recommended is a judgment call, not a technical one — kept
 * intentionally short: only ANTHROPIC_API_KEY is "the app can't function"
 * (AI drafting/triage/agents touch nearly every module); everything else
 * degrades one feature (email, cron auth, backups, alt providers, alerting,
 * public CMS host routing) without taking the whole app down.
 */

export interface EnvCheckResult {
  missingRequired: string[];
  missingRecommended: string[];
}

/** App can't function correctly without these — see module doc. */
const REQUIRED_VARS = ["ANTHROPIC_API_KEY"] as const;

/** A specific feature degrades or silently no-ops without these. */
const RECOMMENDED_VARS = [
  "RESEND_API_KEY", // outbound email (client/staff mail, platform billing mail)
  "EMAIL_TOKEN_SECRET", // Gmail OAuth token encryption at rest (has a dev-only fallback)
  "CRON_SECRET", // authorizes the external scheduler hitting /api/cron/*
  "OPENROUTER_API_KEY", // non-Anthropic model fallback in the AI provider registry
  "ALERT_EMAIL", // opt-in ops alerting (crash-survived + backup-failure emails)
  "CMS_SITE_HOSTS", // public multi-site host→tenant routing (see middleware.ts)
] as const;

/** Single grouped entry — isBackupConfigured() already encodes "at least one
 *  of the BACKUP_S3_ or BACKUP_R2_ groups is fully set", so listing the
 *  individual keys here too would just duplicate (and could disagree with)
 *  that logic. */
const BACKUP_GROUP_LABEL = "BACKUP_S3_*/BACKUP_R2_* (off-volume nightly backups)";

export type EnvLike = Record<string, string | undefined>;

/**
 * Pure bucketing decision: given an env-like object and whether backup
 * storage is configured (from isBackupConfigured(), reused rather than
 * re-listing the BACKUP_* vars — see BACKUP_GROUP_LABEL above), return which
 * required/recommended vars are missing. No process.env/console/network
 * access, so it's trivially unit-testable (env.test.ts) independent of
 * logging, and safe to import from anywhere — including instrumentation.ts's
 * edge-compiled register() (this module and ./backup/config are both free of
 * better-sqlite3/@aws-sdk/node-core imports for exactly that reason).
 */
export function checkEnv(env: EnvLike, backupConfigured: boolean): EnvCheckResult {
  const missingRequired: string[] = REQUIRED_VARS.filter((name) => !env[name]);
  const missingRecommended: string[] = RECOMMENDED_VARS.filter((name) => !env[name]);
  if (!backupConfigured) missingRecommended.push(BACKUP_GROUP_LABEL);
  return { missingRequired, missingRecommended };
}

/**
 * Boot-time env validation: logs a loud, grouped summary but NEVER throws —
 * see instrumentation.ts's register() (the only caller). Reads process.env +
 * isBackupConfigured() itself (the impure edges); the actual bucketing
 * decision is the pure checkEnv() above.
 */
export function logEnvCheck(): void {
  const { missingRequired, missingRecommended } = checkEnv(process.env, isBackupConfigured());

  if (missingRequired.length > 0) {
    console.error(
      `[env] MISSING REQUIRED: ${missingRequired.join(", ")} — the app CANNOT function correctly without ` +
        `these. Set them in the deploy environment. (Not crashing the process — see lib/env.ts — but this ` +
        `WILL fail at the point of use.)`,
    );
  }
  for (const name of missingRecommended) {
    console.warn(`[env] missing recommended: ${name} — the dependent feature will be degraded or disabled.`);
  }
  if (missingRequired.length === 0 && missingRecommended.length === 0) {
    console.log("[env] startup check: all required + recommended vars present");
  }
}
