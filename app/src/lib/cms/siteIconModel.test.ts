// Run: npm test -- src/lib/cms/siteIconModel.test.ts
//
// A business's website showed the platform's mark in the browser tab and in
// Google's results, because the admin app's icon was a file icon, which
// outranks every page's own. These are the rules for what a site shows now.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { isSafeSiteSlug, pickSiteIconFile, siteIconHref } from "./siteIconModel";

// A site's own file wins, SVG first.
assert.equal(pickSiteIconFile(["logo.png", "favicon.png", "favicon.svg"])?.name, "favicon.svg");
assert.equal(pickSiteIconFile(["favicon.ico", "favicon.png"])?.name, "favicon.png");
assert.equal(pickSiteIconFile(["FAVICON.PNG"])?.type, "image/png");
assert.equal(pickSiteIconFile(["favicon.ico"])?.type, "image/x-icon");
// No file: the caller draws one from the business's logo.
assert.equal(pickSiteIconFile(["logo.png", "mark.avif"]), null);
assert.equal(pickSiteIconFile([]), null);

// The slug reaches the file system, so only real slugs pass.
assert.equal(isSafeSiteSlug("optimal-health"), true);
assert.equal(isSafeSiteSlug("../control"), false);
assert.equal(isSafeSiteSlug("a/b"), false);
assert.equal(isSafeSiteSlug(""), false);

// The link carries a version so a changed icon is fetched again.
assert.equal(siteIconHref("optimal-health", 1731250000123.4), "/site-media/optimal-health/icon?v=1731250000123");

// The platform icon must not come back as a file icon: one in app/ would put
// the platform's mark on every client website again.
const appDir = path.join(process.cwd(), "src", "app");
for (const f of ["icon.svg", "icon.png", "icon.ico", "favicon.ico", "apple-icon.png"]) {
  assert.equal(fs.existsSync(path.join(appDir, f)), false, `src/app/${f} would override every site's own favicon`);
}

// The client sites built in this repo each ship their own mark.
for (const slug of ["optimal-health", "inspire", "healthwise", "adonisagent"]) {
  const names = fs.readdirSync(path.join(process.cwd(), "public", "sites", slug, "assets"));
  assert.ok(pickSiteIconFile(names), `${slug} has no favicon in its assets`);
}

console.log("siteIconModel: favicon choice, slug guard and the no-file-icon rule passed.");
