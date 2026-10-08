// Run: npx tsx src/lib/video/uploadPaths.test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { adoptLegacyFiles, legacyProjectDir, projectDirFor } from "./uploadPaths";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-"));
try {
  // One legacy folder "2" holding files of two different tenants' project 2.
  const legacy = legacyProjectDir(2, root);
  fs.mkdirSync(legacy, { recursive: true });
  for (const f of ["main-aaaa.mp4", "output-1.mp4", "main-bbbb.mp4", "captions.ass"]) fs.writeFileSync(path.join(legacy, f), f);

  assert.equal(adoptLegacyFiles(7, 2, ["main-aaaa.mp4", "output-1.mp4", "missing.mp4"], root), 2);
  assert.ok(fs.existsSync(path.join(projectDirFor(7, 2, root), "main-aaaa.mp4")));
  assert.ok(fs.existsSync(path.join(legacy, "main-bbbb.mp4")), "the other tenant's file stays put");

  assert.equal(adoptLegacyFiles(9, 2, ["main-bbbb.mp4"], root), 1);
  assert.ok(fs.existsSync(path.join(projectDirFor(9, 2, root), "main-bbbb.mp4")));
  assert.ok(!fs.existsSync(path.join(projectDirFor(7, 2, root), "main-bbbb.mp4")), "never crosses tenants");

  // Unreferenced scraps stay; the folder stays because it is not empty.
  assert.ok(fs.existsSync(path.join(legacy, "captions.ass")));

  // Running again moves nothing and does not throw.
  assert.equal(adoptLegacyFiles(7, 2, ["main-aaaa.mp4"], root), 0);
  // A path-ish name is ignored rather than escaping the folder.
  assert.equal(adoptLegacyFiles(7, 2, ["../2/captions.ass"], root), 0);

  // An emptied legacy folder is removed.
  fs.mkdirSync(legacyProjectDir(5, root));
  fs.writeFileSync(path.join(legacyProjectDir(5, root), "main-c.mp4"), "x");
  adoptLegacyFiles(7, 5, ["main-c.mp4"], root);
  assert.ok(!fs.existsSync(legacyProjectDir(5, root)));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log("uploadPaths: all checks passed.");
