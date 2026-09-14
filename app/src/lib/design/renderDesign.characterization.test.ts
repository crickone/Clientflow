// Run: npm test -- src/lib/design/renderDesign.characterization.test.ts
//
// CHARACTERIZATION tests, not correctness tests: they pin what
// gradedPhotoDataUri, stampLogo and the "render a designed slide" recipe DO
// today, so a refactor that moves them (three copies of this recipe are being
// consolidated into one) fails loudly if it changes behaviour along the way.
// Nothing here is fixed or improved even where it looks questionable -- see
// the notes inline where that happens.
//
// Both functions under test had ZERO references anywhere in the repo before
// this file. That is the gap this file closes.
import assert from "node:assert/strict";
import { randomFillSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

import { PHOTO_TOKEN } from "../ai/designPost.parse";
import { loadDesignFonts } from "./fonts";
import {
  gradedPhotoDataUri,
  renderDesignToPng,
  stampLogo,
  type PhotoGrade,
} from "./renderDesign";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

/** A real PNG encoding of `width`x`height` truly random pixels, matching the
 *  convention in src/lib/image/processUpload.test.ts: random noise makes the
 *  "a different input changes the output" assertions robust, and gives
 *  gradedPhotoDataUri's `position: "attention"` crop something non-uniform to
 *  actually crop toward. */
async function randomEncodedPng(width: number, height: number): Promise<Buffer> {
  const raw = randomFillSync(Buffer.alloc(width * height * 3));
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** A small opaque logo file on disk. stampLogo and logoBox both call
 *  `sharp(logoPath)` directly -- a path, not a buffer -- so a real file is
 *  required. There is no existing fixture-image convention in the repo (other
 *  tests generate images with sharp in-memory); this writes into a temp
 *  directory rather than adding a binary fixture to the repo, which keeps the
 *  commit to source only. */
async function writeSolidLogo(
  dir: string,
  name: string,
  w: number,
  h: number,
  rgb: [number, number, number],
): Promise<string> {
  const file = path.join(dir, name);
  const png = await sharp({
    create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 } },
  })
    .png()
    .toBuffer();
  writeFileSync(file, png);
  return file;
}

/** A flat-colour canvas PNG, standing in for a rendered slide. Plain sharp,
 *  no satori -- stampLogo doesn't care how the PNG it's given was produced,
 *  and a flat canvas makes "which pixels changed" trivial to check exactly. */
async function flatCanvas(width: number, height: number, rgb: [number, number, number]): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } },
  })
    .png()
    .toBuffer();
}

async function decodedSize(dataUri: string): Promise<{ width: number; height: number; format: string }> {
  const comma = dataUri.indexOf(",");
  const buf = Buffer.from(dataUri.slice(comma + 1), "base64");
  const meta = await sharp(buf).metadata();
  return { width: meta.width!, height: meta.height!, format: meta.format! };
}

async function main() {
  const tmp = mkdtempSync(path.join(tmpdir(), "renderDesign-characterization-"));

  // ────────────────────────────────────────────────────────────────────────
  // gradedPhotoDataUri
  // ────────────────────────────────────────────────────────────────────────

  const SOURCE = await randomEncodedPng(300, 200);
  const GRADE_A: PhotoGrade = { saturate: 1.4, contrast: 1.2, brightness: 1.1 };
  const GRADE_B: PhotoGrade = { saturate: 0.6, contrast: 0.9, brightness: 0.85 };

  const uriA1 = await gradedPhotoDataUri(SOURCE, 240, 160, GRADE_A);

  check("gradedPhotoDataUri returns a data: URI", uriA1.startsWith("data:"));
  // Pinned as-is: the function hardcodes JPEG output regardless of the
  // source's own format (the source here is a PNG). That is current
  // behaviour, not a requirement being asserted as correct.
  check("the data URI is image/jpeg (current hardcoded output type)", uriA1.startsWith("data:image/jpeg;base64,"));

  const uriA2 = await gradedPhotoDataUri(SOURCE, 240, 160, GRADE_A);
  check(
    "the same inputs produce a byte-identical result across two calls (determinism)",
    uriA1 === uriA2,
  );

  const uriB = await gradedPhotoDataUri(SOURCE, 240, 160, GRADE_B);
  check("a different photo treatment produces a different result", uriA1 !== uriB);

  const uriNoGrade = await gradedPhotoDataUri(SOURCE, 240, 160, null);
  check("a null treatment also differs from a graded result", uriNoGrade !== uriA1);

  const sizeA = await decodedSize(uriA1);
  check("the decoded image has the requested width", sizeA.width === 240);
  check("the decoded image has the requested height", sizeA.height === 160);
  check("the decoded image is a JPEG", sizeA.format === "jpeg");

  // A differently-shaped request (portrait rather than landscape) still comes
  // back at exactly the requested box -- `fit: "cover"` crops rather than
  // letterboxing.
  const uriTall = await gradedPhotoDataUri(SOURCE, 120, 300, GRADE_A);
  const sizeTall = await decodedSize(uriTall);
  check("a portrait request is honoured exactly (cover-crop, not letterboxed)", sizeTall.width === 120 && sizeTall.height === 300);

  // ────────────────────────────────────────────────────────────────────────
  // stampLogo
  // ────────────────────────────────────────────────────────────────────────
  //
  // Geometry pinned against the constants renderDesign.ts documents:
  //   LOGO_MARGIN_FRACTION = 0.07, LOGO_WIDTH_FRACTION = 0.19
  // These are re-derived here from the doc comment, not imported (they are
  // not exported) -- that is the point: this test must notice if the private
  // constants drift, not silently track them.
  const CANVAS_W = 600;
  const CANVAS_H = 600;
  const LOGO_MARGIN_FRACTION = 0.07;
  const LOGO_WIDTH_FRACTION = 0.19;

  const LOGO_SRC_W = 300;
  const LOGO_SRC_H = 150; // 2:1 -- exercises logoBox's aspect-ratio math, not a square coincidence
  const logoRed = await writeSolidLogo(tmp, "logo-red.png", LOGO_SRC_W, LOGO_SRC_H, [220, 30, 30]);

  const LIGHT_BG: [number, number, number] = [235, 235, 230];
  const DARK_BG: [number, number, number] = [10, 10, 12];

  const lightSlide = await flatCanvas(CANVAS_W, CANVAS_H, LIGHT_BG);
  const stamped1 = await stampLogo(lightSlide, logoRed, CANVAS_W, CANVAS_H);
  const stamped2 = await stampLogo(lightSlide, logoRed, CANVAS_W, CANVAS_H);

  const stampedMeta = await sharp(stamped1).metadata();
  check("stampLogo's output is a valid PNG", stampedMeta.format === "png");
  check("stampLogo's output keeps the input's dimensions", stampedMeta.width === CANVAS_W && stampedMeta.height === CANVAS_H);
  check("stamping is deterministic for the same inputs", Buffer.compare(stamped1, stamped2) === 0);
  check("the stamped output differs from the unstamped input", Buffer.compare(stamped1, lightSlide) !== 0);

  const margin = Math.round(CANVAS_W * LOGO_MARGIN_FRACTION);
  const logoW = Math.round(CANVAS_W * LOGO_WIDTH_FRACTION);
  const logoH = Math.round((LOGO_SRC_H * logoW) / LOGO_SRC_W);
  const boxLeft = CANVAS_W - margin - logoW;
  const boxTop = margin;

  const rawStamped = await sharp(stamped1).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  function pixelAt(raw: typeof rawStamped, x: number, y: number): [number, number, number] {
    const o = (y * raw.info.width + x) * raw.info.channels;
    return [raw.data[o], raw.data[o + 1], raw.data[o + 2]];
  }

  const centerX = boxLeft + Math.floor(logoW / 2);
  const centerY = boxTop + Math.floor(logoH / 2);
  const centerPixel = pixelAt(rawStamped, centerX, centerY);
  const changedAtCenter =
    Math.abs(centerPixel[0] - LIGHT_BG[0]) > 8 ||
    Math.abs(centerPixel[1] - LIGHT_BG[1]) > 8 ||
    Math.abs(centerPixel[2] - LIGHT_BG[2]) > 8;
  check("stamping changes pixels inside the documented logo box", changedAtCenter);

  // On a light ground, the mark is pushed through DEFAULT_LOGO_MARKS.onLight
  // (#0b0b0b) regardless of the supplied artwork's own colour -- pinned as
  // current behaviour (the logo's own red is discarded).
  check(
    "on a light ground the stamped pixel is the onLight ink colour (#0b0b0b), not the logo's own colour",
    Math.abs(centerPixel[0] - 0x0b) <= 4 && Math.abs(centerPixel[1] - 0x0b) <= 4 && Math.abs(centerPixel[2] - 0x0b) <= 4,
  );

  // Far outside the box -- top-left corner and bottom-right corner -- must be
  // untouched. The background is flat, so this can be an exact match.
  const farCorners: Array<[number, number]> = [
    [2, 2],
    [2, CANVAS_H - 3],
    [Math.floor(CANVAS_W / 2), CANVAS_H - 3],
  ];
  const cornersUntouched = farCorners.every(([x, y]) => {
    const [r, g, b] = pixelAt(rawStamped, x, y);
    return r === LIGHT_BG[0] && g === LIGHT_BG[1] && b === LIGHT_BG[2];
  });
  check("pixels far outside the documented logo box are left untouched", cornersUntouched);

  // A pixel just left of the box's left edge (still in the reserved top band,
  // horizontally, but outside the box) is also untouched.
  const [justOutsideR, justOutsideG, justOutsideB] = pixelAt(rawStamped, boxLeft - 5, boxTop + 2);
  check(
    "a pixel just outside the box's left edge is untouched",
    justOutsideR === LIGHT_BG[0] && justOutsideG === LIGHT_BG[1] && justOutsideB === LIGHT_BG[2],
  );

  // The ink flip: on a DARK ground the same artwork is pushed through
  // DEFAULT_LOGO_MARKS.onDark (#f2f3ed) instead.
  const darkSlide = await flatCanvas(CANVAS_W, CANVAS_H, DARK_BG);
  const stampedDark = await stampLogo(darkSlide, logoRed, CANVAS_W, CANVAS_H);
  const rawDark = await sharp(stampedDark).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const darkCenterPixel = pixelAt(rawDark, centerX, centerY);
  check(
    "on a dark ground the stamped pixel is the onDark ink colour (#f2f3ed) instead",
    Math.abs(darkCenterPixel[0] - 0xf2) <= 4 && Math.abs(darkCenterPixel[1] - 0xf3) <= 4 && Math.abs(darkCenterPixel[2] - 0xed) <= 4,
  );

  // ────────────────────────────────────────────────────────────────────────
  // The full recipe, composed the way renderOne (src/lib/ai/designPost.ts,
  // not exported) does it today: substitute {{PHOTO}}, load fonts, render,
  // stamp the logo. Not calling renderOne -- it is private -- but running its
  // own public building blocks in its own order, against a fixture.
  // ────────────────────────────────────────────────────────────────────────

  const RECIPE_W = 400;
  const RECIPE_H = 300;
  const recipeLogo = await writeSolidLogo(tmp, "logo-recipe.png", 200, 200, [30, 90, 220]);
  const recipeFonts = await loadDesignFonts("Inter");
  const recipePhotoSource = await randomEncodedPng(320, 240);

  const recipeTemplate = (photoSrc: string) =>
    `<div style="display:flex;flex-direction:column;position:relative;width:${RECIPE_W}px;height:${RECIPE_H}px;background:#f2f3ed;font-family:Inter">` +
    `<img src="${photoSrc}" style="width:${RECIPE_W}px;height:200px" />` +
    `<div style="display:flex;width:${RECIPE_W}px;height:100px;align-items:center;justify-content:center;font-size:22px;color:#24231f">Composed recipe</div>` +
    `</div>`;

  async function runRecipe(withPhoto: boolean): Promise<Buffer> {
    // Mirrors renderOne's branch exactly: substitute the token when a photo is
    // available, or strip the whole <img> tag (matching on the literal token
    // still present in its src) when it is not.
    let html = recipeTemplate(PHOTO_TOKEN);
    if (html.includes(PHOTO_TOKEN)) {
      if (withPhoto) {
        const uri = await gradedPhotoDataUri(recipePhotoSource, RECIPE_W, 200, { saturate: 1.2, contrast: 1.1, brightness: 1.05 });
        html = html.split(PHOTO_TOKEN).join(uri);
      } else {
        html = html.replace(/<img[^>]*\{\{PHOTO\}\}[^>]*>/gi, "");
      }
    }
    let png = await renderDesignToPng(html, RECIPE_W, RECIPE_H, recipeFonts);
    png = await stampLogo(png, recipeLogo, RECIPE_W, RECIPE_H);
    return png;
  }

  const recipeWithPhoto1 = await runRecipe(true);
  const recipeWithPhoto2 = await runRecipe(true);
  check("the composed recipe is deterministic for the same inputs", Buffer.compare(recipeWithPhoto1, recipeWithPhoto2) === 0);

  const recipeNoPhoto = await runRecipe(false);
  check(
    "substituting {{PHOTO}} actually changes the output versus the no-photo (stripped <img>) path",
    Buffer.compare(recipeWithPhoto1, recipeNoPhoto) !== 0,
  );

  check("the composed recipe with a photo renders a non-empty PNG", recipeWithPhoto1.length > 0);
  check("the composed recipe without a photo also renders a non-empty PNG", recipeNoPhoto.length > 0);

  console.log(`\nrenderDesign.characterization: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
