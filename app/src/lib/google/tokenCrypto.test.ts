// Run: npm test -- src/lib/google/tokenCrypto.test.ts
//
// Batch 2d (EMAIL_TOKEN_SECRET fail-closed, improvement-plan-2026-08.md Theme
// B4): deriveKey() used to fall back from EMAIL_TOKEN_SECRET to
// GOOGLE_CLIENT_SECRET to a hardcoded dev constant, unconditionally. Now it
// fails closed (throws) when NODE_ENV=production and EMAIL_TOKEN_SECRET is
// unset, so a rotated Google secret can never silently become the token key.
// The dev fallbacks still work outside production. deriveKey reads
// process.env fresh on every call (no module-level caching), so mutating env
// vars between calls in this one process is sufficient — no re-import tricks
// needed. Every mutated var is restored in `finally`.
import assert from "node:assert/strict";
import { encryptToken, decryptToken } from "./tokenCrypto";

const ORIGINAL = {
  NODE_ENV: process.env.NODE_ENV,
  EMAIL_TOKEN_SECRET: process.env.EMAIL_TOKEN_SECRET,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
};

// process.env.NODE_ENV is typed read-only (Next's global augmentation), so
// mutating it needs a widened view of process.env for the assignment target.
const mutableEnv = process.env as Record<string, string | undefined>;

function setEnv(key: keyof typeof ORIGINAL, value: string | undefined) {
  if (value === undefined) delete mutableEnv[key];
  else mutableEnv[key] = value;
}
function restoreEnv() {
  (Object.keys(ORIGINAL) as (keyof typeof ORIGINAL)[]).forEach((k) => setEnv(k, ORIGINAL[k]));
}

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}
function checkThrows(name: string, fn: () => unknown, match: RegExp) {
  assert.throws(fn, match, name);
  passed++;
  console.log("  ✓", name);
}

try {
  // 1. Non-production, nothing set at all: the hardcoded dev constant fallback
  //    still works (unchanged legacy behaviour for local dev).
  setEnv("NODE_ENV", "test");
  setEnv("EMAIL_TOKEN_SECRET", undefined);
  setEnv("GOOGLE_CLIENT_SECRET", undefined);
  check(
    "dev fallback (no secrets at all) round-trips",
    decryptToken(encryptToken("hello-dev")) === "hello-dev",
  );

  // 2. Non-production, GOOGLE_CLIENT_SECRET set, no EMAIL_TOKEN_SECRET: the
  //    other pre-existing dev fallback still works too.
  setEnv("GOOGLE_CLIENT_SECRET", "a-google-oauth-secret");
  check(
    "dev fallback via GOOGLE_CLIENT_SECRET round-trips",
    decryptToken(encryptToken("hello-dev-2")) === "hello-dev-2",
  );

  // 3. Production, no EMAIL_TOKEN_SECRET -> fail closed, even with
  //    GOOGLE_CLIENT_SECRET present. Both encrypt and decrypt must refuse
  //    (decryptToken calls deriveKey before it ever touches the payload).
  setEnv("NODE_ENV", "production");
  setEnv("EMAIL_TOKEN_SECRET", undefined);
  checkThrows(
    "production + no EMAIL_TOKEN_SECRET: encryptToken throws",
    () => encryptToken("should-not-encrypt"),
    /EMAIL_TOKEN_SECRET/,
  );
  checkThrows(
    "production + no EMAIL_TOKEN_SECRET: decryptToken throws",
    () => decryptToken("anything"),
    /EMAIL_TOKEN_SECRET/,
  );

  // 4. Production, EMAIL_TOKEN_SECRET set -> works normally.
  setEnv("EMAIL_TOKEN_SECRET", "a-dedicated-prod-secret");
  check(
    "production with EMAIL_TOKEN_SECRET round-trips",
    decryptToken(encryptToken("hello-prod")) === "hello-prod",
  );

  // 5. EMAIL_TOKEN_SECRET takes precedence over GOOGLE_CLIENT_SECRET
  //    (unchanged precedence), including outside production.
  setEnv("NODE_ENV", "test");
  check(
    "EMAIL_TOKEN_SECRET precedence round-trips outside production too",
    decryptToken(encryptToken("hello-both")) === "hello-both",
  );

  console.log(`\ntokenCrypto: ${passed} checks passed.`);
} finally {
  restoreEnv();
}
