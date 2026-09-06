// Run: npm test -- src/lib/image/chrome.test.ts
//
// paintSlideChrome (architecture review, 2026-08-30) is the deep module that
// now draws every carousel slide's chrome (brand credit, slide indicator,
// "SWIPE →" hint) AND places the tenant logo — measured against what it just
// drew, instead of a static per-template corner enum. `measure` is the same
// MeasureText port templates.ts already uses for body text (see
// templates.test.ts): a plain `(text, font) => width` function, so this file
// drives paintSlideChrome with a deterministic FAKE measurer and a minimal
// recording canvas stub — no jsdom, no real <canvas>.
//
// What's under test is specifically the MEASURED logo-corner rule: does the
// logo stay at its preferred corner when nothing paintSlideChrome draws
// would collide with it, and does it move to the other top corner when the
// (fake-)measured chrome is wide enough to reach in? A few extra checks
// cover the exact chrome text (the double-space "NAME  ·  LOCALITY" /
// "SWIPE  →" strings every carousel used to hand-roll slightly differently)
// and the tagline-overrides-the-fallback rule.
import assert from "node:assert/strict";

import {
  paintSlideChrome,
  type ChromeIntent,
  type DesignState,
  type FontFamilies,
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

// ── Fakes ──────────────────────────────────────────────────────────────
//
// A minimal recording canvas stub. paintSlideChrome calls ctx.save/restore,
// sets font/textAlign/textBaseline/fillStyle, and calls fillText for each
// chrome piece it draws — then, when it places the logo, calls the REAL
// (unmodified) drawLogoOverlay(), which itself calls ctx.save/restore again
// plus ctx.shadow*/globalAlpha and ctx.drawImage(logo, x, y, w, h). That
// drawImage call is the signal this file reads to see which corner the logo
// actually landed at.
type Call = { method: string; args: unknown[] };

function fakeCtx() {
  const calls: Call[] = [];
  const stub = {
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    fillStyle: "#000000",
    globalAlpha: 1,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    save() {
      calls.push({ method: "save", args: [] });
    },
    restore() {
      calls.push({ method: "restore", args: [] });
    },
    fillText(text: string, x: number, y: number) {
      calls.push({ method: "fillText", args: [text, x, y] });
    },
    drawImage(...args: unknown[]) {
      calls.push({ method: "drawImage", args });
    },
  };
  return { ctx: stub as unknown as CanvasRenderingContext2D, calls };
}

function fakeLogo(naturalWidth: number, naturalHeight: number): HTMLImageElement {
  return {
    naturalWidth,
    naturalHeight,
    width: naturalWidth,
    height: naturalHeight,
  } as unknown as HTMLImageElement;
}

function baseDesign(overrides: Partial<DesignState> = {}): DesignState {
  return {
    headingText: "Heading",
    bodyText: "Body",
    tagline: null,
    accentColor: "#3366ff",
    backgroundFit: "cover",
    backgroundOffsetX: 0.5,
    backgroundOffsetY: 0.5,
    headingScale: 1,
    backgroundZoom: 1,
    businessName: "Renova",
    location: "Park, Clonmel, Co. Tipperary",
    ...overrides,
  };
}

const fonts: FontFamilies = { heading: "TestHeading", body: "TestBody" };

// Last drawImage call's args — [logo, x, y, w, h] — the resolved logo box.
function lastDrawImage(calls: Call[]): unknown[] | undefined {
  const call = [...calls].reverse().find((c) => c.method === "drawImage");
  return call?.args;
}

// A 4:1 wordmark logo (400x100) — a realistic wide tenant logo shape.
const LOGO = fakeLogo(400, 100);
const W = 1080;
const H = 1080;

// Hand-verified logo geometry at W=H=1080 (mirrors drawLogoOverlay's own
// margin/drawH/drawW/maxW math, since paintSlideChrome's corner-picker has
// to predict the same box drawLogoOverlay will paint):
//   margin = round(1080*0.04) = 43
//   drawH  = round(1080*0.055) = 59
//   drawW  = round((400/100) * 59) = 236   (<= maxW = round(1080*0.22) = 238,
//                                            so no clamping)
//   top-left box:   x: 43..279,  y: 43..102
//   top-center box: x: (1080-236)/2=422..658, y: 43..102
const TOP_LEFT_X = 43;
const TOP_CENTER_X = 422;
const LOGO_Y = 43;
const LOGO_W = 236;
const LOGO_H = 59;

// The top-right indicator is right-aligned at anchorX = W-padX = 1080-92 =
// 988 (default inset 0.085 -> padX = round(1080*0.085) = 92), so its box is
// [988-width, 988]. For it to reach the top-center box's right edge (658) it
// needs width >= 988-658 = 330; to also clear top-left's right edge (279) it
// needs width < 988-279 = 709.

// ── preferred corner kept when chrome is short (top-center variant) ─────
{
  // carousel-cta's actual chrome shape: indicator only, top-center logo,
  // centre-aligned. A flat 80px measurer is nowhere near the ~330px the
  // indicator would need to reach the top-center logo box.
  const intent: ChromeIntent = {
    indicator: "05 / 05",
    ink: "auto",
    logo: "top-center",
    align: "center",
  };
  const shortMeasure: MeasureText = () => 80;
  const { ctx, calls } = fakeCtx();
  paintSlideChrome(ctx, W, H, intent, shortMeasure, fonts, baseDesign(), LOGO);
  const draw = lastDrawImage(calls);
  ok("logo drawImage call happened", draw !== undefined);
  eq(
    "preferred top-center corner is KEPT when the indicator is short enough not to reach it",
    draw && [draw[1], draw[2], draw[3], draw[4]],
    [TOP_CENTER_X, LOGO_Y, LOGO_W, LOGO_H],
  );
}

// ── preferred corner kept when chrome is short (top-left variant) ───────
{
  // question-hook/carousel-cover's shape: brand (bottom-left) + indicator
  // (top-right) + swipe (bottom-right), all short — none of them come
  // anywhere near a top-left logo.
  const intent: ChromeIntent = {
    brand: "name",
    indicator: "01 / 05",
    swipe: true,
    ink: "light",
    logo: "top-left",
  };
  const shortMeasure: MeasureText = () => 80;
  const { ctx, calls } = fakeCtx();
  paintSlideChrome(ctx, W, H, intent, shortMeasure, fonts, baseDesign(), LOGO);
  const draw = lastDrawImage(calls);
  eq(
    "preferred top-left corner is KEPT when brand/indicator/swipe are all short",
    draw && [draw[1], draw[2]],
    [TOP_LEFT_X, LOGO_Y],
  );
}

// ── shifts to the other top corner when measured chrome is wide enough to
//    collide ──
{
  const intent: ChromeIntent = {
    indicator: "05 / 05",
    ink: "auto",
    logo: "top-center",
    align: "center",
  };
  // 500px-wide indicator: box = [988-500, 988] = [488, 988] — overlaps the
  // top-center logo box (488 < 658) but clears the top-left box (488 > 279).
  const wideMeasure: MeasureText = () => 500;
  const { ctx, calls } = fakeCtx();
  paintSlideChrome(ctx, W, H, intent, wideMeasure, fonts, baseDesign(), LOGO);
  const draw = lastDrawImage(calls);
  eq(
    "logo SHIFTS from top-center to top-left when the measured indicator box would overlap it",
    draw && [draw[1], draw[2], draw[3], draw[4]],
    [TOP_LEFT_X, LOGO_Y, LOGO_W, LOGO_H],
  );
}

// ── falls back to the originally-preferred corner when BOTH top corners
//    would collide — an extreme case (only reachable with a very long
//    user-entered tagline), better to keep the logo visible on top of text
//    than to lose it between two bad options ──
{
  const intent: ChromeIntent = {
    indicator: "05 / 05",
    ink: "auto",
    logo: "top-center",
    align: "center",
  };
  // 950px-wide indicator: box = [988-950, 988] = [38, 988] — overlaps BOTH
  // the top-left box (43..279) and the top-center box (422..658).
  const extremeMeasure: MeasureText = () => 950;
  const { ctx, calls } = fakeCtx();
  paintSlideChrome(ctx, W, H, intent, extremeMeasure, fonts, baseDesign(), LOGO);
  const draw = lastDrawImage(calls);
  eq(
    "logo KEEPS the preferred corner when neither top corner is clear",
    draw && [draw[1], draw[2]],
    [TOP_CENTER_X, LOGO_Y],
  );
}

// ── `align` picks the default logo corner when `logo` itself is omitted ──
{
  const shortMeasure: MeasureText = () => 80;
  {
    const { ctx, calls } = fakeCtx();
    paintSlideChrome(ctx, W, H, { align: "center" }, shortMeasure, fonts, baseDesign(), LOGO);
    const draw = lastDrawImage(calls);
    eq(
      "align:'center' with no `logo` set defaults the logo to top-center",
      draw && [draw[1], draw[2]],
      [TOP_CENTER_X, LOGO_Y],
    );
  }
  {
    const { ctx, calls } = fakeCtx();
    paintSlideChrome(ctx, W, H, {}, shortMeasure, fonts, baseDesign(), LOGO);
    const draw = lastDrawImage(calls);
    eq(
      "no `align` and no `logo` defaults to top-left",
      draw && [draw[1], draw[2]],
      [TOP_LEFT_X, LOGO_Y],
    );
  }
}

// ── no logo -> no drawImage call, no crash ──
{
  const { ctx, calls } = fakeCtx();
  paintSlideChrome(
    ctx,
    W,
    H,
    { brand: "name", indicator: "01 / 05", swipe: true, logo: "top-left" },
    () => 80,
    fonts,
    baseDesign(),
    null,
  );
  ok("no drawImage call when logo is null", lastDrawImage(calls) === undefined);
}

// ── chrome text: exact strings + the tagline-overrides-the-fallback rule ──
{
  const { ctx, calls } = fakeCtx();
  paintSlideChrome(
    ctx,
    W,
    H,
    { brand: "name-locality", indicator: "02", swipe: true, ink: "dark" },
    () => 80,
    fonts,
    baseDesign({ tagline: null }),
    null,
  );
  const fillTexts = calls.filter((c) => c.method === "fillText").map((c) => c.args[0]);
  eq(
    "brand:'name-locality' draws 'NAME  ·  LOCALITY' (double-space separator, matching every pre-consolidation carousel that used it)",
    fillTexts.includes("RENOVA  ·  CLONMEL"),
    true,
  );
  eq("swipe hint is always exactly 'SWIPE  →'", fillTexts.includes("SWIPE  →"), true);
  eq(
    "indicator falls back to the ChromeIntent string when design.tagline is blank",
    fillTexts.includes("02"),
    true,
  );
}
{
  const { ctx, calls } = fakeCtx();
  paintSlideChrome(ctx, W, H, { indicator: "02" }, () => 80, fonts, baseDesign({ tagline: "04 / 07" }), null);
  const fillTexts = calls.filter((c) => c.method === "fillText").map((c) => c.args[0]);
  eq("a non-blank design.tagline overrides the ChromeIntent fallback string", fillTexts, ["04 / 07"]);
}
{
  const { ctx, calls } = fakeCtx();
  paintSlideChrome(ctx, W, H, {}, () => 80, fonts, baseDesign(), null);
  eq(
    "an empty ChromeIntent draws no chrome text at all",
    calls.filter((c) => c.method === "fillText").length,
    0,
  );
}

console.log(`\nchrome: ${passed} checks passed.`);
