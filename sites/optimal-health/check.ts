// Run from app/:  npx tsx ../sites/optimal-health/check.ts
// Reads the built pages exactly as tools/import-site.cjs will, splits each
// into head/content/tail the way the CMS does, and applies the Studio's
// editability rule. Fails if any page is refused or if any of the three zones
// is empty.
//
// Content is in that list for the same reason head and tail are, and it was
// the one left out: a page whose body vanished -- a partial emptied, a marker
// swallowing the markup after it, a strip that took more than it meant to --
// passed, reporting `editable | content 0`, and exited 0. Studio calls an
// empty page editable, which it is; what it is not is a page.
//
// BLANK, not zero-length. readSitePages joins the zones with newlines
// (`${gfonts}\n${styles}\n${body}`), so a page with nothing at all in its
// <body> still arrives with a one-character content zone: a `.length > 0`
// clause would have read `content 1` and passed the very page it was written
// to catch. A zone of pure whitespace is an empty zone, and all three are
// judged that way -- head and tail are runs of <style>/<link>/<script>
// tokens and can never legitimately be whitespace either.
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
  // Named, not just counted: "1 page(s) would not import cleanly" over a row
  // of three numbers makes the reader work out which number was the problem,
  // and the three failures mean three different things.
  const empty = (["content", "head", "tail"] as const).filter((zone) => !z[zone].trim());
  if (!e.ok || empty.length) bad++;
  const verdict = [e.ok ? "editable" : `REFUSED: ${e.reason}`]
    .concat(empty.length ? [`EMPTY: ${empty.join(", ")}`] : [])
    .join(" ");
  console.log(
    p.path.padEnd(16),
    verdict,
    `| head ${z.head.length} content ${z.content.length} tail ${z.tail.length}`,
  );
}
if (bad) {
  console.error(`${bad} page(s) would not import cleanly (refused, or a zone came out empty)`);
  process.exit(1);
}
console.log(`${join(here, "*.html")}: every page splits into three zones and is Studio-editable`);
