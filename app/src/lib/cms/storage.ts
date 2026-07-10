import "server-only";

import fs from "node:fs";
import path from "node:path";

/**
 * Object storage for the shared CMS media library ("the CDN").
 *
 * Today this writes to local disk under data/cms-library/ and the bytes are
 * delivered by the /library-media/<id> route (which can sit behind a CDN in
 * production). The interface is deliberately small — putObject / getObject /
 * deleteObject keyed by an opaque storage key — so swapping to Cloudflare R2 or
 * S3 later is a single-file change: detect the bucket env vars here and route to
 * an S3Client (@aws-sdk/client-s3 is already a dependency) without touching any
 * caller. Keys are random basenames, never user input.
 */

const ROOT = path.join(process.cwd(), "data", "cms-library");

function keyPath(key: string): string {
  // Guard against traversal — only ever a flat basename under ROOT.
  return path.join(ROOT, path.basename(key));
}

export async function putObject(key: string, bytes: Buffer): Promise<void> {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(keyPath(key), bytes);
}

export async function getObject(key: string): Promise<Buffer | null> {
  try {
    return fs.readFileSync(keyPath(key));
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  try {
    fs.rmSync(keyPath(key), { force: true });
  } catch {
    /* ignore */
  }
}
