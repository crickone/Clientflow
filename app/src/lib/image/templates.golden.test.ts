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
// HOW IT CAPTURES A RENDER, and why not pixels: see ./recordingContext.ts —
// it instruments the EXISTING render path rather than inventing a second one,
// capturing the ordered sequence of draw calls instead of rasterising.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CarouselSlide } from "@/lib/db/schema";
import { paintSlide } from "@/lib/image/paintSlide";
import { fakeImage, makeContext, type FakeImage } from "@/lib/image/recordingContext";
import { TEMPLATES } from "@/lib/image/templates";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// -------------------------------------------------------------------------
//  Fixtures
// -------------------------------------------------------------------------

const PHOTO: FakeImage = fakeImage("photo", 1600, 1200);
const LOGO: FakeImage = fakeImage("logo", 512, 128);

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
