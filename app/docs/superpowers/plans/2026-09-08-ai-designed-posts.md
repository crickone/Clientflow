# AI-Designed Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator asks for a post, and the AI *designs* it — composing its own layout as HTML from the tenant's design system — which is rendered server-side to a real PNG.

**Architecture:** The model emits an HTML document per slide, constrained by the tenant's design system in its prompt. `satori` turns that markup into SVG and `sharp` rasterises it to PNG, server-side, with no browser. The PNG is stored and shown in the editor, so preview and export are the *same bytes* rather than two code paths that agree. Editing is accept / regenerate / nudge — there are no inspector controls, because there is no fixed slot for them to point at. The 39 fixed templates are untouched and remain the fallback.

**Tech Stack:** `satori` (HTML/CSS subset → SVG), `satori-html` (HTML string → satori's node tree), `sharp` (already present, SVG → PNG), Anthropic SDK via the existing `meteredCreate`.

## Global Constraints

- **NO EMOJIS** anywhere — code, comments, UI copy, commit messages. `lucide-react` icons only.
- Run from `app/`. Gate before every commit: `npm run typecheck`, `npm test`, `npx next build`.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **One renderer.** Preview and export must both be the stored PNG. Never render the design a second way (a browser iframe, an HTML preview) — that reintroduces the drift the single `paintSlide` existed to prevent.
- Pure modules (`lib/design/*` except `system.ts`) keep **zero runtime imports** so they load under the plain tsx runner (`scripts/test.mjs`). Tests are `node:assert/strict` + a local `check(name, cond)` + a `console.log` summary. No framework.
- Multi-tenancy: a tenant with **no design system falls through to today's behaviour exactly** — fixed templates, no AI design. `getDesignSystem()` returning null is a first-class state.
- Satori constraints are load-bearing and must be stated in the prompt: **flexbox only** (no grid, no float), every element with children needs `display:flex`, **no CSS `filter`**, `<img>` sizing must be in `style` not attributes.
- Metering unchanged: `meteredCreate` (which calls `assertUnderCap` before and `recordUsage` after) wraps every paid call.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/lib/design/fonts.ts` | Load font bytes for satori from disk. Server-only. |
| `src/lib/design/renderDesign.ts` | `renderDesignToPng(html, w, h, fonts)`. The only renderer. Server-only. |
| `src/lib/design/htmlAudit.ts` | Pure. Parse emitted HTML, pull out colours, audit against the palette. Zero runtime imports. |
| `src/lib/design/htmlAudit.test.ts` | Tests for the above. |
| `src/lib/ai/designPost.parse.ts` | Pure. The prompt text, the reply extractor, the per-slide checker. |
| `src/lib/ai/designPost.parse.test.ts` | Tests for the above. |
| `src/lib/ai/designPost.ts` | Server-only. `designPost()` — the model calls, repair, and self-check. |
| `src/lib/image/renderStore.ts` | Write/read rendered PNGs on the volume. |
| `src/app/api/content-studio/renders/[filename]/route.ts` | Serve a stored render. |
| `app/public/fonts/Inter-{400,500,600,700}.ttf` | Real font bytes. Satori cannot use a CSS `@import`. |

**Modified**

| File | Change |
|---|---|
| `src/lib/db/schema.ts` | Add `designHtml`, `renderFilename` to `carouselSlides`. |
| `src/lib/db/tenant.ts` | Two additive PRAGMA-guarded migrations. |
| `src/lib/image/carousels.ts` | `AddSlideInput` carries the two new fields. |
| `src/app/api/content-studio/carousels/[id]/generate/route.ts` | Route to `designPost()` when a system exists. |
| `src/components/content-studio/ImageDesigner.tsx` | Designed slides show the render plus Regenerate/nudge. |
| `src/components/content-studio/SlideCanvas.tsx` | Show the stored render for a designed slide. |
| `Dockerfile` | Ensure satori's WASM assets reach the runtime image. |

**Deleted (Task 9)**

`src/lib/design/grammar.ts`, `grammar.test.ts`, `src/lib/image/paintLayout.ts`, `paintLayout.test.ts`, and the `COMPOSED_TEMPLATE_ID` branch in `paintSlide.ts`.

**Kept, unchanged:** `src/lib/design/parse.ts`, `presets.ts`, `system.ts`, `validate.ts` (contrast maths reused by `htmlAudit`), `src/lib/image/templates.ts` and all 39 templates, `templates.golden.test.ts` and `templates.golden.json`, `recordingContext.ts`, `TemplateGallery.tsx`, `StartTabs.tsx`.

---

### Task 1: Fonts and the renderer

**Why first:** everything downstream is unverifiable without a working render. This task ends with a real PNG on disk.

**Files:**
- Create: `src/lib/design/fonts.ts`, `src/lib/design/renderDesign.ts`
- Add: `public/fonts/Inter-400.ttf`, `-500`, `-600`, `-700`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadDesignFonts(family: string): Promise<DesignFont[]>` where `DesignFont = { name: string; data: Buffer; weight: 400|500|600|700; style: "normal" }`; `renderDesignToPng(html: string, width: number, height: number, fonts: DesignFont[]): Promise<Buffer>`.

- [ ] **Step 1: Install the two libraries**

```bash
cd app && npm install satori@0.33.4 satori-html@0.3.2
```

- [ ] **Step 2: Fetch Inter's real bytes into the repo**

Satori needs font *files*; it cannot resolve a Google Fonts stylesheet. Inter is the Sage Field system's stand-in for Neue Haas Grotesk Display.

```bash
cd app && mkdir -p public/fonts
for w in 400 500 600 700; do
  u=$(curl -s "https://fonts.googleapis.com/css2?family=Inter:wght@$w" | grep -o "https://fonts.gstatic.com[^)]*" | head -1)
  curl -sL "$u" -o "public/fonts/Inter-$w.ttf"
done
ls -la public/fonts
```

Expected: four files, each roughly 320-330KB.

- [ ] **Step 3: Write `src/lib/design/fonts.ts`**

```ts
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Font bytes for satori. It rasterises server-side with no browser, so a CSS
 * font stack means nothing to it -- it needs the actual file. The faces live in
 * public/fonts and are read once and cached for the process's life.
 */
export interface DesignFont {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600 | 700;
  style: "normal";
}

const WEIGHTS = [400, 500, 600, 700] as const;
const cache = new Map<string, DesignFont[]>();

/** Families with real bytes on disk. A design system naming anything else
 *  falls back to Inter rather than rendering in a silent default. */
export const AVAILABLE_FAMILIES = ["Inter"] as const;

export async function loadDesignFonts(family = "Inter"): Promise<DesignFont[]> {
  const name = (AVAILABLE_FAMILIES as readonly string[]).includes(family)
    ? family
    : "Inter";
  const hit = cache.get(name);
  if (hit) return hit;
  const dir = path.join(process.cwd(), "public", "fonts");
  const fonts = await Promise.all(
    WEIGHTS.map(async (weight) => ({
      name,
      data: await readFile(path.join(dir, `${name}-${weight}.ttf`)),
      weight,
      style: "normal" as const,
    })),
  );
  cache.set(name, fonts);
  return fonts;
}
```

- [ ] **Step 4: Write `src/lib/design/renderDesign.ts`**

```ts
import "server-only";
import satori from "satori";
import { html as toNodes } from "satori-html";
import sharp from "sharp";

import type { DesignFont } from "./fonts";

/**
 * THE ONLY RENDERER. A designed slide is HTML; this turns it into the PNG that
 * is both what the editor shows and what the operator exports. There is
 * deliberately no second path -- no browser preview of the same markup -- because
 * preview and export agreeing by construction is worth more than a live DOM.
 *
 * satori implements a SUBSET of CSS: flexbox only, every element with children
 * needs display:flex, no `filter`, and <img> sizing must be in `style`. Those
 * limits are stated in the generation prompt; this function does not paper over
 * them, because a design that silently loses a rule is worse than one that
 * fails loudly.
 */
export async function renderDesignToPng(
  html: string,
  width: number,
  height: number,
  fonts: DesignFont[],
): Promise<Buffer> {
  const svg = await satori(toNodes(html), { width, height, fonts });
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Grade a photograph to a design system's numbers BEFORE it is embedded.
 * satori has no CSS `filter`, so the brand's saturation/contrast/brightness
 * cannot be applied in markup -- it has to be baked into the pixels.
 * Returns a data URI, because satori cannot fetch a relative URL either.
 */
export async function gradedPhotoDataUri(
  source: Buffer | string,
  width: number,
  height: number,
  grade: { saturate: number; contrast: number; brightness: number } | null,
): Promise<string> {
  let img = sharp(source).resize(width, height, {
    fit: "cover",
    position: "attention",
  });
  if (grade) {
    img = img
      .modulate({ saturation: grade.saturate, brightness: grade.brightness })
      .linear(grade.contrast, 0);
  }
  const buf = await img.jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}
```

- [ ] **Step 5: Prove it renders — write `scripts/render-design-spike.mts`**

```ts
// Run: npx tsx scripts/render-design-spike.mts
// Writes /tmp/design-spike.png. This is a smoke test you LOOK at, not an
// assertion -- the point is that a real font, a real layout and a real
// rasteriser all line up.
import { writeFileSync } from "node:fs";
import { loadDesignFonts } from "../src/lib/design/fonts";
import { renderDesignToPng } from "../src/lib/design/renderDesign";

const fonts = await loadDesignFonts("Inter");
const png = await renderDesignToPng(
  `<div style="display:flex;width:1080px;height:1080px;background:#c7d2bb;font-family:Inter;position:relative">
     <div style="display:flex;flex-direction:column;position:absolute;left:76px;top:180px;width:820px">
       <div style="display:flex;width:132px;height:3px;background:#b0844f;margin-bottom:30px"></div>
       <div style="display:flex;font-size:104px;font-weight:600;color:#24231f;letter-spacing:-0.042em;line-height:0.97">It's not the oxygen. It's the pressure.</div>
     </div>
   </div>`,
  1080,
  1080,
  fonts,
);
writeFileSync("/tmp/design-spike.png", png);
console.log("wrote /tmp/design-spike.png", (png.length / 1024).toFixed(0) + "KB");
```

- [ ] **Step 6: Run it and LOOK at the output**

Run: `cd app && npx tsx scripts/render-design-spike.mts`
Expected: `wrote /tmp/design-spike.png` around 40-80KB. Open it. The heading must be **Inter at weight 600** on a sage ground with a timber rule — not a serif fallback, which is what a font that failed to load looks like.

- [ ] **Step 7: Commit**

```bash
git add app/package.json app/package-lock.json app/public/fonts app/src/lib/design/fonts.ts app/src/lib/design/renderDesign.ts app/scripts/render-design-spike.mts
git commit -m "feat(design): render AI-authored HTML to PNG, server-side, no browser"
```

---

### Task 2: Get the renderer into the deployed image

**Why now:** satori ships WASM (`yoga-layout`, `harfbuzzjs`). Next's output tracing follows `import` statements but has historically missed `.wasm` assets. Finding that out on Railway costs a deploy cycle; finding it out here costs a build.

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Check what tracing actually collected**

```bash
cd app && npx next build && \
  ls .next/standalone/node_modules/satori 2>/dev/null && \
  find .next/standalone/node_modules -name "*.wasm" | head
```

Expected: a `satori` directory and at least one `.wasm` file. **If either is missing, the runtime will throw at first render** and Step 2 is required. If both are present, note that in the commit message and skip Step 2.

- [ ] **Step 2: If missing, copy them explicitly**

The Dockerfile already hand-copies dependencies tracing cannot find (`better-sqlite3`, `ffmpeg-static`). Add satori beside them, after the existing `sharp` copy:

```dockerfile
# satori renders AI-authored HTML to SVG for the Content Studio. It is pure JS
# but its layout and shaping engines are WASM (yoga-layout, harfbuzzjs), which
# Next's output tracing does not always collect -- same reason better-sqlite3
# and ffmpeg-static are copied by hand above.
COPY --from=builder /app/node_modules/satori ./node_modules/satori
COPY --from=builder /app/node_modules/satori-html ./node_modules/satori-html
COPY --from=builder /app/node_modules/yoga-layout ./node_modules/yoga-layout
COPY --from=builder /app/node_modules/harfbuzzjs ./node_modules/harfbuzzjs
```

- [ ] **Step 3: Confirm the fonts ship**

`public/` is already copied wholesale (`COPY --from=builder /app/public ./public`), so `public/fonts` rides along. Verify:

```bash
grep -n "COPY --from=builder /app/public" Dockerfile
```

Expected: one match. If absent, add it.

- [ ] **Step 4: Build and commit**

Run: `cd app && npx next build`
Expected: `Compiled successfully`.

```bash
git add app/Dockerfile
git commit -m "build(design): ship satori and its WASM into the runtime image"
```

---

### Task 3: Storing and serving a render

**Files:**
- Create: `src/lib/image/renderStore.ts`, `src/app/api/content-studio/renders/[filename]/route.ts`
- Modify: `src/lib/db/schema.ts`, `src/lib/db/tenant.ts`, `src/lib/image/carousels.ts`

**Interfaces:**
- Consumes: `renderDesignToPng` (Task 1).
- Produces: `saveRender(png: Buffer): string` (returns the filename), `renderFilePath(filename: string): string`, `renderFileUrl(filename: string): string`, `deleteRender(filename: string): void`.

- [ ] **Step 1: Write `src/lib/image/renderStore.ts`**

```ts
import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Rendered slide PNGs, on the volume beside the image library rather than in
 * it: these are OUTPUT, and mixing them into the operator's own photo library
 * would put machine artefacts in the place they keep their pictures.
 *
 * The filename carries a content hash, so re-rendering identical markup
 * overwrites rather than accumulating, and a changed design always gets a new
 * URL -- which is what stops a browser showing a stale render after a
 * regenerate.
 */
const RENDER_ROOT = path.join(process.cwd(), "data", "renders");

export function renderDir(): string {
  if (!fs.existsSync(RENDER_ROOT)) {
    fs.mkdirSync(RENDER_ROOT, { recursive: true });
  }
  return RENDER_ROOT;
}

export function renderFilePath(filename: string): string {
  // Basename only: the filename reaches this from a URL segment.
  return path.join(renderDir(), path.basename(filename));
}

export function renderFileUrl(filename: string): string {
  return `/api/content-studio/renders/${encodeURIComponent(filename)}`;
}

export function saveRender(png: Buffer): string {
  const hash = crypto.createHash("sha256").update(png).digest("hex").slice(0, 16);
  const filename = `design-${hash}.png`;
  fs.writeFileSync(renderFilePath(filename), png);
  return filename;
}

export function deleteRender(filename: string | null | undefined): void {
  if (!filename) return;
  try {
    fs.unlinkSync(renderFilePath(filename));
  } catch {
    // Already gone, or shared with another slide by content hash. Either way
    // there is nothing to do -- a stray render is harmless.
  }
}
```

- [ ] **Step 2: Write the serving route**

`src/app/api/content-studio/renders/[filename]/route.ts`:

```ts
import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import fs from "node:fs";
import { renderFilePath } from "@/lib/image/renderStore";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { filename: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const file = renderFilePath(params.filename);
  if (!fs.existsSync(file)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  return new NextResponse(fs.readFileSync(file), {
    headers: {
      "Content-Type": "image/png",
      // The filename carries a content hash, so the bytes behind a URL never
      // change and this can be cached hard.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
```

- [ ] **Step 3: Add the two columns to `src/lib/db/schema.ts`**

In `carouselSlides`, directly after `layoutJson`:

```ts
  /**
   * The AI-authored HTML for a designed slide. The SOURCE OF TRUTH: the PNG is
   * derived from it, so a slide can always be re-rendered (a font change, a new
   * aspect ratio) without asking the model again.
   */
  designHtml: text("design_html"),
  /**
   * Filename of the rendered PNG in data/renders. What the editor shows and
   * what the operator exports -- the same bytes, which is how preview equals
   * export for a designed slide.
   */
  renderFilename: text("render_filename"),
```

- [ ] **Step 4: Add the migrations to `src/lib/db/tenant.ts`**

Immediately after the `layout_json` guard, following the same shape:

```ts
  // AI-designed slides: the authored HTML and the PNG rendered from it.
  // Additive/idempotent, like every guard in this block.
  try {
    const designCols = sqlite
      .prepare("PRAGMA table_info(carousel_slides)")
      .all() as Array<{ name: string }>;
    if (designCols.length > 0 && !designCols.some((c) => c.name === "design_html")) {
      sqlite.exec("ALTER TABLE carousel_slides ADD COLUMN design_html TEXT");
    }
    if (designCols.length > 0 && !designCols.some((c) => c.name === "render_filename")) {
      sqlite.exec("ALTER TABLE carousel_slides ADD COLUMN render_filename TEXT");
    }
  } catch (err) {
    console.error("[db] carousel_slides design columns migration failed:", err);
  }
```

- [ ] **Step 5: Carry the fields through `addSlide`**

In `src/lib/image/carousels.ts`, add to `AddSlideInput`:

```ts
  /** AI-authored HTML for a designed slide (lib/design/renderDesign.ts). */
  designHtml?: string | null;
  /** Filename of the PNG rendered from it (lib/image/renderStore.ts). */
  renderFilename?: string | null;
```

and to the `.values({...})` object:

```ts
      designHtml: input.designHtml ?? null,
      renderFilename: input.renderFilename ?? null,
```

- [ ] **Step 6: Verify the migration fires**

```bash
cd app && npx tsx -e '
import D from "better-sqlite3";
const t = new D("data/tenants/optimal-health/optimal-health.db");
const cols = (t.prepare("PRAGMA table_info(carousel_slides)").all() as any[]).map(c => c.name);
if (!cols.includes("design_html")) t.exec("ALTER TABLE carousel_slides ADD COLUMN design_html TEXT");
if (!cols.includes("render_filename")) t.exec("ALTER TABLE carousel_slides ADD COLUMN render_filename TEXT");
console.log((t.prepare("PRAGMA table_info(carousel_slides)").all() as any[]).map(c=>c.name).join(", "));
'
```

Expected: the list ends with `design_html, render_filename`.

- [ ] **Step 7: Gate and commit**

Run: `npm run typecheck && npm test && npx next build`

```bash
git add app/src/lib/image/renderStore.ts app/src/app/api/content-studio/renders app/src/lib/db/schema.ts app/src/lib/db/tenant.ts app/src/lib/image/carousels.ts
git commit -m "feat(design): store and serve rendered slide PNGs"
```

---

### Task 4: Auditing what the model emits

**Why before generation:** the audit is what the repair call quotes. Writing it first means the generator has something concrete to say when it rejects a design.

**Files:**
- Create: `src/lib/design/htmlAudit.ts`, `src/lib/design/htmlAudit.test.ts`

**Interfaces:**
- Consumes: `DesignSystem` and `valueHex` from `./parse`; `contrastRatio`, `formatRatio`, `valueKeyForHex` from `./validate`.
- Produces: `extractColours(html: string): string[]`, `auditDesignHtml(html: string, system: DesignSystem): { ok: true } | { ok: false; violations: string[] }`.

**Honesty note for the implementer:** this audit is *approximate*, and deliberately so. Checking the contrast of free-form HTML properly means resolving which background each text node actually sits over, which means laying the document out — the renderer's job, not a parser's. What this catches is the failure that actually matters and is cheap: **a colour that is not in the tenant's palette at all**, and **a value the system forbids as type used as a `color`**. State that limit in the module doc rather than implying more.

- [ ] **Step 1: Write the failing test**

`src/lib/design/htmlAudit.test.ts`:

```ts
// Run: npm test -- src/lib/design/htmlAudit.test.ts
//
// The audit on AI-authored design markup. It is deliberately narrow: it catches
// colours that are not in the tenant's palette, and the system's
// forbidden-as-type value used as text. It does NOT resolve which ground a text
// node sits over -- that needs layout, not parsing. See the module doc.
import assert from "node:assert/strict";

import { auditDesignHtml, extractColours } from "./htmlAudit";
import { OPTIMAL_HEALTH_DESIGN_SYSTEM as SYSTEM } from "./presets";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const onPalette = `<div style="display:flex;background:#c7d2bb">
  <div style="color:#24231f">Recovery is a practice</div>
  <div style="width:132px;height:3px;background:#b0844f"></div>
</div>`;

check("a design in palette passes", auditDesignHtml(onPalette, SYSTEM).ok);
check(
  "every colour is found",
  extractColours(onPalette).sort().join() === "#24231f,#b0844f,#c7d2bb",
);
check("case is normalised", extractColours('<i style="color:#C7D2BB">x</i>')[0] === "#c7d2bb");
check(
  "rgba is read as well as hex",
  extractColours('<i style="background:rgba(36,35,31,0.6)">x</i>').length === 1,
);

const offPalette = `<div style="display:flex;background:#ff00ff"><span style="color:#24231f">x</span></div>`;
const off = auditDesignHtml(offPalette, SYSTEM);
check("an off-palette colour fails", !off.ok);
check(
  "and the violation names the colour and says the palette is closed",
  !off.ok &&
    off.violations.some((v) => v.includes("#ff00ff") && v.includes("closed")),
);

const timberType = `<div style="display:flex;background:#c7d2bb"><span style="color:#b0844f">x</span></div>`;
const timber = auditDesignHtml(timberType, SYSTEM);
check("the forbidden-as-type value fails as a color", !timber.ok);
check(
  "and the violation names it",
  !timber.ok && timber.violations.some((v) => v.includes("timber")),
);
check(
  "but timber as a BACKGROUND is fine, which is what an accent is for",
  auditDesignHtml(
    `<div style="display:flex;background:#b0844f;width:132px;height:3px"></div>`,
    SYSTEM,
  ).ok,
);

// Semi-transparent overlays over photography are how a scrim is built, and are
// not palette drift.
check(
  "rgba overlays are exempt",
  auditDesignHtml(
    `<div style="display:flex;background:rgba(36,35,31,0.55)"><span style="color:#f2f3ed">x</span></div>`,
    SYSTEM,
  ).ok,
);

check("auditing never throws on junk", (() => {
  try {
    auditDesignHtml("<<<not html", SYSTEM);
    auditDesignHtml("", SYSTEM);
    return true;
  } catch {
    return false;
  }
})());

console.log(`\nhtmlAudit: ${passed} checks passed`);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npm test -- src/lib/design/htmlAudit.test.ts`
Expected: FAIL — `Cannot find module './htmlAudit'`.

- [ ] **Step 3: Write `src/lib/design/htmlAudit.ts`**

```ts
/**
 * Audit AI-authored design markup against a tenant's palette.
 * ZERO RUNTIME IMPORTS (see ./parse.ts).
 *
 * DELIBERATELY NARROW. Checking contrast properly in free-form HTML means
 * resolving which background each text node actually sits over, which means
 * laying the document out -- the renderer's job, not a parser's. So this checks
 * the two things that are both cheap and worth catching:
 *
 *   1. a colour that is not in the tenant's palette at all (the drift a closed
 *      palette exists to prevent), and
 *   2. the system's forbidden-as-type value used as a `color`.
 *
 * Semi-transparent rgba() is exempt: that is how a scrim over a photograph is
 * built, and a scrim is not a palette choice.
 *
 * The real check on a free-form design is looking at the rendered image --
 * see designPost.ts's visual pass.
 */
import type { DesignSystem } from "./parse";
import { valueKeyForHex } from "./validate";

const HEX = /#[0-9a-fA-F]{6}\b/g;
const RGBA = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)/g;
/** `color: <value>` specifically, so a background can be audited differently. */
const COLOR_PROP = /(?:^|[;{"'\s])color\s*:\s*(#[0-9a-fA-F]{6})\b/gi;

/** Every distinct colour the markup sets, normalised. */
export function extractColours(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.match(HEX) ?? []) out.add(m.toLowerCase());
  for (const m of html.match(RGBA) ?? []) out.add(m.replace(/\s+/g, ""));
  return [...out];
}

/** Colours set specifically as TEXT colour. */
function textColours(html: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(COLOR_PROP.source, "gi");
  while ((m = re.exec(html)) !== null) out.add(m[1].toLowerCase());
  return [...out];
}

export type DesignAudit =
  | { ok: true }
  | { ok: false; violations: string[] };

export function auditDesignHtml(
  html: string,
  system: DesignSystem,
): DesignAudit {
  const violations: string[] = [];
  const palette = system.values.map((v) => v.key).join(", ");

  for (const colour of extractColours(html)) {
    // A scrim, not a palette choice.
    if (colour.startsWith("rgb")) continue;
    if (!valueKeyForHex(system, colour)) {
      violations.push(
        `${colour} is not a value in this design system. The palette is ${palette}, and it is deliberately closed.`,
      );
    }
  }

  for (const colour of textColours(html)) {
    const key = valueKeyForHex(system, colour);
    if (key && system.rules.neverType.includes(key)) {
      violations.push(
        `${key} is set as text. This system never sets type in ${key} -- it is for rules, blocks and fills.`,
      );
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
```

- [ ] **Step 4: Run the test**

Run: `cd app && npm test -- src/lib/design/htmlAudit.test.ts`
Expected: PASS, `htmlAudit: 11 checks passed`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/design/htmlAudit.ts app/src/lib/design/htmlAudit.test.ts
git commit -m "feat(design): audit AI-authored markup against the tenant palette"
```

---

### Task 5: The design prompt and reply contract

**Files:**
- Create: `src/lib/ai/designPost.parse.ts`, `src/lib/ai/designPost.parse.test.ts`

**Interfaces:**
- Consumes: `DesignSystem`, `TYPE_LEVELS`, `columnWidth` from `@/lib/design/parse`; `auditDesignHtml` from `@/lib/design/htmlAudit`.
- Produces: `describeSystemForDesign(system: DesignSystem): string`, `DESIGN_RULES: string`, `extractDesignPayload(text: string): { slides: RawDesign[]; caption: string }` where `RawDesign = { html: string; photo: string }`, `checkDesigns(raw: RawDesign[], system: DesignSystem): { designs: CheckedDesign[]; problems: string[] }`.

**Note:** this mirrors the split already used by `composeDesign.parse.ts` — the server-only chain (`businessContext`, the settings store) pulls React in transitively and will not load under the plain tsx runner, so everything pure lives here.

- [ ] **Step 1: Write the failing test**

`src/lib/ai/designPost.parse.test.ts`:

```ts
// Run: npm test -- src/lib/ai/designPost.parse.test.ts
import assert from "node:assert/strict";

import {
  DESIGN_RULES,
  checkDesigns,
  describeSystemForDesign,
  extractDesignPayload,
} from "./designPost.parse";
import { OPTIMAL_HEALTH_DESIGN_SYSTEM as SYSTEM } from "@/lib/design/presets";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// -- What the model is told ------------------------------------------------
const d = describeSystemForDesign(SYSTEM);
check("the palette is named with hexes", d.includes("sage #c7d2bb"));
check("the forbidden-as-type value is called out", d.includes("NEVER set type"));
check("the grounds carry their budgets", d.includes("at most 33%"));
check("the type scale is given", d.includes("84px"));
check("the grid is given in real numbers", d.includes("76px") && d.includes("131px"));

// satori's limits are not optional advice -- a design that ignores them
// renders wrong or not at all.
check("flexbox-only is stated", DESIGN_RULES.includes("display:flex"));
check("no CSS filter is stated", DESIGN_RULES.includes("filter"));
check("img sizing in style is stated", DESIGN_RULES.includes("style"));
check("the canvas size is stated", DESIGN_RULES.includes("1080"));

// -- Reading the reply -----------------------------------------------------
const reply = `Here you go.
<design>
{"caption":"A caption.","slides":[{"photo":"a quiet room","html":"<div style=\\"display:flex\\"></div>"}]}
</design>`;
const read = extractDesignPayload(reply);
check("the payload is found inside the tags", read.slides.length === 1);
check("the caption comes back", read.caption === "A caption.");
check("the scene comes back", read.slides[0].photo === "a quiet room");

check(
  "a truncated reply names itself, rather than failing as JSON",
  (() => {
    try {
      extractDesignPayload('<design>\n{"caption":"c","slides":[{"html":"<div');
      return false;
    } catch (e) {
      return e instanceof Error && e.message.toLowerCase().includes("cut off");
    }
  })(),
);

// -- Checking what came back ----------------------------------------------
const good = checkDesigns(
  [{ html: `<div style="display:flex;background:#f2f3ed"><span style="color:#24231f">x</span></div>`, photo: "" }],
  SYSTEM,
);
check("a clean design passes", good.problems.length === 0);
check("and is returned", good.designs.length === 1);

const bad = checkDesigns(
  [{ html: `<div style="display:flex;background:#ff00ff"></div>`, photo: "" }],
  SYSTEM,
);
check("an off-palette design is a problem", bad.problems.length > 0);
check(
  "numbered by slide, so the repair call can name it",
  bad.problems[0].startsWith("Slide 1:"),
);
check(
  "the design is still returned -- a violation is shown, never discarded",
  bad.designs.length === 1,
);

const empty = checkDesigns([{ html: "   ", photo: "" }], SYSTEM);
check("an empty design is a problem", empty.problems.some((p) => p.includes("no markup")));

console.log(`\ndesignPost.parse: ${passed} checks passed`);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npm test -- src/lib/ai/designPost.parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/ai/designPost.parse.ts`**

```ts
/**
 * The pure half of the design pass: what the model is told, and what is made of
 * what it returns. Split from ./designPost.ts for the same reason
 * composeDesign.parse.ts is split -- the server-only chain pulls React in
 * transitively and will not load under the plain tsx runner.
 */
import { auditDesignHtml } from "@/lib/design/htmlAudit";
import {
  TYPE_LEVELS,
  columnWidth,
  type DesignSystem,
} from "@/lib/design/parse";

export interface RawDesign {
  html: string;
  /** A photographic scene for this slide, or "" when the design uses none. */
  photo: string;
}

export interface CheckedDesign extends RawDesign {
  violations: string[];
}

/** The tenant's system, as instructions the model can act on. */
export function describeSystemForDesign(system: DesignSystem): string {
  const lines: string[] = ["THE BRAND'S DESIGN SYSTEM", ""];

  lines.push("Palette -- these are the only colours. Do not invent one:");
  for (const v of system.values) {
    const notes = [v.role];
    if (system.rules.neverType.includes(v.key)) notes.push("NEVER set type in this");
    lines.push(`- ${v.key} ${v.hex} -- ${notes.join(", ")}`);
  }

  lines.push("", "Grounds -- a slide's background is one of these:");
  for (const g of system.grounds) {
    lines.push(
      `- ${g.value} -- at most ${Math.round(g.share * 100)}% of a set, never more than ${g.maxRun} slide${g.maxRun === 1 ? "" : "s"} in a row`,
    );
  }
  lines.push(
    "Use all of them across a set. Monotony is fixed by changing a ground, not by enlarging a headline.",
  );

  lines.push("", "Type scale (px on a 1080 field, scale proportionally):");
  for (const level of TYPE_LEVELS) {
    const t = system.type[level];
    lines.push(
      `- ${level}: ${t.size}px / line-height ${t.leading} / letter-spacing ${t.tracking}em / weight ${t.weight}${t.upper ? " / UPPERCASE" : ""}`,
    );
  }

  lines.push(
    "",
    `Grid: ${system.grid.columns} columns of ${Math.round(columnWidth(system))}px, margins ${system.grid.margin}px, gutters ${system.grid.gutter}px. Text sits in three or four columns. The empty columns are the calm and are not there to be filled.`,
    `Contrast: body text needs ${system.rules.minContrastBody}:1 against its ground, large text ${system.rules.minContrastLarge}:1.`,
    "Setting: flush left, ragged right. No centred type, no justification, no italics.",
  );

  return lines.join("\n");
}

/**
 * The renderer's real limits. These are not style advice -- satori implements a
 * SUBSET of CSS, and markup that ignores this renders wrong or not at all.
 */
export const DESIGN_RULES = `YOU ARE DESIGNING THE POST, not filling in a template. Compose each slide yourself: decide the structure, the scale, what dominates and what stays quiet. Every colour and type size comes from the system above; the composition is yours.

You write ONE HTML element per slide. It is rendered by satori, which supports a SUBSET of CSS. Stay inside it:
- FLEXBOX ONLY. No grid, no float, no table. EVERY element that has children must set "display:flex" -- this is the single most common mistake and the design will not render without it.
- Set flex-direction explicitly whenever children stack vertically.
- Absolute positioning IS supported ("position:absolute" inside a "position:relative" parent) and is how you overlap, bleed a figure off the edge, or pin a footer.
- NO CSS filter, backdrop-filter, mix-blend-mode, or mask. A photograph is already graded before you get it.
- An <img> takes its size in "style" ("style=\\"width:1080px;height:1080px;object-fit:cover\\""), NEVER as width/height attributes -- as attributes it silently renders nothing.
- Gradients work ("background:linear-gradient(...)"), and rgba() is how you build a scrim over a photograph.
- No external CSS, no <style> block, no classes. Inline "style" only.
- font-family is exactly "Inter".

The canvas is EXACTLY the size you are told (e.g. 1080x1080). The outermost element must set that width and height in px and "display:flex".

Moves worth making, because a fixed template cannot: a figure or word oversized and cropped by the canvas edge; a panel of type overlapping a full-bleed photograph; an asymmetric split where a band of a second ground cuts the first; a rule that crosses the whole composition. Vary them across a set -- five slides of the same shape read as a template, which is the thing this exists to avoid.

Where a slide uses a photograph, put "<img src=\\"{{PHOTO}}\\" ...>" EXACTLY -- that placeholder is substituted with the real image. Use it at most once per slide, and give that slide a "photo" field describing the scene (subject, setting, mood, composition; never any text, signage or lettering in shot). A slide with no photograph has "photo": "".

Copy: plain text, no markdown, no emojis, no hashtags. Headings short and concrete. Never invent a statistic.

Output format -- return ONLY this JSON inside <design>...</design> tags, no other text:
<design>
{
  "caption": "the Instagram caption for the whole post",
  "slides": [
    { "photo": "a quiet treatment room, daylight", "html": "<div style=\\"display:flex;width:1080px;height:1080px;...\\">...</div>" }
  ]
}
</design>
The "slides" array must hold exactly the number of slides requested, in order.`;

export function extractDesignPayload(text: string): {
  slides: RawDesign[];
  caption: string;
} {
  const closed = text.match(/<design>([\s\S]*?)<\/design>/i);
  if (!closed && /<design>/i.test(text)) {
    throw new Error(
      "The design was cut off before it finished. Try fewer slides, or a shorter topic.",
    );
  }
  const jsonText = (closed ? closed[1] : text)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(jsonText) as { slides?: unknown; caption?: unknown };
  if (!Array.isArray(parsed.slides)) {
    throw new Error("The designer did not return a slides array.");
  }
  return {
    caption: typeof parsed.caption === "string" ? parsed.caption.trim() : "",
    slides: parsed.slides.map((s, i): RawDesign => {
      if (!s || typeof s !== "object") throw new Error(`Slide ${i + 1} is not an object.`);
      const o = s as Record<string, unknown>;
      return {
        html: typeof o.html === "string" ? o.html : "",
        photo: typeof o.photo === "string" ? o.photo.trim() : "",
      };
    }),
  };
}

/**
 * Audit every design. Problems are phrased for the repair call; the designs are
 * returned regardless, because a flagged slide is SHOWN, never discarded.
 */
export function checkDesigns(
  raw: RawDesign[],
  system: DesignSystem,
): { designs: CheckedDesign[]; problems: string[] } {
  const problems: string[] = [];
  const designs: CheckedDesign[] = [];

  raw.forEach((r, i) => {
    const violations: string[] = [];
    if (!r.html.trim()) {
      violations.push("This slide has no markup.");
    } else {
      const audit = auditDesignHtml(r.html, system);
      if (!audit.ok) violations.push(...audit.violations);
      if (!/display\s*:\s*flex/i.test(r.html)) {
        violations.push(
          "The outermost element does not set display:flex, so this will not render.",
        );
      }
    }
    violations.forEach((v) => problems.push(`Slide ${i + 1}: ${v}`));
    designs.push({ ...r, violations });
  });

  return { designs, problems };
}
```

- [ ] **Step 4: Run the test**

Run: `cd app && npm test -- src/lib/ai/designPost.parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/designPost.parse.ts app/src/lib/ai/designPost.parse.test.ts
git commit -m "feat(design): the prompt and reply contract for AI-designed posts"
```

---

### Task 6: The generation pass

**Files:**
- Create: `src/lib/ai/designPost.ts`

**Interfaces:**
- Consumes: everything from Task 5; `getDesignSystem` from `@/lib/design/system`; `loadDesignFonts`, `renderDesignToPng`, `gradedPhotoDataUri` from Task 1; `saveRender` from Task 3; `meteredCreate` from `@/lib/ai/metered`; `getBusinessContext`, `getSignoffRule`.
- Produces: `designPost(input: GenerateInput, meter: MeterContext, model?: string): Promise<DesignPostResult>` where `DesignPostResult = { designed: true; slides: DesignedSlide[]; caption: string; repaired: boolean; usage: Usage } | (GenerateResult & { designed: false })`, and `DesignedSlide = { html: string; renderFilename: string | null; photo: string; violations: string[] }`.

- [ ] **Step 1: Write it**

Key decisions to implement exactly:

1. **`getDesignSystem()` null → delegate to `generateCarouselSlides` unchanged and return `{ designed: false, ...result }`.** Same fall-through contract as today.
2. **`max_tokens: 32000`.** An HTML design per slide is the largest payload this app asks a model for, and adaptive thinking spends from the same budget. 4096 truncated the far smaller archetype payload in production; do not repeat it. Also check `stop_reason === "max_tokens"` and throw the named error before parsing.
3. **One repair call maximum**, quoting `problems` verbatim, and taken only if it is genuinely better (no fewer slides, fewer problems).
4. **Render every slide** and `saveRender` the PNG. A slide whose markup throws in satori keeps `renderFilename: null` and gains a violation naming the renderer's own message — never a crash of the whole set.
5. **Photos**: substitute `{{PHOTO}}` with `gradedPhotoDataUri(...)` using the system's `photo` grade. When a slide's `photo` is `""`, strip any stray `<img ...{{PHOTO}}...>` rather than leaving a broken placeholder.

```ts
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

import { getBusinessContext, getSignoffRule } from "@/lib/ai/businessContext";
import { CONTENT_MODEL } from "@/lib/ai/client";
import { meteredCreate, type MeterContext } from "@/lib/ai/metered";
import {
  generateCarouselSlides,
  type GenerateInput,
  type GenerateResult,
} from "@/lib/ai/generateCarousel";
import {
  DESIGN_RULES,
  checkDesigns,
  describeSystemForDesign,
  extractDesignPayload,
} from "@/lib/ai/designPost.parse";
import { getDesignSystem } from "@/lib/design/system";
import { loadDesignFonts } from "@/lib/design/fonts";
import { renderDesignToPng } from "@/lib/design/renderDesign";
import { saveRender } from "@/lib/image/renderStore";

/**
 * An HTML design per slide is the largest payload this app asks a model for,
 * and adaptive thinking spends from the same output budget. 4096 truncated the
 * far smaller archetype payload in production; this is not the place to be
 * frugal. Output tokens bill as used.
 */
const DESIGN_MAX_TOKENS = 32000;

export interface DesignedSlide {
  html: string;
  renderFilename: string | null;
  photo: string;
  violations: string[];
}

export interface DesignPostResult {
  designed: true;
  slides: DesignedSlide[];
  caption: string;
  repaired: boolean;
  usage: GenerateResult["usage"];
}
export interface FellThrough extends GenerateResult {
  designed: false;
}

export async function designPost(
  input: GenerateInput,
  meter: MeterContext,
  model: string = CONTENT_MODEL,
): Promise<DesignPostResult | FellThrough> {
  const system = getDesignSystem();
  if (!system) {
    const result = await generateCarouselSlides(input, meter, model);
    return { designed: false, ...result };
  }
  // ... system prompt from getBusinessContext() + describeSystemForDesign(system)
  //     + DESIGN_RULES + getSignoffRule("social")
  // ... one meteredCreate, stop_reason guard, extractDesignPayload, checkDesigns
  // ... at most one repair call, taken only if strictly better
  // ... render each design, saveRender, collect violations
  throw new Error("implement per the five decisions above");
}
```

- [ ] **Step 2: Verify it end to end against the real tenant**

There is no unit test for the model call; the check is a real generation.

```bash
cd app && npx tsx -e '
// Renders every design the model returns to /tmp so they can be LOOKED at.
// Requires ANTHROPIC_API_KEY and a seeded design system.
' 
```

Instead, run the real route once via the app (Task 7) and open the PNGs. **Do not mark this task done without looking at the images.**

- [ ] **Step 3: Gate and commit**

```bash
git add app/src/lib/ai/designPost.ts
git commit -m "feat(design): the AI design pass -- markup in, rendered slides out"
```

---

### Task 7: Wire the route

**Files:**
- Modify: `src/app/api/content-studio/carousels/[id]/generate/route.ts`

- [ ] **Step 1: Swap `composeCarousel` for `designPost`**

Replace the `result.composed` branch with a `result.designed` branch that calls `addSlide` with:

```ts
        templateId: DESIGNED_TEMPLATE_ID,   // "designed"
        aspectRatio: "1:1",
        headingText: "",                     // a designed slide has no slots
        bodyText: "",
        caption: i === 0 ? result.caption : "",
        designHtml: slide.html,
        renderFilename: slide.renderFilename,
```

Note there is **no** `imagePrompt` / `queueSlideImages` for designed slides: the photograph is embedded in the markup at generation time, so the AI-background queue plays no part.

- [ ] **Step 2: Define the sentinel**

In `src/lib/image/paintSlide.ts`, beside the existing constant:

```ts
/** A slide the AI designed as HTML. Its markup is in `design_html` and its
 *  rendered PNG in `render_filename`; nothing in TEMPLATES uses this id. */
export const DESIGNED_TEMPLATE_ID = "designed";
```

- [ ] **Step 3: Gate and commit**

Run: `npm run typecheck && npm test && npx next build`

```bash
git add app/src/app/api/content-studio/carousels app/src/lib/image/paintSlide.ts
git commit -m "feat(content-studio): generate designed posts from the carousel route"
```

---

### Task 8: The editor — accept, regenerate, nudge

**Files:**
- Modify: `src/components/content-studio/SlideCanvas.tsx`, `src/components/content-studio/ImageDesigner.tsx`
- Create: `src/app/api/content-studio/carousels/[id]/redesign/route.ts`

- [ ] **Step 1: `SlideCanvas` shows the render for a designed slide**

Before the canvas effect, branch: when `slide.templateId === DESIGNED_TEMPLATE_ID && slide.renderFilename`, render an `<img src={renderFileUrl(slide.renderFilename)}>` at the slide's aspect ratio instead of a `<canvas>`. **Do not** attempt to draw the design on the canvas — the stored PNG is the single rendering.

- [ ] **Step 2: `slideSurface` describes a designed slide**

In `paintSlide.ts`, extend `slideSurface` so `DESIGNED_TEMPLATE_ID` returns `{ id: "designed", name: "AI design", aspectRatio, width, height, category: "carousels", usesTagline: false, composed: true }`. Without this the editor treats it as an empty slot — the exact bug fixed in `356040d`.

- [ ] **Step 3: The inspector for a designed slide**

Replace the Content/Layout sections with: the violations notice (existing `DesignNotice`), a **Regenerate** button, and a one-line nudge field ("make the headline bigger", "try it on the dark ground") posting to the redesign route. No heading/body/colour controls — a designed slide has no slots for them to address.

- [ ] **Step 4: The redesign route**

`POST /api/content-studio/carousels/[id]/redesign` with `{ slideId, note? }`: re-runs the design pass for that one slide, passing the previous HTML and the note as an additional user turn, re-renders, `saveRender`s, `deleteRender`s the old file, and updates the row. Metered like every other paid call.

- [ ] **Step 5: Gate, look, commit**

Generate a real carousel in Content Studio, look at every slide, then regenerate one with a note and confirm it changes.

```bash
git add app/src/components/content-studio app/src/app/api/content-studio/carousels app/src/lib/image/paintSlide.ts
git commit -m "feat(content-studio): accept, regenerate or nudge a designed slide"
```

---

### Task 9: Remove the archetype system

**Why last:** nothing may be deleted until its replacement is proven in the app.

**Files:**
- Delete: `src/lib/design/grammar.ts`, `grammar.test.ts`, `src/lib/image/paintLayout.ts`, `paintLayout.test.ts`, `src/lib/ai/composeDesign.ts`, `composeDesign.parse.ts`, `composeDesign.test.ts`
- Modify: `src/lib/image/paintSlide.ts` (drop the `COMPOSED_TEMPLATE_ID` branch), `src/lib/design/validate.ts` (drop `validateSlide`/`validateCarousel`/`validateSet`, which take a `LayoutSpec`; **keep** `contrastRatio`, `relativeLuminance`, `formatRatio`, `valueKeyForHex`, `defaultTypeValue`, `groundBudget`), `validate.test.ts` accordingly.

- [ ] **Step 1: Deal with the existing composed slides**

Production has five slides on `template_id = 'composed'` in the Optimal Health tenant (carousel set 2). Once `paintLayout` is gone they render nothing. Delete that design from the CMS first, then confirm:

```bash
railway ssh "cd /app && node -e \"
const D=require('better-sqlite3');
const t=new D('/app/data/tenants/optimal-health/optimal-health.db',{readonly:true});
console.log('composed slides left:', t.prepare(\\\"SELECT COUNT(*) c FROM carousel_slides WHERE template_id='composed'\\\").get().c);
\""
```

Expected: `composed slides left: 0`.

- [ ] **Step 2: Delete the files and the fork**

- [ ] **Step 3: Run the golden master — this is the gate**

Run: `cd app && npx tsx src/lib/image/templates.golden.test.ts`
Expected: `no template render drifted`, 39 templates. Removing the composed branch must not touch a single template.

- [ ] **Step 4: Gate and commit**

Run: `npm run typecheck && npm test && npx next build`

```bash
git add -A app/src
git commit -m "refactor(design): remove the archetype grammar, superseded by AI design"
```

---

## Verification that matters

1. **A real generation, looked at.** Not "it returned 200" — open all five PNGs and judge them against the Sage Field document. This is the only test that answers whether the feature works.
2. **The golden master green after Task 9** — the 39 templates are untouched by any of this.
3. **A tenant with no design system** (Inspire) generating exactly as it does today.
4. **A regenerate-with-a-note visibly changing one slide** while leaving its neighbours alone.
5. **Deploy, then render once in production** — satori's WASM loading in the slim runtime image is the one thing that cannot be proven locally.
