import "server-only";

import crypto from "node:crypto";

/**
 * AES-256-GCM encryption for OAuth tokens at rest. The key is derived (scrypt)
 * from a server secret — EMAIL_TOKEN_SECRET if set, otherwise (non-production
 * only) GOOGLE_CLIENT_SECRET or a hardcoded dev fallback. Format:
 * base64(salt|iv|tag|ciphertext).
 */

function deriveKey(salt: Buffer, secretOverride?: string): Buffer {
  const secret = secretOverride ?? process.env.EMAIL_TOKEN_SECRET;
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

function decryptWith(payload: string, secret?: string): string {
  const buf = Buffer.from(payload, "base64");
  const salt = buf.subarray(0, 16);
  const iv = buf.subarray(16, 28);
  const tag = buf.subarray(28, 44);
  const ct = buf.subarray(44);
  const key = deriveKey(salt, secret);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Decrypt with the current key, or, during a key rotation, the previous one.
 *
 * ROTATING EMAIL_TOKEN_SECRET: set EMAIL_TOKEN_SECRET_PREVIOUS to the old
 * value and EMAIL_TOKEN_SECRET to the new one, then redeploy. Everything
 * still decrypts (this fallback), and lib/security/resealSecrets.ts
 * re-encrypts every stored secret with the new key shortly after boot and
 * logs what is left. Once it reports 0 left, remove the _PREVIOUS variable.
 * Without the fallback, changing the secret made every stored token, API key
 * and password unreadable at once, so it could never be rotated.
 */
export function decryptToken(payload: string): string {
  try {
    return decryptWith(payload);
  } catch (err) {
    const previous = process.env.EMAIL_TOKEN_SECRET_PREVIOUS;
    if (!previous) throw err;
    return decryptWith(payload, previous);
  }
}

/**
 * The same secret under the CURRENT key when `payload` is only readable with
 * the previous one; null when it is already current (or unreadable either
 * way, which is reported, never rewritten).
 */
export function resealIfPrevious(payload: string): { resealed: string } | { current: true } | { unreadable: true } {
  try {
    decryptWith(payload);
    return { current: true };
  } catch {
    const previous = process.env.EMAIL_TOKEN_SECRET_PREVIOUS;
    if (!previous) return { unreadable: true };
    try {
      return { resealed: encryptToken(decryptWith(payload, previous)) };
    } catch {
      return { unreadable: true };
    }
  }
}
