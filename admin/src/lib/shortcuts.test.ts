// Run: npm test -- src/lib/shortcuts.test.ts
import assert from "node:assert/strict";

import { resolveShortcut } from "./shortcuts";

assert.deepEqual(resolveShortcut(null, "g"), { kind: "pending", key: "g" });
assert.deepEqual(resolveShortcut("g", "b"), { kind: "go", href: "/gyms" });
assert.deepEqual(resolveShortcut("g", "d"), { kind: "go", href: "/" });
assert.deepEqual(resolveShortcut("g", "h"), { kind: "go", href: "/health" });
assert.deepEqual(resolveShortcut("g", "p"), { kind: "go", href: "/provision" });
assert.deepEqual(resolveShortcut("g", "a"), { kind: "go", href: "/audit" });
assert.deepEqual(resolveShortcut("g", "s"), { kind: "go", href: "/settings" });
assert.deepEqual(resolveShortcut("g", "x"), { kind: "none" });
assert.deepEqual(resolveShortcut(null, "?"), { kind: "help" });
assert.deepEqual(resolveShortcut(null, "b"), { kind: "none" });
console.log("shortcuts.test.ts: ok");
