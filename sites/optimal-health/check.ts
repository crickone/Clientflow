// Run from app/:  npx tsx ../sites/optimal-health/check.ts
// Reads the built pages exactly as tools/import-site.cjs will, splits each
// into head/content/tail the way the CMS does, and applies the Studio's
// editability rule. Fails if any page is refused or has an empty head or tail.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { splitPageBody, studioEditability } from "../../app/src/lib/cms/pageBody";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { readSitePages } = require("../../tools/lib/siteHtml.cjs") as {
  readSitePages: (dir: string, slug: string) => Array<{ path: string; body: string }>;
};

let bad = 0;
for (const p of readSitePages(here, "optimal-health")) {
  const z = splitPageBody(p.body);
  const e = studioEditability(z);
  const ok = e.ok && z.head.length > 0 && z.tail.length > 0;
  if (!ok) bad++;
  console.log(
    p.path.padEnd(16),
    e.ok ? "editable" : `REFUSED: ${e.reason}`,
    `| head ${z.head.length} content ${z.content.length} tail ${z.tail.length}`,
  );
}
if (bad) {
  console.error(`${bad} page(s) would not import cleanly`);
  process.exit(1);
}
console.log(`${join(here, "*.html")}: every page splits into three zones and is Studio-editable`);
