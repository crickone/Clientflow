// Run: npm test -- src/lib/humanName.test.ts
//
// Pure tests for splitFullName — the server-side "one Full name field ->
// first + last" split the inbound-leads webhook uses so integrations
// (Zapier/Make/Facebook) can send a single name field instead of splitting it
// in every scenario. humanName.ts is deliberately free of `server-only`/DB so
// it imports cleanly under the plain-tsx test runner.
import assert from "node:assert/strict";

import { splitFullName } from "./humanName";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// two-part name -> the obvious split
{
  const r = splitFullName("Niamh Walsh");
  check("two-part: firstName", r.firstName === "Niamh");
  check("two-part: lastName", r.lastName === "Walsh");
}

// multi-word surname: first token is the first name, the REST is the last name
// (so "van der Berg" survives instead of collapsing to a single last word).
{
  const r = splitFullName("Mary Jane van der Berg");
  check("multi-word: firstName is the first token", r.firstName === "Mary");
  check("multi-word: lastName is the whole remainder", r.lastName === "Jane van der Berg");
}

// single word -> firstName only, no last name
{
  const r = splitFullName("Cher");
  check("single word: firstName", r.firstName === "Cher");
  check("single word: lastName null", r.lastName === null);
}

// irregular whitespace is trimmed + collapsed
{
  const r = splitFullName("   Niamh    Walsh   ");
  check("whitespace: firstName trimmed", r.firstName === "Niamh");
  check("whitespace: inner whitespace collapsed", r.lastName === "Walsh");
}

// empty / whitespace / null / undefined -> both null (never a "" that looks like a value)
{
  check("empty string -> firstName null", splitFullName("").firstName === null);
  check("empty string -> lastName null", splitFullName("").lastName === null);
  check("whitespace-only -> firstName null", splitFullName("   ").firstName === null);
  check("null -> both null", splitFullName(null).firstName === null && splitFullName(null).lastName === null);
  check("undefined -> both null", splitFullName(undefined).firstName === null && splitFullName(undefined).lastName === null);
}

console.log(`\nhumanName.test.ts: ${passed} checks passed.`);
