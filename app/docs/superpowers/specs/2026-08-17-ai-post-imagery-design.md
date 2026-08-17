# AI Post Imagery + Logo-on-Templates — Design

**Date:** 2026-08-17 · **Status:** approved by user (model: FLUX 1.1 Pro; one image per slide; auto with the post; swap/regenerate per slide; logo on all templates)

## Goal

Content Studio image posts (the carousel/social designer) automatically get a
**premium photoreal AI background image per slide**, generated from the post's
topic + a per-tenant editable "house style", dropped into each slide's existing
background slot. Every image is swappable/regenerable per slide. Separately,
the tenant's uploaded **logo is drawn on every template** (preview + export)
with a per-design toggle.

## Non-goals (deferred)

- Blog cover-image generation; video imagery.
- Auto-images from the Marketing agent's `draft_carousel` tool (Content Studio
  route only for now — the agent path has the write-approval gate in the way).
- Regenerating images on slide-text **refresh** (kept: refresh rewrites copy,
  images stay; user regenerates per slide if wanted).
- Multiple image providers in the UI; per-brand fine-tuning.

## Provider: FLUX 1.1 Pro via fal.ai

- Endpoint: `POST https://fal.run/fal-ai/flux-pro/v1.1` (synchronous),
  header `Authorization: Key ${FAL_KEY}`, JSON body
  `{ prompt, image_size: { width, height }, num_images: 1, output_format: "jpeg", enable_safety_checker: true }`.
  Response: `{ images: [{ url, ... }], ... }` — download `images[0].url` to a
  `Buffer` server-side.
- **Pricing:** $0.04/MP, billed rounding up per MP → all our sizes sit **under
  1 MP** so each image is a flat **4¢** (`IMAGE_COST_CENTS = 4`).
- **Env:** new `FAL_KEY` (Railway + `.env`). Fail-closed like Mailgun/FB:
  `isImageGenConfigured()` = key present. Unset ⇒ zero behaviour change
  anywhere (no auto-queue, AI-image UI hidden).
- New module `src/lib/ai/image/`:
  - `falClient.ts` — `isImageGenConfigured()`, `falGenerateImage({prompt, width, height}, fetchImpl?) → Promise<Buffer>`
    (the ONLY file allowed to reference `fal.run`; `fetchImpl` injectable for tests;
    60s `AbortSignal.timeout`).
  - `prompt.ts` — pure (NO `server-only`, tsx-testable):
    `ASPECT_DIMS: Record<AspectRatio, {width, height}>` =
    `1:1 → 992×992`, `4:5 → 864×1088`, `9:16 → 736×1312`
    (all multiples of 32, all < 1 MP, ratio drift ≤ 0.8% — invisible under
    cover-fit), `buildImagePrompt({houseStyle, scene})`,
    `defaultImageStyle(profile)` (fallback house style derived from business
    profile), `fallbackScene({heading, body})`.
    Prompt shape: `"{scene}. {houseStyle}. Editorial photography, natural
    light, shallow depth of field, premium quality, photorealistic, high
    detail. Clean background with no text, no words, no lettering, no logos,
    no watermarks."` (FLUX has no negative prompts — the no-text clause lives
    in the prompt; templates draw all text themselves.)
  - `generatePostImage.ts` — the **metered chokepoint** (mirrors
    `meteredCreate`): `generatePostImage({prompt, aspectRatio}, meter)` =
    `assertAiAllowed` → `falGenerateImage` → `processImageUpload(buf, "image/jpeg")`
    → write to `libraryDir()` as `generated-<Date.now()>-<4hex>.jpg` →
    `addLibraryAsset({label: "AI · " + prompt.slice(0, 60), ...})` →
    `meterAndChargeFlat(tenantId, agentKey, IMAGE_MODEL_ID, IMAGE_COST_CENTS)`
    → returns the asset row. `IMAGE_MODEL_ID = "fal:flux-1.1-pro"`.

## Metering (extends `src/lib/ai/usage.ts`)

- `recordFlatUsage(tenantId, agentKey, model, costCents)` — INSERT into
  `ai_usage` with all four token columns 0 and `cost_cents = costCents`;
  returns costCents. All existing rollups (`getMonthlyUsageCents`, by-agent,
  by-model) just work; images appear on /agents under agent key `carousel`
  and model row `fal:flux-1.1-pro`.
- `meterAndChargeFlat(tenantId, agentKey, model, costCents)` — same
  free-tranche/overflow/`withMargin`/`recordAiSpend` logic as
  `meterAndCharge`, with `rawCost = recordFlatUsage(...)`.
- Gate is the existing `assertAiAllowed` before every image call; over-cap ⇒
  `AiCapError` (429 in routes / `image_status='failed'` with the cap message
  in the detached queue).
- **CI guard:** extend `meteredGuard.test.ts` — add pattern `/fal\.run/`
  (fix: "call fal only via falClient.ts") and add
  `src/lib/ai/image/falClient.ts` to `SANCTIONED`.

## Data model (tenant DB — additive, zero visible change on deploy)

- `carousel_slides` new nullable columns:
  - `image_status TEXT` — `NULL | 'generating' | 'ready' | 'failed'`
  - `image_prompt TEXT` — the prompt last used (regenerate reuses it; Edit
    prompt overwrites it)
  - `image_error TEXT` — operator-visible failure message
- `carousel_sets` new column: `show_logo INTEGER NOT NULL DEFAULT 1`.
- Drizzle `schema.ts` fields + `ensureTenantTables` PRAGMA-guarded `ALTER`s
  (mirror the existing `carousel_slides` caption block at tenant.ts:1456) +
  the columns added to the `CREATE TABLE IF NOT EXISTS` statements.
- `AddSlideInput`/`addSlide` pass through `imageStatus`/`imagePrompt`.
- Settings key `brand_image_style` (per-tenant house style, editable):
  `getBrandImageStyle(): string | null` in `src/lib/settings.ts`; empty/unset ⇒
  `defaultImageStyle(getBusinessProfile())` at call time.

## Text generation grows an image brief (same Sonnet call — no extra AI call)

`generateCarouselSlides` (`src/lib/ai/generateCarousel.ts`):
- JSON contract per slide gains `"image": "photographic scene description for
  this slide's background — concrete subject, setting, mood; never text in
  the image"`; format rules updated accordingly.
- `GeneratedSlide` gains `image: string` (extractPayload: missing/non-string
  ⇒ `""` → caller falls back to `fallbackScene`).

## Auto flow (non-blocking)

`POST /api/content-studio/carousels/[id]/generate`:
1. Text generation exactly as today.
2. Each `addSlide` additionally stores `imagePrompt` (built from
   houseStyle + the slide's `image` scene) and, **when configured**,
   `imageStatus: 'generating'`.
3. After the response fields are assembled, fire
   `queueSlideImages(tenantId, jobs)` (new `src/lib/image/autoImages.ts`) —
   detached `void runWithTenant(tenantId, ...)` continuation (the
   `runBlogGeneration` pattern): **sequentially** per slide →
   `generatePostImage` → `updateSlide({backgroundAssetId, imageStatus:'ready', imageError:null})`.
   Per-slide failure ⇒ `imageStatus:'failed'`, `imageError`, continue;
   `AiCapError` ⇒ mark that slide + all remaining `'failed'` with the cap
   message and stop.
4. Response gains `images: { queued: number, estCents: number }`.
5. Slides render immediately (brand colour / placeholder until the image pops
   in) — a failed image just leaves the slide as it is today.

## Per-slide controls (the "swap if necessary" flow)

- New route `POST /api/content-studio/carousels/[id]/slides/[slideId]/image`
  body `{ prompt?: string }` — **synchronous** single-image generate:
  resolve prompt = `body.prompt ?? slide.imagePrompt ?? buildImagePrompt(houseStyle, fallbackScene(slide))`,
  persist it to `image_prompt`, generate with the **slide's own aspect**, set
  background, return `{ ok, slide, asset, costCents }`. `maxDuration = 60`;
  `AiCapError` ⇒ 429 (same shape as the generate route).
- **Swap** = the existing library picker / upload (unchanged). **Remove** =
  existing Clear.
- `GET /api/content-studio/image-library/[id]` returning `{ ok, asset }` (add
  if the route currently lacks GET) — used by the poller to hydrate
  newly-generated assets into the designer's library state.

## Designer UI (`ImageDesigner.tsx`)

- New props: `imageGenEnabled: boolean`, `logoUrl: string | null`,
  `initialShowLogo: boolean` (page passes `isImageGenConfigured()`,
  `getChromeLogoSrc()`, `design.showLogo`).
- **Polling:** while any slide has `imageStatus === 'generating'`, poll
  `GET /api/content-studio/carousels/[id]` every 2.5s; merge ONLY
  `imageStatus`/`imageError`/`imagePrompt`/`backgroundAssetId` into local
  slide state (and `backgroundAssetId` only for slides still `'generating'`
  locally — never clobber a manual pick); hydrate unknown assets via the
  library GET. (These fields are not in the auto-save snapshot, so polling
  can't fight the debounced save.)
- **Background section** (anchor: the "Background photo" panel,
  ImageDesigner ~1362): when `imageGenEnabled`, a "Generate with AI" block —
  textarea prefilled with `activeSlide.imagePrompt ?? ""`, Generate/Regenerate
  button (spinner while in-flight), caption "≈ €0.04 per image", inline error
  + Retry on `'failed'` (shows `imageError`).
- **Status chip** on slide canvas/thumb while `'generating'`.
- Generate-carousel dialog: after success with `images.queued > 0`, show
  "Generating N background images…" (the poll then fills them in).

## Logo on every template

- `templates.ts` exports `drawLogoOverlay(ctx, width, height, logo: HTMLImageElement)` —
  bottom-right: margin `round(height*0.04)`, logo height `round(height*0.055)`
  (width capped at 22% of canvas, aspect preserved via naturalWidth/Height,
  skip if naturals are 0), `globalAlpha 0.92`, wrapped in save/restore.
- Called AFTER `template.render(...)` at **both** render sites —
  `SlideCanvas`'s effect and `renderSlideToBlob` — when `showLogo && logoImg`.
  Logo `<img>` loaded once in `ImageDesigner` from `logoUrl`
  (`crossOrigin="anonymous"`; same-origin `/api/branding/logo?v=…` so canvas
  export stays untainted; SVG logos draw fine via img).
- **Toggle:** "Show logo" switch in the designer toolbar → PATCH
  `/api/content-studio/carousels/[id]` gains `{ showLogo?: boolean }` →
  `updateCarousel` gains `showLogo`. Per-design, default ON. No logo uploaded
  ⇒ nothing drawn (toggle hidden).

## Settings → Branding: house image style

- Textarea "AI image style" on `/settings/branding` (BrandingForm), saving
  settings key `brand_image_style` via the existing branding save pattern.
  Placeholder shows the computed default so operators see what they're
  overriding. Helper text: used as the style half of every generated post
  image prompt.

## Testing (pure, tsx runner — no DB, no network)

- `prompt.test.ts`: ASPECT_DIMS exact values + all-multiples-of-32 + <1MP;
  buildImagePrompt contains scene + houseStyle + the no-text clause;
  fallbackScene/defaultImageStyle behaviour.
- `falClient.test.ts`: request shape (URL, auth header, body) + response
  parsing + error paths via injected fetch.
- `usage.test.ts` additions: recordFlatUsage writes cost with zero tokens;
  meterAndChargeFlat overflow math (mirrors existing meterAndCharge tests).
- `generateCarousel`: extractPayload tolerates missing `image` field.
- meteredGuard extension covers `fal.run`.
- Gate: `npm run typecheck` + `npm test` + `npx next build`.

## Rollout

1. Land on `main` (gate green) → `railway up` from `app/`.
2. Set `FAL_KEY` on the Railway service (user creates a fal.ai account → API
   key). Until it's set the feature is inert.
3. Verify: generate a carousel in Content Studio → slides appear instantly,
   backgrounds pop in over ~10–40s; /agents shows `fal:flux-1.1-pro` spend
   under `carousel`; toggle logo off/on; regenerate one slide with an edited
   prompt.
