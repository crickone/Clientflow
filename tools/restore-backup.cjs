#!/usr/bin/env node
/**
 * Disaster-recovery restore for the off-volume backups written by
 * app/src/lib/backup/runBackup.ts.
 *
 * Backup layout in each bucket:
 *   backups/<db-basename>/<ISO-stamp>.sqlite   ← point-in-time DB snapshots (KEEP 14)
 *   media/<relpath>                             ← live file-by-file media mirror
 *
 * What it does:
 *   1. Restores control.db (latest snapshot, or --stamp), then reads its
 *      `tenants` table to learn every tenant DB's db_file path and restores
 *      each to its correct location (clinic.db + tenants/<slug>/<slug>.db).
 *   2. Mirrors the `media/` prefix back down into <data-dir> (skips files that
 *      already exist with the same size, so it's resumable).
 *
 * SAFELY DRY-RUN BY DEFAULT — prints exactly what it would restore and writes
 * nothing until you pass --yes. Existing DB files are moved aside to
 * <file>.bak-<stamp> before being overwritten.
 *
 * Usage:
 *   node tools/restore-backup.cjs [options]
 *     --target S3|R2      which backup target to restore FROM (default: S3)
 *     --stamp <iso>       DB snapshot timestamp to restore (default: latest)
 *     --data-dir <path>   where to restore TO (default: app/data)
 *     --dbs               restore only the databases
 *     --media             restore only the media mirror
 *     --yes               actually write (without this: dry-run)
 *
 * Env: the BACKUP_<TARGET>_* vars the app already uses
 *   (ENDPOINT, ACCESS_KEY_ID, SECRET_ACCESS_KEY, BUCKET, REGION).
 *
 * This restores backups into a LOCAL data/ tree. Getting that tree back onto
 * the Railway volume is a separate step (mount/redeploy) — this tool's job is
 * to reconstitute the data from object storage.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { pipeline } = require("node:stream/promises");

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "app");
const Database = require(path.join(APP, "node_modules", "better-sqlite3"));
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} = require(path.join(APP, "node_modules", "@aws-sdk/client-s3"));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : def;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}

const TARGET = (arg("target", "S3") || "S3").toUpperCase();
const STAMP = arg("stamp", "latest");
const DATA_DIR = path.resolve(ROOT, arg("data-dir", path.join("app", "data")));
const APPLY = flag("yes");
const onlyDbs = flag("dbs");
const onlyMedia = flag("media");
const doDbs = onlyDbs || !onlyMedia;
const doMedia = onlyMedia || !onlyDbs;

function envFor(target) {
  const p = `BACKUP_${target}_`;
  const endpoint = process.env[`${p}ENDPOINT`];
  const accessKeyId = process.env[`${p}ACCESS_KEY_ID`];
  const secretAccessKey = process.env[`${p}SECRET_ACCESS_KEY`];
  const bucket = process.env[`${p}BUCKET`];
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    console.error(
      `Missing ${p}ENDPOINT/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET — set them (or pick --target with a configured group).`,
    );
    process.exit(1);
  }
  return {
    bucket,
    client: new S3Client({
      endpoint,
      region: process.env[`${p}REGION`] || "auto",
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: false,
    }),
  };
}

async function listAll(client, bucket, prefix) {
  const out = [];
  let token;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const o of page.Contents || []) out.push({ key: o.Key, size: o.Size ?? -1 });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}

async function download(client, bucket, key, destAbs) {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await pipeline(res.Body, fs.createWriteStream(destAbs));
}

/** Latest snapshot key under backups/<name>/, or the exact --stamp one. */
function pickSnapshot(objs, name) {
  const prefix = `backups/${name}/`;
  const keys = objs
    .filter((o) => o.key.startsWith(prefix) && o.key.endsWith(".sqlite"))
    .map((o) => o.key)
    .sort();
  if (keys.length === 0) return null;
  if (STAMP === "latest") return keys[keys.length - 1];
  const wanted = `${prefix}${STAMP}.sqlite`;
  return keys.includes(wanted) ? wanted : null;
}

function backupAside(absPath) {
  if (!fs.existsSync(absPath)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.renameSync(absPath, `${absPath}.bak-${stamp}`);
}

async function main() {
  const { bucket, client } = envFor(TARGET);
  console.log(
    `Restore FROM ${TARGET} (${bucket}) → ${DATA_DIR}\n  mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes; pass --yes to apply)"}  dbs=${doDbs} media=${doMedia} stamp=${STAMP}\n`,
  );

  // ---- Databases ----
  if (doDbs) {
    const dbObjs = await listAll(client, bucket, "backups/");
    const controlKey = pickSnapshot(dbObjs, "control.db");
    if (!controlKey) {
      console.error("No control.db snapshot found — cannot map tenant DBs. Aborting DB restore.");
    } else {
      // Restore control.db first (into a temp, then read its tenant registry).
      const tmpControl = path.join(require("os").tmpdir(), `restore-control-${Date.now()}.db`);
      await download(client, bucket, controlKey, tmpControl);
      const ctl = new Database(tmpControl, { readonly: true });
      let dbFiles = ["control.db"];
      try {
        const rows = ctl.prepare("SELECT db_file FROM tenants").all();
        for (const r of rows) dbFiles.push(r.db_file);
      } catch (e) {
        console.error("  (control.db had no tenants table — restoring control.db only)");
      } finally {
        ctl.close();
      }
      dbFiles = [...new Set(dbFiles)];

      for (const dbFile of dbFiles) {
        const name = path.basename(dbFile);
        const key = name === "control.db" ? controlKey : pickSnapshot(dbObjs, name);
        const dest = path.isAbsolute(dbFile) ? dbFile : path.join(DATA_DIR, dbFile);
        if (!key) {
          console.log(`  DB  ${name.padEnd(24)} — NO SNAPSHOT FOUND (skipped)`);
          continue;
        }
        console.log(`  DB  ${name.padEnd(24)} ← ${key}${APPLY ? "" : "  [dry-run]"}`);
        if (APPLY) {
          if (name === "control.db") {
            backupAside(dest);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(tmpControl, dest);
          } else {
            backupAside(dest);
            await download(client, bucket, key, dest);
          }
        }
      }
      fs.rmSync(tmpControl, { force: true });
    }
  }

  // ---- Media mirror ----
  if (doMedia) {
    const mediaObjs = await listAll(client, bucket, "media/");
    let restored = 0;
    let skipped = 0;
    let bytes = 0;
    for (const o of mediaObjs) {
      const rel = o.key.slice("media/".length);
      if (!rel) continue;
      const dest = path.join(DATA_DIR, rel);
      if (fs.existsSync(dest) && fs.statSync(dest).size === o.size) {
        skipped++;
        continue;
      }
      bytes += o.size > 0 ? o.size : 0;
      restored++;
      if (APPLY) await download(client, bucket, o.key, dest);
    }
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    console.log(
      `  MEDIA ${mediaObjs.length} objects: ${restored} to restore (${mb} MB), ${skipped} already present${APPLY ? "" : "  [dry-run]"}`,
    );
  }

  console.log(`\n${APPLY ? "Restore complete." : "Dry-run complete. Re-run with --yes to write."}`);
}

main().catch((err) => {
  console.error("Restore failed:", err);
  process.exit(1);
});
