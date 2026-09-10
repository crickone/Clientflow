// Fetch the WOFF faces the design renderer needs, from fontsource's npm
// tarballs, into public/fonts -- with each family's licence beside it.
//
//   node scripts/fetch-design-fonts.mjs
//
// Run once and COMMIT the output: public/fonts ships in the runtime image
// (Dockerfile copies public/), so the files must be in the repo, not fetched
// at boot. Pinned versions, so a re-run produces identical bytes.
//
// WOFF rather than WOFF2 because satori's font parser reads TTF/OTF/WOFF and
// not WOFF2. fontsource ships both; only the .woff is taken.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const FAMILIES = [
  { pkg: "playfair-display", version: "5.3.0" },
  { pkg: "space-grotesk", version: "5.3.0" },
  { pkg: "manrope", version: "5.3.0" },
  { pkg: "archivo", version: "5.3.0" },
  { pkg: "fraunces", version: "5.3.0" },
];
const WEIGHTS = [400, 500, 600, 700];

const dest = path.join(process.cwd(), "public", "fonts");
const tmp = mkdtempSync(path.join(os.tmpdir(), "design-fonts-"));

for (const { pkg, version } of FAMILIES) {
  const url = `https://registry.npmjs.org/@fontsource/${pkg}/-/${pkg}-${version}.tgz`;
  const tgz = path.join(tmp, `${pkg}.tgz`);
  execFileSync("curl", ["-sSL", "--fail", "-o", tgz, url]);
  execFileSync("tar", ["-xzf", tgz, "-C", tmp]);
  const files = path.join(tmp, "package", "files");
  for (const weight of WEIGHTS) {
    const name = `${pkg}-latin-${weight}-normal.woff`;
    const src = path.join(files, name);
    if (!existsSync(src)) throw new Error(`${pkg}@${version} has no ${name}`);
    copyFileSync(src, path.join(dest, name));
  }
  const licence = path.join(tmp, "package", "LICENSE");
  if (existsSync(licence)) copyFileSync(licence, path.join(dest, `LICENSE-${pkg}.txt`));
  rmSync(path.join(tmp, "package"), { recursive: true, force: true });
  console.log(`fetched ${pkg} ${version}`);
}
rmSync(tmp, { recursive: true, force: true });
