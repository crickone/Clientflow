#!/usr/bin/env node
/**
 * Minimal test runner: finds every `*.test.ts` under src/ and runs it with tsx.
 * Tests are plain assertion scripts (node:assert/strict) that exit non-zero on
 * failure. No framework.
 *
 *   npm test            # run all
 *   npm test -- <path>  # run one file
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();
const tsx = join(cwd, "node_modules", ".bin", "tsx");
if (!existsSync(tsx)) {
  console.error("tsx not found. Run `npm install` first.");
  process.exit(1);
}

function findTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...findTests(p));
    else if (entry.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const arg = process.argv[2];
const files = arg ? [join(cwd, arg)] : findTests(join(cwd, "src")).sort();

if (files.length === 0) {
  console.log("No *.test.ts files found under src/.");
  process.exit(0);
}

let failed = 0;
for (const file of files) {
  const rel = file.replace(cwd + "/", "");
  console.log(`\n> ${rel}`);
  // `--conditions=react-server` lets modules that `import "server-only"` load
  // under plain Node. Next applies the same condition for server code.
  const res = spawnSync(tsx, [file], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--conditions=react-server"].filter(Boolean).join(" "),
    },
  });
  if (res.status !== 0) {
    failed++;
    console.log(`FAILED: ${rel}`);
  }
}
console.log(`\n${files.length - failed}/${files.length} test file(s) passed`);
process.exit(failed ? 1 : 0);
