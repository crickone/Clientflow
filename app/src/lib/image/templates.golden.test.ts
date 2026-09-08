// Run: npm test -- src/lib/image/templates.golden.test.ts
//
// GOLDEN MASTER over every template's render path, through paintSlide.
//
// Why this exists: paintSlide is load-bearing — SlideCanvas (live preview) and
// renderSlideToBlob (PNG export) both call it, so the preview-equals-export
// invariant is only as safe as that one function. The AI-composed-design work
// forks inside paintSlide. This test is the regression that proves the
// existing templates came through that fork byte-for-byte unchanged.
//
// HOW IT CAPTURES A RENDER, and why not pixels: there is no server-side canvas
// in this app. paintSlide takes a CanvasRenderingContext2D and
// HTMLImageElements, and the only rasterising caller lives in the browser
// (ImageDesigner's renderSlideToBlob -> canvas.toBlob). Rather than invent a
// second render path — a native canvas dep whose antialiasing would differ
// between a Mac dev box and Linux CI, making a committed pixel hash unstable —
// this instruments the EXISTING path: a recording 2D context that captures the
// exact ordered sequence of drawing operations each template issues. That
// trace IS what our code does; rasterising it afterwards adds no information
// our code controls. It is exactly reproducible on any platform, needs no
// dependency, and on a mismatch gives a real line-by-line diff instead of two
// different hashes.
//
// Text measurement goes through the same MeasureText port templates.test.ts
// uses (see its header): canvasMeasure(ctx) calls ctx.measureText, and this
// context answers with a deterministic synthetic metric, so wrapLines and
// autoFitHeading run their real logic against stable widths.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CarouselSlide } from "@/lib/db/schema";
import { paintSlide } from "@/lib/image/paintSlide";
import { TEMPLATES } from "@/lib/image/templates";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// -------------------------------------------------------------------------
//  The recording context
// -------------------------------------------------------------------------

/** Every 2D-context member templates.ts touches. Kept exhaustive on purpose:
 *  an unrecognised call throws rather than silently vanishing from the trace,
 *  so a template reaching for a new primitive can't slip past unrecorded. */
const TRACKED_PROPS = [
  "fillStyle",
  "strokeStyle",
  "font",
  "textAlign",
  "textBaseline",
  "lineWidth",
  "lineCap",
  "lineJoin",
  "globalAlpha",
  "shadowColor",
  "shadowBlur",
  "shadowOffsetX",
  "shadowOffsetY",
] as const;

/** Stable rendering of a call argument. Numbers print at full precision —
 *  IEEE-754 arithmetic is exact and identical everywhere, so any difference in
 *  the printed value is a real difference in the layout maths, never noise. */
function arg(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : `!${v}`;
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "object" && v !== null && "__id" in v) {
    return String((v as { __id: unknown }).__id);
  }
  return JSON.stringify(v);
}

interface FakeImage {
  __id: string;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

class RecordingContext {
  readonly ops: string[] = [];
  private gradients = 0;
  private state: Record<string, unknown> = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    globalAlpha: 1,
    shadowColor: "rgba(0, 0, 0, 0)",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
  private stack: Record<string, unknown>[] = [];

  private record(line: string) {
    this.ops.push(line);
  }

  private call(name: string, ...args: unknown[]) {
    this.record(`${name}(${args.map(arg).join(", ")})`);
  }

  // Property access is proxied in makeContext() below; these back it.
  getProp(name: string): unknown {
    return this.state[name];
  }
  setProp(name: string, value: unknown) {
    // canvasMeasure() sets ctx.font on every single measurement, so recording
    // every assignment would bury the trace in repeats of one value. Only
    // CHANGES are recorded, which loses nothing: re-assigning the value a
    // property already holds cannot affect a single pixel. save()/restore()
    // move the current value too, which is why this.state is stacked.
    if (this.state[name] === value) return;
    this.state[name] = value;
    this.record(`${name} = ${arg(value)}`);
  }

  save() {
    this.stack.push({ ...this.state });
    this.call("save");
  }
  restore() {
    const prev = this.stack.pop();
    if (prev) this.state = prev;
    this.call("restore");
  }
  beginPath() {
    this.call("beginPath");
  }
  closePath() {
    this.call("closePath");
  }
  moveTo(x: number, y: number) {
    this.call("moveTo", x, y);
  }
  lineTo(x: number, y: number) {
    this.call("lineTo", x, y);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.call("quadraticCurveTo", cx, cy, x, y);
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean) {
    this.call("arc", x, y, r, a0, a1, ccw);
  }
  rect(x: number, y: number, w: number, h: number) {
    this.call("rect", x, y, w, h);
  }
  clip() {
    this.call("clip");
  }
  fill() {
    this.call("fill");
  }
  stroke() {
    this.call("stroke");
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.call("fillRect", x, y, w, h);
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.call("strokeRect", x, y, w, h);
  }
  fillText(text: string, x: number, y: number, maxWidth?: number) {
    this.call("fillText", text, x, y, maxWidth);
  }
  strokeText(text: string, x: number, y: number, maxWidth?: number) {
    this.call("strokeText", text, x, y, maxWidth);
  }
  drawImage(img: unknown, ...rest: number[]) {
    this.call("drawImage", img, ...rest);
  }
  measureText(text: string): { width: number } {
    const width = syntheticWidth(text, String(this.state.font));
    this.call("measureText", text, `-> ${width}`);
    return { width };
  }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
    const id = `linearGradient#${++this.gradients}`;
    this.call("createLinearGradient", x0, y0, x1, y1, `-> ${id}`);
    return this.gradient(id);
  }
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ) {
    const id = `radialGradient#${++this.gradients}`;
    this.call("createRadialGradient", x0, y0, r0, x1, y1, r1, `-> ${id}`);
    return this.gradient(id);
  }
  private gradient(id: string) {
    const self = this;
    return {
      __id: id,
      addColorStop(offset: number, color: string) {
        self.call(`${id}.addColorStop`, offset, color);
      },
    };
  }
}

/**
 * Synthetic text metric: proportional to the font's px size and the string
 * length. Deterministic, and varies with size — which is what autoFitHeading
 * needs to actually shrink (a flat per-char width would measure a 20px and a
 * 10px heading identically). Same trick as templates.test.ts's fake measurer.
 */
function syntheticWidth(text: string, font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  const size = m ? Number(m[1]) : 16;
  return text.length * size * 0.52;
}

/**
 * Wraps a RecordingContext so the TRACKED_PROPS behave as real context
 * properties (get returns the current value, set records the change) while
 * every method call passes straight through. Unknown members throw, so a
 * template reaching for something this recorder doesn't model fails loudly
 * instead of producing a quietly incomplete trace.
 */
function makeContext(): {
  ctx: CanvasRenderingContext2D;
  rec: RecordingContext;
} {
  const rec = new RecordingContext();
  const props = new Set<string>(TRACKED_PROPS);
  const proxy = new Proxy(rec, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (props.has(key)) return target.getProp(key);
      const value = (target as unknown as Record<string, unknown>)[key];
      if (typeof value === "function") return value.bind(target);
      if (value !== undefined) return value;
      throw new Error(`RecordingContext: unmodelled context member "${key}"`);
    },
    set(target, key, value) {
      if (typeof key === "string" && props.has(key)) {
        target.setProp(key, value);
        return true;
      }
      throw new Error(
        `RecordingContext: unmodelled context property "${String(key)}"`,
      );
    },
  });
  return { ctx: proxy as unknown as CanvasRenderingContext2D, rec };
}

// -------------------------------------------------------------------------
//  Fixtures
// -------------------------------------------------------------------------

const PHOTO: FakeImage = {
  __id: "photo",
  width: 1600,
  height: 1200,
  naturalWidth: 1600,
  naturalHeight: 1200,
};
const LOGO: FakeImage = {
  __id: "logo",
  width: 512,
  height: 128,
  naturalWidth: 512,
  naturalHeight: 128,
};

const FONTS = { heading: "Nebula", body: "Hanken Grotesk" };

const BRAND = {
  businessName: "Renova Cellular Health",
  website: "optimalhealthatinspire.ie",
  location: "Park, Clonmel, Co. Tipperary",
  phone: "083 867 2844",
};

/** One slide row, reused for every template so the trace difference between
 *  two runs can only come from the render code. The asterisks are deliberate:
 *  they exercise tokenizeHighlight on the templates that declare
 *  headingHighlight, and must render literally on the ones that don't. */
function slideFixture(over: Partial<CarouselSlide>): CarouselSlide {
  return {
    headingText: "Feel *stronger* in ninety days, not someday",
    bodyText:
      "Three sessions a week, a plan built around your own numbers, and a coach who checks in.\nNo guesswork, no crowds.",
    tagline: "WHERE TO START",
    accentColor: "#e8a33d",
    backgroundColor: "#101318",
    backgroundFit: "cover",
    backgroundOffsetX: 0.5,
    backgroundOffsetY: 0.4,
    backgroundZoom: 1.15,
    headingScale: 1,
    ...over,
  } as CarouselSlide;
}

/** Four passes per template, chosen so every branch paintSlide can take is
 *  actually walked — each of these was added because a deliberate mutation
 *  survived without it:
 *  - "photo": background image, cover fit, logo, explicit tagline, mid-carousel.
 *  - "flat": no image but a solid backgroundColour (paintBackground's solid
 *    branch), no logo, no tagline and total = 1 so autoTagline returns null,
 *    plus a heading-scale override.
 *  - "empty": no image AND no backgroundColour — the "drop a photo" placeholder
 *    gradient, which the other two never reach.
 *  - "contain": image with contain fit and no backgroundColour — the letterbox
 *    fill and the contain scale branch. */
const VARIANTS = [
  {
    key: "photo",
    slide: slideFixture({}),
    idx: 2,
    total: 5,
    bg: PHOTO,
    logo: LOGO,
  },
  {
    key: "flat",
    slide: slideFixture({ tagline: null, headingScale: 1.35 }),
    idx: 0,
    total: 1,
    bg: null,
    logo: null,
  },
  {
    key: "empty",
    slide: slideFixture({ backgroundColor: null, headingScale: 0.8 }),
    idx: 9,
    total: 12,
    bg: null,
    logo: LOGO,
  },
  {
    key: "contain",
    slide: slideFixture({
      backgroundColor: null,
      backgroundFit: "contain",
      backgroundZoom: 1,
      backgroundOffsetX: 0.25,
    }),
    idx: 1,
    total: 3,
    bg: PHOTO,
    logo: LOGO,
  },
] as const;

/** The full ordered draw-call trace for one template, across both variants. */
function traceTemplate(templateId: string): string[] {
  const template = TEMPLATES.find((t) => t.id === templateId);
  assert.ok(template, `unknown template ${templateId}`);
  const lines: string[] = [];
  for (const v of VARIANTS) {
    const { ctx, rec } = makeContext();
    paintSlide(
      ctx,
      template.width,
      template.height,
      { ...v.slide, templateId } as CarouselSlide,
      v.idx,
      v.total,
      BRAND,
      FONTS,
      v.bg as unknown as HTMLImageElement | null,
      v.logo as unknown as HTMLImageElement | null,
    );
    lines.push(`--- ${templateId} [${v.key}] ---`);
    lines.push(...rec.ops);
  }
  return lines;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// -------------------------------------------------------------------------
//  The test
// -------------------------------------------------------------------------

const GOLDEN_PATH = join(
  process.cwd(),
  "src/lib/image/templates.golden.json",
);

interface Golden {
  note: string;
  templates: Record<string, { ops: number; sha256: string }>;
}

const current: Golden["templates"] = {};
const traces: Record<string, string> = {};
for (const template of TEMPLATES) {
  const trace = traceTemplate(template.id).join("\n");
  traces[template.id] = trace;
  current[template.id] = { ops: trace.split("\n").length, sha256: sha256(trace) };
}

// Determinism: the same render, traced twice in the same process, must be
// identical. Cheap, and it catches any accidental dependence on module-level
// mutable state before the committed hashes are ever trusted.
let stable = true;
for (const template of TEMPLATES) {
  if (traceTemplate(template.id).join("\n") !== traces[template.id]) {
    stable = false;
    console.log(`  ! non-deterministic trace: ${template.id}`);
  }
}
check(`all ${TEMPLATES.length} template traces are deterministic`, stable);

check(
  "every template drew something",
  TEMPLATES.every((t) => current[t.id].ops > 5),
);

// GOLDEN_DUMP=<templateId> writes that template's full trace out to look at —
// the way to read what a render actually does, and what a drift changed.
if (process.env.GOLDEN_DUMP) {
  const id = process.env.GOLDEN_DUMP;
  const out = join(tmpdir(), `golden-trace-${id}.txt`);
  writeFileSync(out, traces[id] ?? `no such template: ${id}`);
  console.log(`  · trace for ${id} written to ${out}`);
}

if (process.env.UPDATE_GOLDEN === "1") {
  const golden: Golden = {
    note:
      "Golden master over every template's draw-call trace through paintSlide. " +
      "Regenerate deliberately with UPDATE_GOLDEN=1 npm test -- src/lib/image/templates.golden.test.ts, " +
      "and only when the render change is intended.",
    templates: current,
  };
  writeFileSync(GOLDEN_PATH, JSON.stringify(golden, null, 2) + "\n");
  console.log(`  · wrote ${GOLDEN_PATH}`);
}

const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as Golden;

const recorded = Object.keys(golden.templates).sort();
const live = TEMPLATES.map((t) => t.id).sort();
check(
  `golden covers all ${live.length} templates`,
  JSON.stringify(recorded) === JSON.stringify(live),
);

let drifted = 0;
for (const template of TEMPLATES) {
  const was = golden.templates[template.id];
  const now = current[template.id];
  if (!was) continue;
  if (was.sha256 !== now.sha256) {
    drifted++;
    console.log(
      `  ! DRIFT ${template.id}: ${was.ops} ops -> ${now.ops} ops (${was.sha256.slice(0, 12)} -> ${now.sha256.slice(0, 12)})`,
    );
    // Dump the trace so the change is diffable, not just detected.
    const out = join(tmpdir(), `golden-actual-${template.id}.txt`);
    writeFileSync(out, traces[template.id]);
    console.log(`    actual trace written to ${out}`);
  }
}
check("no template render drifted", drifted === 0);

console.log(`\n${passed} checks passed (${TEMPLATES.length} templates traced)`);
