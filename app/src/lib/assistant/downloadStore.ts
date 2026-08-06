import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Temporary store for AI-generated download bundles (e.g. an invoices .zip). The
 * server can't write to a user's Downloads folder directly, so it stashes the
 * file here and hands back a URL; the browser download lands in Downloads.
 * Files are namespaced per tenant and swept after ~2 hours.
 */

const DIR = path.join(process.cwd(), "data", "assistant-downloads");
const TTL_MS = 2 * 60 * 60 * 1000;

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

/** Delete bundles older than the TTL so the volume doesn't fill up. */
function sweep() {
  try {
    if (!fs.existsSync(DIR)) return;
    const now = Date.now();
    for (const f of fs.readdirSync(DIR)) {
      const p = path.join(DIR, f);
      try {
        if (now - fs.statSync(p).mtimeMs > TTL_MS) fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export type StoredDownload = { id: string; filename: string; url: string };

/** Save bytes and return an id + public download URL. */
export function saveDownload(
  tenantId: number,
  filename: string,
  bytes: Buffer,
): StoredDownload {
  ensureDir();
  sweep();
  const id = crypto.randomBytes(16).toString("hex");
  const safeName = filename.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "download.zip";
  // Encode tenant + display name in a sidecar so the download route can validate
  // ownership and serve the right filename.
  fs.writeFileSync(path.join(DIR, `${id}.bin`), bytes);
  fs.writeFileSync(
    path.join(DIR, `${id}.json`),
    JSON.stringify({ tenantId, filename: safeName }),
  );
  return { id, filename: safeName, url: `/api/assistant/download/${id}` };
}

export type ResolvedDownload = { filename: string; bytes: Buffer };

/** Read a stored bundle, verifying it belongs to the requesting tenant. */
export function readDownload(tenantId: number, id: string): ResolvedDownload | null {
  if (!/^[a-f0-9]{32}$/.test(id)) return null; // guard against path traversal
  const metaPath = path.join(DIR, `${id}.json`);
  const binPath = path.join(DIR, `${id}.bin`);
  if (!fs.existsSync(metaPath) || !fs.existsSync(binPath)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
      tenantId: number;
      filename: string;
    };
    if (meta.tenantId !== tenantId) return null;
    return { filename: meta.filename, bytes: fs.readFileSync(binPath) };
  } catch {
    return null;
  }
}
