// Run: npm test -- src/lib/palette.test.ts
import assert from "node:assert/strict";

import { STATIC_COMMANDS, rankStatic, pushRecent } from "./palette";

assert.ok(STATIC_COMMANDS.some((c) => c.href === "/provision"));
assert.deepEqual(rankStatic("", STATIC_COMMANDS).map((c) => c.href), STATIC_COMMANDS.map((c) => c.href));
assert.equal(rankStatic("prov", STATIC_COMMANDS)[0]?.href, "/provision");
assert.equal(rankStatic("audit", STATIC_COMMANDS)[0]?.href, "/audit");
assert.deepEqual(rankStatic("zzz", STATIC_COMMANDS), []);

const a = { kind: "business" as const, id: 1, title: "A", subtitle: "", href: "/gyms/1" };
const b = { kind: "business" as const, id: 2, title: "B", subtitle: "", href: "/gyms/2" };
let recent = pushRecent([], a, 5);
recent = pushRecent(recent, b, 5);
recent = pushRecent(recent, a, 5);
assert.deepEqual(recent.map((r) => r.href), ["/gyms/1", "/gyms/2"], "newest first, no duplicates");
assert.equal(pushRecent([a, b], { ...a, id: 3, href: "/gyms/3" }, 2).length, 2, "capped");
console.log("palette.test.ts: ok");
