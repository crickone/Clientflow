# AI-composed post design, per tenant — Design

**Date:** 2026-09-08 · **Status:** DRAFT, for review

**Decisions locked in conversation:**
- The AI **composes its own layout per slide** from the tenant's own design system, rather than picking one of the 48 fixed templates.
- It composes **within a grammar** — a bounded set of layout archetypes whose every parameter comes from the tenant's system — not free-form box placement.
- Built **tenant-scoped** and proven on Optimal Health, whose design system already exists.
- The **48 templates stay**, under a Templates tab, with real rendered thumbnails.
- A new **AI Generation** tab sits alongside it.
- The AI pass is **full**: copy, layout, brand colours, and imagery.

## The problem

Two separate gaps, one build.

**The AI cannot design.** `generateCarousel.ts` writes copy and names a template from a **hand-written list inside the prompt** — a paraphrase of the catalogue that can silently drift from `templates.ts`. It never sets colour (slides keep the `#2c6ce0` column default), never decides whether a slide should carry a photograph, and knows nothing about the tenant's brand. A generated carousel is text in someone else's clothes.

**Templates are code, not data.** Each of the 48 is an imperative `render(ctx, design, bg, fonts)`. There is nothing for an AI to compose with — you can pick a template or you can't, and that is the whole vocabulary.

## What makes this tractable

**The primitives already exist.** Every template is built from the same handful: `paintBackground`, `autoFitHeading`, `paintLines`, `canvasMeasure`, `wrapLines`, `tokenizeHighlight`, `paintSlideChrome`. A composed layout needs no new drawing code — only a spec the renderer can walk.

**The design system already has a prototype.** `OPTIMAL-BRAND-SYSTEM.md` carries exactly the right shape: five values with roles, three grounds with proportions and adjacency rules, a type scale with size/leading/tracking per level, a six-column grid with real numbers, photography treatment, and contrast ratios stated as rules. It is a machine-readable design system written in prose.

**The rules are checkable, which is the whole safety story.** During the Optimal Health build, computing contrast caught a primary button at 3.01:1 (failing) and a ground-rotation check caught sage at 67% against a one-third ceiling. The same checks run against a composed slide before anyone sees it. Without this, AI-composed design is a lottery.

## Architecture

### 1. `lib/design/system.ts` — the tenant design system (data)

```ts
export interface DesignSystem {
  version: 1;
  values: { key: string; hex: string; role: "ground" | "type" | "accent" | "reserved" }[];
  grounds: { value: string; share: number; maxRun: number }[];   // share 0..1, maxRun = consecutive slides allowed
  type: Record<"display"|"headline"|"subhead"|"body"|"label",
    { size: number; leading: number; tracking: number; weight: number; upper?: boolean }>;
  grid: { columns: number; margin: number; gutter: number; field: number };
  photo: { saturate: number; contrast: number; brightness: number; wash?: { hex: string; alpha: number } } | null;
  rules: {
    minContrastBody: number;      // 4.5
    minContrastLarge: number;     // 3.0
    neverType: string[];          // value keys that must never carry text (Optimal: timber)
  };
}
```

Stored per tenant in the existing `settings` key/value table (`setKey("design_system", …)`), so no schema migration. `getDesignSystem(): DesignSystem | null` — **null is a first-class state**: tenants without one keep today's behaviour exactly, which is how Inspire and Renova stay working until their systems are written.

Sizes are authored against `grid.field` (1080 for Optimal Health) and scale proportionally to the slide's real width, so one system serves 1:1, 4:5 and 9:16.

### 2. `lib/design/grammar.ts` — the layout spec (what the AI emits)

```ts
export type Archetype =
  | "statement"      // full-bleed photo or ground, one large line
  | "split"          // photo one half, panel the other
  | "stack"          // label, heading, body in a column
  | "list"           // heading plus 3-5 short lines
  | "quote"          // attributed quotation
  | "stat";          // one number carrying the slide

export interface LayoutSpec {
  archetype: Archetype;
  ground: string;                       // a value key, must exist and be role:"ground"
  photo: "full" | "half" | "none";
  photoSide?: "left" | "right";         // split only
  align: "left";                        // flush left; the systems that allow centring set it explicitly
  slots: { level: keyof DesignSystem["type"]; text: string; span: number }[];
  accentRule?: { value: string; place: "above" | "below" };
  chrome?: ChromeIntent;                // reuses the existing type
}
```

Every field is either a value key from the system or a bounded enum. **The AI cannot position a box**; it chooses an archetype and fills parameters. That constraint is the design, not a limitation of the model.

### 3. `lib/image/paintLayout.ts` — one renderer for composed slides

`paintLayout(ctx, W, H, spec, system, design, bg, fonts, logo)` walks the spec using the existing primitives. One function per archetype, each a bounded composition — no new drawing capability enters the codebase.

**The 48 templates are untouched.** `paintSlide` keeps its `getTemplate(slide.templateId)` path; a composed slide takes the new branch. The preview-equals-export invariant holds because `SlideCanvas` and `renderSlideToBlob` both call `paintSlide`, and the fork happens inside it — exactly one branch runs, the same one on both sides.

### 4. `lib/design/validate.ts` — the gate (pure, heavily tested)

Given a `LayoutSpec` and a `DesignSystem`, returns `{ ok: true } | { ok: false; violations: string[] }`:

- every colour referenced exists in `values`;
- no value in `rules.neverType` is used for a text slot;
- the actual foreground/ground pairing meets `minContrastBody` (or `minContrastLarge` for display/headline levels), computed by real WCAG relative luminance;
- `slots[].span` fits `grid.columns`;
- across a carousel: each ground's share is within its budget, and no ground exceeds `maxRun` consecutive slides.

Zero runtime imports so it loads under the tsx runner. Contrast maths is pinned by asserting the three ratios Optimal Health publishes (10.01, 14.09, 2.14) — the same check that caught the real defect.

### 5. The generation pass

`composeCarousel()` in `lib/ai/composeDesign.ts`:

1. Load the tenant's design system. **Null → fall through to today's `generateCarouselSlides` unchanged.**
2. One Claude call returns, per slide, the copy **and** a `LayoutSpec`, with the system given as structured context and the archetype list as the vocabulary.
3. Validate every spec. Violations go back in **one** repair call naming them. Still failing → fall back to the nearest fixed template and record why. Never show an invalid slide.
4. Imagery only where `spec.photo !== "none"` — a stat slide on a flat ground never spends 4¢.
5. Persist: `carousel_slides.template_id` is `notNull`, so a composed slide stores a sentinel `"composed"` plus the spec in a new nullable `layout_json` column (additive, PRAGMA-guarded, the established pattern).

### 6. Information architecture

Content Studio gains two tabs:

- **AI Generation** — topic, single or carousel, then the full pass.
- **Templates** — the 48 by category with **real thumbnails**, each painted through `paintSlide` with representative content, lazy-mounted with IntersectionObserver, and shown at each template's own aspect ratio (the home grid's 4:3 crop mangles 9:16 — a known open issue from that build).

## Non-goals

- No free-form design: no arbitrary coordinates, no new drawing primitives, no AI-authored code or SVG.
- The 48 templates are not migrated into the grammar, deprecated, or altered.
- No design system for Inspire, Renova or ClientFlow in this work — Optimal Health only.
- No change to video, blog, or the campaign engine.

## Risks

| Risk | Mitigation |
|---|---|
| Composed design looks worse than templates | The grammar is bounded; validation gates every slide; templates remain the fallback and the comparison |
| Renderer change breaks preview==export | The fork lives inside `paintSlide`, which both sides already call; golden-master the 48 templates byte-for-byte before and after |
| Cost per post rises | Imagery is gated on `spec.photo`; one repair call maximum; existing `assertUnderCap`/`recordUsage` unchanged |
| A tenant without a system gets a degraded experience | Null system falls through to today's path exactly |

## Testing

- `validate.test.ts` — contrast maths pinned against the doc's published ratios; each rule with a passing and failing case; carousel-level share and run limits.
- `grammar.test.ts` — spec parsing rejects unknown archetypes, unknown value keys, spans over the column count.
- **Golden master**: render all 48 templates before and after the `paintSlide` fork and assert byte-identical PNGs. This is the regression that matters.
- Composed output is judged by eye, against the real Optimal Health system, before it ships.

## Open questions for review

1. Should a composed slide be **editable** afterwards in the Studio's normal controls, or locked to its spec? Editable is friendlier; it means the spec and the edited slide can diverge, and the validator no longer holds.
2. When validation fails twice, is falling back to a fixed template the right behaviour, or should the slide be shown with the violation surfaced to the operator?
