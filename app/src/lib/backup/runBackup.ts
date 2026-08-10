import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

// Re-exported for existing callers (lib/backup/scheduler.ts) — the actual
// env-var presence check now lives in ./config, a dependency-free module
// (Batch 6a) so the startup env check (lib/env.ts) can reuse it without
// pulling better-sqlite3/@aws-sdk into instrumentation.ts's edge bundle.
export { isBackupConfigured } from "./config";

const DATA_DIR = path.join(process.cwd(), "data");
const KEEP = 14; // retain the most recent N snapshots per database, per target

/**
 * Every SQLite file to back up: the control DB plus every tenant's business DB.
 * Read straight from control.db (no app imports) so the backup path stays
 * dependency-light. Returns paths relative to DATA_DIR.
 */
function listDatabaseFiles(): string[] {
  const files = new Set<string>(["control.db"]);
  const controlPath = path.join(DATA_DIR, "control.db");
  if (fs.existsSync(controlPath)) {
    const ctl = new Database(controlPath, { readonly: true });
    try {
      const hasTenants = ctl
        .prepare(
          "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='tenants'",
        )
        .get() as { c: number };
      if (hasTenants.c > 0) {
        const rows = ctl
          .prepare("SELECT db_file FROM tenants")
          .all() as Array<{ db_file: string }>;
        for (const r of rows) files.add(r.db_file);
      }
    } finally {
      ctl.close();
    }
  }
  return [...files];
}

interface BackupTarget {
  label: string;
  client: S3Client;
  bucket: string;
}

export interface BackupResult {
  ok: boolean;
  uploaded: string[];
  error?: string;
  errors?: string[];
}

/**
 * Build one S3-compatible target from a `${prefix}*` env-var group. Returns null
 * when the group is incomplete, so an unconfigured provider is simply skipped
 * (the off-provider R2 copy stays optional until its vars are set).
 */
function makeTarget(label: string, prefix: string): BackupTarget | null {
  const endpoint = process.env[`${prefix}ENDPOINT`];
  const accessKeyId = process.env[`${prefix}ACCESS_KEY_ID`];
  const secretAccessKey = process.env[`${prefix}SECRET_ACCESS_KEY`];
  const bucket = process.env[`${prefix}BUCKET`];
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    label,
    bucket,
    client: new S3Client({
      endpoint,
      region: process.env[`${prefix}REGION`] || "auto",
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: false, // both Tigris and R2 are virtual-host addressed
    }),
  };
}

/**
 * Every configured backup target. Primary = Tigris/Railway (`BACKUP_S3_*`);
 * off-provider DR copy = Cloudflare R2 (`BACKUP_R2_*`). Add another provider by
 * adding a makeTarget(...) line — each target gets the identical snapshot and
 * its own independent prune.
 */
function makeTargets(): BackupTarget[] {
  return [
    makeTarget("S3", "BACKUP_S3_"),
    makeTarget("R2", "BACKUP_R2_"),
  ].filter((t): t is BackupTarget => t !== null);
}

/**
 * Take a consistent online snapshot of each SQLite database and upload it to
 * EVERY configured off-volume target under a timestamped key, then prune each
 * target to the most recent KEEP. Safe against the live DBs (SQLite online
 * backup API). Returns a result rather than throwing so the caller (route or
 * scheduler) can log it. A target that fails does NOT abort the others — its
 * error is collected and surfaced (ok=false) so a down provider gets noticed,
 * while the healthy provider's copy still lands.
 */
export async function runBackup(): Promise<BackupResult> {
  const targets = makeTargets();
  if (targets.length === 0) {
    return { ok: false, uploaded: [], error: "Backup storage not configured" };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cf-backup-"));
  const uploaded: string[] = [];
  const errors: string[] = [];
  try {
    for (const file of listDatabaseFiles()) {
      const srcPath = path.join(DATA_DIR, file);
      if (!fs.existsSync(srcPath)) continue;

      // Backup key + temp filename use the basename; tenant db files are unique
      // (one per slug), as is control.db / clinic.db.
      const name = path.basename(file);
      const destPath = path.join(tmp, name);
      const src = new Database(srcPath, { readonly: true });
      try {
        await src.backup(destPath);
      } finally {
        src.close();
      }
      const body = fs.readFileSync(destPath);
      const key = `backups/${name}/${stamp}.sqlite`;

      for (const target of targets) {
        try {
          await target.client.send(
            new PutObjectCommand({
              Bucket: target.bucket,
              Key: key,
              Body: body,
              ContentType: "application/x-sqlite3",
            }),
          );
          uploaded.push(`${target.label}:${key}`);
          await prune(target, `backups/${name}/`);
        } catch (err) {
          errors.push(
            `${target.label} ${name}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
    return {
      ok: errors.length === 0 && uploaded.length > 0,
      uploaded,
      ...(errors.length > 0 ? { error: errors.join("; "), errors } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      uploaded,
      error: err instanceof Error ? err.message : String(err),
      ...(errors.length > 0 ? { errors } : {}),
    };
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/** Keep only the newest KEEP objects under a prefix (keys sort by timestamp). */
async function prune(target: BackupTarget, prefix: string): Promise<void> {
  const list = await target.client.send(
    new ListObjectsV2Command({ Bucket: target.bucket, Prefix: prefix }),
  );
  const keys = (list.Contents ?? [])
    .map((o) => o.Key)
    .filter((k): k is string => !!k)
    .sort()
    .reverse(); // newest first (ISO timestamp in key)
  const old = keys.slice(KEEP);
  if (old.length > 0) {
    await target.client.send(
      new DeleteObjectsCommand({
        Bucket: target.bucket,
        Delete: { Objects: old.map((Key) => ({ Key })) },
      }),
    );
  }
}
