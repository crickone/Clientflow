import "server-only";

import crypto from "node:crypto";

/**
 * AES-256-GCM encryption for OAuth tokens at rest. The key is derived (scrypt)
 * from a server secret — EMAIL_TOKEN_SECRET if set, otherwise (non-production
 * only) GOOGLE_CLIENT_SECRET or a hardcoded dev fallback. Format:
 * base64(salt|iv|tag|ciphertext).
 */

function deriveKey(salt: Buffer): Buffer {
  const secret = process.env.EMAIL_TOKEN_SECRET;
  if (secret) return crypto.scryptSync(secret, salt, 32);

  // Fail closed in production: silently keying off GOOGLE_CLIENT_SECRET means
  // a routine OAuth-secret rotation would rotate the token-encryption key too
  // and permanently break decryption of every tenant's already-stored tokens;
  // falling back further to a hardcoded constant would make the encryption
  // meaningless. Both are only acceptable for local dev, never prod.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "EMAIL_TOKEN_SECRET is not set. Refusing to derive the OAuth token " +
        "encryption key from GOOGLE_CLIENT_SECRET or a dev constant in " +
        "production — set EMAIL_TOKEN_SECRET.",
    );
  }
  const devSecret = process.env.GOOGLE_CLIENT_SECRET || "clientflow-dev-only-secret";
  return crypto.scryptSync(devSecret, salt, 32);
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
