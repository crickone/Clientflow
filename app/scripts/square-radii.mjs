// One-off: flatten inline container border-radii to the design-system token.
// Skips src/components/charts (those borderRadius values are Chart.js numeric
// dataset props, not CSS) and anything already using var(--radius) or "50%".
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "src");
const SKIP_DIR = join(ROOT, "components", "charts");

/** Recursively collect .ts/.tsx files under dir. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (p.startsWith(SKIP_DIR)) continue;
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

// Numeric form:  borderRadius: 12      → borderRadius: "var(--radius)"
// Px-string:     borderRadius: "12px"  → borderRadius: "var(--radius)"
const NUM = /borderRadius:\s*(?:4|5|6|7|8|9|10|11|12|13|14|15|16|18|20|22|24|28|32|36|40|999)\b/g;
const PX = /borderRadius:\s*"(?:4|5|6|7|8|9|10|11|12|13|14|15|16|18|20|22|24|28|32|36|40|999)px"/g;

let totalFiles = 0;
let totalHits = 0;

for (const file of walk(ROOT)) {
  const src = readFileSync(file, "utf8");
  let hits = 0;
  let next = src
    .replace(PX, () => {
      hits++;
      return 'borderRadius: "var(--radius)"';
    })
    .replace(NUM, () => {
      hits++;
      return 'borderRadius: "var(--radius)"';
    });
  if (hits > 0) {
    writeFileSync(file, next);
    totalFiles++;
    totalHits += hits;
    console.log(`${hits.toString().padStart(3)}  ${file.replace(ROOT, "src")}`);
  }
}

console.log(`\n${totalHits} replacements across ${totalFiles} files.`);
