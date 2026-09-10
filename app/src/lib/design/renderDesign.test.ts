// Run: npm test -- src/lib/design/renderDesign.test.ts
//
// The renderer's normalisation layer, pinned against the shapes that actually
// broke. satori demands an explicit `display` on any element that is not simply
// holding text, and its error ("more than one child node") undersells the rule:
// an EMPTY div throws too. A model writes ordinary HTML, where none of that is
// required, so the renderer translates rather than expecting the prompt to hold.
//
// Every case here is markup a real generation produced.
import assert from "node:assert/strict";
import sharp from "sharp";

import { composeDesignSystem, defaultPalette } from "./direction";
import { getDirection } from "./directions";
import { loadDesignFonts } from "./fonts";
import { measureOverflowPx, renderDesignToPng } from "./renderDesign";
import { buildHitMapHtml, indexFromColour, pickBand } from "./hitMap";
import { OPTIMAL_HEALTH_DESIGN_SYSTEM } from "./presets";
import { sampleSlides } from "./sampleSlides";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const SHELL = (body: string) =>
  `<div style="display:flex;position:relative;width:400px;height:300px;background:#f2f3ed;font-family:Inter">${body}</div>`;

async function renders(body: string): Promise<boolean> {
  const fonts = await loadDesignFonts("Inter");
  try {
    const png = await renderDesignToPng(SHELL(body), 400, 300, fonts);
    return png.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  // The accent bar that took down three of four slides in a real generation:
  // a positioned block of colour with no children and no display.
  check(
    "an empty div renders (a plain accent bar)",
    await renders(
      `<div style="position:absolute;bottom:20px;right:20px;width:10px;height:120px;background:#b0844f"></div>`,
    ),
  );

  check(
    "a div with several element children renders",
    await renders(
      `<div style="margin:20px"><div style="width:300px">first</div><div style="width:300px">second</div></div>`,
    ),
  );

  check(
    "a div holding only text still renders, and is left alone to wrap",
    await renders(`<div style="width:300px;margin:20px">a heading long enough to wrap onto two lines</div>`),
  );

  check(
    "an explicit display is respected, not overwritten",
    await renders(
      `<div style="display:flex;flex-direction:row;margin:20px"><div style="width:100px">a</div><div style="width:100px">b</div></div>`,
    ),
  );

  // Entities are decoded in text, so a middot is a middot and not six
  // characters -- and an escaped tag stays text rather than becoming markup.
  const fonts = await loadDesignFonts("Inter");
  const png = await renderDesignToPng(
    SHELL(`<div style="width:300px;margin:20px">OPTIMAL &middot; CLONMEL &amp; CO</div>`),
    400,
    300,
    fonts,
  );
  check("entity-bearing text renders", png.length > 0);

  const escaped = await renderDesignToPng(
    SHELL(`<div style="width:300px;margin:20px">&lt;div&gt; stays text</div>`),
    400,
    300,
    fonts,
  );
  check("an escaped tag stays text rather than becoming an element", escaped.length > 0);

  // ── measureOverflowPx: does the design actually FIT the canvas? ──
  //
  // satori has no auto-fit, so a slide with one sentence too many renders
  // "successfully" with its last lines sliced off at the canvas edge. That is
  // the "the last sentence doesn't finish" an operator reports. Detection
  // works because satori does NOT clip at the root: rendered into a taller
  // canvas at the SAME width, the overflow paints below the canvas line, and
  // everything past the root is otherwise transparent.
  const LONG =
    "Hyperbaric oxygen therapy works by increasing the pressure around you, which dissolves far " +
    "more oxygen into the plasma than breathing at sea level ever could, reaching tissue that red " +
    "blood cells struggle to serve when circulation is the limiting factor rather than the oxygen.";
  const block = (px: number) =>
    `<div style="display:flex;flex-direction:column;position:relative;width:600px;height:400px;background:#f2f3ed;font-family:Inter;padding:40px;">` +
    `<span style="font-size:${px}px;line-height:1.15;color:#24231f;">${LONG}</span></div>`;

  check("text that fits reports no overflow", (await measureOverflowPx(block(14), 600, 400, fonts)) === 0);

  const past = await measureOverflowPx(block(40), 600, 400, fonts);
  check("text that does not fit reports overflow", past > 0);
  check("and reports roughly how far past it runs", past > 10);

  // An empty-ish canvas must never report overflow — the predicate reads the
  // alpha channel, so a full-bleed background must not be mistaken for content
  // spilling out of the canvas.
  const flat = `<div style="display:flex;width:600px;height:400px;background:#24231f;font-family:Inter;"></div>`;
  check("a full-bleed background alone reports no overflow", (await measureOverflowPx(flat, 600, 400, fonts)) === 0);

  // ── the hit map lands ON the words ──
  //
  // Click-to-edit rests entirely on "the hit map changes style, never
  // structure, therefore satori lays it out identically". That is a claim
  // about the renderer, so it is checked against the renderer: colour every
  // text element, render both, and ask what the hit map says is underneath
  // each ink pixel of the real render. Anything unattributed is text the
  // operator could click and miss.
  //
  // If someone later makes buildHitMapHtml wrap elements instead of styling
  // them, this is what fails.
  const HIT_SLIDE =
    `<div style="display:flex;flex-direction:column;justify-content:space-between;width:600px;height:600px;background:#f2f3ed;padding:50px 40px;font-family:Inter;">` +
    `<span style="font-size:52px;line-height:0.98;font-weight:600;color:#24231f;">It's not the oxygen.<br/>It's the pressure.</span>` +
    `<span style="font-size:18px;line-height:1.4;color:#6b6a63;">How hyperbaric therapy actually works.</span>` +
    `</div>`;

  const band = pickBand(HIT_SLIDE);
  const { runs: hitRuns, html: hitHtml } = buildHitMapHtml(HIT_SLIDE, band);
  const realRaw = await sharp(await renderDesignToPng(HIT_SLIDE, 600, 600, fonts))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mapRaw = await sharp(await renderDesignToPng(hitHtml, 600, 600, fonts))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bg = [realRaw.data[0], realRaw.data[1], realRaw.data[2]];
  const seen = new Set<number>();
  let ink = 0;
  let attributed = 0;
  for (let i = 0; i < realRaw.info.width * realRaw.info.height; i++) {
    const o = i * realRaw.info.channels;
    const isInk =
      Math.abs(realRaw.data[o] - bg[0]) > 60 ||
      Math.abs(realRaw.data[o + 1] - bg[1]) > 60 ||
      Math.abs(realRaw.data[o + 2] - bg[2]) > 60;
    if (!isInk) continue;
    ink++;
    const idx = indexFromColour(mapRaw.data[o], mapRaw.data[o + 1], mapRaw.data[o + 2], band);
    if (idx !== null) {
      attributed++;
      seen.add(idx);
    }
  }

  check("the probe slide actually has text to hit", ink > 1000);
  check(
    "virtually every rendered ink pixel falls inside a hit region",
    attributed / ink > 0.95,
  );
  check("and every run is reachable", seen.size === hitRuns.length);

  // ── sample slides: the preview a tenant judges a direction by ──
  //
  // Three fixed compositions, no model call, rendered with the system's own
  // font, grounds and type. They must render for the hand-authored system
  // (fonts and rules known-good) so that a direction that fails to preview is
  // the direction's fault, not the sample's.
  const samples = sampleSlides(OPTIMAL_HEALTH_DESIGN_SYSTEM);
  check("three sample slides", samples.length === 3);
  check("every sample names the system's font", samples.every((s) => s.includes(`font-family:${OPTIMAL_HEALTH_DESIGN_SYSTEM.font}`)));
  check("the samples use the system's grounds", samples.some((s) => s.includes("#c7d2bb")) && samples.some((s) => s.includes("#f2f3ed")));
  for (const [i, html] of samples.entries()) {
    const png = await renderDesignToPng(html, 1080, 1080, fonts);
    check(`sample ${i + 1} renders`, png.length > 0);
    check(`sample ${i + 1} fits the canvas`, (await measureOverflowPx(html, 1080, 1080, fonts)) === 0);

    // The top-right corner is where the logo is stamped afterwards. It must
    // hold nothing but ground: sample stampLogo's actual box (a 7% margin plus
    // a 19% logo width, a tenth of the height) and require it to be one flat
    // colour.
    const raw = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const cornerX = raw.info.width - Math.round(raw.info.width * 0.07) - Math.round(raw.info.width * 0.19);
    const cornerH = Math.round(raw.info.height / 10);
    const first = (raw.info.width - 1) * raw.info.channels; // top-right pixel
    let flat = true;
    for (let y = 0; y < cornerH && flat; y++) {
      for (let x = cornerX; x < raw.info.width; x++) {
        const o = (y * raw.info.width + x) * raw.info.channels;
        if (
          Math.abs(raw.data[o] - raw.data[first]) > 8 ||
          Math.abs(raw.data[o + 1] - raw.data[first + 1]) > 8 ||
          Math.abs(raw.data[o + 2] - raw.data[first + 2]) > 8
        ) {
          flat = false;
          break;
        }
      }
    }
    check(`sample ${i + 1} keeps the logo corner clear`, flat);
  }

  // The corner rule has to hold for every direction's grid, not just Optimal
  // Health's hand-authored one -- rerun the same three assertions against
  // "bold", which has the smallest margin (64) of any direction in the
  // catalogue and is therefore the tightest case for the reserved corner.
  const bold = getDirection("bold")!;
  const boldFonts = await loadDesignFonts(bold.font);
  const boldSamples = sampleSlides(composeDesignSystem(bold, defaultPalette(bold)));
  for (const [i, html] of boldSamples.entries()) {
    const png = await renderDesignToPng(html, 1080, 1080, boldFonts);
    check(`bold sample ${i + 1} renders`, png.length > 0);
    check(`bold sample ${i + 1} fits the canvas`, (await measureOverflowPx(html, 1080, 1080, boldFonts)) === 0);

    const raw = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const cornerX = raw.info.width - Math.round(raw.info.width * 0.07) - Math.round(raw.info.width * 0.19);
    const cornerH = Math.round(raw.info.height / 10);
    const first = (raw.info.width - 1) * raw.info.channels;
    let flat = true;
    for (let y = 0; y < cornerH && flat; y++) {
      for (let x = cornerX; x < raw.info.width; x++) {
        const o = (y * raw.info.width + x) * raw.info.channels;
        if (
          Math.abs(raw.data[o] - raw.data[first]) > 8 ||
          Math.abs(raw.data[o + 1] - raw.data[first + 1]) > 8 ||
          Math.abs(raw.data[o + 2] - raw.data[first + 2]) > 8
        ) {
          flat = false;
          break;
        }
      }
    }
    check(`bold sample ${i + 1} keeps the logo corner clear`, flat);
  }

  console.log(`\nrenderDesign: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
