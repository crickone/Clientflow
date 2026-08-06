// Shared password-hashing leaf: pure `node:crypto` (scryptSync / randomBytes /
// timingSafeEqual), no react or next imports. This is the single source of
// truth for the `scrypt$<saltHex>$<hashHex>` hash format — both `@/lib/auth`
// (the real Next.js auth layer, which pulls in `react`'s `cache` and
// `next/headers`' `cookies`) and `@/lib/platform/auth` (which must stay
// importable under the plain-tsx test runner) import from here instead of
// each maintaining their own copy.

import crypto from "node:crypto";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}
