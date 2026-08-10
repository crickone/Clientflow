// Run: npm test -- src/lib/env.test.ts
//
// Batch 6a (scale-hardening smalls, improvement-plan-2026-08.md Theme E5):
// unit tests for the pure env-var bucketing decision behind the boot-time
// startup check (see lib/env.ts, checkEnv). Deliberately NOT testing
// logEnvCheck's console output or isBackupConfigured's real process.env
// reads — those are the impure/side-effecting edges; checkEnv is the pure,
// therefore testable, part (same philosophy as db/control.test.ts's
// shouldRunToday).
import assert from "node:assert/strict";
import { checkEnv } from "./env";

const FULL_ENV: Record<string, string> = {
  ANTHROPIC_API_KEY: "sk-ant-x",
  RESEND_API_KEY: "re_x",
  EMAIL_TOKEN_SECRET: "secret",
  CRON_SECRET: "cron",
  OPENROUTER_API_KEY: "or_x",
  ALERT_EMAIL: "ops@example.com",
  CMS_SITE_HOSTS: "example.com=slug",
};

/** Return a copy of `env` with `key` entirely absent (not merely undefined) —
 *  matches how an actually-unset env var looks. */
function omit(env: Record<string, string>, key: string): Record<string, string> {
  const { [key]: _removed, ...rest } = env;
  return rest;
}

// All present + backup configured -> both buckets empty.
assert.deepEqual(checkEnv(FULL_ENV, true), { missingRequired: [], missingRecommended: [] });

// Missing the one required var -> bucketed as required only.
{
  const result = checkEnv(omit(FULL_ENV, "ANTHROPIC_API_KEY"), true);
  assert.deepEqual(result.missingRequired, ["ANTHROPIC_API_KEY"]);
  assert.deepEqual(result.missingRecommended, []);
}

// Missing one recommended var -> bucketed as recommended only.
{
  const result = checkEnv(omit(FULL_ENV, "RESEND_API_KEY"), true);
  assert.deepEqual(result.missingRequired, []);
  assert.deepEqual(result.missingRecommended, ["RESEND_API_KEY"]);
}

// Missing a required AND a recommended var simultaneously (the brief's exact
// scenario) -> both buckets populated, each with only its own var.
{
  const env = omit(omit(FULL_ENV, "ANTHROPIC_API_KEY"), "CRON_SECRET");
  const result = checkEnv(env, true);
  assert.deepEqual(result.missingRequired, ["ANTHROPIC_API_KEY"]);
  assert.deepEqual(result.missingRecommended, ["CRON_SECRET"]);
}

// backupConfigured=false adds ONE grouped backup label to recommended —
// isBackupConfigured() already resolved "is at least one target fully
// configured", so checkEnv trusts the boolean rather than re-deriving it
// from individual BACKUP_* keys in `env`.
{
  const result = checkEnv(FULL_ENV, false);
  assert.deepEqual(result.missingRequired, []);
  assert.equal(result.missingRecommended.length, 1);
  assert.ok(result.missingRecommended[0].includes("BACKUP"), "backup group label mentions BACKUP");
}

// Empty env entirely -> every required + recommended var missing, plus the
// backup group (6 named recommended vars + 1 backup group = 7).
{
  const result = checkEnv({}, false);
  assert.deepEqual(result.missingRequired, ["ANTHROPIC_API_KEY"]);
  assert.equal(result.missingRecommended.length, 7);
}

console.log("env.test.ts: all assertions passed");
