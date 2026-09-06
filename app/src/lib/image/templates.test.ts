// Run: npm test -- src/lib/image/templates.test.ts
//
// Testability seam (architecture review, 2026-08-30): wrapLines/autoFitHeading
// used to take a live CanvasRenderingContext2D purely to call
// ctx.measureText(...).width — which welded the wrap/auto-fit math to the DOM
// canvas and meant this test runner (plain tsx, no jsdom/canvas) couldn't
// exercise it at all. Both now take a MeasureText port — `(text, font) =>
// width` — instead of a ctx, so they can be driven here with a deterministic
// FAKE measurer. canvasMeasure() is the production adapter that backs the
// port with a real canvas; every template creates one (`canvasMeasure(ctx)`)
// and passes it through. This is pure math — no DOM, no canvas, no jsdom.
import assert from "node:assert/strict";

import {
  HEADING_SCALE_MAX,
  HEADING_SCALE_MIN,
  autoFitHeading,
  canvasMeasure,
  clampHeadingScale,
  wrapLines,
  type MeasureText,
} from "./templates";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}
function eq(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(
    actual,
    expected,
    `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
  passed++;
  console.log("  ✓", name);
}

// A flat monospace metric — exactly the "(t) => t.length * 10" shape a fixed
// font size implies. Ignores the font string entirely, which is fine for
// wrapLines: it only ever measures against ONE font per call (the font
// parameter is constant across the whole wrap), so a flat per-char width is
// enough to make wrapping boundaries exactly hand-computable.
const flatMeasure: MeasureText = (text) => text.length * 10;

// autoFitHeading, by contrast, re-measures at a SHRINKING font size across
// iterations — a flat metric can't distinguish "fits at 20px" from "fits at
// 10px" since it would measure identically either way. This fake parses the
// px size out of the CSS font string (e.g. "600 20px Georgia" -> 20) and
// scales per-character width by it, so a smaller size measurably fits more
// text per line — same relationship real canvas text measurement has.
const sizedMeasure: MeasureText = (text, font) => {
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  return text.length * size;
};

// ── wrapLines: exact-width boundary (the `w > maxWidth` check is strict) ──
{
  // "AB" + " " + "CD" = 5 chars * 10px/char = 50 == maxWidth -> NOT > maxWidth,
  // so the two words stay combined on one line.
  eq(
    "wrapLines keeps words together when the combined width is EXACTLY maxWidth (not >)",
    wrapLines(flatMeasure, "400 10px monospace", "AB CD", 50),
    ["AB CD"],
  );
  // Same shape but one character longer ("CDE") pushes combined width to 60,
  // which IS > 50 -> wraps.
  eq(
    "wrapLines wraps as soon as the combined width exceeds maxWidth by even one unit",
    wrapLines(flatMeasure, "400 10px monospace", "AB CDE", 50),
    ["AB", "CDE"],
  );
}

// ── wrapLines: general word-wrap ──
{
  eq(
    "wrapLines wraps a run of words onto multiple lines at the width limit",
    wrapLines(flatMeasure, "400 10px monospace", "AAAAA BB CCC", 50),
    ["AAAAA", "BB", "CCC"],
  );
  eq(
    "wrapLines treats \\n as a hard paragraph break (never joins across it, even if it would fit)",
    wrapLines(flatMeasure, "400 10px monospace", "AAAAA BBBBB\nCC", 50),
    ["AAAAA", "BBBBB", "CC"],
  );
}

// ── wrapLines: a single word wider than maxWidth is never dropped or split ──
{
  eq(
    "wrapLines lets an over-width single word overflow its own line rather than dropping/splitting it",
    wrapLines(flatMeasure, "400 10px monospace", "SUPERLONGWORD", 10),
    ["SUPERLONGWORD"],
  );
}

// ── wrapLines: empty / whitespace-only text short-circuits to [] ──
{
  eq("wrapLines('') -> []", wrapLines(flatMeasure, "400 10px monospace", "", 500), []);
  eq(
    "wrapLines(whitespace-only) -> [] (never measures)",
    wrapLines(flatMeasure, "400 10px monospace", "   \n  ", 500),
    [],
  );
}

// ── wrapLines: the font string is threaded through unchanged to every
//    measure() call — this is what makes canvasMeasure's ctx.font side
//    effect land correctly (see canvasMeasure section below) ──
{
  const seenFonts: string[] = [];
  const spy: MeasureText = (text, font) => {
    seenFonts.push(font);
    return flatMeasure(text, font);
  };
  wrapLines(spy, "italic 600 14px Georgia", "one two three four five", 1000);
  ok(
    "wrapLines calls measure() with the SAME font string for every word in the call",
    seenFonts.length > 0 && seenFonts.every((f) => f === "italic 600 14px Georgia"),
  );
}

// ── wrapLines -> .slice(0, N): the truncation pattern every template uses ──
{
  // 5 words, each exactly maxWidth wide alone (50) and always > maxWidth
  // combined with a neighbour -> one word per line, 5 lines total.
  const lines = wrapLines(
    flatMeasure,
    "400 10px monospace",
    "AAAAA BBBBB CCCCC DDDDD EEEEE",
    50,
  );
  eq("wrapLines produces all 5 lines before any truncation", lines, [
    "AAAAA",
    "BBBBB",
    "CCCCC",
    "DDDDD",
    "EEEEE",
  ]);
  eq(
    "…and .slice(0, N) — the truncation every template applies — keeps only the first N, silently drops the rest",
    lines.slice(0, 3),
    ["AAAAA", "BBBBB", "CCCCC"],
  );
}

// ── autoFitHeading: shrinks the font size step-by-step (by 2px) until the
//    wrap fits within maxLines, then stops at the FIRST size that fits ──
{
  // "ONE TWO THREE FOUR" wraps to 4 lines at 20/18/16px, 3 lines at 14/12px,
  // and finally 2 lines at 10px (hand-verified against sizedMeasure's
  // length*size metric) — so with maxLines=2 the loop must walk all the way
  // down from 20 to 10 before it succeeds.
  const fit = autoFitHeading(sizedMeasure, "ONE TWO THREE FOUR", "400", "TestFont", 20, 10, 100, 2, 1);
  eq("autoFitHeading shrinks from startSize down to the size that first satisfies maxLines", fit.size, 10);
  eq("...and returns the lines wrapped at THAT size", fit.lines, ["ONE TWO", "THREE FOUR"]);
  ok("...which does satisfy the maxLines cap", fit.lines.length <= 2);
}

// ── autoFitHeading: when startSize already fits, it returns immediately
//    without shrinking ──
{
  const fit = autoFitHeading(sizedMeasure, "SHORT", "400", "TestFont", 20, 10, 1000, 3, 1);
  eq("autoFitHeading doesn't shrink when startSize already satisfies maxLines", fit.size, 20);
  eq("...lines wrapped at startSize", fit.lines, ["SHORT"]);
}

// ── autoFitHeading: max-lines cap that's NOT achievable even at minSize —
//    gives up honestly and returns minSize's wrap (which may still exceed
//    maxLines) rather than looping forever or fabricating a fit ──
{
  // Same text as the shrink-succeeds case, but maxLines=1: even minSize=6
  // only gets it to 2 lines (verified: 18 chars * 6px/char = 108 > 100 for
  // all four words combined, so it can never reach exactly 1 line here).
  const fit = autoFitHeading(sizedMeasure, "ONE TWO THREE FOUR", "400", "TestFont", 20, 6, 100, 1, 1);
  eq("autoFitHeading falls back to minSize when maxLines is unreachable", fit.size, 6);
  eq("...returning minSize's wrap even though it still exceeds maxLines", fit.lines, ["ONE TWO THREE", "FOUR"]);
  ok("...(this is the honest-overflow case: more lines than maxLines asked for)", fit.lines.length > 1);
}

// ── autoFitHeading: empty/whitespace-only text returns startSize immediately
//    with no lines (wrapLines short-circuits before ever calling measure) ──
{
  const fit = autoFitHeading(sizedMeasure, "   ", "400", "TestFont", 40, 10, 500, 3, 1);
  eq("autoFitHeading(whitespace-only) returns startSize (0 lines always satisfies maxLines)", fit.size, 40);
  eq("...with no lines", fit.lines, []);
}

// ── autoFitHeading: the font string handed to measure() is always exactly
//    `${weight} ${size}px ${family}` — the same construction the pre-seam
//    code used for ctx.font, now passed explicitly instead of mutating ctx ──
{
  const seenFonts: string[] = [];
  const spy: MeasureText = (text, font) => {
    seenFonts.push(font);
    return sizedMeasure(text, font);
  };
  autoFitHeading(spy, "HELLO WORLD", "600", "Georgia", 20, 10, 10000, 5, 1);
  ok(
    "autoFitHeading builds the font string as `${weight} ${size}px ${family}`",
    seenFonts.length > 0 && seenFonts.every((f) => f === "600 20px Georgia"),
  );
}

// ── autoFitHeading: the operator's heading-size override ───────────────────
//
// Templates auto-fit DOWNWARDS from a fixed start size, so a short heading —
// a carousel cover, say — renders at exactly startSize even when there's room
// for much more. The scale raises that ceiling. It's applied to the SEARCH
// RANGE, not to the result: scaling the result would return a size whose line
// count was measured for the smaller font, and the heading would overflow the
// block the template laid out for it.
{
  // "SHORT" fits on one line at any size here, so it lands on the ceiling.
  const plain = autoFitHeading(sizedMeasure, "SHORT", "400", "TestFont", 20, 10, 1000, 3, 1);
  const bigger = autoFitHeading(sizedMeasure, "SHORT", "400", "TestFont", 20, 10, 1000, 3, 1.5);
  eq("a short heading normally stops at startSize, however much room it has", plain.size, 20);
  eq("...and scaling up lets it grow into that room", bigger.size, 30);
  eq("...still on one line — the scale buys size, not extra lines", bigger.lines, ["SHORT"]);
}
{
  const smaller = autoFitHeading(sizedMeasure, "SHORT", "400", "TestFont", 20, 10, 1000, 3, 0.8);
  eq("scaling down lowers the ceiling too", smaller.size, 16);
}
{
  // The maxLines contract has to survive scaling, or a bigger heading silently
  // spills past the space the template reserved.
  const fit = autoFitHeading(sizedMeasure, "ONE TWO THREE FOUR", "400", "TestFont", 20, 10, 100, 2, 1.5);
  ok("a scaled-up heading still obeys maxLines", fit.lines.length <= 2);
  ok("...by shrinking below its raised ceiling when it has to", fit.size < 30);
}
{
  // The floor must NOT move when scaling up. It is the whole reason a long
  // heading fits at all, so lifting it makes a heading that used to fit spill
  // onto extra lines. This caught exactly that: scaling the floor too made
  // this case overflow from 2 lines to 4.
  const plain = autoFitHeading(sizedMeasure, "ONE TWO THREE FOUR", "400", "TestFont", 20, 6, 100, 1, 1);
  const bigger = autoFitHeading(sizedMeasure, "ONE TWO THREE FOUR", "400", "TestFont", 20, 6, 100, 1, 1.5);
  eq("an unreachable maxLines bottoms out at minSize", plain.size, 6);
  eq("...and scaling up cannot lift that floor", bigger.size, 6);
  eq("...so a bottomed-out heading wraps identically however big you ask for", bigger.lines, plain.lines);
}
{
  // Scaling DOWN does lower the floor, or the request is silently ignored on
  // templates whose minimum sits close to their start size.
  const small = autoFitHeading(sizedMeasure, "SHORT", "400", "TestFont", 20, 18, 1000, 3, 0.7);
  eq("scaling down can go below the template's own minimum", small.size, 14);
}
{
  // Out-of-range values are clamped rather than trusted, so a bad stored value
  // can't render a 400px heading or a zero-size one.
  eq("a scale above the maximum clamps", clampHeadingScale(99), HEADING_SCALE_MAX);
  eq("a scale below the minimum clamps", clampHeadingScale(0), HEADING_SCALE_MIN);
  eq("a missing scale means the template's own size", clampHeadingScale(undefined), 1);
  eq("a null scale means the template's own size", clampHeadingScale(null), 1);
  eq("NaN means the template's own size", clampHeadingScale(Number.NaN), 1);
  const wild = autoFitHeading(sizedMeasure, "SHORT", "400", "TestFont", 20, 10, 1000, 3, 999);
  eq("...and the renderer clamps too, rather than trusting its caller", wild.size, Math.round(20 * HEADING_SCALE_MAX));
}
{
  // Scale 1 must be byte-identical to the old behaviour, or every existing
  // slide in the fleet re-renders slightly differently after this ships.
  const cases: Array<[string, number, number, number, number]> = [
    ["ONE TWO THREE FOUR", 20, 10, 100, 2],
    ["SHORT", 20, 10, 1000, 3],
    ["ONE TWO THREE FOUR", 20, 6, 100, 1],
    ["   ", 40, 10, 500, 3],
  ];
  let drift = "";
  for (const [text, start, min, width, maxLines] of cases) {
    const fit = autoFitHeading(sizedMeasure, text, "400", "TestFont", start, min, width, maxLines, 1);
    // Recompute what the pre-scale loop would have produced.
    let size = start;
    let lines = wrapLines(sizedMeasure, `400 ${size}px TestFont`, text, width);
    while (size >= min && lines.length > maxLines) {
      size -= 2;
      lines = wrapLines(sizedMeasure, `400 ${size}px TestFont`, text, width);
    }
    const expected = size >= min ? size : min;
    if (fit.size !== expected) drift = `${text} -> ${fit.size} vs ${expected}`;
  }
  eq("scale 1 reproduces the unscaled result exactly", drift, "");
}

// ── canvasMeasure: the production MeasureText adapter. Confirms it (a) sets
//    ctx.font to the exact string passed in BEFORE measuring — reproducing
//    both the returned width and the "ctx.font left set to the last-measured
//    font" side effect the pre-seam code had — and (b) returns
//    ctx.measureText(text).width unchanged. A minimal fake stands in for the
//    canvas context: only .font and .measureText are ever touched. ──
{
  const calls: Array<{ fontAtCallTime: string; text: string }> = [];
  // Referenced by name (not `this`) from inside its own method — a plain
  // closure capture, which sidesteps `this`-typing inference entirely and
  // keeps `fakeCtx.font` a plain `string` throughout.
  const fakeCtx = {
    font: "",
    measureText(text: string) {
      calls.push({ fontAtCallTime: fakeCtx.font, text });
      return { width: text.length * 7 };
    },
  };
  const measure = canvasMeasure(fakeCtx as unknown as CanvasRenderingContext2D);
  const width = measure("hello", "700 20px Georgia");

  ok("canvasMeasure sets ctx.font to the exact font string passed in", fakeCtx.font === "700 20px Georgia");
  eq("canvasMeasure returns ctx.measureText(text).width unchanged", width, 35);
  ok(
    "canvasMeasure sets ctx.font BEFORE calling measureText (not after)",
    calls.length === 1 && calls[0].fontAtCallTime === "700 20px Georgia" && calls[0].text === "hello",
  );

  // ctx.font is left set to the last-measured font after the call returns —
  // exactly the side effect every template's render() used to get for free
  // from the old ctx-mutating wrapLines/autoFitHeading.
  measure("x", "italic 400 12px Arial");
  ok("ctx.font is left set to the LAST font measure() was called with", fakeCtx.font === "italic 400 12px Arial");
}

console.log(`\ntemplates: ${passed} checks passed.`);
