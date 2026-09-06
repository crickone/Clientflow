# CMS Studio — the visual site editor, rebuilt — Design

**Date:** 2026-09-06 · **Status:** APPROVED
**Decision locked:** faithful static canvas + click-to-edit (no free-form layout building), **draft → Publish** (nothing reaches the live site until the operator publishes), and an inspector that also edits **link URLs**, **image alt text**, and **section visibility**.

## Goal

Make `/cms/<slug>/studio` an editor an operator can actually work in: the canvas shows the page **exactly as it looks live**, clicking anything selects it, and a right-hand inspector edits what that thing can change. Today the canvas renders the site unstyled — headings at browser defaults, counters rendering as bare `0`, lists as raw text — because the edit path strips the page's own stylesheet.

## The bug this fixes (latent, not yet fired)

Every imported bespoke page stores one `body` block laid out identically (measured on Inspire `/`):

```
3 x <link> (Google Fonts) | 1 x <style> (13,104 chars — the ENTIRE site CSS) | 1 x <script> (59 — the `js` class flag)
  --> content (17,114 chars)  <-- the only zone an editor should touch
4 x <script> (GSAP 81, ScrollTrigger 90, Lenis 72, inline init 3,514)
```

1. `lib/cms/render.ts#editBodyHtml` runs that value through `sanitizeHtmlKeepStyles`, whose own doc comment states `<style>` is deliberately excluded ("The page's own `<style>` BLOCK element is not in `BESPOKE_TAGS` at all... it's discarded outright"). So the canvas receives the page with **no CSS**. That is the mess in the screenshots.
2. `cms/[siteSlug]/studio/actions.ts#savePageHtmlAction` then writes that CSS-less HTML back over the stored `body`, re-appending only the original `<script>` tags. **One Save would permanently strip the live site's stylesheet** and reorder the `js`-flag script to the end.

Nothing has saved yet — every Inspire `content_blocks.updated_at` is still the June import timestamp — so this is a loaded gun, not damage already done.

## Non-goals

- Free-form element creation, drag-anywhere layout, class-based styling, breakpoint editing (a real Webflow clone — weeks, and not what a content editor needs).
- A properties panel for arbitrary CSS (colour/spacing/typography of any element).
- A layers tree, section reordering, or a library of insertable pre-built sections.
- Running the page's GSAP/Lenis scripts inside the canvas (see "Why static" below).
- Re-authoring imported sites into a structured block model.

## Architecture

### 1. `lib/cms/pageBody.ts` — the three-zone split (new, pure, tested)

```ts
export interface PageBodyZones { head: string; content: string; tail: string }
export function splitPageBody(stored: string | null | undefined): PageBodyZones
export function joinPageBody(zones: PageBodyZones): string
```

- **head** — the leading run of `<link>` / `<style>` / `<script>` tokens (plus the whitespace between them) that appears *before* the first non-whitespace content.
- **tail** — the trailing run of `<script>` tokens at the end.
- **content** — everything between. For a plain HTML body with no styles or scripts, head and tail are empty and content is the whole string.

**Invariant, covered by tests:** `joinPageBody(splitPageBody(x)) === x`, byte for byte, for every input — the bespoke shape above, a bare `<div>hello</div>`, empty string, null, a body whose scripts sit mid-content (they stay inside `content`, are inert under `innerHTML`, and round-trip untouched).

Zero imports, so it loads under the plain tsx test runner (mirrors `lib/campaigns/plan.ts`).

The editor reads and writes **only `content`**. `head` and `tail` never enter the editable DOM, so they cannot be lost by an edit, a save, or a sanitiser.

### 2. Drafts — a second content block, no schema change

A draft is a `content_blocks` row with `name: "body:draft"`, `kind: "html"`, holding **only the content zone**. The existing `(site_id, page_id, name)` uniqueness gives exactly one draft per page.

| Action | Effect |
|---|---|
| edit in canvas | autosaves the content zone to `body:draft` (debounced ~1.2s). The live page is untouched. |
| **Publish** | `upsertBlock(body, joinPageBody({ ...splitPageBody(currentBody), content: draft }))`, delete the draft row, `revalidatePath` the public URL. |
| **Discard draft** | delete the draft row; the canvas reloads from `body`. |

Storing only the content zone means a draft stays valid across a re-import: it is re-joined to whatever `head`/`tail` the body holds **at publish time**, so new CSS is picked up rather than clobbered.

The Screens list marks pages that have an unpublished draft; the top bar shows Draft / Published state.

### 3. The canvas — faithful, static

`editBodyHtml(pc)` stops sanitising and returns the zones. `StudioCanvas` renders:

- `head` — via `dangerouslySetInnerHTML` into a container div. `<style>` and `<link rel=stylesheet>` inserted through `innerHTML` **are** applied by the browser (unlike `<script>`, which is inert), so the page gets its real CSS and fonts.
- `content` — into `#cms-edit-root`, the single editable region.
- `tail` — never rendered.

**Why static.** The page's own scripts are the reason the current canvas needs its `.pt,.intro{display:none!important}` hack: transition overlays that only lift once GSAP runs. Running them for real is worse — Lenis hijacks scroll, ScrollTrigger pins sections, and GSAP writes inline `style="opacity:0;transform:..."` onto elements, which the save path would then bake into the stored page. Static means WYSIWYG for layout, type and colour (what an editor is choosing between) and no DOM mutation racing the editor. Webflow's designer does not run your page JS either. The overlay hack is deleted, because the overlays are only hidden by scripts that no longer load.

**Why dropping the sanitiser here is safe.** The live `clientflow-live` template already renders this exact stored HTML **verbatim, scripts included**, on the same origin (`lib/cms/sites/renova/templates.tsx`). The canvas is admin-only (`canEditNow()` requires the admin role) and renders strictly less than the live page does. The sanitiser was not a boundary between anyone and anything here; it was only mangling first-party markup. `sanitizeHtmlKeepStyles` stays exactly as it is for its other caller, the `clientflow-page` static template.

### 4. Selection model + inspector

One model for every element. Click selects; the selection gets an outline and a small chip naming it (Heading / Text / Link / Image / Section). The inspector is always mounted — empty state "Click anything on the page to edit it" — so the canvas never changes width.

| Selection | Inspector controls |
|---|---|
| Text (`h1-h6, p, li, blockquote, figcaption, dt, dd, th, td`, and standalone inline text) | edits **inline on the page** (contenteditable, as today) with the floating bold / italic / link / clear toolbar. Panel shows the tag and a word count. |
| Link (`a`) | `href` field + "opens in a new tab" toggle (writes/removes `target="_blank"`). |
| Image (`img`) | thumbnail, **Replace** (opens the media drawer), `alt` field. |
| Section (`section, header, footer, article, aside`, or a direct child of the edit root) | **Hidden** toggle. |

An **ancestor breadcrumb** (`section > div > h2`) sits at the top of the inspector: click a heading, step up one level, and the whole section is selected. Two clicks to reach the thing the current editor cannot select at all.

**Hiding** writes inline `style="display:none"` — the only mechanism that reliably beats the site's own stylesheet (a `hidden` attribute loses to any `display:flex` rule) and that survives storage, since `display` is already in the sanitiser's `STYLE_PROPS` allow-list. In the canvas a hidden section renders at low opacity with a Hidden badge so it can always be found and restored.

Drag-and-drop image replace from the library survives unchanged.

### 5. Layout + file split

Three columns: **Screens** (pages + the existing Manage-site links) | **canvas** (device widths: desktop / tablet 820 / mobile 390) | **inspector**. The media library becomes a **drawer inside the inspector**, opened by Replace, instead of a third column that resizes the editor. Top bar: back, path, draft status, device switcher, View live, Discard draft, **Publish** (primary).

`StudioShell.tsx` is 483 lines today and this work would push it past 800, so:

| File | Holds |
|---|---|
| `lib/cms/pageBody.ts` + `.test.ts` | the pure three-zone split/join |
| `components/cms/studio/StudioShell.tsx` | layout, top bar, draft state, postMessage bridge |
| `components/cms/studio/ScreensPanel.tsx` | pages list (with draft dots) + manage links |
| `components/cms/studio/Inspector.tsx` | breadcrumb + per-selection controls |
| `components/cms/studio/MediaDrawer.tsx` | library grid, upload, drag source |
| `components/cms/StudioCanvas.tsx` | the in-iframe editor (renamed from `RenovaEditCanvas` — it has not been Renova-specific for a long time) |
| `cms/[siteSlug]/studio/actions.ts` | `saveDraftAction` / `publishDraftAction` / `discardDraftAction` |

### 6. postMessage protocol (canvas <-> shell)

| Direction | Message |
|---|---|
| canvas -> shell | `cms:ready{path}`, `cms:dirty{content}`, `cms:selection{kind, breadcrumb[], props}`, `cms:pickImage{token}` |
| shell -> canvas | `cms:setImage{token,src,alt}`, `cms:setProp{prop,value}` (href/target/alt/hidden), `cms:selectAncestor{depth}`, `cms:dragStart{asset}` / `cms:dragEnd` |

`cms:dirty` carries the cleaned content zone, so the shell autosaves what the canvas actually holds rather than reaching into the iframe's DOM to reconstruct it (today's `save()` does the latter, which is why the clean-up logic is duplicated in both files).

## Security

- Edit route stays admin-gated (`canEditNow()`); unchanged.
- Draft and publish server actions call `requireAdminPage()` and resolve the site by slug within the caller's tenant — same shape as today's `savePageHtmlAction`.
- Publishing writes a body built from the stored head/tail plus admin-authored content — never from client-supplied head or scripts. The canvas cannot introduce a `<script>` into `head`/`tail`, because it never renders or returns them.

## Testing

- `pageBody.test.ts`: round-trip byte-equality across the bespoke shape, plain HTML, empty/null, mid-content scripts, style-only, script-only; and that `content` excludes every head/tail token.
- Publish/discard: unit-level checks that publish re-joins against the **current** body (a body whose head changed between draft and publish gets the new head).
- The rest is DOM behaviour: verified by running the app against Inspire (`/cms/inspire/studio`) and looking at every page.

## Risks

- **A page whose body does not match the expected shape** (e.g. a CMS-authored `basic-page`) — handled: head/tail empty, content is everything, editing still works.
- **Fonts** load from Google in the canvas exactly as they do live; no offline story, same as the live site.
- **Very long pages** (17KB+ of content) in contenteditable — same as today, no regression.
