// Run: npm test -- src/lib/design/layoutBoxes.test.ts
//
// Reading satori's laid-out geometry back out of its SVG, and the comparison
// that turns it into a violation the repair loop can act on.
//
// The case at the bottom is the real one: slide 62 of Optimal Health's set 13,
// exactly as a generation wrote it. Its heading budgets for one line, wraps to
// two, and lands on its own body text. It is rendered here through real satori
// and real fonts, because the whole point of this module is that it measures
// rather than estimates -- a fixture SVG could only pin the parsing, never the
// fact that satori and this module agree about where things are.
import assert from "node:assert/strict";

import { loadDesignFonts } from "./fonts";
import {
  collisionViolation,
  laidOutBoxes,
  textBlocks,
  textCollisions,
} from "./layoutBoxes";
import { renderDesignToSvg } from "./renderDesign";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------
const SVG = [
  '<svg width="1080" height="1080">',
  '<mask id="satori_om-id"><rect x="0" y="0" width="1080" height="1080" fill="#fff"/></mask>',
  '<mask id="satori_om-id-0"><rect x="0" y="0" width="1080" height="1080" fill="#fff"/></mask>',
  '<mask id="satori_om-id-0-3"><rect x="76" y="775" width="860" height="102" fill="#fff"/></mask>',
  '<mask id="satori_om-id-0-4"><rect x="76" y="860" width="760" height="96" fill="#fff"/></mask>',
  "</svg>",
].join("");

{
  const boxes = laidOutBoxes(SVG);
  check("the root is keyed by the empty path", boxes.get("")?.height === 1080);
  check(
    "a nested element is keyed by its path, not its raw id",
    boxes.get("0-3")?.y === 775 && boxes.get("0-3")?.height === 102,
  );
  check("an absent path is absent, not a guess", boxes.get("9-9") === undefined);
  check("no boxes come out of markup with no masks", laidOutBoxes("<svg/>").size === 0);
}

// ---------------------------------------------------------------------------
// Walking the tree for text blocks
// ---------------------------------------------------------------------------
const leaf = (text: string) => ({ type: "div", props: { children: text } });
const box = (...children: unknown[]) => ({ type: "div", props: { children } });

{
  // Shaped like the real thing: satori-html wraps the markup in a div of its
  // own, and THAT wrapper is the root satori numbers from -- so the design's
  // own outer element is "0" and its blocks are "0-0", "0-1", ...
  const tree = box(box(leaf("a"), leaf("b"), box(leaf("c"))));
  const found = textBlocks(tree);
  check(
    "the design's own root is 0, so its first block is 0-0",
    found[0].path === "0-0" && found[0].text === "a",
  );
  check("siblings advance the last index", found[1].path === "0-1");
  check("nesting adds a level", found[2].path === "0-2-0" && found[2].text === "c");
  check("only leaves are reported", found.length === 3);
}
check(
  "an element holding both text and an element is not a leaf",
  textBlocks(box(box({ type: "div", props: { children: ["text", leaf("x")] } }))).every(
    (b) => b.text !== "text",
  ),
);
check("blank text is not a block anyone can see collide", textBlocks(box(box(leaf("   ")))).length === 0);

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------
{
  const blocks = [
    { path: "0-3", text: "Radiant warmth, nothing enclosing you" },
    { path: "0-4", text: "You lie on a bed that radiates gentle heat" },
  ];
  const hits = textCollisions(SVG, blocks);
  check("the overlap is found", hits.length === 1);
  check("its size is the real one -- 877 reaches 17px past 860", hits[0].overlapPx === 17);
  check("the block higher up the canvas is named as the upper one", hits[0].upper.startsWith("Radiant"));
}
{
  // Same vertical band, different columns. An ordinary two-column layout, and
  // flagging it would send the repair loop after designs that are correct.
  const twoColumn =
    '<mask id="satori_om-id-0-0"><rect x="76" y="400" width="400" height="120" /></mask>' +
    '<mask id="satori_om-id-0-1"><rect x="600" y="400" width="400" height="120" /></mask>';
  const hits = textCollisions(twoColumn, [
    { path: "0-0", text: "left" },
    { path: "0-1", text: "right" },
  ]);
  check("two columns sharing a band do not collide", hits.length === 0);
}
{
  const abutting =
    '<mask id="satori_om-id-0-0"><rect x="76" y="100" width="400" height="100" /></mask>' +
    '<mask id="satori_om-id-0-1"><rect x="76" y="200" width="400" height="100" /></mask>';
  check(
    "blocks that abut exactly are not a collision",
    textCollisions(abutting, [
      { path: "0-0", text: "a" },
      { path: "0-1", text: "b" },
    ]).length === 0,
  );
}
check(
  "a block with no box in the SVG is skipped rather than assumed",
  textCollisions(SVG, [{ path: "7-7", text: "unrendered" }]).length === 0,
);

check(
  "the violation names both blocks and tells the model what to do instead",
  (() => {
    const v = collisionViolation([{ upper: "Radiant warmth", lower: "You lie on a bed", overlapPx: 17 }]);
    return (
      v.includes("Radiant warmth") &&
      v.includes("You lie on a bed") &&
      v.includes("17px") &&
      v.includes("flex-direction:column")
    );
  })(),
);

// ---------------------------------------------------------------------------
// The real slide, through real satori. This is the case the module exists for.
// ---------------------------------------------------------------------------
const SLIDE_62 =
  '<div style="width:1080px;height:1080px;display:flex;flex-direction:column;position:relative;font-family:Inter">' +
  '<div style="position:absolute;top:700px;left:0px;width:1080px;height:380px;background:#f2f3ed"></div>' +
  '<div style="position:absolute;top:740px;left:76px;width:400px;font-size:15px;line-height:1;letter-spacing:0.2em;font-weight:600;color:#5e6b4e">INFRARED THERAPY</div>' +
  '<div style="position:absolute;top:775px;left:76px;width:860px;font-size:50px;line-height:1.02;letter-spacing:-0.03em;font-weight:600;color:#24231f">Radiant warmth, nothing enclosing you</div>' +
  '<div style="position:absolute;top:860px;left:76px;width:760px;font-size:21px;line-height:1.52;color:#24231f">You lie on a bed that radiates gentle heat through the skin. Fifteen minutes, open, no seal — many people read, close their eyes, or just let the warmth work through tired muscles.</div>' +
  "</div>";

(async () => {
  const fonts = await loadDesignFonts("Inter");
  const { svg, nodes } = await renderDesignToSvg(SLIDE_62, 1080, 1080, fonts);

  const boxes = laidOutBoxes(svg);
  check(
    "satori still keys its overflow masks by path -- the scheme this module reads",
    boxes.size > 0 && boxes.has("0-0"),
  );
  check(
    "the heading's MEASURED height is two lines (102px), not the one line its top budgeted for",
    boxes.get("0-2")?.height === 102 && boxes.get("0-2")?.y === 775,
  );

  const blocks = textBlocks(nodes);
  check(
    "the tree walk lands on the same elements satori numbered",
    blocks.some((b) => b.path === "0-2" && b.text.startsWith("Radiant warmth")),
  );

  const hits = textCollisions(svg, blocks);
  check(
    "the real slide's real collision is found, at the size on screen",
    hits.length === 1 && hits[0].overlapPx === 17,
  );

  // The fix the violation asks for, applied: one positioned column with a gap.
  const REPAIRED =
    '<div style="width:1080px;height:1080px;display:flex;flex-direction:column;position:relative;font-family:Inter">' +
    '<div style="position:absolute;top:700px;left:0px;width:1080px;height:380px;background:#f2f3ed"></div>' +
    '<div style="position:absolute;top:740px;left:76px;width:860px;display:flex;flex-direction:column;gap:20px">' +
    '<div style="font-size:15px;line-height:1;letter-spacing:0.2em;font-weight:600;color:#5e6b4e">INFRARED THERAPY</div>' +
    '<div style="font-size:50px;line-height:1.02;letter-spacing:-0.03em;font-weight:600;color:#24231f">Radiant warmth, nothing enclosing you</div>' +
    '<div style="font-size:21px;line-height:1.52;color:#24231f">You lie on a bed that radiates gentle heat through the skin. Fifteen minutes, open, no seal — many people read, close their eyes, or just let the warmth work through tired muscles.</div>' +
    "</div></div>";
  const fixed = await renderDesignToSvg(REPAIRED, 1080, 1080, fonts);
  check(
    "the same content in a flowed column does not collide, whatever it wraps to",
    textCollisions(fixed.svg, textBlocks(fixed.nodes)).length === 0,
  );

  console.log(`\nlayoutBoxes: ${passed} checks passed`);
})();
