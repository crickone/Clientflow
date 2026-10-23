// Run: npm test -- src/lib/facebook/pageTokenAtRest.test.ts
import assert from "node:assert/strict";

import { classifyStored, migrateStored, openStored, SEALED_PREFIX } from "./pageTokenAtRest";

let passed = 0;
const check = (name: string, cond: boolean) => {
  assert.ok(cond, name);
  passed++;
};

// A toy cipher: key "A" can open what key "A" sealed; key "B" cannot.
const cipher = (key: string) => ({
  encrypt: (s: string) => Buffer.from(`${key}|${s}`).toString("base64"),
  decrypt: (s: string) => {
    const [k, ...rest] = Buffer.from(s, "base64").toString().split("|");
    if (k !== key) throw new Error("bad key");
    return rest.join("|");
  },
  canDecrypt: (s: string) => {
    try {
      return Buffer.from(s, "base64").toString().split("|")[0] === key;
    } catch {
      return false;
    }
  },
});
const A = cipher("A");
const B = cipher("B");
const PLAIN = "EAAGm0PX4ZCpsBAKZB" + "x".repeat(40);

const once = migrateStored(PLAIN, A)!;
check("a plain token is sealed with the prefix", once.startsWith(SEALED_PREFIX));
check("sealing is never repeated, with the same key", migrateStored(once, A) === null);
check("...or with a different key (the bug that grew a token to 500 MB)", migrateStored(once, B) === null);
check("a token sealed before the prefix existed gets the prefix, not a second seal", migrateStored(A.encrypt(PLAIN), A) === SEALED_PREFIX + A.encrypt(PLAIN));
check("an unprefixed value this key cannot read is left alone", migrateStored(B.encrypt(PLAIN), A) === null);
check("empty stays empty", migrateStored("", A) === null && classifyStored("", A.canDecrypt) === "empty");

check("opens a prefixed token", openStored(once, A) === PLAIN);
check("opens a legacy sealed token", openStored(A.encrypt(PLAIN), A) === PLAIN);
check("a plain token is used as it is", openStored(PLAIN, A) === PLAIN);
check("a token sealed with another key reads as nothing (reconnect), never as garbage", openStored(once, B) === "");

console.log(`pageTokenAtRest: ${passed} checks passed`);
