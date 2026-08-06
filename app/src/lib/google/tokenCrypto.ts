import "server-only";

import crypto from "node:crypto";

/**
 * AES-256-GCM encryption for OAuth tokens at rest. The key is derived (scrypt)
 * from a server secret — EMAIL_TOKEN_SECRET if set, otherwise GOOGLE_CLIENT_SECRET
 * (always present when Gmail is configured). Format: base64(salt|iv|tag|ciphertext).
 */

function deriveKey(salt: Buffer): Buffer {
  const secret =
    process.env.EMAIL_TOKEN_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    "clientflow-dev-only-secret";
  return crypto.scryptSync(secret, salt, 32);
}

export function encryptToken(plain: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, ct]).toString("base64");
}

export function decryptToken(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 28);
  const tag = buf.subarray(28, 44);
  const ct = buf.subarray(44);
  const key = deriveKey(salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
