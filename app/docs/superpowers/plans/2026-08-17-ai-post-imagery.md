# AI Post Imagery + Logo-on-Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Content Studio image post auto-gets a premium FLUX-1.1-Pro AI background per slide (swappable/regenerable, metered at 4¢/image), and the tenant's logo is drawn on every template with a per-design toggle.

**Architecture:** A new `src/lib/ai/image/` module (pure prompt helpers → fal client → metered chokepoint) feeds slides' EXISTING `backgroundAssetId` slot via the image library. The carousel generate route stores a prompt per slide and fires a detached sequential queue (the `runBlogGeneration` pattern); the designer polls while generating. Logo overlay is one shared canvas function called after `template.render` at both existing render sites.

**Tech Stack:** Next.js 14 App Router, drizzle + better-sqlite3 (sync), raw `fetch` to fal.ai (NO new deps), sharp via existing `processImageUpload`, plain-tsx test runner (`npm test -- <file>`).

**Spec:** `docs/superpowers/specs/2026-08-17-ai-post-imagery-design.md`

## Global Constraints

- fal endpoint EXACTLY: `POST https://fal.run/fal-ai/flux-pro/v1.1`, header `Authorization: Key ${FAL_KEY}`, body `{ prompt, image_size: { width, height }, num_images: 1, output_format: "jpeg", enable_safety_checker: true }`; response `{ images: [{ url }] }`, then download the url.
- `IMAGE_MODEL_ID = "fal:flux-1.1-pro"`; `IMAGE_COST_CENTS = 4`; agent key for all post-image spend: `"carousel"`.
- `ASPECT_DIMS` EXACTLY: `1:1 → 992×992`, `4:5 → 864×1088`, `9:16 → 736×1312` (all multiples of 32, all < 1,000,000 px).
- Fail-closed on missing `FAL_KEY`: `isImageGenConfigured()` gates the auto-queue, the sync route (400), and all designer AI-image UI. With the key unset, EVERY existing flow behaves exactly as today.
- Every image call goes gate→call→meter through `generatePostImage` (assertAiAllowed → falGenerateImage → library save → meterAndChargeFlat). No other file may reference `fal.run` (CI-guarded).
- The generated prompt's no-text clause must survive verbatim: `no text, no words, no lettering, no logos, no watermarks`.
- New DB columns are additive + nullable (or defaulted): `carousel_slides.image_status/image_prompt/image_error`, `carousel_sets.show_logo INTEGER NOT NULL DEFAULT 1`. Zero visible change on deploy.
- No new npm dependencies.
- Gate per task: `npm run typecheck` && `npm test -- <touched test files>`; full `npm test` + `npx next build` at Tasks 9–11.
- All commits on `main` (matches this repo's convention).

---

### Task 1: Pure prompt layer

**Files:**
- Create: `src/lib/ai/image/prompt.ts`
- Test: `src/lib/ai/image/prompt.test.ts`

**Interfaces:**
- Consumes: nothing (pure module — deliberately NO `server-only`, no imports, same reasoning as `lib/humanName.ts`).
- Produces: `type ImageAspect = "1:1" | "9:16" | "4:5"`; `ASPECT_DIMS: Record<ImageAspect, {width: number; height: number}>`; `defaultImageStyle(profile: {businessName?: string; tagline?: string; location?: string}): string`; `fallbackScene(slide: {heading?: string | null; body?: string | null}): string`; `buildImagePrompt(input: {houseStyle: string; scene: string}): string`. Tasks 5, 7, 8, 11 consume these.

- [ ] **Step 1: Write the failing test**

```ts
// Run: npm test -- src/lib/ai/image/prompt.test.ts
import assert from "node:assert/strict";
import {
  ASPECT_DIMS,
  buildImagePrompt,
  defaultImageStyle,
  fallbackScene,
} from "./prompt";

(async () => {
  // Exact dims — chosen to be multiples of 32 (fal constraint) and under
  // 1,000,000 px (fal bills $0.04 per rounded-up MP → always one 4¢ unit).
  assert.deepEqual(ASPECT_DIMS["1:1"], { width: 992, height: 992 });
  assert.deepEqual(ASPECT_DIMS["4:5"], { width: 864, height: 1088 });
  assert.deepEqual(ASPECT_DIMS["9:16"], { width: 736, height: 1312 });
  for (const [aspect, d] of Object.entries(ASPECT_DIMS)) {
    assert.equal(d.width % 32, 0, `${aspect} width multiple of 32`);
    assert.equal(d.height % 32, 0, `${aspect} height multiple of 32`);
    assert.ok(d.width * d.height < 1_000_000, `${aspect} under 1MP`);
  }

  // buildImagePrompt: scene first, then style, then the fixed suffixes.
  const p = buildImagePrompt({
    houseStyle: "Warm minimal wellness photography.",
    scene: "A sunlit treatment room with a linen-covered bed.",
  });
  assert.ok(p.startsWith("A sunlit treatment room with a linen-covered bed. "));
  assert.ok(p.includes("Warm minimal wellness photography. "), "style present, trailing dots deduped");
  assert.ok(p.includes("photorealistic"), "quality suffix present");
  assert.ok(
    p.includes("no text, no words, no lettering, no logos, no watermarks"),
    "no-text clause present verbatim",
  );
  assert.ok(!p.includes(".."), "no doubled dots after joining");

  // fallbackScene: heading + body joined; empty-safe.
  assert.equal(
    fallbackScene({ heading: "Recover faster", body: "Cold water therapy" }),
    "Recover faster — Cold water therapy",
  );
  assert.equal(fallbackScene({ heading: "Only heading", body: "" }), "Only heading");
  assert.equal(
    fallbackScene({ heading: null, body: null }),
    "an atmospheric scene that fits the brand",
  );

  // defaultImageStyle: uses tagline + location when present, generic otherwise.
  const s1 = defaultImageStyle({ tagline: "a recovery & wellness clinic", location: "Clonmel, Co. Tipperary" });
  assert.ok(s1.includes("a recovery & wellness clinic"));
  assert.ok(s1.includes("in Clonmel, Co. Tipperary"));
  const s2 = defaultImageStyle({});
  assert.ok(s2.includes("a premium local business"));
  assert.ok(!s2.includes(" in "), "no dangling location clause");

  console.log("prompt.test.ts: all assertions passed");
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/ai/image/prompt.test.ts`
Expected: FAIL — cannot find module `./prompt`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Pure prompt/dimension helpers for AI post imagery. Deliberately NO
 * `server-only` and zero imports so the plain tsx test runner executes this
 * file directly (same reasoning as lib/humanName.ts).
 */

export type ImageAspect = "1:1" | "9:16" | "4:5";

/**
 * fal FLUX 1.1 Pro bills $0.04 per rounded-up megapixel — every size here
 * stays under 1,000,000 px so one image is always exactly one 4¢ unit
 * (IMAGE_COST_CENTS in falClient.ts). Dimensions must be multiples of 32
 * (fal constraint). Ratio drift from the true aspect is ≤0.8% — invisible
 * under the designer's cover-fit background cropping.
 */
export const ASPECT_DIMS: Record<ImageAspect, { width: number; height: number }> = {
  "1:1": { width: 992, height: 992 },
  "4:5": { width: 864, height: 1088 },
  "9:16": { width: 736, height: 1312 },
};

/**
 * The fallback house style when the tenant hasn't set `brand_image_style`
 * (Settings → Branding). Derived from the business profile so it's on-brand
 * out of the box.
 */
export function defaultImageStyle(profile: {
  businessName?: string;
  tagline?: string;
  location?: string;
}): string {
  const what = profile.tagline?.trim() || "a premium local business";
  const where = profile.location?.trim() ? ` in ${profile.location.trim()}` : "";
  return `Warm, calming lifestyle and interior photography for ${what}${where}: soft natural light, neutral tones with subtle warm accents, real-feeling spaces and people, aspirational but authentic`;
}

/** Scene used when a slide has no AI-written image brief (manual slides). */
export function fallbackScene(slide: {
  heading?: string | null;
  body?: string | null;
}): string {
  const heading = slide.heading?.trim() ?? "";
  const body = slide.body?.trim() ?? "";
  const joined = [heading, body].filter(Boolean).join(" — ");
  return joined || "an atmospheric scene that fits the brand";
}

/**
 * Compose the final FLUX prompt: scene, then house style, then fixed quality
 * + no-text suffixes. FLUX has no negative prompts, so "no text…" must live
 * in the prompt — the templates draw all copy themselves and a background
 * with baked-in lettering is unusable.
 */
export function buildImagePrompt(input: { houseStyle: string; scene: string }): string {
  const scene = input.scene.trim().replace(/\.+$/, "");
  const style = input.houseStyle.trim().replace(/\.+$/, "");
  return `${scene}. ${style}. Editorial photography, natural light, shallow depth of field, premium quality, photorealistic, high detail. Clean background with no text, no words, no lettering, no logos, no watermarks.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/ai/image/prompt.test.ts`
Expected: PASS (`prompt.test.ts: all assertions passed`).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/lib/ai/image/prompt.ts src/lib/ai/image/prompt.test.ts
git commit -m "feat(imagery): pure prompt + dimension helpers for AI post backgrounds"
```

---

### Task 2: Flat-cost metering

**Files:**
- Modify: `src/lib/ai/usage.ts` (append after `meterAndCharge`, ~line 206)
- Test: create `src/lib/ai/usageFlat.test.ts`

**Interfaces:**
- Consumes: existing `controlSqlite`, `currentMonth()`, `getTenantCapCents`, `getMonthlyUsageCents`, `withMargin`, `recordAiSpend` (all already imported/defined in usage.ts).
- Produces: `recordFlatUsage(tenantId: number, agentKey: string, model: string, costCents: number): number`; `meterAndChargeFlat(tenantId: number, agentKey: string, model: string, costCents: number): void`. Task 5 consumes `meterAndChargeFlat`.

- [ ] **Step 1: Write the failing test** — mirror `usage.test.ts`'s scratch-tenant harness exactly (async IIFE, real throwaway tenant row, cleanup in finally):

```ts
// Run: npm test -- src/lib/ai/usageFlat.test.ts
import assert from "node:assert/strict";
import { controlSqlite } from "../db/control";
import {
  recordFlatUsage,
  meterAndChargeFlat,
  getMonthlyUsageCents,
  getMonthlyUsageByAgent,
  getMonthlyUsageByModel,
} from "./usage";

(async () => {
  // Scratch tenant — ai_usage.tenant_id has an FK, so use a real throwaway
  // tenant row (same pattern as usage.test.ts / apiKeys.test.ts).
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = 'aiflat-test'").run();
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('aiflat-test','AI Flat Test','tenants/aiflat-test/void.db',1) RETURNING id",
    )
    .get() as { id: number };
  const tid = t.id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM ai_usage WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  try {
    assert.equal(getMonthlyUsageCents(tid), 0, "clean slate");

    // recordFlatUsage: cost lands verbatim, all four token columns are 0.
    const cost = recordFlatUsage(tid, "carousel", "fal:flux-1.1-pro", 4);
    assert.equal(cost, 4, "returns the cost it recorded");
    assert.equal(getMonthlyUsageCents(tid), 4, "flat cost counted in the monthly total");
    const row = controlSqlite
      .prepare(
        "SELECT input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cost_cents, model, agent_key FROM ai_usage WHERE tenant_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(tid) as {
      input_tokens: number; output_tokens: number; cache_read_tokens: number;
      cache_create_tokens: number; cost_cents: number; model: string; agent_key: string;
    };
    assert.equal(row.input_tokens, 0);
    assert.equal(row.output_tokens, 0);
    assert.equal(row.cache_read_tokens, 0);
    assert.equal(row.cache_create_tokens, 0);
    assert.equal(row.cost_cents, 4);
    assert.equal(row.model, "fal:flux-1.1-pro");
    assert.equal(row.agent_key, "carousel");

    // Existing rollups include the flat row with no changes.
    assert.equal(getMonthlyUsageByAgent(tid).carousel, 4);
    assert.ok(
      getMonthlyUsageByModel(tid).some((m) => m.model === "fal:flux-1.1-pro" && m.cents === 4),
      "per-model breakdown row present",
    );

    // meterAndChargeFlat inside the free tranche: records spend, debits no credits
    // (billable overflow is 0 — identical tranche math to meterAndCharge).
    meterAndChargeFlat(tid, "carousel", "fal:flux-1.1-pro", 4);
    assert.equal(getMonthlyUsageCents(tid), 8, "second flat call recorded");

    console.log("usageFlat.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/ai/usageFlat.test.ts`
Expected: FAIL — `recordFlatUsage` is not exported.

- [ ] **Step 3: Implement** — in `src/lib/ai/usage.ts`: extract the tranche/overflow billing that `meterAndCharge` currently inlines into a private helper, delegate `meterAndCharge` to it (its doc comment and exported behaviour stay EXACTLY as-is), and add the two flat-cost functions:

```ts
/**
 * Shared tranche/overflow billing used by `meterAndCharge` (token calls) and
 * `meterAndChargeFlat` (flat-cost calls): the slice of `rawCost` lying ABOVE
 * the free tranche is marked up (`withMargin`, +5%) and debited from prepaid
 * credits. `usedBefore` must be read BEFORE the usage row was recorded so the
 * call isn't counted against its own free-tranche headroom.
 */
function chargeOverflow(
  tenantId: number,
  agentKey: string,
  usedBefore: number,
  rawCost: number,
): void {
  const trancheCents = getTenantCapCents(tenantId);
  const freeRemaining = Math.max(0, trancheCents - usedBefore);
  const overflowRaw = Math.max(0, rawCost - freeRemaining);
  const billable = withMargin(overflowRaw);
  if (billable > 0) recordAiSpend(tenantId, billable, agentKey);
}
```

`meterAndCharge`'s body becomes (keep its existing doc comment verbatim):

```ts
export function meterAndCharge(tenantId: number, agentKey: string, model: string, u: Usage): void {
  const usedBefore = getMonthlyUsageCents(tenantId);
  const rawCost = recordUsage(tenantId, agentKey, model, u);
  chargeOverflow(tenantId, agentKey, usedBefore, rawCost);
}
```

Then append:

```ts
/**
 * Record a FLAT-COST AI call (per-image pricing — no token counts) against a
 * tenant's monthly `ai_usage` bucket. Same row shape as `recordUsage` with all
 * four token columns 0, so every existing rollup (total / by-agent / by-model)
 * includes it with no changes. Returns the cost it recorded.
 */
export function recordFlatUsage(
  tenantId: number,
  agentKey: string,
  model: string,
  costCents: number,
): number {
  controlSqlite
    .prepare(
      `INSERT INTO ai_usage (tenant_id, yyyymm, agent_key, model, input_tokens, output_tokens, cache_read_tokens, cache_create_tokens, cost_cents)
       VALUES (?,?,?,?,0,0,0,0,?)`,
    )
    .run(tenantId, currentMonth(), agentKey, model, costCents);
  return costCents;
}

/**
 * `meterAndCharge` for flat-cost calls (post images): identical
 * free-tranche/overflow/margin billing via the shared `chargeOverflow`, with
 * the raw cost given directly instead of estimated from tokens.
 */
export function meterAndChargeFlat(
  tenantId: number,
  agentKey: string,
  model: string,
  costCents: number,
): void {
  const usedBefore = getMonthlyUsageCents(tenantId);
  const rawCost = recordFlatUsage(tenantId, agentKey, model, costCents);
  chargeOverflow(tenantId, agentKey, usedBefore, rawCost);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/ai/usageFlat.test.ts` then `npm test -- src/lib/ai/usage.test.ts` (regression).
Expected: both PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/lib/ai/usage.ts src/lib/ai/usageFlat.test.ts
git commit -m "feat(imagery): flat-cost metering (recordFlatUsage + meterAndChargeFlat)"
```

---

### Task 3: fal client

**Files:**
- Create: `src/lib/ai/image/falClient.ts`
- Test: `src/lib/ai/image/falClient.test.ts`

**Interfaces:**
- Consumes: `process.env.FAL_KEY`; global `fetch` (injectable).
- Produces: `isImageGenConfigured(): boolean`; `falGenerateImage(input: {prompt: string; width: number; height: number}, fetchImpl?: typeof fetch): Promise<Buffer>`; `class ImageGenError extends Error`; `const IMAGE_MODEL_ID = "fal:flux-1.1-pro"`; `const IMAGE_COST_CENTS = 4`. Tasks 5, 7, 8, 9 consume these.

- [ ] **Step 1: Write the failing test**

```ts
// Run: npm test -- src/lib/ai/image/falClient.test.ts
import assert from "node:assert/strict";
import {
  falGenerateImage,
  ImageGenError,
  isImageGenConfigured,
  IMAGE_COST_CENTS,
  IMAGE_MODEL_ID,
} from "./falClient";

(async () => {
  const prevKey = process.env.FAL_KEY;
  try {
    process.env.FAL_KEY = "test-key-123";
    assert.equal(isImageGenConfigured(), true);

    // Happy path: request shape + bytes round-trip via injected fetch.
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const okFetch = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("fal.run")) {
        return new Response(
          JSON.stringify({ images: [{ url: "https://cdn.example/img.jpg" }] }),
          { status: 200 },
        );
      }
      return new Response(bytes, { status: 200 });
    }) as typeof fetch;

    const buf = await falGenerateImage(
      { prompt: "a calm room", width: 992, height: 992 },
      okFetch,
    );
    assert.equal(buf.length, 4, "returns the downloaded bytes");
    assert.equal(calls.length, 2, "one generate call + one download");
    assert.equal(calls[0].url, "https://fal.run/fal-ai/flux-pro/v1.1");
    const hdrs = calls[0].init?.headers as Record<string, string>;
    assert.equal(hdrs.Authorization, "Key test-key-123");
    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.prompt, "a calm room");
    assert.deepEqual(body.image_size, { width: 992, height: 992 });
    assert.equal(body.num_images, 1);
    assert.equal(body.output_format, "jpeg");
    assert.equal(body.enable_safety_checker, true);

    // API error → ImageGenError.
    const errFetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    await assert.rejects(
      () => falGenerateImage({ prompt: "x", width: 992, height: 992 }, errFetch),
      ImageGenError,
    );

    // Empty images array → ImageGenError.
    const emptyFetch = (async () =>
      new Response(JSON.stringify({ images: [] }), { status: 200 })) as typeof fetch;
    await assert.rejects(
      () => falGenerateImage({ prompt: "x", width: 992, height: 992 }, emptyFetch),
      ImageGenError,
    );

    // Missing key → ImageGenError before any fetch.
    delete process.env.FAL_KEY;
    assert.equal(isImageGenConfigured(), false);
    await assert.rejects(
      () => falGenerateImage({ prompt: "x", width: 992, height: 992 }, okFetch),
      ImageGenError,
    );

    assert.equal(IMAGE_COST_CENTS, 4);
    assert.equal(IMAGE_MODEL_ID, "fal:flux-1.1-pro");
    console.log("falClient.test.ts: all assertions passed");
  } finally {
    if (prevKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = prevKey;
  }
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/ai/image/falClient.test.ts`
Expected: FAIL — cannot find module `./falClient`.

- [ ] **Step 3: Implement**

```ts
import "server-only";

/**
 * The ONLY file that talks to fal.ai — enforced by meteredGuard.test.ts (the
 * `fal.run` pattern is forbidden everywhere else). Raw fetch on purpose, no
 * SDK dependency — the same deliberate choice as MailgunSender.
 */

export const IMAGE_MODEL_ID = "fal:flux-1.1-pro";
/**
 * fal bills FLUX 1.1 Pro at $0.04 per rounded-up megapixel; every ASPECT_DIMS
 * size (lib/ai/image/prompt.ts) is under 1MP, so one image = one flat 4¢ unit.
 */
export const IMAGE_COST_CENTS = 4;

const FAL_ENDPOINT = "https://fal.run/fal-ai/flux-pro/v1.1";

export function isImageGenConfigured(): boolean {
  return !!process.env.FAL_KEY?.trim();
}

export class ImageGenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGenError";
  }
}

interface FalImageResponse {
  images?: Array<{ url?: string }>;
}

/**
 * Generate one JPEG with FLUX 1.1 Pro and return its bytes. `fetchImpl` is
 * injectable for tests; defaults to global fetch. Throws ImageGenError on any
 * API/shape failure — callers map it to image_status='failed' (queue) or a
 * 500 (sync route). 60s timeout on each leg; the sync fal.run call typically
 * returns in ~5–10s.
 */
export async function falGenerateImage(
  input: { prompt: string; width: number; height: number },
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new ImageGenError("Image generation isn't configured (FAL_KEY missing).");
  }

  const res = await fetchImpl(FAL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${key}`,
    },
    body: JSON.stringify({
      prompt: input.prompt,
      image_size: { width: input.width, height: input.height },
      num_images: 1,
      output_format: "jpeg",
      enable_safety_checker: true,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ImageGenError(`Image API error ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as FalImageResponse;
  const url = json.images?.[0]?.url;
  if (!url) throw new ImageGenError("Image API returned no image.");

  const imgRes = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  if (!imgRes.ok) {
    throw new ImageGenError(`Couldn't download the generated image (${imgRes.status}).`);
  }
  return Buffer.from(await imgRes.arrayBuffer());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/ai/image/falClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/lib/ai/image/falClient.ts src/lib/ai/image/falClient.test.ts
git commit -m "feat(imagery): fal FLUX 1.1 Pro client (raw fetch, fail-closed on FAL_KEY)"
```

---

### Task 4: Schema, migration + server plumbing

**Files:**
- Modify: `src/lib/db/schema.ts` (carouselSets ~853, carouselSlides ~864)
- Modify: `src/lib/db/tenant.ts` (CREATE TABLE blocks ~1163–1194; append a migration block after the carousel caption block that ends ~1474)
- Modify: `src/lib/image/carousels.ts` (`AddSlideInput`/`addSlide` ~78–146; `updateCarousel` ~65)
- Modify: `src/lib/settings.ts` (append getter near `getBrandingLogoFilename` ~98)
- Modify: `src/app/api/content-studio/carousels/[id]/route.ts` (PATCH ~29 — accept `showLogo`)

No pure test is practical for a live-DB migration under the DB-free runner — the PRAGMA-guard pattern mirrors the reviewed caption migration directly. Gate: typecheck + build + full test suite regression.

- [ ] **Step 1: Drizzle schema — `carouselSets`** (after `name`):

```ts
  /** Draw the tenant's uploaded logo on every slide of this design (preview + export). */
  showLogo: integer("show_logo", { mode: "boolean" }).notNull().default(true),
```

(Match the file's existing boolean-column style — if other boolean columns use a different idiom, mirror that idiom for `show_logo` instead.)

- [ ] **Step 2: Drizzle schema — `carouselSlides`** (after `backgroundZoom`):

```ts
  /** AI background generation state: null = never generated, else 'generating' | 'ready' | 'failed'. */
  imageStatus: text("image_status", { enum: ["generating", "ready", "failed"] }),
  /** The prompt last used for this slide's AI background (Regenerate reuses it; Edit-prompt overwrites it). */
  imagePrompt: text("image_prompt"),
  /** Operator-visible message when image_status = 'failed'. */
  imageError: text("image_error"),
```

- [ ] **Step 3: `tenant.ts` CREATE TABLE blocks** — add the same columns to the `CREATE TABLE IF NOT EXISTS carousel_sets` (`show_logo INTEGER NOT NULL DEFAULT 1`) and `carousel_slides` (`image_status TEXT`, `image_prompt TEXT`, `image_error TEXT`) statements so fresh tenants get them at create time.

- [ ] **Step 4: `tenant.ts` migration block** — append AFTER the existing carousel caption/heading_font block (the try/catch ending ~line 1474), mirroring its exact shape:

```ts
  // Carousel AI-imagery + logo columns (2026-08-17): additive, nullable/defaulted.
  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(carousel_slides)")
      .all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "image_status")) {
      sqlite.exec("ALTER TABLE carousel_slides ADD COLUMN image_status TEXT");
    }
    if (!cols.find((c) => c.name === "image_prompt")) {
      sqlite.exec("ALTER TABLE carousel_slides ADD COLUMN image_prompt TEXT");
    }
    if (!cols.find((c) => c.name === "image_error")) {
      sqlite.exec("ALTER TABLE carousel_slides ADD COLUMN image_error TEXT");
    }
    const setCols = sqlite
      .prepare("PRAGMA table_info(carousel_sets)")
      .all() as Array<{ name: string }>;
    if (!setCols.find((c) => c.name === "show_logo")) {
      sqlite.exec(
        "ALTER TABLE carousel_sets ADD COLUMN show_logo INTEGER NOT NULL DEFAULT 1",
      );
    }
  } catch (err) {
    console.error("[db] carousel imagery migration failed:", err);
  }
```

- [ ] **Step 5: `carousels.ts`** — extend `AddSlideInput` with:

```ts
  imageStatus?: "generating" | "ready" | "failed" | null;
  imagePrompt?: string | null;
```

and in `addSlide`'s `.values({...})` add:

```ts
      imageStatus: input.imageStatus ?? null,
      imagePrompt: input.imagePrompt ?? null,
```

Extend `updateCarousel`'s patch type to `{ name?: string; showLogo?: boolean }` (the spread already passes it through).

- [ ] **Step 6: `settings.ts`** — append:

```ts
/**
 * Per-tenant "house style" half of every AI post-image prompt (see
 * lib/ai/image/prompt.ts buildImagePrompt). Null/empty = caller falls back to
 * defaultImageStyle(getBusinessProfile()).
 */
export function getBrandImageStyle(): string | null {
  const v = readKey<string | null>("brand_image_style", null);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
```

- [ ] **Step 7: carousels `[id]` PATCH** — read the route first; alongside the existing `name` handling, accept and forward `showLogo`:

```ts
  const showLogo = typeof body?.showLogo === "boolean" ? body.showLogo : undefined;
```

and pass `{ name, showLogo }` (each only when defined) into `updateCarousel`, preserving the route's current validation/response shape exactly.

- [ ] **Step 8: Gate + commit**

```bash
npm run typecheck
npm test
npx next build
git add src/lib/db/schema.ts src/lib/db/tenant.ts src/lib/image/carousels.ts src/lib/settings.ts "src/app/api/content-studio/carousels/[id]/route.ts"
git commit -m "feat(imagery): slide image-status/prompt + design show_logo columns, migration, plumbing"
```

---

### Task 5: `generatePostImage` chokepoint + CI guard

**Files:**
- Create: `src/lib/ai/image/generatePostImage.ts`
- Modify: `src/lib/ai/meteredGuard.test.ts` (SANCTIONED + FORBIDDEN)

**Interfaces:**
- Consumes: `assertAiAllowed`/`meterAndChargeFlat` (Task 2), `falGenerateImage`/`IMAGE_*` (Task 3), `ASPECT_DIMS`/`ImageAspect` (Task 1), `processImageUpload`, `addLibraryAsset`/`libraryDir`.
- Produces: `generatePostImage(input: {prompt: string; aspectRatio: ImageAspect}, meter: {tenantId: number; agentKey: string}): Promise<ImageLibraryAsset>`. Tasks 7 and 8 consume it.

- [ ] **Step 1: Implement**

```ts
import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { assertAiAllowed, meterAndChargeFlat } from "@/lib/ai/usage";
import { processImageUpload } from "@/lib/image/processUpload";
import { addLibraryAsset, libraryDir } from "@/lib/image/library";
import type { ImageLibraryAsset } from "@/lib/db/schema";
import { falGenerateImage, IMAGE_COST_CENTS, IMAGE_MODEL_ID } from "./falClient";
import { ASPECT_DIMS, type ImageAspect } from "./prompt";

/**
 * The ONE metered path for a post-image generation — the image counterpart of
 * meteredCreate's gate → call → meter contract:
 *   assertAiAllowed → falGenerateImage → save into the image library →
 *   meterAndChargeFlat (flat 4¢/image under agentKey, model fal:flux-1.1-pro).
 *
 * Returns the created library asset (downscaled/re-encoded through
 * processImageUpload exactly like an uploaded photo) — callers set it as a
 * slide's backgroundAssetId. AiCapError and ImageGenError propagate; callers
 * decide (429 in the sync route, image_status='failed' in the detached queue).
 */
export async function generatePostImage(
  input: { prompt: string; aspectRatio: ImageAspect },
  meter: { tenantId: number; agentKey: string },
): Promise<ImageLibraryAsset> {
  assertAiAllowed(meter.tenantId);

  const dims = ASPECT_DIMS[input.aspectRatio] ?? ASPECT_DIMS["1:1"];
  const raw = await falGenerateImage({
    prompt: input.prompt,
    width: dims.width,
    height: dims.height,
  });

  const { buffer, width, height } = await processImageUpload(raw, "image/jpeg");
  const filename = `generated-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.jpg`;
  fs.writeFileSync(path.join(libraryDir(), filename), buffer);

  const asset = addLibraryAsset({
    filename,
    originalName: filename,
    mimeType: "image/jpeg",
    kind: "image",
    sizeBytes: buffer.length,
    width: width ?? dims.width,
    height: height ?? dims.height,
    label: `AI · ${input.prompt.slice(0, 60)}`,
  });

  meterAndChargeFlat(meter.tenantId, meter.agentKey, IMAGE_MODEL_ID, IMAGE_COST_CENTS);
  return asset;
}
```

- [ ] **Step 2: Extend the CI guard** — in `meteredGuard.test.ts`: add to `SANCTIONED`:

```ts
  "src/lib/ai/image/falClient.ts", // falGenerateImage(): the one fal.ai call site (flat-cost images; metered via generatePostImage)
```

and to `FORBIDDEN`:

```ts
  { pattern: /fal\.run/, fix: "fal.ai calls live only in lib/ai/image/falClient.ts — route image generation through generatePostImage()" },
```

- [ ] **Step 3: Run the guard + full suite**

Run: `npm test -- src/lib/ai/meteredGuard.test.ts` then `npm test`.
Expected: PASS (guard proves falClient is the only `fal.run` reference).

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck
git add src/lib/ai/image/generatePostImage.ts src/lib/ai/meteredGuard.test.ts
git commit -m "feat(imagery): metered generatePostImage chokepoint + fal.run CI guard"
```

---

### Task 6: Sonnet writes a per-slide image brief

**Files:**
- Modify: `src/lib/ai/generateCarousel.ts` (`CAROUSEL_FORMAT_RULES` ~9–50, `GeneratedSlide` ~52, `extractPayload` ~184)
- Test: create `src/lib/ai/generateCarouselExtract.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `GeneratedSlide` gains `image: string` (`""` when the model omits it); `extractPayload` is **exported** for the test. Task 7 consumes `slide.image`.

- [ ] **Step 1: Write the failing test**

```ts
// Run: npm test -- src/lib/ai/generateCarouselExtract.test.ts
import assert from "node:assert/strict";
import { extractPayload } from "./generateCarousel";

(async () => {
  const withImages = `<slides>{"caption":"cap","slides":[
    {"template":"carousel-cover","heading":"H1","body":"B1","image":"a sunlit gym floor with kettlebells"},
    {"template":"carousel-content","heading":"H2","body":"B2","image":"  close-up of chalked hands  "}
  ]}</slides>`;
  const a = extractPayload(withImages);
  assert.equal(a.slides[0].image, "a sunlit gym floor with kettlebells");
  assert.equal(a.slides[1].image, "close-up of chalked hands", "trimmed");

  // Missing / wrong-typed image → "" (caller falls back to fallbackScene).
  const withoutImages = `<slides>{"caption":"cap","slides":[
    {"template":"carousel-cover","heading":"H1","body":"B1"},
    {"template":"carousel-content","heading":"H2","body":"B2","image":42}
  ]}</slides>`;
  const b = extractPayload(withoutImages);
  assert.equal(b.slides[0].image, "");
  assert.equal(b.slides[1].image, "");

  console.log("generateCarouselExtract.test.ts: all assertions passed");
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/ai/generateCarouselExtract.test.ts`
Expected: FAIL — `extractPayload` is not exported.

- [ ] **Step 3: Implement.** (a) `export` `extractPayload`. (b) `GeneratedSlide` gains `image: string;`. (c) In `extractPayload`'s slide mapper add:

```ts
    const image = typeof obj.image === "string" ? obj.image.trim() : "";
```

and include `image` in the returned object. (d) In `CAROUSEL_FORMAT_RULES`, extend each slide line of the JSON example with `"image": "..."` and add this bullet under "Format constraints":

```
- Each slide ALSO carries an "image" field: a concrete photographic scene
  description for that slide's BACKGROUND image (subject, setting, mood,
  composition). Vary the scenes across the carousel while keeping one coherent
  visual world. The background sits behind text drawn by our templates — favour
  calm compositions with clear space, and NEVER describe any text, signage,
  lettering or logos appearing in the scene.
```

- [ ] **Step 4: Run tests**

Run: `npm test -- src/lib/ai/generateCarouselExtract.test.ts` then `npm test` (the modelLiterals/marketing tests must stay green — `image` is additive).
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/lib/ai/generateCarousel.ts src/lib/ai/generateCarouselExtract.test.ts
git commit -m "feat(imagery): carousel generator emits a per-slide image brief (same Sonnet call)"
```

---

### Task 7: Detached auto-queue + generate-route wiring

**Files:**
- Create: `src/lib/image/autoImages.ts`
- Modify: `src/app/api/content-studio/carousels/[id]/generate/route.ts` (slide-insert loop ~101–123, response ~125)

**Interfaces:**
- Consumes: `generatePostImage` (Task 5), `buildImagePrompt`/`fallbackScene`/`defaultImageStyle` (Task 1), `getBrandImageStyle` (Task 4), `isImageGenConfigured`/`IMAGE_COST_CENTS` (Task 3), `GeneratedSlide.image` (Task 6), `runWithTenant`, `updateSlide`, `getBusinessProfile`, `AiCapError`.
- Produces: `queueSlideImages(tenantId: number, jobs: SlideImageJob[]): void` with `SlideImageJob = { slideId: number; prompt: string; aspectRatio: ImageAspect }`; generate-route response gains `images: { queued: number; estCents: number }`. Task 9 consumes both.

- [ ] **Step 1: Create `src/lib/image/autoImages.ts`**

```ts
import "server-only";

import { runWithTenant } from "@/lib/db/tenant";
import { updateSlide } from "@/lib/image/carousels";
import { AiCapError } from "@/lib/ai/usage";
import { generatePostImage } from "@/lib/ai/image/generatePostImage";
import type { ImageAspect } from "@/lib/ai/image/prompt";

export interface SlideImageJob {
  slideId: number;
  prompt: string;
  aspectRatio: ImageAspect;
}

/**
 * Fire-and-forget background generation of slide images — the
 * runBlogGeneration pattern: the caller captures the tenant while still in
 * the request; this detached continuation re-enters it after the response
 * has gone out (Railway runs a persistent `next start`, not serverless).
 *
 * SEQUENTIAL on purpose: gentle on fal rate limits, and a 5-slide set still
 * completes in ~30–60s. Per-slide failure marks that slide 'failed' and
 * continues; AiCapError marks the current + ALL remaining slides 'failed'
 * with the cap message and stops (no pointless further gate-hits).
 */
export function queueSlideImages(tenantId: number, jobs: SlideImageJob[]): void {
  if (jobs.length === 0) return;
  void runWithTenant(tenantId, async () => {
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      try {
        const asset = await generatePostImage(
          { prompt: job.prompt, aspectRatio: job.aspectRatio },
          { tenantId, agentKey: "carousel" },
        );
        updateSlide(job.slideId, {
          backgroundAssetId: asset.id,
          imageStatus: "ready",
          imageError: null,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Image generation failed.";
        if (err instanceof AiCapError) {
          for (const rest of jobs.slice(i)) {
            updateSlide(rest.slideId, { imageStatus: "failed", imageError: message });
          }
          console.error("[autoImages] stopped — tenant over its AI allowance");
          return;
        }
        updateSlide(job.slideId, { imageStatus: "failed", imageError: message });
        console.error(`[autoImages] slide ${job.slideId} failed:`, err);
      }
    }
  });
}
```

- [ ] **Step 2: Wire the generate route.** Add imports:

```ts
import { isImageGenConfigured, IMAGE_COST_CENTS } from "@/lib/ai/image/falClient";
import { buildImagePrompt, defaultImageStyle, fallbackScene } from "@/lib/ai/image/prompt";
import { getBrandImageStyle } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";
import { queueSlideImages, type SlideImageJob } from "@/lib/image/autoImages";
```

Replace the slide-insert loop (currently `for (let i = 0; i < result.slides.length; i++) { ... addSlide({...}) }`) with:

```ts
  const imageGen = isImageGenConfigured();
  const houseStyle = imageGen
    ? (getBrandImageStyle() ?? defaultImageStyle(getBusinessProfile()))
    : null;
  const jobs: SlideImageJob[] = [];

  for (let i = 0; i < result.slides.length; i++) {
    const slide = result.slides[i];
    const prompt = houseStyle
      ? buildImagePrompt({
          houseStyle,
          scene:
            slide.image?.trim() ||
            fallbackScene({ heading: slide.heading, body: slide.body }),
        })
      : null;
    const row = addSlide({
      carouselSetId: carouselId,
      slotKey,
      templateId: slide.template,
      aspectRatio: "1:1",
      headingText: slide.heading,
      bodyText: slide.body,
      caption: i === 0 ? result.caption : "",
      accentColor: previousAccent,
      imagePrompt: prompt,
      imageStatus: prompt ? "generating" : null,
    });
    if (prompt) jobs.push({ slideId: row.id, prompt, aspectRatio: "1:1" });
  }

  if (jobs.length > 0) queueSlideImages(tenantId, jobs);
```

(Keep every existing field of the old `addSlide` call — the block above is the old call plus the two new fields and the captured `row`.) Then extend the response JSON:

```ts
  return NextResponse.json({
    ok: true,
    carousel: getCarousel(carouselId),
    usage: result.usage,
    images: { queued: jobs.length, estCents: jobs.length * IMAGE_COST_CENTS },
  });
```

- [ ] **Step 3: Gate + commit**

```bash
npm run typecheck
npm test
git add src/lib/image/autoImages.ts "src/app/api/content-studio/carousels/[id]/generate/route.ts"
git commit -m "feat(imagery): auto-generate slide backgrounds after carousel generation (detached queue)"
```

---

### Task 8: Per-slide image route + library asset GET

**Files:**
- Create: `src/app/api/content-studio/carousels/[id]/slides/[slideId]/image/route.ts`
- Modify: `src/app/api/content-studio/image-library/[id]/route.ts` (add GET; it currently has only DELETE)

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5 exports; `getCarousel`/`updateSlide`; `getLibraryAsset`; `guard`, `getCurrentMembership`.
- Produces: `POST .../slides/[slideId]/image` body `{ prompt?: string | null }` → `{ ok, slide, asset, costCents }` (429 on cap, 400 unconfigured, 404 unknown slide); `GET /api/content-studio/image-library/[id]` → `{ ok, asset }`. Task 9 consumes both.

- [ ] **Step 1: Create the slide-image route**

```ts
import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/auth";
import { getCarousel, updateSlide } from "@/lib/image/carousels";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getBrandImageStyle } from "@/lib/settings";
import { AiCapError } from "@/lib/ai/usage";
import { generatePostImage } from "@/lib/ai/image/generatePostImage";
import { isImageGenConfigured } from "@/lib/ai/image/falClient";
import { IMAGE_COST_CENTS } from "@/lib/ai/image/falClient";
import {
  buildImagePrompt,
  defaultImageStyle,
  fallbackScene,
  type ImageAspect,
} from "@/lib/ai/image/prompt";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Synchronous single-slide background generation — the designer's Generate /
 * Regenerate / edited-prompt path (the initial auto flow is the detached
 * queue in lib/image/autoImages). Body `{ prompt? }`: a non-empty prompt is
 * used VERBATIM (the textarea edits the full stored prompt — re-wrapping it
 * through buildImagePrompt would double-wrap); otherwise the slide's stored
 * image_prompt; otherwise a fresh house-style prompt from the slide copy.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string; slideId: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const membership = getCurrentMembership();
  if (!membership) {
    return NextResponse.json({ ok: false, error: "No active account" }, { status: 401 });
  }
  const tenantId = membership.tenant.id;

  if (!isImageGenConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Image generation isn't configured." },
      { status: 400 },
    );
  }

  const carouselId = Number(params.id);
  const slideId = Number(params.slideId);
  const carousel = getCarousel(carouselId);
  const slide = carousel?.slides.find((s) => s.id === slideId);
  if (!carousel || !slide) {
    return NextResponse.json({ ok: false, error: "Slide not found." }, { status: 404 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine — means "reuse the stored prompt"
  }
  const override =
    typeof body?.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : null;
  const prompt =
    override ??
    slide.imagePrompt ??
    buildImagePrompt({
      houseStyle: getBrandImageStyle() ?? defaultImageStyle(getBusinessProfile()),
      scene: fallbackScene({ heading: slide.headingText, body: slide.bodyText }),
    });

  try {
    const asset = await generatePostImage(
      { prompt, aspectRatio: slide.aspectRatio as ImageAspect },
      { tenantId, agentKey: "carousel" },
    );
    updateSlide(slideId, {
      backgroundAssetId: asset.id,
      imagePrompt: prompt,
      imageStatus: "ready",
      imageError: null,
    });
    const fresh = getCarousel(carouselId)?.slides.find((s) => s.id === slideId) ?? null;
    return NextResponse.json({ ok: true, slide: fresh, asset, costCents: IMAGE_COST_CENTS });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Image generation failed.";
    updateSlide(slideId, { imageStatus: "failed", imageError: message });
    if (err instanceof AiCapError) {
      return NextResponse.json({ ok: false, error: message }, { status: 429 });
    }
    console.error("[slide-image] generation failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add GET to `image-library/[id]/route.ts`** (read the file first; keep its imports/DELETE untouched, add `getLibraryAsset` to the existing `@/lib/image/library` import):

```ts
/** Fetch one asset row — used by the designer's poller to hydrate newly-generated backgrounds into its local library state. */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const asset = getLibraryAsset(Number(params.id));
  if (!asset) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, asset });
}
```

- [ ] **Step 3: Gate + commit**

```bash
npm run typecheck
npm test
npx next build
git add "src/app/api/content-studio/carousels/[id]/slides/[slideId]/image" "src/app/api/content-studio/image-library/[id]/route.ts"
git commit -m "feat(imagery): sync per-slide image generate/regenerate route + library asset GET"
```

---

### Task 9: Designer UI — polling, AI panel, status chips

**Files:**
- Modify: `src/components/content-studio/ImageDesigner.tsx`
- Modify: `src/app/content-studio/images/[id]/page.tsx`

Read both files before editing. Anchors given are from the current file; locate by the quoted code, not the line number alone.

**Interfaces:**
- Consumes: `images.queued` from the generate route (Task 7), the slide-image route + library GET (Task 8), slide fields `imageStatus`/`imageError`/`imagePrompt` (Task 4).
- Produces: designer prop `imageGenEnabled: boolean` (page passes `isImageGenConfigured()`).

- [ ] **Step 1: Page props.** In `images/[id]/page.tsx` add `import { isImageGenConfigured } from "@/lib/ai/image/falClient";` and pass `imageGenEnabled={isImageGenConfigured()}` to `<ImageDesigner …>`.

- [ ] **Step 2: Designer prop.** Add `imageGenEnabled?: boolean;` to `Props` and destructure with default `false`.

- [ ] **Step 3: Poll while generating.** Add below the auto-save effects (after the design-name effect ending ~line 285):

```tsx
  // Poll while any slide's AI background is generating — the detached server
  // queue flips image_status/backgroundAssetId as each image completes. Merge
  // ONLY the generation-owned fields; backgroundAssetId only while the local
  // slide is still 'generating' (a manual pick mid-flight wins). These fields
  // are NOT in the auto-save snapshot, so polling never fights the debounce.
  const libraryRef = useRef(library);
  useEffect(() => {
    libraryRef.current = library;
  }, [library]);
  const anyGenerating = slides.some((s) => s.imageStatus === "generating");
  useEffect(() => {
    if (!anyGenerating) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/content-studio/carousels/${designId}`);
        const json = await res.json();
        if (stopped || !res.ok || !json.ok) return;
        const server: CarouselSlide[] = json.carousel?.slides ?? [];
        const byId = new Map(server.map((s) => [s.id, s]));
        // Hydrate newly-generated assets we don't have locally yet.
        const known = new Set(libraryRef.current.map((a) => a.id));
        const missing = Array.from(
          new Set(
            server
              .map((s) => s.backgroundAssetId)
              .filter((id): id is number => id != null && !known.has(id)),
          ),
        );
        for (const id of missing) {
          try {
            const ares = await fetch(`/api/content-studio/image-library/${id}`);
            const ajson = await ares.json();
            if (!stopped && ares.ok && ajson.ok && ajson.asset) {
              setLibrary((prev) =>
                prev.some((a) => a.id === ajson.asset.id) ? prev : [ajson.asset, ...prev],
              );
            }
          } catch {}
        }
        if (stopped) return;
        setSlides((prev) =>
          prev.map((s) => {
            const sv = byId.get(s.id);
            if (!sv) return s;
            const patch: Partial<CarouselSlide> = {
              imageStatus: sv.imageStatus,
              imageError: sv.imageError,
              imagePrompt: sv.imagePrompt,
            };
            if (s.imageStatus === "generating" && sv.backgroundAssetId != null) {
              patch.backgroundAssetId = sv.backgroundAssetId;
            }
            return { ...s, ...patch };
          }),
        );
      } catch {}
    };
    const iv = setInterval(tick, 2500);
    tick();
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, [anyGenerating, designId]);
```

- [ ] **Step 4: AI panel component.** Add near `GenerateCarouselButton` (module scope):

```tsx
/**
 * Per-slide AI background controls: prompt textarea (prefilled with the
 * stored prompt), Generate/Regenerate via the sync slide-image route, cost
 * hint, and failed-state retry. Rendered only when imageGenEnabled.
 */
function AiImagePanel({
  slide,
  designId,
  onAsset,
  onSlidePatch,
}: {
  slide: CarouselSlide;
  designId: number;
  onAsset: (asset: ImageLibraryAsset) => void;
  onSlidePatch: (patch: Partial<CarouselSlide>) => void;
}) {
  const [prompt, setPrompt] = useState(slide.imagePrompt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPrompt(slide.imagePrompt ?? "");
    setError(null);
  }, [slide.id, slide.imagePrompt]);

  const generating = slide.imageStatus === "generating";
  const failed = slide.imageStatus === "failed";

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/content-studio/carousels/${designId}/slides/${slide.id}/image`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: prompt.trim() || null }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Image generation failed.");
      if (json.asset) onAsset(json.asset as ImageLibraryAsset);
      onSlidePatch({
        backgroundAssetId: json.slide?.backgroundAssetId ?? json.asset?.id ?? null,
        imageStatus: "ready",
        imageError: null,
        imagePrompt: json.slide?.imagePrompt ?? prompt,
      });
      setPrompt(json.slide?.imagePrompt ?? prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image generation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: 14,
        background: "var(--surface-1)",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
          AI background
        </span>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>≈ €0.04 / image</span>
      </div>
      <Textarea
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe the scene — leave as-is to reuse the last prompt"
        style={{ fontSize: 12 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Button type="button" size="sm" onClick={generate} disabled={busy || generating}>
          <Sparkles size={14} />
          {busy
            ? "Generating…"
            : slide.backgroundAssetId != null
              ? "Regenerate"
              : "Generate"}
        </Button>
        {generating && (
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Generating in the background…
          </span>
        )}
      </div>
      {(error || failed) && (
        <div style={{ fontSize: 12, color: "var(--danger, #dc2626)" }}>
          {error ?? slide.imageError ?? "Image generation failed."}{" "}
          <button
            type="button"
            onClick={generate}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "inherit",
              textDecoration: "underline",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Mount the panel.** Directly ABOVE the `<Label>Background photo</Label>` block (~line 1362), inside the same parent `<div>` chain:

```tsx
          {imageGenEnabled && activeSlide && (
            <div>
              <Label>AI background</Label>
              <AiImagePanel
                slide={activeSlide}
                designId={designId}
                onAsset={(asset) =>
                  setLibrary((prev) =>
                    prev.some((a) => a.id === asset.id) ? prev : [asset, ...prev],
                  )
                }
                onSlidePatch={updateActiveSlide}
              />
            </div>
          )}
```

(If a `<Label>` already wraps the panel's own header, drop the outer `<Label>` — match the surrounding section markup style.)

- [ ] **Step 6: Generating chip on the preview.** Locate the MAIN stage `<SlideCanvas …>` usage (the large preview, not `SlideThumb`). Wrap it in `position: relative` container (if not already) and add after it:

```tsx
              {activeSlide?.imageStatus === "generating" && (
                <div
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: "rgba(10,10,10,0.72)",
                    color: "#fff",
                  }}
                >
                  <RefreshCw size={11} className="cf-spin" />
                  Generating image…
                </div>
              )}
```

(`RefreshCw` is already imported. If no spin utility class exists, inline `animation: "spin 1s linear infinite"` with a local `@keyframes` — or drop the icon; the chip text is the requirement.)

- [ ] **Step 7: Post-generate toast.** In `GenerateCarouselButton.submit`, after `onGenerated(newSlides…)`, read `json.images` and when `queued > 0` surface it: change the `onGenerated` prop to `(newSlides: CarouselSlide[], images?: { queued: number; estCents: number }) => void`, pass `json.images`, and in the parent's existing `onGenerated` handler add:

```tsx
                if (images && images.queued > 0) {
                  toast.success(`Generating ${images.queued} AI backgrounds — they'll appear as they finish.`);
                }
```

with `import { toast } from "sonner";` added to the file's imports.

- [ ] **Step 8: Gate + commit**

```bash
npm run typecheck
npm test
npx next build
git add src/components/content-studio/ImageDesigner.tsx "src/app/content-studio/images/[id]/page.tsx"
git commit -m "feat(imagery): designer AI-background panel, generation polling + status chips"
```

---

### Task 10: Logo on every template

**Files:**
- Modify: `src/lib/image/templates.ts` (append near the other exported helpers at the bottom, ~3371)
- Modify: `src/components/content-studio/ImageDesigner.tsx` (`SlideCanvas` render effect ~1974–2005, `SlideThumb`, `renderSlideToBlob` ~2121–2175, toolbar, Props)
- Modify: `src/app/content-studio/images/[id]/page.tsx` (logo props)

**Interfaces:**
- Consumes: `getChromeLogoSrc()` (`@/lib/branding`), `design.showLogo` (Task 4), carousels `[id]` PATCH `showLogo` (Task 4).
- Produces: `drawLogoOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, logo: HTMLImageElement): void` exported from templates.ts.

- [ ] **Step 1: `drawLogoOverlay` in templates.ts**

```ts
/**
 * Draw the tenant's uploaded logo bottom-right on a rendered slide. Called by
 * the canvas renderers AFTER template.render — both the live preview and the
 * PNG export — never by templates themselves, so every template gets it from
 * one shared implementation.
 */
export function drawLogoOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  logo: HTMLImageElement,
) {
  const nw = logo.naturalWidth || logo.width;
  const nh = logo.naturalHeight || logo.height;
  if (!nw || !nh) return;
  const margin = Math.round(height * 0.04);
  let drawH = Math.round(height * 0.055);
  let drawW = Math.round((nw / nh) * drawH);
  const maxW = Math.round(width * 0.22);
  if (drawW > maxW) {
    drawW = maxW;
    drawH = Math.round((nh / nw) * drawW);
  }
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.drawImage(logo, width - margin - drawW, height - margin - drawH, drawW, drawH);
  ctx.restore();
}
```

- [ ] **Step 2: Page props.** `images/[id]/page.tsx`: add `import { getChromeLogoSrc } from "@/lib/branding";` and pass `logoUrl={getChromeLogoSrc()}` and `initialShowLogo={design.showLogo}` to `<ImageDesigner …>`. (`design` already includes `showLogo` after Task 4's schema change.)

- [ ] **Step 3: Designer logo state.** Props gain `logoUrl?: string | null;` and `initialShowLogo?: boolean;` (destructure defaults `null` / `true`). Add state + loader near the fonts-preload effect:

```tsx
  const [showLogo, setShowLogo] = useState(initialShowLogo);
  const [logoImg, setLogoImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!logoUrl) {
      setLogoImg(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous"; // same-origin /api/branding/logo — keeps export canvases untainted
    img.src = logoUrl;
    img.onload = () => setLogoImg(img);
    img.onerror = () => setLogoImg(null);
  }, [logoUrl]);
```

- [ ] **Step 4: Thread the logo into rendering.** Add a `logo: HTMLImageElement | null` prop to `SlideCanvas` and `SlideThumb` (pass `showLogo ? logoImg : null` from the parent at every usage), add `logo` to the render effect's dependency array, and after the existing `template.render(…)` call in `SlideCanvas`'s effect add:

```tsx
    if (logo) drawLogoOverlay(ctx, canvas.width, canvas.height, logo);
```

Import `drawLogoOverlay` from `@/lib/image/templates`. Give `renderSlideToBlob` a new final parameter `logo: HTMLImageElement | null` and the same call after its `template.render(…)`; update its call site(s) in the export path to pass `showLogo ? logoImg : null`.

- [ ] **Step 5: Toolbar toggle.** Next to the Download/Export controls (the toolbar block containing `title="Download all slides as a zip"` ~line 728), when `logoUrl` is set render:

```tsx
            <Button
              type="button"
              size="sm"
              variant={showLogo ? "default" : "outline"}
              title="Draw your logo on every slide (preview + export)"
              onClick={async () => {
                const next = !showLogo;
                setShowLogo(next); // optimistic — canvas re-renders immediately
                try {
                  await fetch(`/api/content-studio/carousels/${designId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ showLogo: next }),
                  });
                } catch {}
              }}
            >
              <ImageIcon size={14} />
              {showLogo ? "Logo on" : "Logo off"}
            </Button>
```

- [ ] **Step 6: Gate + commit**

```bash
npm run typecheck
npm test
npx next build
git add src/lib/image/templates.ts src/components/content-studio/ImageDesigner.tsx "src/app/content-studio/images/[id]/page.tsx"
git commit -m "feat(imagery): tenant logo drawn on every template (preview + export) with per-design toggle"
```

---

### Task 11: Branding settings — editable house image style

**Files:**
- Modify: `src/app/settings/branding/actions.ts` (add `saveBrandImageStyleAction` — read the file first and mirror `saveBrandFontsAction`'s auth + return conventions exactly)
- Modify: `src/components/settings/BrandingForm.tsx` (new section)
- Modify: `src/app/settings/branding/page.tsx` (pass initial value + computed default)

**Interfaces:**
- Consumes: `getBrandImageStyle` (Task 4), `defaultImageStyle` (Task 1), `getBusinessProfile`, `setKey`/`deleteKey` (`@/lib/settings`).
- Produces: `saveBrandImageStyleAction(input: { style: string }): Promise<{ ok: true } | { ok: false; error: string }>` (match the actions file's actual result shape); settings key `brand_image_style`.

- [ ] **Step 1: Action** — in `actions.ts`, mirroring the existing action's guard/shape:

```ts
export async function saveBrandImageStyleAction(input: { style: string }) {
  // (same auth guard as saveBrandFontsAction — copy it verbatim)
  const style = String(input?.style ?? "").trim();
  if (style.length > 600) {
    return { ok: false as const, error: "Keep the style under 600 characters." };
  }
  if (style) setKey("brand_image_style", style);
  else deleteKey("brand_image_style");
  return { ok: true as const };
}
```

(Import `setKey`/`deleteKey` from `@/lib/settings` if not already imported.)

- [ ] **Step 2: Page** — in `page.tsx` add:

```ts
import { getBrandImageStyle } from "@/lib/settings";
import { defaultImageStyle } from "@/lib/ai/image/prompt";
import { getBusinessProfile } from "@/lib/businessProfile";
```

compute `const imageStyle = getBrandImageStyle() ?? "";` and `const imageStyleDefault = defaultImageStyle(getBusinessProfile());`, pass both to `<BrandingForm imageStyle={imageStyle} imageStyleDefault={imageStyleDefault} …/>`. Also update the page subtitle to mention AI image style.

- [ ] **Step 3: Form section** — in `BrandingForm.tsx` add props `imageStyle: string; imageStyleDefault: string;`, local state, and a section below the fonts block:

```tsx
      <div style={{ display: "grid", gap: 8 }}>
        <Label htmlFor="brand-image-style">AI image style</Label>
        <textarea
          id="brand-image-style"
          rows={3}
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          placeholder={imageStyleDefault}
          style={{
            width: "100%",
            resize: "vertical",
            font: "inherit",
            fontSize: 13,
            padding: 10,
            borderRadius: "var(--radius)",
            border: "1px solid var(--hairline)",
            background: "var(--surface-1)",
            color: "var(--text-primary)",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Button type="button" size="sm" onClick={saveStyle} disabled={savingStyle}>
            {savingStyle ? <Loader2 size={14} className="cf-spin" /> : <Check size={14} />}
            Save style
          </Button>
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
            The look-and-feel half of every AI post image prompt. Leave blank to
            use the default shown above.
          </span>
        </div>
      </div>
```

with the handler:

```tsx
  const [style, setStyle] = useState(imageStyle);
  const [savingStyle, setSavingStyle] = useState(false);
  async function saveStyle() {
    setSavingStyle(true);
    try {
      const res = await saveBrandImageStyleAction({ style });
      if (!res.ok) throw new Error(("error" in res && res.error) || "Couldn't save.");
      toast.success("Image style saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSavingStyle(false);
    }
  }
```

(`toast`, `router`, `Check`, `Loader2` are already imported in this file; reuse them. If the file styles inputs via a shared component instead of a raw `<textarea>`, use the shared `Textarea` from `@/components/ui/Input` and drop the inline style.)

- [ ] **Step 4: Gate + commit**

```bash
npm run typecheck
npm test
npx next build
git add src/app/settings/branding/actions.ts src/components/settings/BrandingForm.tsx src/app/settings/branding/page.tsx
git commit -m "feat(imagery): editable per-tenant AI image style in Branding settings"
```

---

## Post-plan (controller, not a task)

- Final whole-branch review (subagent-driven-development's closing step).
- Deploy: `cd app && railway up` after the full gate; then set `FAL_KEY` on the Railway `clientflow` service (feature is inert until set).
- Manual QA per spec §Rollout: generate a carousel → backgrounds pop in; regenerate one slide with an edited prompt; toggle the logo; check /agents shows `fal:flux-1.1-pro` under `carousel`.

## Self-review notes

- Spec coverage: provider ✓ (T3), metering ✓ (T2/T5), schema ✓ (T4), Sonnet brief ✓ (T6), auto flow ✓ (T7), per-slide controls + library GET ✓ (T8/T9), polling ✓ (T9), logo ✓ (T10), house style ✓ (T11), guard ✓ (T5), fail-closed ✓ (T3/T7/T8/T9 gates).
- Type consistency: `SlideImageJob`/`ImageAspect`/`generatePostImage`/`meterAndChargeFlat` names match across tasks; `slide.aspectRatio` feeds regenerate; initial auto-gen uses `"1:1"` (matches the generate route's hardcoded aspect).
- Known intentional choices: prompt override used VERBATIM (no double-wrap); sequential queue; poll merges only generation-owned fields.
