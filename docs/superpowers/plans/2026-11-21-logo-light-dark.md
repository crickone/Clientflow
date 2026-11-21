# One-colour Logos for Light and Dark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A business's logo shows in one colour that matches the theme in the staff app and the member app header. It is near-black on light and near-white on dark, and it changes instantly with the light/dark toggle.

**Architecture:**
- **The shape file:** sharp turns the uploaded logo into a "shape" PNG (white, with the logo in the alpha channel). Any solid background is removed. It is cached on disk next to the logo as `logo.shape.png`, or a `logo.shape.none` marker when no shape is possible.
- **The route:** `GET /api/branding/logo?shape=1` serves it.
- **Painting:** `<Logo oneColour>` paints it with a CSS mask over `currentColor`. A transparent `<img>` of the same shape sizes the box, so no dimensions are passed around.
- **Fallback:** any failure shows the original logo, as today.

**Tech Stack:** Next.js 15 App Router, TypeScript, sharp ^0.35, CSS `mask-image`.

Spec: `docs/superpowers/specs/2026-11-21-logo-light-dark-design.md`

## Global Constraints

- **Where:** only the staff app (sidebar, top bar, account picker) and the member app header use one colour. Websites, campaign pages (`site/[siteSlug]/c/...`), social posts, video cards, ads, app icons, login and reset pages keep the logo as uploaded.
- **Colours:** theme variables only in app UI. The Branding preview panels take their colours from `THEME_MODES` in `src/lib/theme.ts`.
- **Fail-soft:** any processing failure leaves today's behaviour (the original logo). A shape failure never fails an upload.
- **No emojis** anywhere. "program", not "programme".
- **Layout:** 44px controls, 320px phone width, no horizontal scroll.
- **Tests:**
  - pure tests run with `npx tsx <file>`;
  - DB or `server-only` tests run with `npm test -- <file>` from `app/`;
  - the full suite is `npm test`, the typecheck `npx tsc --noEmit -p .`, the build `npx next build`.
- **Git:**
  - never `git add -A`;
  - add the named files only;
  - commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

- Create `app/src/lib/logoShape.ts`: pure pixel step. RGBA in, trimmed white-plus-alpha RGBA out, or null.
- Create `app/src/lib/logoShape.test.ts`.
- Create `app/src/lib/logoShapeFile.ts`: sharp, disk cache and markers. `ensureLogoShape(logoPath)` and `removeLogoShape(logoPath)`.
- Create `app/src/lib/logoShapeFile.test.ts`.
- Modify `app/src/app/api/branding/logo/route.ts`: the `?shape=1` branch in GET, and cleanup in DELETE.
- Modify `app/src/components/ui/Logo.tsx`: `oneColour`, `colour` and `onShapeMissing` props.
- Modify `app/src/components/layout/Sidebar.tsx` (lines 616 and 838), `app/src/components/layout/AppShell.tsx` (line 196) and `app/src/components/clientapp/ClientAppFrame.tsx` (line 131): pass `oneColour`.
- Modify `app/src/lib/tenantLogoThumb.ts`, `app/src/app/select-account/page.tsx` and `app/src/app/select-account/AccountSelector.tsx`: one-colour thumbnails.
- Modify `app/src/components/settings/BrandingForm.tsx`: light and dark preview panels.

---

### Task 1: The pure shape step

**Files:**
- Create: `app/src/lib/logoShape.ts`
- Test: `app/src/lib/logoShape.test.ts`

**Interfaces:**
- Produces:
  - `export interface RawImage { data: Uint8Array; width: number; height: number }` (4 channels, RGBA, row-major);
  - `export function logoShape(img: RawImage): RawImage | null`. It returns a trimmed RGBA image where every pixel is white (255,255,255) and alpha is the logo, or null when no shape can be made.

- [ ] **Step 1: Write the failing test**

```ts
// Run: npx tsx src/lib/logoShape.test.ts
import assert from "node:assert/strict";

import { logoShape, type RawImage } from "./logoShape";

/** A w x h image filled with one RGBA colour. */
function canvas(w: number, h: number, rgba: [number, number, number, number]): RawImage {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { data, width: w, height: h };
}
function paint(img: RawImage, x0: number, y0: number, x1: number, y1: number, rgba: [number, number, number, number]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set(rgba, (y * img.width + x) * 4);
}
const alphaAt = (img: RawImage, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];
const rgbAt = (img: RawImage, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));

// 1. Transparent PNG: alpha passes through, colour becomes white, trimmed to the logo (+2px margin).
{
  const img = canvas(100, 50, [0, 0, 0, 0]);
  paint(img, 20, 10, 80, 40, [212, 175, 55, 255]); // gold block
  paint(img, 30, 20, 40, 30, [255, 255, 255, 128]); // half-see-through detail
  const s = logoShape(img)!;
  assert.ok(s);
  assert.equal(s.width, 64); // 60 + 2*2
  assert.equal(s.height, 34); // 30 + 2*2
  assert.equal(alphaAt(s, 2, 2), 255);
  assert.deepEqual(rgbAt(s, 2, 2), [255, 255, 255]);
  assert.equal(alphaAt(s, 12, 12), 128);
  assert.equal(alphaAt(s, 0, 0), 0);
}

// 2. Dark logo on a white JPG-style background: background removed, logo solid.
{
  const img = canvas(100, 60, [255, 255, 255, 255]);
  paint(img, 25, 15, 75, 45, [20, 20, 20, 255]);
  const s = logoShape(img)!;
  assert.ok(s);
  assert.equal(s.width, 54);
  assert.equal(s.height, 34);
  assert.equal(alphaAt(s, 10, 10), 255);
  assert.equal(alphaAt(s, 0, 0), 0);
}

// 3. Light logo on a dark background: same.
{
  const img = canvas(80, 80, [12, 13, 16, 255]);
  paint(img, 30, 30, 50, 50, [240, 240, 240, 255]);
  const s = logoShape(img)!;
  assert.ok(s);
  assert.equal(alphaAt(s, 10, 10), 255);
}

// 4. Soft edge: a pixel half-way between background and logo gets a middling alpha.
{
  const img = canvas(60, 60, [255, 255, 255, 255]);
  paint(img, 20, 20, 40, 40, [0, 0, 0, 255]);
  paint(img, 19, 20, 20, 40, [215, 215, 215, 255]); // ~69 from white: inside the ramp
  const s = logoShape(img)!;
  const a = alphaAt(s, 2, 10); // column 19 sits at x=2 after trimming with a 2px margin
  assert.ok(a > 0 && a < 255, `soft edge alpha was ${a}`);
}

// 5. Corners that disagree (a photo): no shape.
{
  const img = canvas(60, 60, [255, 255, 255, 255]);
  paint(img, 0, 0, 10, 10, [200, 30, 30, 255]);
  paint(img, 50, 50, 60, 60, [30, 30, 200, 255]);
  assert.equal(logoShape(img), null);
}

// 6. Nothing but background (or nothing visible): no shape.
assert.equal(logoShape(canvas(40, 40, [255, 255, 255, 255])), null);
assert.equal(logoShape(canvas(40, 40, [0, 0, 0, 0])), null);

console.log("logoShape: ok");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx tsx src/lib/logoShape.test.ts`
Expected: FAIL. Cannot find module `./logoShape`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * The one-colour "shape" of a logo, from raw pixels. Pure (no sharp, no
 * disk), so it runs under the plain test runner.
 *
 * - A logo with real transparency keeps its alpha.
 * - A logo on a solid background (a JPG, a flattened PNG) has that
 *   background found from the four corners and removed, with a soft ramp so
 *   curves stay smooth.
 * - A busy background (the corners disagree) gives null: the caller shows
 *   the logo as uploaded.
 *
 * The result is white with the logo in the alpha channel, trimmed to the
 * logo plus a small margin. The app paints it with a CSS mask, so the
 * colour here never shows.
 */

export interface RawImage {
  /** RGBA, 4 bytes per pixel, row by row. */
  data: Uint8Array;
  width: number;
  height: number;
}

/** Below this alpha a pixel counts as see-through when deciding "has transparency". */
const TRANSPARENT_BELOW = 250;
/** Colour distance (0-441) within which a corner patch is one flat colour, and patches match each other. */
const FLAT = 24;
/** Background-to-logo ramp: at or under LOW the pixel is background, at or over HIGH it is fully logo. */
const RAMP_LOW = 24;
const RAMP_HIGH = 72;
/** Alpha above this counts when trimming. */
const VISIBLE = 8;
const MARGIN = 2;

function dist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/** Mean colour of a square patch, or null when the patch is not one flat colour. */
function flatPatch(img: RawImage, x0: number, y0: number, size: number): [number, number, number] | null {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y0 + size; y++)
    for (let x = x0; x < x0 + size; x++) {
      const i = (y * img.width + x) * 4;
      r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
    }
  const mean: [number, number, number] = [r / n, g / n, b / n];
  for (let y = y0; y < y0 + size; y++)
    for (let x = x0; x < x0 + size; x++) {
      const i = (y * img.width + x) * 4;
      if (dist(img.data[i], img.data[i + 1], img.data[i + 2], ...mean) > FLAT) return null;
    }
  return mean;
}

function backgroundColour(img: RawImage): [number, number, number] | null {
  const size = Math.max(1, Math.round(Math.min(img.width, img.height) * 0.04));
  const corners = [
    flatPatch(img, 0, 0, size),
    flatPatch(img, img.width - size, 0, size),
    flatPatch(img, 0, img.height - size, size),
    flatPatch(img, img.width - size, img.height - size, size),
  ];
  if (corners.some((c) => c === null)) return null;
  const cs = corners as [number, number, number][];
  for (const a of cs) for (const b of cs) if (dist(...a, ...b) > FLAT) return null;
  return [0, 1, 2].map((k) => cs.reduce((s, c) => s + c[k], 0) / cs.length) as [number, number, number];
}

export function logoShape(img: RawImage): RawImage | null {
  const { width: w, height: h, data } = img;
  if (w < 1 || h < 1 || data.length < w * h * 4) return null;
  const alpha = new Uint8Array(w * h);

  let transparent = false;
  for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] < TRANSPARENT_BELOW) { transparent = true; break; }

  if (transparent) {
    for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];
  } else {
    const bg = backgroundColour(img);
    if (!bg) return null;
    for (let i = 0; i < w * h; i++) {
      const d = dist(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], ...bg);
      const t = Math.min(1, Math.max(0, (d - RAMP_LOW) / (RAMP_HIGH - RAMP_LOW)));
      alpha[i] = Math.round(t * 255);
    }
  }

  let left = w, top = h, right = -1, bottom = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (alpha[y * w + x] > VISIBLE) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < 0) return null;

  const x0 = Math.max(0, left - MARGIN);
  const y0 = Math.max(0, top - MARGIN);
  const x1 = Math.min(w - 1, right + MARGIN);
  const y1 = Math.min(h - 1, bottom + MARGIN);
  const ow = x1 - x0 + 1;
  const oh = y1 - y0 + 1;
  const out = new Uint8Array(ow * oh * 4);
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      const o = (y * ow + x) * 4;
      out[o] = 255; out[o + 1] = 255; out[o + 2] = 255;
      out[o + 3] = alpha[(y + y0) * w + (x + x0)];
    }
  return { data: out, width: ow, height: oh };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx tsx src/lib/logoShape.test.ts`
Expected: `logoShape: ok`

Test 1 expects 64 x 34. The logo spans x 20-79 and y 10-39, so the trimmed box is x 18-81 and y 8-41: 64 x 34. If an assertion is off by one, fix the implementation, not the expected numbers.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/logoShape.ts app/src/lib/logoShape.test.ts
git commit -m "feat(branding): one-colour logo shape from raw pixels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shape file on disk and the `?shape=1` route

**Files:**
- Create: `app/src/lib/logoShapeFile.ts`
- Test: `app/src/lib/logoShapeFile.test.ts`
- Modify: `app/src/app/api/branding/logo/route.ts` (GET and DELETE)

**Interfaces:**
- Consumes: `logoShape(img: RawImage): RawImage | null` from `@/lib/logoShape`.
- Produces:
  - `export async function ensureLogoShape(logoPath: string): Promise<string | null>`. It returns the path of `logo.shape.png` next to the logo, or null when no shape is possible or anything fails.
  - `export function removeLogoShape(logoPath: string): void`.

- [ ] **Step 1: Write the failing test**

```ts
// Run: npm test -- src/lib/logoShapeFile.test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const sharp = (await import("sharp")).default;
  const { ensureLogoShape, removeLogoShape } = requireLocal("./logoShapeFile") as typeof import("./logoShapeFile");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "logo-shape-"));
  try {
    // A dark block on white, saved as JPG.
    const jpg = path.join(dir, "logo.jpg");
    await sharp({ create: { width: 200, height: 100, channels: 3, background: "#ffffff" } })
      .composite([{ input: { create: { width: 100, height: 50, channels: 3, background: "#111111" } }, left: 50, top: 25 }])
      .jpeg({ quality: 95 })
      .toFile(jpg);
    const shape = await ensureLogoShape(jpg);
    assert.equal(shape, path.join(dir, "logo.shape.png"));
    const meta = await sharp(shape!).metadata();
    assert.equal(meta.hasAlpha, true);
    assert.ok(meta.width! >= 100 && meta.width! <= 106, `width ${meta.width}`);

    // Cached: a second call returns the same file without rewriting it.
    const m1 = fs.statSync(shape!).mtimeMs;
    assert.equal(await ensureLogoShape(jpg), shape);
    assert.equal(fs.statSync(shape!).mtimeMs, m1);

    // An SVG logo works too.
    const svg = path.join(dir, "logo.svg");
    fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect x="10" y="5" width="100" height="30" fill="#d4af37"/></svg>');
    removeLogoShape(svg);
    assert.ok(await ensureLogoShape(svg));

    // A photo-like image: null, and a marker so it isn't recomputed.
    const photo = path.join(dir, "logo.png");
    removeLogoShape(photo);
    await sharp({ create: { width: 60, height: 60, channels: 3, background: "#ffffff" } })
      .composite([
        { input: { create: { width: 10, height: 10, channels: 3, background: "#c81e1e" } }, left: 0, top: 0 },
        { input: { create: { width: 10, height: 10, channels: 3, background: "#1e1ec8" } }, left: 50, top: 50 },
      ])
      .png()
      .toFile(photo);
    assert.equal(await ensureLogoShape(photo), null);
    assert.ok(fs.existsSync(path.join(dir, "logo.shape.none")));

    // removeLogoShape clears both.
    removeLogoShape(photo);
    assert.ok(!fs.existsSync(path.join(dir, "logo.shape.none")));
    assert.ok(!fs.existsSync(path.join(dir, "logo.shape.png")));

    // A missing file is null, never a throw.
    assert.equal(await ensureLogoShape(path.join(dir, "nope.png")), null);
    console.log("logoShapeFile: ok");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npm test -- src/lib/logoShapeFile.test.ts`
Expected: FAIL. Cannot find module `./logoShapeFile`.

- [ ] **Step 3: Write `logoShapeFile.ts`**

```ts
import "server-only";

import fs from "node:fs";
import path from "node:path";

import { logoShape } from "@/lib/logoShape";

/**
 * The one-colour shape of a business logo, cached next to it:
 * `logo.shape.png` (white, logo in alpha), or `logo.shape.none` when the
 * logo has a busy background and none can be made. Both are re-made when the
 * logo is newer. The upload route already clears every `logo.*` file on a new
 * upload. Never throws: null means "show the logo as uploaded".
 */

const SHAPE = "logo.shape.png";
const NONE = "logo.shape.none";
const MAX_PX = 1024;

function fresh(file: string, logoMtime: number): boolean {
  try {
    return fs.statSync(file).mtimeMs >= logoMtime;
  } catch {
    return false;
  }
}

export async function ensureLogoShape(logoPath: string): Promise<string | null> {
  try {
    const dir = path.dirname(logoPath);
    const out = path.join(dir, SHAPE);
    const none = path.join(dir, NONE);
    const logoMtime = fs.statSync(logoPath).mtimeMs;
    if (fresh(out, logoMtime)) return out;
    if (fresh(none, logoMtime)) return null;

    const sharp = (await import("sharp")).default;
    const isSvg = path.extname(logoPath).toLowerCase() === ".svg";
    const { data, info } = await sharp(fs.readFileSync(logoPath), isSvg ? { density: 300 } : {})
      .resize(MAX_PX, MAX_PX, { fit: "inside", withoutEnlargement: !isSvg })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const shape = logoShape({ data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height });
    if (!shape) {
      fs.writeFileSync(none, "");
      fs.rmSync(out, { force: true });
      return null;
    }
    await sharp(Buffer.from(shape.data), { raw: { width: shape.width, height: shape.height, channels: 4 } }).png().toFile(out);
    fs.rmSync(none, { force: true });
    return out;
  } catch {
    return null;
  }
}

export function removeLogoShape(logoPath: string): void {
  const dir = path.dirname(logoPath);
  for (const f of [SHAPE, NONE]) {
    try {
      fs.rmSync(path.join(dir, f), { force: true });
    } catch {
      // best effort
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npm test -- src/lib/logoShapeFile.test.ts`
Expected: `logoShapeFile: ok` and `1/1 test file(s) passed`.

- [ ] **Step 5: Wire the route**

In `app/src/app/api/branding/logo/route.ts`:

1. Add the import:

```ts
import { ensureLogoShape, removeLogoShape } from "@/lib/logoShapeFile";
```

2. Change `export async function GET() {` to take the request:

```ts
/**
 * Streams the current logo for preview in the settings page + img tags.
 * `?shape=1` streams its one-colour shape instead (see lib/logoShapeFile),
 * or 404 when the logo can't be made one-colour, so the caller shows the
 * original.
 */
export async function GET(req: Request) {
```

3. Directly after the existing `if (!filePath) { return NextResponse.json(... 404) }` block, before `const ext = ...`, add:

```ts
  if (new URL(req.url).searchParams.get("shape") === "1") {
    const shape = await ensureLogoShape(filePath);
    if (!shape) {
      return NextResponse.json({ ok: false, error: "No one-colour logo." }, { status: 404 });
    }
    filePath = shape;
  }
```

4. In `DELETE`, inside `if (filename) {`, after the existing `try { ... unlinkSync(full) } catch {}`, add:

```ts
    if (full) removeLogoShape(full);
```

The POST branch needs no change: it already deletes every `logo.*` file in the branding dir before writing the new logo, which covers `logo.shape.png` and `logo.shape.none`.

- [ ] **Step 6: Typecheck**

Run: `cd app && npx tsc --noEmit -p . 2>&1 | grep -v "^.next/"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/logoShapeFile.ts app/src/lib/logoShapeFile.test.ts app/src/app/api/branding/logo/route.ts
git commit -m "feat(branding): cache a one-colour logo shape and serve it at ?shape=1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Paint it in the staff app and member app

**Files:**
- Modify: `app/src/components/ui/Logo.tsx`
- Modify: `app/src/components/layout/Sidebar.tsx:616` and `:838`
- Modify: `app/src/components/layout/AppShell.tsx:196`
- Modify: `app/src/components/clientapp/ClientAppFrame.tsx:131`

**Interfaces:**
- Consumes: `GET /api/branding/logo?...&shape=1` from Task 2. It returns a PNG, or 404 when there is no shape.
- Produces: `<Logo src alt height oneColour? colour? onShapeMissing? />`.
  - `oneColour?: boolean`: paint the shape in `colour`. Only applies when `src` is the branding route (it starts with `/api/branding/logo`). Any other `src` (a campaign page's data URI) renders as today.
  - `colour?: string`: CSS colour, default `"var(--text-primary)"`.
  - `onShapeMissing?: () => void`: called once when the shape 404s and the original is shown instead.

- [ ] **Step 1: Update `Logo.tsx`**

Replace the component with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

import { ADONIS_LOGO_ASPECT, ADONIS_LOGO_PATH, ADONIS_LOGO_VIEWBOX } from "./adonisLogoPath";

/** The branding route: only its logos have a one-colour shape (`&shape=1`). */
const BRANDING_ROUTE = "/api/branding/logo";

function shapeSrcFor(src: string): string {
  return `${src}${src.includes("?") ? "&" : "?"}shape=1`;
}

/**
 * App-chrome logo lockup. A business logo `src` renders as an image; with none
 * (or a broken one) it falls back to the AdonisAgent mark and wordmark.
 *
 * `oneColour` paints the business logo in a single colour (the theme's text
 * colour by default), so it reads on light and dark alike and follows the
 * light/dark toggle instantly. It uses the logo's shape (`?shape=1`, made
 * server-side) as a CSS mask over currentColor. An invisible <img> of the
 * same shape gives the box its natural width. With no shape (404) it shows
 * the original logo.
 *
 * The fallback is the ADONIS wordmark (brand/logo), drawn in the theme's
 * text colour so it adapts to light and dark and any tenant palette.
 *
 * `alt` carries the business name, used as the img alt and folded into the
 * fallback's aria-label. It is not shown as a visible sub-line: the business
 * name already sits in the chrome's account switcher.
 *
 * Plain <img> (not next/image) so the onError swap works and arbitrary dynamic
 * sources load; the app sets images.unoptimized. The useEffect re-check covers
 * the case where the image errors BEFORE React hydrates (onError alone misses
 * those — a known React <img> pitfall).
 */
export function Logo({
  src,
  alt,
  height = 24,
  oneColour = false,
  colour = "var(--text-primary)",
  onShapeMissing,
}: {
  src: string | null;
  alt: string;
  height?: number;
  oneColour?: boolean;
  colour?: string;
  onShapeMissing?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [shapeFailed, setShapeFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  const shapeRef = useRef<HTMLImageElement>(null);

  const wantsShape = oneColour && !!src && src.startsWith(BRANDING_ROUTE) && !shapeFailed;

  useEffect(() => {
    setShapeFailed(false);
  }, [src]);

  useEffect(() => {
    // Already finished loading and broke before the handler attached.
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
    const shape = shapeRef.current;
    if (shape && shape.complete && shape.naturalWidth === 0) missShape();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, wantsShape]);

  function missShape() {
    setShapeFailed(true);
    onShapeMissing?.();
  }

  if (!src || failed) {
    // The ADONIS wordmark, at the cap height the old lockup used.
    const h = Math.round(height * 0.82);
    return (
      <span role="img" aria-label={alt ? `Adonis — ${alt}` : "Adonis"} style={{ display: "inline-flex", alignItems: "center", flex: "none", maxWidth: "100%" }}>
        <svg aria-hidden viewBox={ADONIS_LOGO_VIEWBOX} style={{ height: h, width: Math.round(h * ADONIS_LOGO_ASPECT), color: "var(--text-primary)", display: "block" }}>
          <path d={ADONIS_LOGO_PATH} fill="currentColor" />
        </svg>
      </span>
    );
  }

  if (wantsShape) {
    const shapeSrc = shapeSrcFor(src);
    const mask = `url("${shapeSrc}")`;
    return (
      <span
        role="img"
        aria-label={alt}
        style={{
          display: "inline-block",
          flex: "none",
          lineHeight: 0,
          color: colour,
          backgroundColor: "currentColor",
          WebkitMaskImage: mask,
          maskImage: mask,
          WebkitMaskSize: "100% 100%",
          maskSize: "100% 100%",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- sizes the box; the mask above paints it */}
        <img ref={shapeRef} src={shapeSrc} alt="" aria-hidden onError={missShape} style={{ height, width: "auto", display: "block", opacity: 0 }} />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      style={{ height, width: "auto", opacity: 0.92, display: "block" }}
    />
  );
}
```

- [ ] **Step 2: Turn it on in the four chrome spots**

Add the `oneColour` prop to each of these. Change nothing else on those lines.

- `app/src/components/layout/Sidebar.tsx:616`: `<Logo src={logoSrc} alt={businessName} height={24} oneColour />`
- `app/src/components/layout/Sidebar.tsx:838`: `<Logo src={logoSrc} alt={businessName} height={24} oneColour />`
- `app/src/components/layout/AppShell.tsx:196`: `<Logo src={logoSrc} alt={businessName} height={22} oneColour />`
- `app/src/components/clientapp/ClientAppFrame.tsx:131`: `<Logo src={logoSrc} alt={businessName} height={22} oneColour />`

Leave every other `<Logo>` alone: login, reset, campaign landing, welcome. The member app sets `--text-primary` from its own brand colours, so the default `colour` is already right there.

- [ ] **Step 3: Typecheck**

Run: `cd app && npx tsc --noEmit -p . 2>&1 | grep -v "^.next/"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/ui/Logo.tsx app/src/components/layout/Sidebar.tsx app/src/components/layout/AppShell.tsx app/src/components/clientapp/ClientAppFrame.tsx
git commit -m "feat(branding): staff and member app show the logo in one colour

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Account picker thumbnails and the Branding preview

**Files:**
- Modify: `app/src/lib/tenantLogoThumb.ts`
- Modify: `app/src/app/select-account/page.tsx`
- Modify: `app/src/app/select-account/AccountSelector.tsx` (the logo `<img>` near line 88)
- Modify: `app/src/components/settings/BrandingForm.tsx` (the preview panel, lines 109-147)

**Interfaces:**
- Consumes:
  - `ensureLogoShape(logoPath: string): Promise<string | null>` from `@/lib/logoShapeFile`;
  - `<Logo oneColour colour onShapeMissing>` from Task 3;
  - `THEME_MODES` from `@/lib/theme` (`THEME_MODES.light.bg = "#f4f5f7"`, `.accent = "#16181c"`; `THEME_MODES.dark.bg = "#0c0d10"`, `.accent = "#ffffff"`).
- Produces:
  - `tenantLogoThumb(tenantId: number, px?: number): Promise<{ src: string; oneColour: boolean } | null>`. The return type changes, and its only caller is `select-account/page.tsx`.

- [ ] **Step 1: The thumbnail prefers the shape**

Replace the body of `tenantLogoThumb.ts` with:

```ts
import "server-only";
import sharp from "sharp";

import { runWithTenant } from "@/lib/db/tenant";
import { resolveLogoPath } from "@/lib/branding";
import { ensureLogoShape } from "@/lib/logoShapeFile";

/**
 * A business's logo as a small inline PNG, for screens that list several
 * businesses at once (the account picker). Each is resolved inside its own
 * tenant, so there is no cross-tenant logo route to secure.
 *
 * It prefers the one-colour shape (`oneColour: true`): the caller paints it
 * in the theme's text colour, so it reads on light and dark. If there is no
 * shape, it is the logo as uploaded. Anything that fails is null, and the
 * caller shows an initial.
 */
export async function tenantLogoThumb(tenantId: number, px = 72): Promise<{ src: string; oneColour: boolean } | null> {
  try {
    const file = runWithTenant(tenantId, () => resolveLogoPath());
    if (!file) return null;
    const shape = await ensureLogoShape(file);
    const png = await sharp(shape ?? file, { density: 200 })
      .resize(px, px, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    return { src: `data:image/png;base64,${png.toString("base64")}`, oneColour: shape !== null };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Update the picker page and selector**

In `app/src/app/select-account/page.tsx`, change the `logos` cast type to match:

```ts
  ) as Record<number, { src: string; oneColour: boolean } | null>;
```

In `app/src/app/select-account/AccountSelector.tsx`:

- Change the prop type to `logos?: Record<number, { src: string; oneColour: boolean } | null>;`.
- Replace the `{logos[m.tenantId] ? ( <img .../> ) : (...)}` block with:

```tsx
              {logos[m.tenantId] ? (
                logos[m.tenantId]!.oneColour ? (
                  <span
                    aria-hidden
                    style={{
                      width: 28,
                      height: 28,
                      backgroundColor: "currentColor",
                      WebkitMaskImage: `url("${logos[m.tenantId]!.src}")`,
                      maskImage: `url("${logos[m.tenantId]!.src}")`,
                      WebkitMaskSize: "contain",
                      maskSize: "contain",
                      WebkitMaskRepeat: "no-repeat",
                      maskRepeat: "no-repeat",
                      WebkitMaskPosition: "center",
                      maskPosition: "center",
                    }}
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- inline data URI, already sized
                  <img src={logos[m.tenantId]!.src} alt="" width={28} height={28} style={{ width: 28, height: 28, objectFit: "contain" }} />
                )
              ) : (
                m.name[0]?.toUpperCase() ?? "?"
              )}
```

The surrounding span already sets `color: "var(--text-primary)"`, so `currentColor` is the theme's text colour.

- [ ] **Step 3: Branding preview on light and dark**

In `app/src/components/settings/BrandingForm.tsx`:

1. Add the imports: `import { Logo } from "@/components/ui/Logo";` and `import { THEME_MODES } from "@/lib/theme";`. Check that `@/lib/theme` has no `server-only` import; it is already imported by client components such as `ThemeToggle`.
2. Add the state: `const [noShape, setNoShape] = useState(false);`. Reset it to `false` wherever `cacheKey` changes after an upload or remove (the same place `setCacheKey` is called).
3. Replace the single preview `<div>` (the dashed box with `background: "#0a0a0a"` and its `hasLogo ? <img/> : <empty/>` content) with:

```tsx
          {hasLogo ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                {(["light", "dark"] as const).map((mode) => (
                  <div
                    key={mode}
                    style={{
                      display: "grid",
                      placeItems: "center",
                      gap: 10,
                      padding: 24,
                      minHeight: 150,
                      borderRadius: "var(--radius)",
                      border: "1px solid var(--hairline)",
                      // The two app themes, shown side by side whatever mode the viewer is in.
                      background: THEME_MODES[mode].bg,
                    }}
                  >
                    <Logo
                      src={`/api/branding/logo?v=${cacheKey}`}
                      alt="Business logo"
                      height={56}
                      oneColour
                      colour={THEME_MODES[mode].accent}
                      onShapeMissing={() => setNoShape(true)}
                    />
                    <span style={{ fontSize: 12, color: THEME_MODES[mode].accent, opacity: 0.6 }}>{mode === "light" ? "Light mode" : "Dark mode"}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.5 }}>
                {noShape
                  ? "Shown as uploaded. Use a transparent PNG for a logo that suits light and dark."
                  : "The app shows your logo in one colour, so it reads in light and dark mode."}
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 24,
                borderRadius: "var(--radius)",
                border: "1px dashed var(--hairline-strong)",
                minHeight: 180,
                color: "var(--text-tertiary)",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              <div>
                <ImagePlus size={28} style={{ marginBottom: 8, opacity: 0.6 }} />
                <div>No logo uploaded yet.</div>
              </div>
            </div>
          )}
```

Keep the rest of the form as it is: the file input, the buttons and the tips. In the tips text, "use a transparent PNG" stays.

- [ ] **Step 4: Typecheck and the full suite**

Run: `cd app && npx tsc --noEmit -p . 2>&1 | grep -v "^.next/"; npm test 2>&1 | tail -2`
Expected: no type errors, and every test file passes.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/tenantLogoThumb.ts app/src/app/select-account/page.tsx app/src/app/select-account/AccountSelector.tsx app/src/components/settings/BrandingForm.tsx
git commit -m "feat(branding): one-colour picker thumbnails and a light/dark logo preview

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Browser check, build, deploy

Done by the controller, not a subagent. It needs the dev session recipe in memory `diy-program-library.md`:
- back up `data/control.db` and the tenant DBs first, and restore them afterwards;
- mint a staff session in `auth_sessions` for user 2279, and a member session;
- use playwright-core with chrome-headless-shell.

- [ ] **Step 1: Staff app check.** Look at the sidebar logo for Inspire (580) and Optimal Health (1028) with the `ui-theme` cookie on `dark`, then on `light`, at 1280px and 390px.
  - Expected: Inspire's white-and-gold logo shows near-white on dark and near-black on light.
  - Expected: there is no rectangle behind any logo.
- [ ] **Step 2: Other surfaces.**
  - **Member app header:** one member session per tenant, at 320px and 390px.
  - **The account picker.**
  - **Settings > Branding:** both preview panels show the logo.
  - **The no-shape note:** check it with a photo-like logo in a dev tenant only, then restore.
- [ ] **Step 3: Unchanged surfaces.** A campaign landing page and the member app login still show the logo as uploaded.
- [ ] **Step 4: Ship it.**
  - Run `rm -rf .next && npx next build`.
  - Push `main`.
  - Run `cd app && railway up --detach`.
  - Wait until the deployment is SUCCESS and `https://www.adonisagent.ie/api/health` returns 200.
- [ ] **Step 5: Memory.** Add a memory file `logo-one-colour.md`, with a line in `MEMORY.md`, covering:
  - the shape file;
  - the `?shape=1` route;
  - the `oneColour` prop;
  - where it is and isn't used;
  - the badge-with-cut-out-text limit.
