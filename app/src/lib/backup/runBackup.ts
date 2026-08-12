import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
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
 * Uploaded-media / asset directories under data/ that are NOT captured by the
 * SQLite snapshots — the DB rows reference these files by name, so a volume
 * loss that took only the DBs would still orphan every logo, image and video.
 * Mirrored file-by-file to object storage under the `media/` prefix (see
 * syncMedia). `tenants` is included for per-tenant branding/nutrition/workout
 * files; *.db* files inside it are skipped (the DB snapshots above are the
 * single consistent source for databases). `cards` (a regenerable render
 * cache) and `archive` (already-archived offboarded tenants) are omitted.
 */
export const MEDIA_DIRS = [
  "uploads",
  "cms",
  "image-library",
  "branding",
  "broll-library",
  "music",
  "tenants",
];

/** A local media file paired with the object key it mirrors to (`media/<relpath>`). */
interface MediaFile {
  abs: string;
  key: string;
}

/** Walk MEDIA_DIRS (recursively) into a flat file list, skipping DB files. */
export function listMediaFiles(dataDir = DATA_DIR): MediaFile[] {
  const out: MediaFile[] = [];
  const isDbFile = (name: string) => /\.db(-wal|-shm)?$/.test(name);
  const walk = (absDir: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return; // dir vanished mid-walk — skip
    }
    for (const e of entries) {
      const abs = path.join(absDir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, relPath);
      else if (e.isFile() && !isDbFile(e.name)) {
        out.push({ abs, key: `media/${relPath}` });
      }
    }
  };
  for (const d of MEDIA_DIRS) {
    const absDir = path.join(dataDir, d);
    if (fs.existsSync(absDir)) walk(absDir, d);
  }
  return out;
}

/** Every object under `prefix` in a target, as key → byte size (paginated). */
async function listRemoteSizes(
  target: BackupTarget,
  prefix: string,
): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  let token: string | undefined;
  do {
    const page: ListObjectsV2CommandOutput = await target.client.send(
      new ListObjectsV2Command({
        Bucket: target.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const o of page.Contents ?? []) {
      if (o.Key) sizes.set(o.Key, o.Size ?? -1);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return sizes;
}

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

    // Media mirror: incrementally mirror the asset dirs to every target under
    // the `media/` prefix (only new/changed files upload). A failure here is
    // collected (does not abort the DB backups, which already succeeded above).
    await syncMedia(targets, uploaded, errors);

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

/**
 * Mirror the media/asset dirs to every target under the `media/` prefix,
 * uploading only files that are NEW or size-changed. A full nightly re-upload
 * of multi-GB media (video projects, image library) to two clouds would be
 * prohibitive, so this diffs against a single ListObjectsV2 pass per target
 * and PUTs only the deltas — the first run uploads everything, later runs
 * upload just what changed. Orphans (files deleted locally) are deliberately
 * LEFT in the mirror: cheap insurance against accidental deletion, and media
 * rarely churns. Uploads stream from disk. Failures are collected into
 * `errors`, never thrown (the DB snapshots already succeeded).
 *
 * Note this is a live MIRROR, not point-in-time like the DB snapshots — a
 * restore pairs the latest media with a chosen DB snapshot. That's safe: the
 * DB references a subset of the media by filename, so extra/newer files are
 * inert. See tools/restore-backup.cjs.
 */
async function syncMedia(
  targets: BackupTarget[],
  uploaded: string[],
  errors: string[],
): Promise<void> {
  const files = listMediaFiles();
  if (files.length === 0) return;

  for (const target of targets) {
    try {
      const remote = await listRemoteSizes(target, "media/");
      let changed = 0;
      for (const f of files) {
        let size: number;
        try {
          size = fs.statSync(f.abs).size;
        } catch {
          continue; // file vanished between walk and upload
        }
        if (remote.get(f.key) === size) continue; // already mirrored, unchanged
        await target.client.send(
          new PutObjectCommand({
            Bucket: target.bucket,
            Key: f.key,
            Body: fs.createReadStream(f.abs),
            ContentLength: size,
          }),
        );
        changed++;
      }
      uploaded.push(`${target.label}:media(${changed} changed/${files.length})`);
    } catch (err) {
      errors.push(
        `${target.label} media: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
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
