// Run: npm test -- src/lib/cms/siteDeletion.test.ts
//
// Pure tests for the "Delete site" guardrails: the typed-confirmation match
// and the verified-domain block. Deliberately has no database — the real
// db-backed functions (summariseSiteDeletion/deleteSiteCascade in ./sites)
// need a real tenant DB and are exercised only through the app, not here.
import assert from "node:assert/strict";

import { canDeleteSite } from "./siteDeletion";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

check(
  "exact slug match with no verified domains passes",
  canDeleteSite({ confirmSlug: "inspire", siteSlug: "inspire", verifiedDomains: 0 }).ok === true,
);

const wrongSlug = canDeleteSite({ confirmSlug: "inspier", siteSlug: "inspire", verifiedDomains: 0 });
check("wrong slug refuses", wrongSlug.ok === false);
check(
  "wrong slug names the confirmation guard",
  !wrongSlug.ok && wrongSlug.reason.toLowerCase().includes("type"),
);

const emptyConfirm = canDeleteSite({ confirmSlug: "", siteSlug: "inspire", verifiedDomains: 0 });
check("empty confirm refuses", emptyConfirm.ok === false);

const caseMismatch = canDeleteSite({ confirmSlug: "Inspire", siteSlug: "inspire", verifiedDomains: 0 });
check("case mismatch refuses", caseMismatch.ok === false);

const verifiedDomainBlocks = canDeleteSite({
  confirmSlug: "inspire",
  siteSlug: "inspire",
  verifiedDomains: 1,
});
check("a verified domain refuses even with the right slug", verifiedDomainBlocks.ok === false);
check(
  "verified-domain refusal names the domain, not the slug",
  !verifiedDomainBlocks.ok && verifiedDomainBlocks.reason.toLowerCase().includes("domain"),
);

console.log(`\n${passed} check(s) passed`);
