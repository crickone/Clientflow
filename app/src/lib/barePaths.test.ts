/**
 * Run: npm test -- src/lib/barePaths.test.ts
 *
 * These exist because the two hand-maintained copies of this list drifted and
 * a signed-in operator got the full admin sidebar wrapped around the password
 * reset page. The list is one array now; this pins the membership so removing
 * an entry has to be deliberate.
 */
import assert from "node:assert/strict";

import { BARE_PATHS, isBarePath } from "./barePaths";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  passed++;
}

check("the list is exactly these six", [...BARE_PATHS], [
  "/login", "/change-password", "/select-account", "/accept-invite", "/forgot-password", "/reset-password",
]);

// Password recovery is the pair that drifted, so it gets named checks.
check("/forgot-password is bare", isBarePath("/forgot-password"), true);
check("/reset-password is bare", isBarePath("/reset-password"), true);
check("a reset token URL is bare too", isBarePath("/reset-password/abc123"), true);
check("a reset query string is bare", isBarePath("/reset-password"), true);

check("/login is bare", isBarePath("/login"), true);
check("/dashboard is not", isBarePath("/dashboard"), false);
check("/", isBarePath("/"), false);

// A prefix match must not catch an unrelated sibling route.
check("/logins is NOT bare", isBarePath("/logins"), false);
check("/login-help is NOT bare", isBarePath("/login-help"), false);

// usePathname() can hand back null before hydration; bare must not throw, and
// must not claim a null path is bare (that would drop the shell on every page).
check("null is not bare", isBarePath(null), false);
check("undefined is not bare", isBarePath(undefined), false);
check("empty string is not bare", isBarePath(""), false);

// The layout redirects a stale session to /login for any path that is NOT
// bare. These are the paths that must never be caught by that, or a signed-out
// visitor bounces off the very page that would sign them in.
for (const p of ["/login", "/forgot-password", "/reset-password", "/accept-invite", "/select-account", "/change-password"]) {
  check(`${p} survives the stale-session redirect`, isBarePath(p), true);
}
// …and the ones that must be caught, so a dead cookie cannot reach a page that
// touches the tenant DB.
for (const p of ["/dashboard", "/clients", "/settings/pipeline", "/agents/orchestrator"]) {
  check(`${p} is caught by the stale-session redirect`, isBarePath(p), false);
}

console.log(`barePaths: ${passed} checks passed.`);
