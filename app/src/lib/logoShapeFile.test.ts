// Run: npm test -- src/lib/logoShapeFile.test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const sharp = (await import("sharp")).default;
  const { ensureLogoShape, removeLogoShape, svgDensity } = requireLocal("./logoShapeFile") as typeof import("./logoShapeFile");
  assert.equal(svgDensity(120, 40), 300); // small mark: crisp
  assert.equal(Math.round(svgDensity(4000, 4000)), 37); // big export: scaled down
  assert.equal(svgDensity(undefined, undefined), 72);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logo-shape-"));
  try {
    // A dark block on white, saved as JPG.
    const jpg = path.join(dir, "logo.jpg");
    await sharp({ create: { width: 200, height: 100, channels: 3, background: "#ffffff" } })
      .composite([{ input: { create: { width: 100, height: 50, channels: 3, background: "#111111" } }, left: 50, top: 25 }])
      .jpeg({ quality: 95 })
      .toFile(jpg);
    const shape = await ensureLogoShape(jpg);
    assert.equal(shape, path.join(dir, "logo.shape.png"));
    const meta = await sharp(shape!).metadata();
    assert.equal(meta.hasAlpha, true);
    assert.ok(meta.width! >= 100 && meta.width! <= 106, `width ${meta.width}`);

    // Cached: a second call returns the same file without rewriting it.
    const m1 = fs.statSync(shape!).mtimeMs;
    assert.equal(await ensureLogoShape(jpg), shape);
    assert.equal(fs.statSync(shape!).mtimeMs, m1);

    // An SVG logo works too.
    const svg = path.join(dir, "logo.svg");
    fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect x="10" y="5" width="100" height="30" fill="#d4af37"/></svg>');
    removeLogoShape(svg);
    assert.ok(await ensureLogoShape(svg));

    // A photo-like image: null, and a marker so it isn't recomputed.
    const photo = path.join(dir, "logo.png");
    removeLogoShape(photo);
    await sharp({ create: { width: 60, height: 60, channels: 3, background: "#ffffff" } })
      .composite([
        { input: { create: { width: 10, height: 10, channels: 3, background: "#c81e1e" } }, left: 0, top: 0 },
        { input: { create: { width: 10, height: 10, channels: 3, background: "#1e1ec8" } }, left: 50, top: 50 },
      ])
      .png()
      .toFile(photo);
    assert.equal(await ensureLogoShape(photo), null);
    assert.ok(fs.existsSync(path.join(dir, "logo.shape.none")));

    // removeLogoShape clears both.
    removeLogoShape(photo);
    assert.ok(!fs.existsSync(path.join(dir, "logo.shape.none")));
    assert.ok(!fs.existsSync(path.join(dir, "logo.shape.png")));

    // A large design-tool SVG (4000 x 4000 user units) still gets a shape.
    const big = path.join(dir, "logo.svg");
    removeLogoShape(big);
    fs.writeFileSync(big, '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="4000"><rect x="400" y="1500" width="3200" height="1000" fill="#111"/></svg>');
    const bigShape = await ensureLogoShape(big);
    assert.ok(bigShape, "large SVG should get a shape");
    const bigMeta = await sharp(bigShape!).metadata();
    assert.ok(bigMeta.width! <= 1024 + 4, `width ${bigMeta.width}`);

    // An undecodable logo is remembered (marker), so it isn't re-decoded on every request.
    const junk = path.join(dir, "logo.webp");
    removeLogoShape(junk);
    fs.writeFileSync(junk, "not an image");
    assert.equal(await ensureLogoShape(junk), null);
    assert.ok(fs.existsSync(path.join(dir, "logo.shape.none")));
    removeLogoShape(junk);

    // A missing file is null, never a throw.
    assert.equal(await ensureLogoShape(path.join(dir, "nope.png")), null);
    console.log("logoShapeFile: ok");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
