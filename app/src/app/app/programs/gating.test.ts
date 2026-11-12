// Run: npm test -- src/app/app/programs/gating.test.ts
//
// Every member Programs page calls requireProgramsPage(), and every exported
// server action under /app/programs checks the member (requireClient plus
// memberSeesPrograms, through member()) before it does anything. A new page or
// action that skips the gate fails here.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "src", "app", "app", "programs");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

const files = walk(root);
const pages = files.filter((f) => f.endsWith("page.tsx"));
const actions = files.filter((f) => f.endsWith("actions.ts"));
const rel = (f: string) => path.relative(root, f);
for (const want of ["page.tsx", "[key]/page.tsx", "[key]/start/page.tsx", "mine/page.tsx", "built/new/page.tsx", "built/[id]/page.tsx", "built/[id]/start/page.tsx"]) {
  assert.ok(pages.some((f) => rel(f) === want), `has ${want}`);
}
for (const want of ["actions.ts", "built/actions.ts"]) assert.ok(actions.some((f) => rel(f) === want), `has ${want}`);

for (const f of pages) {
  const src = fs.readFileSync(f, "utf8");
  assert.ok(/requireProgramsPage\(\)/.test(src), `${rel(f)} calls requireProgramsPage()`);
}

for (const f of actions) {
  const src = fs.readFileSync(f, "utf8");
  assert.ok(/^(\/\/[^\n]*\n)*"use server";/.test(src), `${rel(f)} is a server actions file`);
  assert.ok(/function member\(\) \{\s+const c = requireClient\(\);\s+return memberSeesPrograms\(c\) \? c : null;\s+\}/.test(src), `${rel(f)} gates with requireClient and memberSeesPrograms`);
  const bodies = src.split(/\nexport async function /).slice(1);
  assert.ok(bodies.length > 0, `${rel(f)} exports actions`);
  for (const body of bodies) {
    const name = body.slice(0, body.indexOf("("));
    const firstLines = body.split("\n").slice(1, 3).join("\n");
    assert.ok(/const c = member\(\);\s+if \(!c\) return/.test(firstLines), `${rel(f)}: ${name} checks the member first`);
  }
}

console.log("app/programs gating: ok");
