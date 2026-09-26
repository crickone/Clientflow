// Run: npm test -- src/lib/api/tenantStampRules.test.ts
//
// THE BUG THIS PINS: the active clinic lives on the shared session row, so
// switching account in one tab silently repointed every other open tab. An
// operator redesigning an Inspire slide got "Design not found." — the design
// was there, in the clinic they were no longer in. The 404 was luck: ids
// collide across clinics, and a colliding id would have had the redesign
// rewrite the OTHER clinic's slide and report success.
//
// These are the two decisions the fix rests on. The server guard and the
// browser wrapper both import them, so they cannot drift apart into a header
// the client sends on a URL the server never checks.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);
const { parseStamp, isOwnApiUrl, TENANT_STAMP_HEADER, TENANT_MISMATCH_CODE } =
  requireLocal("./tenantStampRules") as typeof import("./tenantStampRules");

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

// ── parseStamp: malformed reads as ABSENT, never as a mismatch ────────────
{
  ok("a real tenant id parses", parseStamp("580") === 580);
  ok("null is absent", parseStamp(null) === null);
  ok("undefined is absent", parseStamp(undefined) === null);
  ok("empty string is absent", parseStamp("") === null);
  ok("junk is absent, not a refusal", parseStamp("inspire") === null);
  ok("zero is absent", parseStamp("0") === null);
  ok("a negative id is absent", parseStamp("-1") === null);
  ok("a fractional id is absent", parseStamp("1.5") === null);
  // The whole point: a stamp can only ever NARROW what a request may do. If a
  // malformed one refused, a mangled header would lock an operator out of
  // their own account — strictly worse than the bug being fixed.
  ok("whitespace is absent", parseStamp("   ") === null);
}

// ── isOwnApiUrl: only our own API carries the stamp ───────────────────────
{
  const origin = "https://www.adonisagent.ie";
  ok("a relative api path is ours", isOwnApiUrl("/api/content-studio/carousels/39", origin));
  ok("an absolute same-origin api url is ours", isOwnApiUrl(`${origin}/api/health`, origin));
  ok("a query string does not confuse it", isOwnApiUrl("/api/x?site=inspire", origin));

  // A third party must never be told which clinic this operator is in.
  ok("another origin is not ours", !isOwnApiUrl("https://api.stripe.com/v1/x", origin));
  ok(
    "another origin's /api path is still not ours",
    !isOwnApiUrl("https://evil.example/api/content-studio/carousels/39", origin),
  );
  // A protocol-relative URL resolves to a DIFFERENT host, not to ours -- the
  // trap in reading it as a path.
  ok("a protocol-relative url is not ours", !isOwnApiUrl("//evil.example/api/x", origin));

  // Same origin but not the API: a page navigation or an asset has no guard
  // to read the header.
  ok("a page path is not ours", !isOwnApiUrl("/content-studio/images/39", origin));
  ok("a near-miss prefix is not ours", !isOwnApiUrl("/apiary/x", origin));
  ok("the bare /api path is not ours", !isOwnApiUrl("/api", origin));

  ok("unparseable input is not ours", !isOwnApiUrl("::::", origin));
}

// ── The constants are the contract between server and client ──────────────
{
  ok("the header is lowercase (Headers normalises, comparisons should not surprise)",
    TENANT_STAMP_HEADER === TENANT_STAMP_HEADER.toLowerCase());
  ok("the mismatch code is stable", TENANT_MISMATCH_CODE === "TENANT_MISMATCH");
}

console.log(`tenantStampRules.test.ts: all ${passed} assertions passed`);
