// Run: npm test -- src/lib/design/renderDesignedSlide.test.ts
//
// The consolidated "render a designed slide" recipe. Three copies of this
// existed before -- the generator, the photo swap and the text editor -- and
// they had drifted. These checks pin the behaviour the single copy owes all
// three: the photo branch both ways, the overflow measurement that used to run
// only during generation, the content-addressed filename, the flat stand-in's
// equivalence to a real graded photograph and its cover of every slot, a non-square canvas actually going
// through the recipe end to end, and the no-token early return.
//
// Deliberately real: real satori, real sharp, real font bytes, a real write
// into the render store. The recipe IS the composition of those, so stubbing
// any of them would test the arrangement of mocks rather than the thing.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

import { PHOTO_TOKEN } from "../ai/designPost.parse";
import { renderFilePath } from "../image/renderStore";
import { loadDesignFonts } from "./fonts";
import type { DesignSystem } from "./parse";
import { gradedPhotoDataUri, measureLayout, renderDesignToPng } from "./renderDesign";
import { fillPhotoSlots, photoSlotBoxes, photoSlotsUsed } from "./photoSlots";
import { CANVAS, canvasFor, measurementHtmlFor, renderDesignedSlide } from "./renderDesignedSlide";

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
async function samplePhoto(
  dir: string,
  name: string,
  background: { r: number; g: number; b: number } = { r: 120, g: 140, b: 110 },
): Promise<string> {
  const png = await sharp({
    create: { width: 320, height: 240, channels: 3, background },
  })
    .blur(8)
    .png()
    .toBuffer();
  const file = path.join(dir, name);
  writeFileSync(file, png);
  return file;
}

/**
 * A photograph with a distinct top band and bottom band -- unlike samplePhoto,
 * which is deliberately a single flat colour and so crops identically no
 * matter what box it is graded at. The gate check needs a fixture where
 * cropping to a DIFFERENT aspect actually changes what is visible: a 320x240
 * source (4:3) cropped to a 1080x1080 square keeps its full height (cover
 * crops the sides), while cropped to a 1080x540 box (2:1, wider than the
 * source) it loses part of a band (cover crops top/bottom) -- so a
 * canvas-graded and a box-graded copy of the same file are visibly, and
 * therefore byte-wise, different.
 */
async function bandedPhoto(dir: string, name: string): Promise<string> {
  const width = 320;
  const height = 240;
  const top = await sharp({
    create: { width, height: height / 2, channels: 3, background: { r: 30, g: 60, b: 160 } },
  })
    .png()
    .toBuffer();
  const bottom = await sharp({
    create: { width, height: height / 2, channels: 3, background: { r: 220, g: 140, b: 40 } },
  })
    .png()
    .toBuffer();
  const composed = await sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([
      { input: top, left: 0, top: 0 },
      { input: bottom, left: 0, top: height / 2 },
    ])
    .png()
    .toBuffer();
  const file = path.join(dir, name);
  writeFileSync(file, composed);
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

/**
 * The pixel size of every stand-in the overflow measurement would use for
 * `html`, by running the real grading path and decoding what came back.
 *
 * Goes through gradedPhotoDataUri + measurementHtmlFor rather than reaching
 * into renderDesignedSlide, because the property under test is the agreement
 * BETWEEN those two: the stand-in must be the same pixel size as the graded
 * photograph it replaces.
 */
async function standInSizes(
  html: string,
  photos: { path: string }[],
): Promise<{ width: number; height: number }[]> {
  const { width, height } = canvasFor("1:1");
  const boxes = photoSlotBoxes(html);
  const slots = photoSlotsUsed(html);
  const uriBySlot = new Map<number, string>();
  const gradedAt = new Map<string, { width: number; height: number }>();
  for (const slot of slots) {
    const photo = photos[slot - 1];
    if (!photo) continue;
    const box = boxes.get(slot) ?? { width, height };
    const uri = await gradedPhotoDataUri(photo.path, box.width, box.height, SYSTEM.photo);
    uriBySlot.set(slot, uri);
    gradedAt.set(uri, box);
  }
  const filled = fillPhotoSlots(html, (slot) => uriBySlot.get(slot) ?? null);
  const measured = await measurementHtmlFor(filled, width, height, gradedAt);
  const embedded = measured.match(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi) ?? [];
  return Promise.all(
    embedded.map(async (uri) => {
      const meta = await sharp(Buffer.from(uri.split(",")[1], "base64")).metadata();
      return { width: meta.width ?? 0, height: meta.height ?? 0 };
    }),
  );
}

async function main() {
  const tmp = mkdtempSync(path.join(tmpdir(), "renderDesignedSlide-"));
  const photoPath = await samplePhoto(tmp, "photo.png");
  // Two DISTINCT photographs for the two-slot checks: same smooth fixture, a
  // different colour. If they were identical, "renders differently from the
  // same one twice" would hold no matter what the renderer did with the slots.
  const photoA = photoPath;
  const photoB = await samplePhoto(tmp, "photo-b.png", { r: 40, g: 70, b: 160 });
  // Banded (top/bottom colour split), for the grading-gate checks below --
  // samplePhoto's flat colour crops identically to any box, which would make
  // the gate untestable by pixel comparison.
  const bandedA = await bandedPhoto(tmp, "banded-a.png");
  const bandedB = await bandedPhoto(tmp, "banded-b.png");
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
  const realOverflow = (await measureLayout(
    equivHtml.split(PHOTO_TOKEN).join(realPhotoUri),
    1080,
    1080,
    equivFonts,
  )).overflowPx;
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

  // ── two photographs, one per slot ──────────────────────────────

  // Two photographs, each in its own slot. Before this, substitution was
  // `html.split(PHOTO_TOKEN).join(uri)` -- the same picture everywhere the token
  // appeared -- so a comparison slide showed one photograph twice.
  {
    const twoSlot =
      '<div style="display:flex;flex-direction:column;width:1080px;height:1080px;background-color:#f2f3ed;">' +
      `<img src="${PHOTO_TOKEN}" style="width:1080px;height:540px;object-fit:cover"/>` +
      '<img src="{{PHOTO:2}}" style="width:1080px;height:540px;object-fit:cover"/>' +
      "</div>";

    const both = await renderDesignedSlide({
      html: twoSlot,
      aspectRatio: "1:1",
      photos: [{ path: photoA }, { path: photoB }],
      logoPath: null,
      system: SYSTEM,
    });
    const sameTwice = await renderDesignedSlide({
      html: twoSlot,
      aspectRatio: "1:1",
      photos: [{ path: photoA }, { path: photoA }],
      logoPath: null,
      system: SYSTEM,
    });
    check(
      "two different photographs render differently from the same one twice",
      both.filename !== sameTwice.filename,
    );

    const missingSecond = await renderDesignedSlide({
      html: twoSlot,
      aspectRatio: "1:1",
      photos: [{ path: photoA }, null],
      logoPath: null,
      system: SYSTEM,
    });
    check(
      "a slot with no photograph still renders",
      typeof missingSecond.filename === "string" && missingSecond.filename.length > 0,
    );
    check(
      "and it differs from the render where both slots were filled",
      missingSecond.filename !== both.filename,
    );

    // The stand-in must cover BOTH slots, or the overflow pass carries a
    // graded photograph -- roughly 111x the stand-in's payload -- back through
    // satori, which is the entire cost the stand-in exists to avoid.
    //
    // Asserted on the measurement STRING, not on a render. Both <img> tags
    // here pin width AND height, and a graded photograph and the stand-in are
    // both 1080x1080, so the measured LAYOUT is identical whichever one slot 2
    // holds: a render check would pass even with the graded photo left in
    // place, which is exactly the hole this is closing.
    const gradedA = await gradedPhotoDataUri(photoA, 1080, 1080, SYSTEM.photo);
    const gradedB = await gradedPhotoDataUri(photoB, 1080, 1080, SYSTEM.photo);
    const measured = await measurementHtmlFor(
      fillPhotoSlots(twoSlot, (slot) => (slot === 1 ? gradedA : gradedB)),
      1080,
      1080,
    );
    const embedded: string[] = measured.match(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi) ?? [];
    check(
      "the measurement markup still carries an image in each of the two slots",
      embedded.length === 2,
    );
    check(
      "and both are the one flat stand-in -- no graded photograph survives into the measurement",
      new Set(embedded).size === 1 &&
        !embedded.includes(gradedA) &&
        !embedded.includes(gradedB),
    );
  }

  // ── each slot is graded at ITS OWN box ──────────────────────────────────
  //
  // Every slot used to be graded at the whole canvas, so a stacked comparison
  // embedded two full-canvas JPEGs and pushed both through satori twice:
  // measured on these library-sized photographs, 14.2s against 3.2s at 1:1 and
  // 46.8s against 9.8s at 9:16 -- and three of the editor's client paths abort
  // at 180s while the server keeps writing, so the operator saw an error on a
  // change that had landed.
  //
  // Asserted on the measurement markup's stand-ins rather than on elapsed
  // time, which is not a property. The stand-in is built at the size the
  // photograph it replaces was graded at -- that is the whole contract between
  // withPhotos and measurementHtmlFor -- so decoding it reads the grade's size
  // back out. It also pins the invariant directly: a stand-in of the wrong
  // size measures a layout that never rendered, because satori falls back to
  // an image's intrinsic size wherever a style does not pin both axes.
  {
    const halves =
      '<div style="display:flex;flex-direction:column;width:1080px;height:1080px;background:#f2f3ed;font-family:Inter">' +
      '<img src="{{PHOTO}}" style="width:1080px;height:540px" />' +
      '<img src="{{PHOTO:2}}" style="width:540px;height:270px" />' +
      "</div>";
    const seen = await standInSizes(halves, [{ path: photoA }, { path: photoB }]);
    check(
      "each slot's stand-in is the size that slot's <img> declares, not the canvas",
      seen.length === 2 &&
        seen.some((d) => d.width === 1080 && d.height === 540) &&
        seen.some((d) => d.width === 540 && d.height === 270),
    );

    // The fallback is what keeps a full-bleed slide -- the common
    // one-photograph slide -- rendering exactly as it did before per-slot
    // sizing existed. A percentage cannot be resolved without laying the
    // design out, so the canvas stands.
    const bleed =
      '<div style="display:flex;width:1080px;height:1080px;background:#f2f3ed;font-family:Inter">' +
      '<img src="{{PHOTO}}" style="width:100%;height:100%" />' +
      "</div>";
    const bled = await standInSizes(bleed, [{ path: photoA }]);
    check(
      "a slot with no px box falls back to the canvas, as every slot did before",
      bled.length === 1 && bled[0].width === 1080 && bled[0].height === 1080,
    );

    // ── the gate: per-box grading only once a slide has MORE THAN ONE slot ──
    //
    // Pinned by reconstructing what each grading policy would have produced
    // and comparing PNG bytes -- not standInSizes, which only proves the
    // stand-in agrees with whatever box photoSlotBoxes hands it, not which
    // box the real recipe chose. Both <img>s below pin width AND height in
    // their style, so satori lays each one out identically regardless of
    // which crop is embedded in it (see the module doc comment on
    // measurementHtmlFor) -- only the EMBEDDED PIXELS differ between a
    // canvas-graded and a box-graded photograph, which is exactly the signal
    // the gate needs to be judged on.
    const bandFonts = await loadDesignFonts(SYSTEM.font, SYSTEM.bodyFont, SYSTEM.altFont);

    // A single slot pinning a sub-canvas box (a half-height band is the
    // common shape of a slide already published) must still grade at the
    // canvas, exactly as every slot did before per-slot sizing existed --
    // otherwise a published one-photograph slide would silently re-frame the
    // next time anything re-renders it. See the comment above `declared` in
    // renderDesignedSlide.ts.
    const oneSlotBand =
      '<div style="display:flex;flex-direction:column;width:1080px;height:1080px;background:#f2f3ed;font-family:Inter">' +
      '<img src="{{PHOTO}}" style="width:1080px;height:540px" />' +
      "</div>";
    const bandRender = await renderDesignedSlide({
      html: oneSlotBand,
      aspectRatio: "1:1",
      photo: { path: bandedA },
      logoPath: null,
      system: SYSTEM,
    });
    const actualBandPng = readFileSync(renderFilePath(bandRender.filename));

    const canvasGraded = await gradedPhotoDataUri(bandedA, 1080, 1080, SYSTEM.photo);
    const expectedCanvasGradePng = await renderDesignToPng(
      fillPhotoSlots(oneSlotBand, () => canvasGraded),
      1080,
      1080,
      bandFonts,
    );
    check(
      "a single-slot slide with a sub-canvas box grades at the canvas, byte-identical to canvas grading",
      Buffer.compare(actualBandPng, expectedCanvasGradePng) === 0,
    );

    const boxGraded = await gradedPhotoDataUri(bandedA, 1080, 540, SYSTEM.photo);
    const wouldBeBoxGradePng = await renderDesignToPng(
      fillPhotoSlots(oneSlotBand, () => boxGraded),
      1080,
      1080,
      bandFonts,
    );
    check(
      "and differs from what grading at its own 1080x540 box would have produced",
      Buffer.compare(actualBandPng, wouldBeBoxGradePng) !== 0,
    );

    // The identical box, on a SECOND slot, flips the gate: now the slide has
    // more than one slot, so both grade at their own box.
    const twoSlotBands =
      '<div style="display:flex;flex-direction:column;width:1080px;height:1080px;background:#f2f3ed;font-family:Inter">' +
      '<img src="{{PHOTO}}" style="width:1080px;height:540px" />' +
      '<img src="{{PHOTO:2}}" style="width:1080px;height:540px" />' +
      "</div>";
    const twoBandRender = await renderDesignedSlide({
      html: twoSlotBands,
      aspectRatio: "1:1",
      photos: [{ path: photoA }, { path: photoB }],
      logoPath: null,
      system: SYSTEM,
    });
    const actualTwoBandPng = readFileSync(renderFilePath(twoBandRender.filename));

    const boxGradedA = await gradedPhotoDataUri(photoA, 1080, 540, SYSTEM.photo);
    const boxGradedB = await gradedPhotoDataUri(photoB, 1080, 540, SYSTEM.photo);
    const expectedBoxGradePng = await renderDesignToPng(
      fillPhotoSlots(twoSlotBands, (slot) => (slot === 1 ? boxGradedA : boxGradedB)),
      1080,
      1080,
      bandFonts,
    );
    check(
      "a two-slot slide with the same box grades at its own boxes, byte-identical to box grading",
      Buffer.compare(actualTwoBandPng, expectedBoxGradePng) === 0,
    );
  }

  // ── indexed by SLOT, not by order of appearance ─────────────────────────
  //
  // A design may write {{PHOTO:2}} and no {{PHOTO}} at all -- nothing requires
  // a model that has been taught both to use slot 1 first. renderDesignedSlide
  // reads photos[slot - 1], so that slide's photograph is the list's SECOND
  // entry. Indexing by order of appearance instead would take the first, and
  // every other check in this file would still pass.
  {
    const secondOnly =
      '<div style="display:flex;width:1080px;height:1080px;background-color:#f2f3ed;">' +
      '<img src="{{PHOTO:2}}" style="width:1080px;height:1080px;object-fit:cover"/>' +
      "</div>";
    const atSlotTwo = await renderDesignedSlide({
      html: secondOnly, aspectRatio: "1:1", photos: [null, { path: photoA }], logoPath: null, system: SYSTEM,
    });
    // The same markup with slot 1's spelling: the token is substituted away,
    // so identical pixels are what "the photograph landed in that <img>" means.
    const asSlotOne = await renderDesignedSlide({
      html: secondOnly.replace("{{PHOTO:2}}", PHOTO_TOKEN),
      aspectRatio: "1:1", photo: { path: photoA }, logoPath: null, system: SYSTEM,
    });
    check(
      "a lone {{PHOTO:2}} is filled from the list's second entry",
      atSlotTwo.filename === asSlotOne.filename,
    );
    const firstEntry = await renderDesignedSlide({
      html: secondOnly, aspectRatio: "1:1", photos: [{ path: photoA }], logoPath: null, system: SYSTEM,
    });
    check(
      "and the list's FIRST entry does not fill it -- slot 2 with nothing for it loses its <img>",
      firstEntry.filename !== atSlotTwo.filename,
    );
  }

  // The single-photograph shorthand still works and is identical to the list form.
  {
    const oneSlot =
      '<div style="display:flex;width:1080px;height:1080px;background-color:#f2f3ed;">' +
      `<img src="${PHOTO_TOKEN}" style="width:1080px;height:1080px;object-fit:cover"/>` +
      "</div>";
    const viaPhoto = await renderDesignedSlide({
      html: oneSlot, aspectRatio: "1:1", photo: { path: photoA }, logoPath: null, system: SYSTEM,
    });
    const viaPhotos = await renderDesignedSlide({
      html: oneSlot, aspectRatio: "1:1", photos: [{ path: photoA }], logoPath: null, system: SYSTEM,
    });
    check("the `photo` shorthand and a one-entry `photos` produce the same render", viaPhoto.filename === viaPhotos.filename);
  }

  console.log(`\nrenderDesignedSlide: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
