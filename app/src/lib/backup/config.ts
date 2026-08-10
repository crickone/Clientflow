import "server-only";

/**
 * Pure env-var presence check for the backup targets (Batch 6a —
 * improvement-plan-2026-08.md Theme E5). Split out of runBackup.ts so
 * `isBackupConfigured()` can be reused by lib/env.ts's startup check WITHOUT
 * dragging better-sqlite3 or @aws-sdk/client-s3 into instrumentation.ts's
 * edge-compiled bundle — see instrumentation.ts's header comment on why that
 * file's import graph must stay free of native/Node-only modules (we hit
 * this exact class of bug before: instrumentation → better-sqlite3 → "Can't
 * resolve 'fs'/'path'" in the edge build). This module only reads
 * `process.env`; it never touches the filesystem, SQLite, or the network.
 *
 * `runBackup.ts` re-exports `isBackupConfigured` from here, so existing
 * callers (lib/backup/scheduler.ts) are unaffected.
 *
 * Mirrors runBackup.ts's `makeTarget()` env-var group check exactly (same
 * four required keys per prefix; REGION stays optional, defaulted to "auto"
 * there) but WITHOUT constructing an S3Client — this only tests presence,
 * never connects.
 */
const BACKUP_PREFIXES = ["BACKUP_S3_", "BACKUP_R2_"] as const;
const BACKUP_KEYS = ["ENDPOINT", "ACCESS_KEY_ID", "SECRET_ACCESS_KEY", "BUCKET"] as const;

function isTargetGroupConfigured(env: NodeJS.ProcessEnv, prefix: string): boolean {
  return BACKUP_KEYS.every((key) => !!env[`${prefix}${key}`]);
}

/**
 * True when at least one backup target (BACKUP_S3_* or BACKUP_R2_*) is fully
 * configured — i.e. `runBackup()` would actually upload somewhere instead of
 * short-circuiting to `{ok:false, error:"Backup storage not configured"}`.
 * Takes `env` as a parameter (defaulting to `process.env`) so it's testable
 * without mutating the real process env.
 */
export function isBackupConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return BACKUP_PREFIXES.some((prefix) => isTargetGroupConfigured(env, prefix));
}
