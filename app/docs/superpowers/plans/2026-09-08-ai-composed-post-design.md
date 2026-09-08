# AI-composed post design — Implementation Plan

> **For agentic workers:** use superpowers:subagent-driven-development to execute this task-by-task. Steps use `- [ ]` checkboxes.

**Spec:** `app/docs/superpowers/specs/2026-09-08-ai-composed-post-design.md` (read it first — it carries the decisions and the reasoning).

**Goal:** The AI composes a layout per slide from the tenant's own design system, within a bounded grammar, validated against that system's own measurable rules. The 48 existing templates keep working untouched.

**Order matters:** Task 1 first, always. It is the safety net for every later change to the render path.

## Global constraints

- **NO EMOJIS** anywhere — code, comments, UI copy, commit messages. `lucide-react` icons only.
- Run from `app/`. Gate before every commit: `npm run typecheck`, `npm test`, `npx next build`.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **preview == export is load-bearing.** `SlideCanvas` (editor) and `renderSlideToBlob` (PNG export) both call `paintSlide`. Any fork must live *inside* `paintSlide` so exactly one branch runs on both sides.
- Pure modules (`lib/design/*` except `system.ts`) must have **zero runtime imports** so they load under the plain tsx runner (`scripts/test.mjs`). Tests are `node:assert/strict` + a local `check(name, cond)` + a `console.log` summary. No framework.
- Multi-tenancy: `getDesignSystem()` reads the caller's own tenant. A tenant with no system must behave exactly as today.

---

### Task 1: Golden master for the 48 templates

**Why first:** every later task touches `paintSlide`. This is the regression that proves nothing drifted.

**Files:** create `src/lib/image/templates.golden.test.ts`, and a fixture directory it manages.

- [ ] Render all 48 templates through the **existing** `paintSlide` with fixed synthetic content (same heading/body/tagline/colours for each, a deterministic 1×1 background, no logo), using `@napi-rs/canvas` or the existing node canvas path used elsewhere in tests — check what `renderSlideToBlob` uses server-side and reuse it.
- [ ] Hash each rendered buffer (sha256) and write `templates.golden.json` — `{ [templateId]: sha256 }` — committed.
- [ ] The test re-renders and compares hashes; any mismatch fails, printing the template id.
- [ ] Run it twice in a row to confirm determinism before trusting it (fonts and antialiasing must be stable).
- [ ] Commit: `test(content-studio): golden master for all 48 template renders`

**If rendering server-side is not already possible**, say so and stop — do not invent a second render path. Fall back to asserting the render *inputs* (the DesignState each template receives) and note the reduced coverage in the report.

---

### Task 2: The tenant design system

**Files:** create `src/lib/design/system.ts`; author Optimal Health's system; `src/lib/design/system.test.ts`.

- [ ] Define `DesignSystem` exactly as the spec's section 1 shows (values/grounds/type/grid/photo/rules).
- [ ] `getDesignSystem(): DesignSystem | null` and `setDesignSystem(s)` on the existing settings key/value store (`getSettings`/`setKey` in `src/lib/settings.ts`, key `design_system`). **No schema migration.**
- [ ] `parseDesignSystem(unknown): DesignSystem | null` — pure, zero-import, tolerant: unknown shape returns null rather than throwing. Put the parser in its own file if `system.ts` needs `server-only`.
- [ ] Author Optimal Health's system from `/Users/truep/Desktop/OPTIMAL-BRAND-SYSTEM.md`: sage `#C7D2BB`, ink `#24231F`, plaster `#F2F3ED`, timber `#B0844F` (role accent, **in `rules.neverType`**), deep green `#5E6B4E`. Grounds: plaster share .5 maxRun 3, sage share .33 **maxRun 1**, ink share .17 maxRun 2. Type scale display 84/0.96/-0.035em/600 … label 15/1.0/+0.20em/600 upper. Grid 6 columns, margin 76, gutter 28, field 1080. Photo: the doc's grade numbers. `minContrastBody: 4.5`, `minContrastLarge: 3.0`.
- [ ] Tests: parser rejects junk, accepts the authored system, null round-trips.
- [ ] Commit.

---

### Task 3: The layout grammar

**Files:** create `src/lib/design/grammar.ts` (zero runtime imports) + `grammar.test.ts`.

- [ ] `Archetype` and `LayoutSpec` exactly as the spec's section 2 shows.
- [ ] `parseLayoutSpec(unknown, system): LayoutSpec | { error: string }` — rejects unknown archetypes, value keys absent from the system, `span` exceeding `grid.columns`, `photoSide` on a non-split archetype.
- [ ] Tests for each rejection and the happy path.
- [ ] Commit.

---

### Task 4: The validator

**Files:** create `src/lib/design/validate.ts` (zero runtime imports) + `validate.test.ts`.

- [ ] `contrastRatio(hexA, hexB): number` — real WCAG relative luminance.
- [ ] **Pin the maths first**: assert ink-on-sage `10.01`, ink-on-plaster `14.09`, timber-on-sage `2.14` (to 2dp) — these are the ratios Optimal Health's own doc publishes, so a mismatch means the maths is wrong, not the design.
- [ ] `validateSlide(spec, system, colours): { ok: true } | { ok: false; violations: string[] }` where `colours` carries the slide's actual accent/background (content lives in the slide row, not the spec — see the spec's resolved question 1). Checks: every colour key exists; nothing in `rules.neverType` carries text; each text slot meets `minContrastBody`, or `minContrastLarge` for display/headline levels; spans fit the grid.
- [ ] `validateCarousel(specs, system)`: ground share within budget, and no ground exceeding `maxRun` consecutively.
- [ ] Violation strings must name the measurement — `"Heading is timber on sage: 2.14:1, below the 4.5:1 this system requires"` — because they are shown to the operator verbatim.
- [ ] Tests: a passing and failing case per rule; the sage-twice-in-a-row case; the sage-over-a-third case.
- [ ] Commit.

---

### Task 5: The renderer fork

**Files:** create `src/lib/image/paintLayout.ts`; modify `src/lib/image/paintSlide.ts`; additive migration in `src/lib/db/tenant.ts`.

- [ ] `carousel_slides.layout_json` — nullable TEXT, additive, **PRAGMA-guarded** migration (follow the pattern already in `tenant.ts`; `template_id` stays `notNull` and a composed slide stores the sentinel `"composed"`).
- [ ] `paintLayout(ctx, W, H, spec, system, design, bg, fonts, logo)` — one function per archetype, built **only** from the existing primitives (`paintBackground`, `autoFitHeading`, `paintLines`, `canvasMeasure`, `wrapLines`, `tokenizeHighlight`, `paintSlideChrome`). No new drawing capability.
- [ ] Scale the system's type sizes and grid from `system.grid.field` to the real `W`, so one system serves 1:1, 4:5 and 9:16.
- [ ] Fork **inside** `paintSlide`: `slide.templateId === "composed" && layout_json parses && a system exists` → `paintLayout`; otherwise the existing `getTemplate` path, byte-for-byte unchanged.
- [ ] **Run Task 1's golden master.** All 48 hashes must be identical. This is the gate on this task.
- [ ] Commit.

---

### Task 6: The generation pass

**Files:** create `src/lib/ai/composeDesign.ts`; wire into the carousel generate route.

- [ ] `composeCarousel(input)`: load the system; **null → delegate to today's `generateCarouselSlides` unchanged and return**.
- [ ] One Claude call returns per slide: copy **plus** a `LayoutSpec`. Give the system as structured context and the archetype list as the vocabulary. Reuse `getBusinessContext()` and the sign-off rule (`getSignoffRule("social")`).
- [ ] Validate every spec. Failures go back in **exactly one** repair call naming the violations. What survives is persisted **with its violations recorded** — per the spec's resolved question 2, a failing slide is shown, never swapped or hidden.
- [ ] Imagery only where `spec.photo !== "none"`.
- [ ] Metering unchanged: `assertUnderCap()` before, `recordUsage()` after.
- [ ] Commit.

---

### Task 7: Surfacing violations in the editor

**Files:** modify the Studio Inspector / ImageDesigner.

- [ ] Composed slides re-validate **on render** (not only at generation), so an operator edit that breaks a rule is caught too.
- [ ] Show violations as a non-blocking notice in the controls column, quoting the measurement.
- [ ] **Editor-only** — never in the exported PNG. Verify against the export path.
- [ ] Commit.

---

### Task 8: The two tabs

**Files:** `src/app/content-studio/*`, `src/components/content-studio/*`.

- [ ] **AI Generation** tab — topic, single/carousel, then the full pass. Replaces today's `/content-studio/images/new` entry point (keep the route working for deep links).
- [ ] **Templates** tab — all 48 by category with **real thumbnails** painted through `paintSlide` with representative content. Lazy-mount with IntersectionObserver (the home grid pattern). Show each at **its own aspect ratio** — the home grid's 4:3 crop mangles 9:16, a known open issue from that build.
- [ ] Commit, then deploy: `git push origin main` and `cd app && railway up` (see CLAUDE.md).

---

## Verification that matters

1. Golden master green after Task 5 — the single most important signal.
2. A composed Optimal Health carousel rendered and **looked at**, against the real brand system.
3. A tenant with no design system (Inspire) generating exactly as it does today.
4. An operator edit that breaks contrast producing the notice, and the exported PNG not containing it.
