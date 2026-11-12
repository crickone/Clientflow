// app/src/components/clientapp/programs/kit.test.ts
// Run: npm test -- src/components/clientapp/programs/kit.test.ts
//
// The Programs kit's CSS: one block with its own .pk- prefix that nothing
// else in globals.css uses, brand variables only (no fixed colours), and a
// rule for every pk- class the Programs screens use.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = path.join(process.cwd(), "src");
const css = fs.readFileSync(path.join(src, "app", "globals.css"), "utf8");
const START = "/* ── Programs kit (.pk-)";
const END = "/* ── end Programs kit ── */";
const a = css.indexOf(START);
const b = css.indexOf(END);
assert.ok(a !== -1 && b > a, "globals.css has one Programs kit block");
assert.equal(css.indexOf(START, a + 1), -1, "only one kit block");
const block = css.slice(a, b);
const outside = css.slice(0, a) + css.slice(b);

assert.ok(!/\.pk-/.test(outside), "no .pk- rule outside the kit block");
const noComments = block.replace(/\/\*[\s\S]*?\*\//g, "");
assert.ok(!/#[0-9a-f]{3,8}\b/i.test(noComments), "no hex colours in the kit");
assert.ok(!/\b(rgba?|hsla?)\(/i.test(noComments), "no fixed rgb or hsl colours in the kit");

// Every class a selector names is a pk- class.
const selectors = noComments.match(/(^|})\s*([^{}@]+)\{/g) ?? [];
for (const sel of selectors) {
  for (const cls of sel.match(/\.[a-zA-Z][\w-]*/g) ?? []) assert.ok(cls === ".pk" || cls.startsWith(".pk-"), `kit selector uses only pk classes: ${sel.trim()}`);
}
const defined = new Set((noComments.match(/\.pk(-[\w-]+)?/g) ?? []).map((c) => c.slice(1)));

// Every pk- class used in the member Programs code has a rule.
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const files = [...walk(path.join(src, "components", "clientapp")), ...walk(path.join(src, "app", "app", "programs"))].filter((f) => f.endsWith(".tsx"));
const used = new Set<string>();
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const c of (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) if (c === "pk" || c.startsWith("pk-")) used.add(c);
  }
  // Class names built in strings and template literals: "pk-card", `pk-card${...}`, " pk-card--accent".
  for (const m of text.matchAll(/[`"'\s](pk-[\w-]+)/g)) used.add(m[1]);
}
for (const c of used) assert.ok(defined.has(c), `${c} is used but has no rule in the kit`);
assert.ok(used.has("pk-card") && used.has("pk-phases"), "the kit components use the kit");

console.log(`programs kit css: ${defined.size} classes, ${used.size} used, ok`);
