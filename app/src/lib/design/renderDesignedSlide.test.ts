// Run: npm test -- src/lib/design/renderDesignedSlide.test.ts
//
// The consolidated "render a designed slide" recipe. Three copies of this
// existed before -- the generator, the photo swap and the text editor -- and
// they had drifted. These checks pin the behaviour the single copy owes all
// three: the photo branch both ways, the overflow measurement that used to run
// only during generation, the content-addressed filename, the flat stand-in's
// equivalence to a real graded photograph, a non-square canvas actually going
// through the recipe end to end, and the no-token early return.
//
// Deliberately real: real satori, real sharp, real font bytes, a real write
// into the render store. The recipe IS the composition of those, so stubbing
// any of them would test the arrangement of mocks rather than the thing.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

import { PHOTO_TOKEN } from "../ai/designPost.parse";
import { renderFilePath } from "../image/renderStore";
import { loadDesignFonts } from "./fonts";
import type { DesignSystem } from "./parse";
import { gradedPhotoDataUri, measureOverflowPx } from "./renderDesign";
import { CANVAS, canvasFor, renderDesignedSlide } from "./renderDesignedSlide";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

/**
 * A stand-in photograph: smooth, not noise.
 *
 * Deliberate, and the reason this file runs in seconds rather than minutes.
 * The recipe embeds the graded photo as a base64 JPEG inside the SVG satori
 * emits, and the rasteriser's cost tracks that string's LENGTH -- random
 * pixels compress to nothing, so a noise fixture produced a 700KB data URI and
 * a 38-second render per pass. A smooth image is both a fairer stand-in for a
 * real photograph and three orders of magnitude cheaper.
 */
async function samplePhoto(dir: string, name: string): Promise<string> {
  const png = await sharp({
    create: { width: 320, height: 240, channels: 3, background: { r: 120, g: 140, b: 110 } },
  })
    .blur(8)
    .png()
    .toBuffer();
  const file = path.join(dir, name);
  writeFileSync(file, png);
  return file;
}

async function writeLogo(dir: string): Promise<string> {
  const file = path.join(dir, "logo.png");
  const png = await sharp({
    create: { width: 200, height: 100, channels: 4, background: { r: 20, g: 90, b: 200, alpha: 1 } },
  })
    .png()
    .toBuffer();
  writeFileSync(file, png);
  return file;
}

/** Only the fields the recipe reads -- the faces and the photo grade. The rest
 *  of a DesignSystem is prompt material the renderer never touches, so it is
 *  filled in to satisfy the type and nothing more. */
const SYSTEM: DesignSystem = {
  version: 1,
  font: "Inter",
  motifs: [],
  templates: [],
  values: [],
  grounds: [],
  type: {} as DesignSystem["type"],
  grid: { columns: 12, margin: 80, gutter: 20, field: 920 },
  photo: { saturate: 1.2, contrast: 1.1, brightness: 1.05 },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
};

/** A square slide with a photograph in the top half and a line of copy under
 *  it. Every style is inline and every box declares a display, because that is
 *  what satori accepts. */
function slideHtml(bodyPx: number): string {
  return (
    `<div style="display:flex;flex-direction:column;width:1080px;height:1080px;background:#f2f3ed;font-family:Inter">` +
    `<img src="${PHOTO_TOKEN}" style="width:1080px;height:540px" />` +
    `<div style="display:flex;width:1080px;font-size:${bodyPx}px;color:#24231f;line-height:1.3">` +
    `A designed slide rendered by the one recipe that every path now shares.` +
    `</div>` +
    `</div>`
  );
}

async function main() {
  const tmp = mkdtempSync(path.join(tmpdir(), "renderDesignedSlide-"));
  const photoPath = await samplePhoto(tmp, "photo.png");
  const logoPath = await writeLogo(tmp);

  // ── the canvas table ────────────────────────────────────────────────────
  check("canvasFor resolves a square ratio", canvasFor("1:1").height === 1080);
  check("canvasFor resolves a portrait ratio", canvasFor("4:5").height === 1350);
  check("canvasFor resolves a story ratio", canvasFor("9:16").height === 1920);
  check("canvasFor falls back to square when the ratio is absent", canvasFor(null).height === CANVAS["1:1"].height);
  check(
    "canvasFor falls back to square on an unrecognised stored ratio rather than throwing",
    canvasFor("3:2").width === 1080 && canvasFor("3:2").height === 1080,
  );

  // ── the photo branch ────────────────────────────────────────────────────
  const withPhoto = await renderDesignedSlide({
    html: slideHtml(40),
    aspectRatio: "1:1",
    photo: { path: photoPath },
    logoPath,
    system: SYSTEM,
  });
  check("a rendered slide reports the canvas it was sized to", withPhoto.width === 1080 && withPhoto.height === 1080);
  check("the render is written to the store under the name it returns", existsSync(renderFilePath(withPhoto.filename)));

  const noPhoto = await renderDesignedSlide({
    html: slideHtml(40),
    aspectRatio: "1:1",
    photo: null,
    logoPath,
    system: SYSTEM,
  });
  check(
    "with no photograph the <img> is stripped, which paints a different slide",
    noPhoto.filename !== withPhoto.filename,
  );

  // The strip has to remove the whole TAG, not just its src: a broken src is
  // drawn by satori as an empty box, which is the bug this branch exists to
  // avoid. Pinned by rendering markup with the <img> already gone and
  // requiring the identical bytes -- the store is content-addressed, so an
  // equal filename is pixel equality.
  const preStripped = await renderDesignedSlide({
    html: slideHtml(40).replace(/<img[^>]*>/i, ""),
    aspectRatio: "1:1",
    photo: null,
    logoPath,
    system: SYSTEM,
  });
  check(
    "the no-photo path removes the whole <img>, painting exactly what markup without one paints",
    preStripped.filename === noPhoto.filename,
  );

  // ── content addressing ──────────────────────────────────────────────────
  const again = await renderDesignedSlide({
    html: slideHtml(40),
    aspectRatio: "1:1",
    photo: { path: photoPath },
    logoPath,
    system: SYSTEM,
  });
  check("the same inputs produce the same filename (the store is content-addressed)", again.filename === withPhoto.filename);

  const noLogo = await renderDesignedSlide({
    html: slideHtml(40),
    aspectRatio: "1:1",
    photo: { path: photoPath },
    logoPath: null,
    system: SYSTEM,
  });
  check("omitting the logo changes the pixels, so the filename changes with them", noLogo.filename !== withPhoto.filename);

  // ── the overflow measurement ────────────────────────────────────────────
  //
  // This is the check the consolidation is for. Only the generator measured
  // overflow before; the edit and swap paths could store a slide with its last
  // line sliced off and report success.
  check("a design that fits reports no overflow", withPhoto.overflowPx === 0);

  // A photograph filling most of the canvas plus copy far too large for what
  // is left has to run off the bottom.
  const overflowing = await renderDesignedSlide({
    html:
      `<div style="display:flex;flex-direction:column;width:1080px;height:1080px;background:#f2f3ed;font-family:Inter">` +
      `<img src="${PHOTO_TOKEN}" style="width:1080px;height:900px" />` +
      `<div style="display:flex;width:1080px;font-size:120px;color:#24231f;line-height:1.3">` +
      `Copy that cannot possibly fit in the strip of canvas left underneath a photograph this tall.` +
      `</div>` +
      `</div>`,
    aspectRatio: "1:1",
    photo: { path: photoPath },
    logoPath,
    system: SYSTEM,
  });
  check("a design that runs past the bottom reports the overflow in pixels", overflowing.overflowPx > 0);
  check(
    "an overflowing design is still stored -- a clipped slide the operator can see beats no slide",
    existsSync(renderFilePath(overflowing.filename)),
  );

  // ── stand-in equivalence ─────────────────────────────────────────────────
  //
  // The property the flat stand-in exists for, and until now it had zero
  // tests: measuring overflow against the REAL graded photograph must report
  // the same number the module reports internally against its stand-in. That
  // equivalence is what makes trading a 135-second pass for a 32ms one safe
  // rather than merely fast.
  //
  // The <img> here pins only WIDTH, not height -- the one fork where this can
  // actually go wrong. With both axes pinned, satori uses the style verbatim
  // and never looks at either image's intrinsic size, so the real photo and
  // the stand-in could never disagree regardless of the stand-in's shape.
  // Leaving height unpinned forces satori to fall back to intrinsic size, and
  // the graded photo and the stand-in only measure the same because both are
  // produced at the CANVAS's dimensions -- never the <img>'s own style box.
  const equivFonts = await loadDesignFonts("Inter");
  const equivHtml =
    `<div style="display:flex;flex-direction:column;width:1080px;height:1080px;background:#f2f3ed;font-family:Inter">` +
    `<img src="${PHOTO_TOKEN}" style="width:1080px" />` +
    `<div style="display:flex;width:1080px;font-size:60px;color:#24231f;line-height:1.3">` +
    `Copy underneath a photograph whose height satori has to infer from the image itself.` +
    `</div>` +
    `</div>`;
  const realPhotoUri = await gradedPhotoDataUri(photoPath, 1080, 1080, SYSTEM.photo);
  const realOverflow = await measureOverflowPx(
    equivHtml.split(PHOTO_TOKEN).join(realPhotoUri),
    1080,
    1080,
    equivFonts,
  );
  const equivRender = await renderDesignedSlide({
    html: equivHtml,
    aspectRatio: "1:1",
    photo: { path: photoPath },
    logoPath: null,
    system: SYSTEM,
  });
  check(
    "the flat stand-in measures the same overflow a real graded photograph would",
    equivRender.overflowPx === realOverflow,
  );

  // ── a real 4:5 render, not just canvasFor's table ───────────────────────
  //
  // canvasFor itself is already unit-tested above; this is the render path
  // actually going through it end to end at a non-square ratio, which no
  // other check here exercises.
  const portrait = await renderDesignedSlide({
    html: slideHtml(40),
    aspectRatio: "4:5",
    photo: { path: photoPath },
    logoPath,
    system: SYSTEM,
  });
  check(
    "a 4:5 render actually sizes the canvas to 1080x1350",
    portrait.width === 1080 && portrait.height === 1350,
  );

  // ── the no-token early return ───────────────────────────────────────────
  //
  // withPhoto's first line is `if (!html.includes(PHOTO_TOKEN)) return html`
  // -- markup with nothing to substitute must come back unchanged and must
  // never even look at `photo`. Pinned by handing it a photo path that does
  // not exist: if the early return were ever removed, gradedPhotoDataUri
  // would try to read that path and this render would throw instead of
  // succeeding.
  const noTokenHtml =
    `<div style="display:flex;flex-direction:column;width:1080px;height:1080px;background:#f2f3ed;font-family:Inter">` +
    `<div style="display:flex;width:1080px;font-size:40px;color:#24231f">No photo placeholder anywhere in this markup.</div>` +
    `</div>`;
  const noTokenRender = await renderDesignedSlide({
    html: noTokenHtml,
    aspectRatio: "1:1",
    photo: { path: path.join(tmp, "does-not-exist.png") },
    logoPath,
    system: SYSTEM,
  });
  check(
    "markup with no {{PHOTO}} token renders even with a bogus photo path -- the early return never touches it",
    existsSync(renderFilePath(noTokenRender.filename)),
  );

  // ── failure ─────────────────────────────────────────────────────────────
  //
  // Markup satori refuses THROWS rather than coming back with a null filename.
  // Both callers already translate that themselves -- the generator into a
  // violation the repair call acts on, the routes into a 500 -- and swallowing
  // it here would take that choice away from both.
  let threw = false;
  try {
    await renderDesignedSlide({
      html: `<div><span>one</span><span>two</span></div>`,
      aspectRatio: "1:1",
      photo: null,
      // A logo file that does not exist: the stamp is part of the recipe, so
      // its failure must surface the same way the renderer's does.
      logoPath: path.join(tmp, "not-a-file.png"),
      system: SYSTEM,
    });
  } catch {
    threw = true;
  }
  check("a step that cannot complete throws rather than returning a half-render", threw);

  console.log(`\nrenderDesignedSlide: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
