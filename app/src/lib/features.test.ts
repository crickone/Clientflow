// Run: npm test -- src/lib/features.test.ts
//
// Platform Console v2, slice 4 (module flags). The safety property first:
// UNSET MEANS ON. Every tenant in the live fleet has no `features` key, so
// if an absent or malformed value ever read as "off" the whole product
// would vanish for all of them at once.
//
// Then the path mapping, which is what the layout's gate and the sidebar
// both rely on: the longest matching prefix wins (so /nutrition/foods is
// nutrition, not something with a shorter prefix), a path no module claims
// is always allowed (the dashboard and settings must never be switchable),
// and a module's own root and children resolve to the same module.
//
// Pure module: no database, no server imports.
import assert from "node:assert/strict";

import {
  MODULE_CATALOG,
  MODULE_KEYS,
  isModuleOn,
  moduleForPath,
  parseFeatureFlags,
  pathAllowed,
} from "./features";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

// ── the catalog is well formed ────────────────────────────────────────────
const seenKeys = new Set<string>();
const seenPaths = new Set<string>();
for (const m of MODULE_CATALOG) {
  check(`${m.key} has a unique key`, !seenKeys.has(m.key));
  seenKeys.add(m.key);
  check(`${m.key} has a label and a blurb`, m.label.length > 0 && m.blurb.length > 0);
  check(`${m.key} owns at least one path`, m.paths.length > 0);
  for (const p of m.paths) {
    check(`${p} is an absolute path`, p.startsWith("/") && !p.endsWith("/"));
    check(`${p} is claimed by only one module`, !seenPaths.has(p));
    seenPaths.add(p);
  }
}
check("MODULE_KEYS matches the catalog", MODULE_KEYS.length === MODULE_CATALOG.length);

// ── UNSET MEANS ON: the property the live fleet depends on ────────────────
const unset = parseFeatureFlags(null);
for (const m of MODULE_CATALOG) {
  check(`${m.key} is on when nothing is stored`, isModuleOn(unset, m.key));
  check(`${m.key}'s pages open when nothing is stored`, pathAllowed(unset, m.paths[0]));
}
for (const junk of [undefined, 0, "", "off", [], [1, 2], { nutrition: "no" }, { madeUpModule: false }]) {
  const flags = parseFeatureFlags(junk);
  check(
    `junk (${JSON.stringify(junk)}) leaves every module on`,
    MODULE_CATALOG.every((m) => isModuleOn(flags, m.key)),
  );
}
check("an unknown key is dropped rather than stored", Object.keys(parseFeatureFlags({ notAModule: false })).length === 0);
check("a real key with a real boolean is kept", parseFeatureFlags({ nutrition: false }).nutrition === false);

// ── switching one off affects only that module ────────────────────────────
const noNutrition = parseFeatureFlags({ nutrition: false });
check("nutrition is off", !isModuleOn(noNutrition, "nutrition"));
check("its root is refused", !pathAllowed(noNutrition, "/nutrition"));
check("its children are refused", !pathAllowed(noNutrition, "/nutrition/foods"));
check("another module is untouched", isModuleOn(noNutrition, "workout"));
check("another module's pages still open", pathAllowed(noNutrition, "/workout/exercises"));

// ── the path mapping ──────────────────────────────────────────────────────
check("/leads is leads", moduleForPath("/leads")?.key === "leads");
check("/leads/42 is leads", moduleForPath("/leads/42")?.key === "leads");
check("/nutrition/foods is nutrition", moduleForPath("/nutrition/foods")?.key === "nutrition");
check("/marketing/schedule is marketing", moduleForPath("/marketing/schedule")?.key === "marketing");
check("/campaigns/domains is email campaigns", moduleForPath("/campaigns/domains")?.key === "email_campaigns");
check("/session-packages is products", moduleForPath("/session-packages")?.key === "products");

// A path no module claims must always be allowed: a business with no
// dashboard, settings or Adonis cannot be supported at all.
for (const p of ["/dashboard", "/settings", "/settings/users", "/adonis", "/clients", "/setup", "/"]) {
  check(`${p} is claimed by no module`, moduleForPath(p) === null);
  check(`${p} is allowed even with everything off`, pathAllowed(allOff(), p));
}

// A prefix that merely starts the same must not match: /leadsomething is not
// /leads.
check("/leadsomething is not leads", moduleForPath("/leadsomething") === null);

// ── everything off still leaves the unclaimed paths open ──────────────────
function allOff() {
  return parseFeatureFlags(Object.fromEntries(MODULE_KEYS.map((k) => [k, false])));
}
const off = allOff();
check("with everything off, every module reads off", MODULE_CATALOG.every((m) => !isModuleOn(off, m.key)));
check("…and every module page is refused", MODULE_CATALOG.every((m) => !pathAllowed(off, m.paths[0])));
check("…but the dashboard still opens", pathAllowed(off, "/dashboard"));

console.log(`features: ${passed} checks passed.`);
