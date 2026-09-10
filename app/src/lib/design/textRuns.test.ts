// Run: npm test -- src/lib/design/textRuns.test.ts
//
// Click-to-edit text on a designed slide. These are the pure halves: finding
// the editable runs in the markup, splicing an edit back in, and encoding /
// decoding the hit-map colours a click is resolved through.
//
// The properties that matter, each of which is a real bug if it goes:
//   - an unchanged edit round-trips to BYTE-IDENTICAL markup (otherwise every
//     click rewrites the design and satori's layout can shift under it);
//   - typed text can never become markup;
//   - mixed content is not offered as editable (making it so would need a
//     wrapper element, which changes what satori's `prepare` does to the
//     parent, which moves the hit boxes off the words);
//   - the hit map changes only style, never structure;
//   - the index encoding survives a round trip through a colour.
import assert from "node:assert/strict";

import { findTextRuns, replaceRunText, runAt } from "./textRuns";
import { buildHitMapHtml, hitColour, hitIndexAt, indexFromColour, pickBand } from "./hitMap";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// Markup in the shape a real generation produces.
const SLIDE =
  `<div style="display:flex;flex-direction:column;width:1080px;height:1080px;background:#f2f3ed;padding:80px;">` +
  `<span style="font-size:84px;color:#24231f;">It's not the oxygen.<br/>It's the pressure.</span>` +
  `<span style="font-size:28px;color:#6b6a63;">How hyperbaric therapy actually works</span>` +
  `<div style="display:flex;width:60px;height:8px;background:#c2410c;"></div>` +
  `</div>`;

const runs = findTextRuns(SLIDE);

check("finds every text-bearing element", runs.length === 2);
check("<br/> becomes a newline for editing", runs[0].text === "It's not the oxygen.\nIt's the pressure.");
check("the second run is found too", runs[1].text === "How hyperbaric therapy actually works");
check("an empty element is not editable", !runs.some((r) => r.text.trim() === ""));
check(
  "the container holding elements is not offered as text",
  !runs.some((r) => r.text.includes("<span")),
);
check("runs are numbered in document order", runs[0].index === 0 && runs[1].index === 1);

// ── round trip: an unchanged edit must not rewrite the design ──
const unchanged = replaceRunText(SLIDE, runs[0], runs[0].text);
check("an unchanged edit produces byte-identical markup", unchanged === SLIDE);

const edited = replaceRunText(SLIDE, runs[1], "What the pressure actually does");
check("an edit changes the text", edited.includes("What the pressure actually does"));
check("and leaves the rest of the markup alone", edited.includes(`font-size:84px`) && edited.includes(`#c2410c`));
check("and does not disturb the other run", findTextRuns(edited)[0].text === runs[0].text);

const multiline = replaceRunText(SLIDE, runs[1], "One line\nTwo line");
check("a newline is written back as <br/>", multiline.includes("One line<br/>Two line"));
check("and re-reads as a newline", findTextRuns(multiline)[1].text === "One line\nTwo line");

// ── typed text can never become markup ──
const hostile = replaceRunText(SLIDE, runs[1], `<img src=x onerror="alert(1)">`);
check("typed markup is escaped, not injected", !hostile.includes("<img src=x"));
check("and reads back as the literal characters", findTextRuns(hostile)[1].text.includes("&lt;img"));

check("runAt finds a run by index", runAt(SLIDE, 1)?.text === runs[1].text);
check("runAt returns null for an index that isn't there", runAt(SLIDE, 99) === null);

// ── mixed content is deliberately NOT editable ──
const mixed = `<div style="display:flex;">Some text <span style="color:red;">and an element</span></div>`;
const mixedRuns = findTextRuns(mixed);
check(
  "mixed content offers only the pure-text child, never the mixed parent",
  mixedRuns.length === 1 && mixedRuns[0].text === "and an element",
);

// ── the hit map ──
const band = pickBand(SLIDE);
check("a band is chosen that the design does not use", band === 0xfe);
check(
  "a design using the first band gets a different one",
  pickBand(`<div style="background:#fe0000;">x</div>`) !== 0xfe,
);

const { html: hitHtml, runs: hitRuns } = buildHitMapHtml(SLIDE, band);
check("the hit map encodes the same runs", hitRuns.length === runs.length);
check("each run gets its own colour", hitHtml.includes(hitColour(0, band)) && hitHtml.includes(hitColour(1, band)));
check("text is hidden so only the region colour shows", (hitHtml.match(/color:transparent/g) ?? []).length === 2);
check("the existing style is kept, not replaced", hitHtml.includes("font-size:84px"));
check(
  "structure is untouched — same tags, same order",
  hitHtml.replace(/\sstyle="[^"]*"/g, "") === SLIDE.replace(/\sstyle="[^"]*"/g, ""),
);
check("the text itself is untouched", hitHtml.includes("It's not the oxygen."));

// An element with no style attribute at all still gets one.
const noStyle = buildHitMapHtml(`<div style="display:flex;"><span>Bare</span></div>`, band).html;
check("an element with no style attribute still gets a hit colour", noStyle.includes(`style="background-color:${hitColour(0, band)}`));

// Photos are blanked but keep their box.
const withPhoto = buildHitMapHtml(
  `<div style="display:flex;"><img src="{{PHOTO}}" style="width:1080px;height:600px;"/><span>Caption</span></div>`,
  band,
).html;
check("the photo token is replaced with a blank pixel", !withPhoto.includes("{{PHOTO}}"));
check("and the image keeps its box", withPhoto.includes("width:1080px;height:600px"));

// ── colour <-> index ──
check("index survives the colour round trip", indexFromColour(band, 0, 5, band) === 5);
check("a large index survives too", indexFromColour(band, 1, 44, band) === 300);
check("a colour outside the band is not a hit", indexFromColour(0x12, 0, 5, band) === null);

// ── hitIndexAt votes over a neighbourhood ──
const W = 9;
const H = 9;
const px = new Uint8ClampedArray(W * H * 4);
// Fill with the design's own background (not a hit), then paint run 3 into the
// left half — the boundary is where a naive single-pixel read goes wrong.
for (let i = 0; i < W * H; i++) {
  const x = i % W;
  const inRegion = x < 4;
  px[i * 4] = inRegion ? band : 0x12;
  px[i * 4 + 1] = 0;
  px[i * 4 + 2] = inRegion ? 3 : 0x34;
  px[i * 4 + 3] = 255;
}
check("a click inside a region resolves to its run", hitIndexAt(px, W, H, 1, 4, band) === 3);
check("a click well outside every region resolves to nothing", hitIndexAt(px, W, H, 8, 4, band) === null);
check("a click on the boundary still resolves to the region", hitIndexAt(px, W, H, 4, 4, band) === 3);

console.log(`\ntextRuns + hitMap: ${passed} checks passed`);
