// Run: npm test -- src/lib/backup/runBackup.test.ts
//
// Batch 1 (production safety net): isBackupConfigured() must reflect exactly
// what runBackup() itself does — it's a thin wrapper over the same
// makeTargets() gate (BACKUP_S3_*/BACKUP_R2_* env-var groups), exported so the
// scheduler's startup alarm never re-implements this check.
import assert from "node:assert/strict";
import { isBackupConfigured } from "./runBackup";

const KEYS = [
  "BACKUP_S3_ENDPOINT",
  "BACKUP_S3_ACCESS_KEY_ID",
  "BACKUP_S3_SECRET_ACCESS_KEY",
  "BACKUP_S3_BUCKET",
  "BACKUP_S3_REGION",
  "BACKUP_R2_ENDPOINT",
  "BACKUP_R2_ACCESS_KEY_ID",
  "BACKUP_R2_SECRET_ACCESS_KEY",
  "BACKUP_R2_BUCKET",
  "BACKUP_R2_REGION",
] as const;

const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};
for (const k of KEYS) saved[k] = process.env[k];
const clearAll = () => {
  for (const k of KEYS) delete process.env[k];
};

try {
  // Nothing set at all -> not configured.
  clearAll();
  assert.equal(isBackupConfigured(), false, "no env vars set -> not configured");

  // Partially set (missing BUCKET) -> still not configured; makeTarget
  // requires ALL of endpoint/access key/secret/bucket, all-or-nothing.
  clearAll();
  process.env.BACKUP_S3_ENDPOINT = "https://example.s3-compatible.test";
  process.env.BACKUP_S3_ACCESS_KEY_ID = "key";
  process.env.BACKUP_S3_SECRET_ACCESS_KEY = "secret";
  assert.equal(isBackupConfigured(), false, "missing BUCKET -> still not configured");

  // Fully set S3 group -> configured.
  process.env.BACKUP_S3_BUCKET = "backups-bucket";
  assert.equal(isBackupConfigured(), true, "full BACKUP_S3_* group set -> configured");

  // Fully set R2 group ONLY (no S3 vars at all) -> also configured; either
  // target counts (the off-provider DR copy is independently sufficient).
  clearAll();
  process.env.BACKUP_R2_ENDPOINT = "https://example.r2.test";
  process.env.BACKUP_R2_ACCESS_KEY_ID = "key";
  process.env.BACKUP_R2_SECRET_ACCESS_KEY = "secret";
  process.env.BACKUP_R2_BUCKET = "dr-bucket";
  assert.equal(isBackupConfigured(), true, "R2-only group set -> configured");

  console.log("backup/runBackup.test.ts: all assertions passed");
} finally {
  clearAll();
  for (const k of KEYS) {
    const v = saved[k];
    if (v !== undefined) process.env[k] = v;
  }
}
