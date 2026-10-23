/**
 * How a Facebook Page token is stored. Sealed tokens carry an explicit prefix,
 * so "is this already encrypted?" is answered by the value itself, never by
 * whether THIS process's key happens to decrypt it. (The first version guessed
 * from a failed decrypt: a process with a different key, such as a test run,
 * took a sealed token for plaintext and wrapped it again on every start.)
 * Pure; the crypto is passed in.
 */

export const SEALED_PREFIX = "enc1:";

/** Meta user and Page access tokens start "EAA" and are plain letters and digits. */
export function looksLikePlainPageToken(v: string): boolean {
  return /^EAA[A-Za-z0-9]{20,}$/.test(v);
}

export type StoredKind = "empty" | "sealed" | "plain" | "legacySealed" | "unreadable";

/** What a stored value is. `canDecrypt` is only asked about unprefixed values that aren't plain tokens. */
export function classifyStored(v: string, canDecrypt: (s: string) => boolean): StoredKind {
  if (!v) return "empty";
  if (v.startsWith(SEALED_PREFIX)) return "sealed";
  if (looksLikePlainPageToken(v)) return "plain";
  return canDecrypt(v) ? "legacySealed" : "unreadable";
}

/** The value to write back at boot, or null to leave the row as it is. Never seals anything twice. */
export function migrateStored(v: string, crypto: { encrypt: (s: string) => string; canDecrypt: (s: string) => boolean }): string | null {
  const kind = classifyStored(v, crypto.canDecrypt);
  if (kind === "plain") return SEALED_PREFIX + crypto.encrypt(v);
  if (kind === "legacySealed") return SEALED_PREFIX + v;
  return null;
}

/** The usable token from a stored value; "" when it cannot be read (the Page then shows as needing a reconnect). */
export function openStored(v: string, crypto: { decrypt: (s: string) => string }): string {
  if (!v) return "";
  if (looksLikePlainPageToken(v)) return v;
  const body = v.startsWith(SEALED_PREFIX) ? v.slice(SEALED_PREFIX.length) : v;
  try {
    return crypto.decrypt(body);
  } catch {
    return "";
  }
}
