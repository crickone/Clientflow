// Run: npm test -- src/lib/api/tabTenant.test.ts
//
// The tab stamp for requests that bypass the fetch wrapper (the attachment
// upload's XMLHttpRequest): no tenant, no header; with one, the same header
// TenantTabGuard puts on fetch. A stale-tab 409 is told apart from any other
// answer and reaches the guard as an event.
import assert from "node:assert/strict";

import { TENANT_MISMATCH_EVENT, reportTenantMismatch, setTabTenant, tabTenantHeaders, tenantMismatchMessage } from "./tabTenant";
import { TENANT_MISMATCH_CODE, TENANT_STAMP_HEADER } from "./tenantStampRules";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

ok("no tenant: no header", Object.keys(tabTenantHeaders()).length === 0);
setTabTenant(1028);
ok("tenant: the fetch wrapper's header and value", tabTenantHeaders()[TENANT_STAMP_HEADER] === "1028" && TENANT_STAMP_HEADER === "x-adonis-tenant");
setTabTenant(null);
ok("cleared: no header", Object.keys(tabTenantHeaders()).length === 0);

const stale = JSON.stringify({ ok: false, code: TENANT_MISMATCH_CODE, error: "This tab is showing Inspire." });
ok("409 mismatch: its message", tenantMismatchMessage(409, stale) === "This tab is showing Inspire.");
ok("409 mismatch with no message: a plain one", /different account/.test(tenantMismatchMessage(409, JSON.stringify({ code: TENANT_MISMATCH_CODE })) ?? ""));
ok("other 409: not stale", tenantMismatchMessage(409, JSON.stringify({ ok: false, error: "Conflict" })) === null);
ok("200 with the code: not stale", tenantMismatchMessage(200, stale) === null);
ok("409 html: not stale", tenantMismatchMessage(409, "<html>") === null);

// The event the guard listens for.
const target = new EventTarget();
(globalThis as { window?: unknown }).window = target;
let heard: string | null = null;
target.addEventListener(TENANT_MISMATCH_EVENT, (e) => {
  heard = (e as CustomEvent<string>).detail;
});
reportTenantMismatch("Reload this tab.");
ok("reported to the guard", heard === "Reload this tab.");
delete (globalThis as { window?: unknown }).window;

console.log(`tabTenant: ${passed} checks passed.`);
