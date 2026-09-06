# CMS Studio Visual Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/cms/<slug>/studio` so the canvas renders each page exactly as it looks live, clicking anything selects it, an inspector edits text / link URLs / image alt / section visibility, and edits go to a draft that only reaches the live site on Publish.

**Architecture:** A stored page body is split into three zones — `head` (fonts + `<style>`), `content`, `tail` (scripts). The editor reads and writes **only `content`**; head and tail never enter the editable DOM, so an edit cannot lose the site's CSS. The canvas renders head + content (never tail), so the page is styled and static. Drafts are a `content_blocks` row named `body:draft` holding only the content zone; Publish re-joins it against the body's current head/tail.

**Tech Stack:** Next.js 14 App Router (server actions), TypeScript, better-sqlite3 + drizzle, plain `node:assert` tests run by `scripts/test.mjs` under `tsx`, `lucide-react` icons.

## Global Constraints

- **NO EMOJIS** anywhere — UI copy, code, comments, log lines, commit messages. Use `lucide-react` icons where a glyph is needed.
- All work happens in `app/` (the Next.js app). Paths below are relative to `app/`.
- Tests are plain assertion scripts: `import assert from "node:assert/strict"`, a local `check(name, cond)` helper, `console.log` a summary line. No test framework. Run with `npm test -- <path>`.
- Pure modules (zero runtime imports) load under the tsx runner directly. Anything importing `server-only` or the DB cannot be unit-tested here — verify those by running the app.
- Existing behaviour that must keep working: drag-and-drop image replace from the media library, the floating bold/italic/link toolbar, device width switching, the Manage-site links in the left panel.
- Never touch `sanitizeHtmlKeepStyles` in `lib/cms/html.ts` — its other caller (the `clientflow-page` template) still depends on it exactly as-is.
- Before any deploy: `npm run typecheck`, `npm test`, `npx next build` must all pass.

---

### Task 1: The three-zone page body split

**Files:**
- Create: `src/lib/cms/pageBody.ts`
- Test: `src/lib/cms/pageBody.test.ts`

**Interfaces:**
- Consumes: nothing (zero runtime imports — this is what makes it testable under tsx).
- Produces:
  - `export interface PageBodyZones { head: string; content: string; tail: string }`
  - `export function splitPageBody(stored: string | null | undefined): PageBodyZones`
  - `export function joinPageBody(zones: PageBodyZones): string`
  - `export function rebuildBodyWithContent(storedBody: string | null | undefined, content: string): string` — the pure half of publishing: keep the stored body's head and tail, swap in new content.

Background for the implementer: every bespoke page imported by `tools/import-site.cjs` stores ONE html block shaped like this (measured on the live Inspire home page):

```
<link fonts> <link fonts> <link fonts> <style>13KB of the entire site CSS</style> <script>js flag</script>
   ...17KB of page content...
<script gsap> <script scrolltrigger> <script lenis> <script>inline init</script>
```

`head` is the leading run of `<link>` / `<style>` / `<script>` tokens before the first non-whitespace content. `tail` is the trailing run of `<script>` tokens. `content` is everything in between. A body with no styles or scripts (a plain CMS page) yields empty head and tail with content as the whole string.

- [ ] **Step 1: Write the failing test**

Create `src/lib/cms/pageBody.test.ts`:

```ts
// Run: npm test -- src/lib/cms/pageBody.test.ts
//
// Pure tests for the three-zone split that keeps the Studio from eating a
// site's CSS. The editable canvas only ever holds `content`; `head` (the
// page's own <style> + font links) and `tail` (GSAP/Lenis/init scripts) are
// carried around it untouched. The round-trip invariant below is the whole
// safety property: if join(split(x)) ever stops being byte-identical to x,
// saving a page silently rewrites markup nobody edited.
import assert from "node:assert/strict";

import { splitPageBody, joinPageBody, rebuildBodyWithContent } from "./pageBody";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// The real shape: fonts + stylesheet + js-flag script, content, then the
// animation scripts (mirrors an imported bespoke page).
const BESPOKE = [
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
  "<style>body{margin:0}.hero{display:flex}</style>",
  "<script>document.documentElement.className+=' js';</script>",
  '<header class="nav"><a href="/">Home</a></header>',
  "<main><h1>Join Our 6-Week Program</h1><p>Kickstart your fitness.</p></main>",
  '<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>',
  "<script>gsap.to('.hero',{opacity:1});</script>",
].join("\n");

const bespoke = splitPageBody(BESPOKE);

check("head holds the stylesheet", bespoke.head.includes("<style>body{margin:0}"));
check("head holds both font links", (bespoke.head.match(/<link/g) || []).length === 2);
check("head holds the leading js-flag script", bespoke.head.includes("className+=' js'"));
check("content holds the page markup", bespoke.content.includes("<h1>Join Our 6-Week Program</h1>"));
check("content has NO style tag", !bespoke.content.includes("<style"));
check("content has NO script tag", !bespoke.content.includes("<script"));
check("content has NO link tag", !bespoke.content.includes("<link"));
check("tail holds the gsap script", bespoke.tail.includes("gsap.min.js"));
check("tail holds the inline init", bespoke.tail.includes("gsap.to('.hero'"));

// THE invariant: nothing is lost or reordered by a round trip.
check("round-trip is byte-identical (bespoke)", joinPageBody(bespoke) === BESPOKE);

// Replacing only the content zone leaves head and tail exactly as they were.
const edited = joinPageBody({ ...bespoke, content: "<main><h1>New heading</h1></main>" });
check("edited body keeps the stylesheet", edited.includes("<style>body{margin:0}"));
check("edited body keeps the gsap script", edited.includes("gsap.min.js"));
check("edited body carries the new content", edited.includes("<h1>New heading</h1>"));
check("edited body drops the old content", !edited.includes("Join Our 6-Week Program"));

// A plain CMS page: no head, no tail, content is everything.
const plain = splitPageBody("<div><p>Just words.</p></div>");
check("plain html: head empty", plain.head === "");
check("plain html: tail empty", plain.tail === "");
check("plain html: content is the whole body", plain.content === "<div><p>Just words.</p></div>");
check("plain html: round-trips", joinPageBody(plain) === "<div><p>Just words.</p></div>");

// Empty and null inputs are a real state (a page with no body block yet).
for (const [label, value] of [["empty string", ""], ["null", null], ["undefined", undefined]] as const) {
  const z = splitPageBody(value as string | null | undefined);
  check(`${label}: all zones empty`, z.head === "" && z.content === "" && z.tail === "");
  check(`${label}: round-trips to ""`, joinPageBody(z) === "");
}

// A script in the MIDDLE of content stays in content (inert under innerHTML)
// and must survive the round trip rather than being hoisted into tail.
const MID = "<section>one</section>\n<script>console.log(1)</script>\n<section>two</section>";
const mid = splitPageBody(MID);
check("mid-content script stays in content", mid.content.includes("console.log(1)"));
check("mid-content script is not in tail", !mid.tail.includes("console.log(1)"));
check("mid-content round-trips", joinPageBody(mid) === MID);

// Degenerate bodies: only a stylesheet, or only scripts.
const styleOnly = splitPageBody("<style>a{color:red}</style>");
check("style-only: lands in head, content empty", styleOnly.head.includes("<style>") && styleOnly.content === "");
check("style-only: round-trips", joinPageBody(styleOnly) === "<style>a{color:red}</style>");

const scriptOnly = splitPageBody("<script>x()</script>");
check("script-only: lands in head (it leads), content empty", scriptOnly.content === "");
check("script-only: round-trips", joinPageBody(scriptOnly) === "<script>x()</script>");

// rebuildBodyWithContent is what Publish runs. The property that matters: it
// re-joins against the body AS IT IS NOW, so a page re-imported with new CSS
// under an open draft picks the new CSS up instead of being clobbered by a
// stale copy carried inside the draft.
const REIMPORTED = BESPOKE.replace("body{margin:0}", "body{margin:0;background:#111}");
const published = rebuildBodyWithContent(REIMPORTED, "<main><h1>Draft heading</h1></main>");
check("publish takes the CURRENT head", published.includes("background:#111"));
check("publish takes the current tail", published.includes("gsap.min.js"));
check("publish carries the draft content", published.includes("<h1>Draft heading</h1>"));
check("publish drops the superseded content", !published.includes("Join Our 6-Week Program"));
check(
  "publishing unchanged content is a no-op",
  rebuildBodyWithContent(BESPOKE, splitPageBody(BESPOKE).content) === BESPOKE,
);
check(
  "publish onto an empty body is just the content",
  rebuildBodyWithContent("", "<p>hi</p>") === "<p>hi</p>",
);

// Whitespace between zones is preserved exactly (part of byte-identity).
const SPACED = "<style>a{}</style>\n\n  <div>hi</div>\n\n<script>y()</script>";
check("whitespace-heavy body round-trips", joinPageBody(splitPageBody(SPACED)) === SPACED);

// Self-closing / attribute-heavy tokens don't break the scanner.
const ATTRS = '<link rel="stylesheet" href="/a.css" />\n<div data-x="<not a tag>">body</div>';
check("self-closing link + attribute noise round-trips", joinPageBody(splitPageBody(ATTRS)) === ATTRS);

console.log(`pageBody: ${passed} checks passed.`);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npm test -- src/lib/cms/pageBody.test.ts`
Expected: FAIL — `Cannot find module './pageBody'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/cms/pageBody.ts`:

```ts
/**
 * The three-zone split of a stored CMS page body.
 *
 * Every bespoke page imported by tools/import-site.cjs stores ONE html block
 * that is really three things glued together: the page's own <style> + font
 * <link>s, the page CONTENT, and the <script> tags that animate it. The Studio
 * only ever edits the middle zone — head and tail are carried around it
 * untouched — so an edit can't lose the stylesheet that IS the site's design.
 * (Before this split, the Studio sanitised the whole body for editing, and the
 * sanitiser drops <style> by design: the canvas rendered unstyled and a save
 * would have written the CSS-less result back over the live page.)
 *
 * Zero imports, so it loads under the plain tsx test runner (mirrors
 * lib/campaigns/plan.ts). joinPageBody(splitPageBody(x)) === x for every
 * input — see pageBody.test.ts.
 */

export interface PageBodyZones {
  /** Leading <link>/<style>/<script> tokens: the page's CSS and fonts. */
  head: string;
  /** The editable page markup — the ONLY zone the Studio reads or writes. */
  content: string;
  /** Trailing <script> tokens: GSAP, Lenis, the inline init. */
  tail: string;
}

/** Matches one <style>...</style>, <script>...</script>, or <link ...> token. */
const TOKEN =
  /<style\b[^>]*>[\s\S]*?<\/style>|<script\b[^>]*>[\s\S]*?<\/script>|<link\b[^>]*>/gi;

interface Token {
  start: number;
  end: number;
  isScript: boolean;
}

function scan(html: string): Token[] {
  const out: Token[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html))) {
    out.push({
      start: m.index,
      end: TOKEN.lastIndex,
      isScript: m[0].slice(0, 7).toLowerCase() === "<script",
    });
  }
  return out;
}

export function splitPageBody(
  stored: string | null | undefined,
): PageBodyZones {
  const html = stored ?? "";
  if (!html) return { head: "", content: "", tail: "" };

  const tokens = scan(html);
  if (tokens.length === 0) return { head: "", content: html, tail: "" };

  // head: consume tokens while everything before the next one is whitespace,
  // i.e. while no real content has started yet.
  let headEnd = 0;
  let i = 0;
  for (; i < tokens.length; i++) {
    if (html.slice(headEnd, tokens[i].start).trim() !== "") break;
    headEnd = tokens[i].end;
  }

  // tail: walk back from the end over SCRIPT tokens only, while everything
  // after each one is whitespace. Font links and styles never move.
  let tailStart = html.length;
  for (let j = tokens.length - 1; j >= i; j--) {
    if (!tokens[j].isScript) break;
    if (html.slice(tokens[j].end, tailStart).trim() !== "") break;
    tailStart = tokens[j].start;
  }
  if (tailStart < headEnd) tailStart = headEnd;

  return {
    head: html.slice(0, headEnd),
    content: html.slice(headEnd, tailStart),
    tail: html.slice(tailStart),
  };
}

export function joinPageBody(zones: PageBodyZones): string {
  return `${zones.head}${zones.content}${zones.tail}`;
}

/**
 * Publishing, as a pure function: keep the stored body's head and tail, swap in
 * the new content. Called with the body as it stands AT PUBLISH TIME, so a page
 * re-imported with new CSS under an open draft picks up the new CSS rather than
 * having a stale copy written back over it.
 */
export function rebuildBodyWithContent(
  storedBody: string | null | undefined,
  content: string,
): string {
  return joinPageBody({ ...splitPageBody(storedBody), content });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npm test -- src/lib/cms/pageBody.test.ts`
Expected: PASS, ending with a `pageBody: N checks passed.` summary (around 36). Every line must show a tick.

- [ ] **Step 5: Verify it splits the REAL stored pages correctly**

Run this one-off check against the live Inspire data (it reads only):

```bash
cd app && npx tsx -e "
import Database from 'better-sqlite3';
import { splitPageBody, joinPageBody } from './src/lib/cms/pageBody';
const db = new Database('data/tenants/inspire/inspire.db', { readonly: true });
const rows = db.prepare(\"select p.path, b.value from pages p join content_blocks b on b.page_id=p.id and b.name='body'\").all() as {path:string;value:string}[];
for (const r of rows) {
  const z = splitPageBody(r.value);
  const ok = joinPageBody(z) === r.value;
  console.log(r.path.padEnd(18), 'roundtrip', ok, '| head', z.head.length, 'content', z.content.length, 'tail', z.tail.length, '| style in head', z.head.includes('<style'), '| script in content', z.content.includes('<script'));
}
"
```

Expected: every row shows `roundtrip true`, `head` around 13,400 chars, `style in head true`, and `script in content false`.

- [ ] **Step 6: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add app/src/lib/cms/pageBody.ts app/src/lib/cms/pageBody.test.ts
git commit -m "$(cat <<'EOF'
feat(cms): split a stored page body into style / content / script zones

The Studio edits the middle zone only. Head (the page's own 13KB stylesheet
and font links) and tail (GSAP, Lenis, the init) are carried around it, so an
edit cannot lose the CSS that is the site's design.

join(split(x)) is byte-identical for every input, which is the whole safety
property; tested against the real imported bodies as well as plain HTML,
empty/null, mid-content scripts and whitespace-heavy shapes.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Draft storage + the server actions

**Files:**
- Create: `src/lib/cms/pageDraft.ts`
- Modify: `src/app/cms/[siteSlug]/studio/actions.ts` (replace `savePageHtmlAction` entirely)
- Modify: `src/lib/cms/render.ts:60-64` (`editBodyHtml` → return zones, stop sanitising)

**Interfaces:**
- Consumes: `splitPageBody`, `joinPageBody`, `PageBodyZones` from Task 1.
- Produces:
  - `src/lib/cms/pageDraft.ts`: `export const DRAFT_BLOCK = "body:draft"`, `export function getDraftContent(siteId: number, pageId: number): string | null`, `export function setDraftContent(siteId: number, pageId: number, content: string): void`, `export function clearDraft(siteId: number, pageId: number): void`, `export function publishDraft(siteId: number, pageId: number): boolean` (false when there was no draft), `export function listPagePathsWithDrafts(siteId: number): string[]`.
  - `src/lib/cms/render.ts`: `export function editBodyZones(pc: PageContext): PageBodyZones & { hasDraft: boolean }` (replaces `editBodyHtml`).
  - `actions.ts`: `saveDraftAction(siteSlug, path, content)`, `publishDraftAction(siteSlug, path)`, `discardDraftAction(siteSlug, path)` — each returns `{ ok: boolean; error?: string }`.

- [ ] **Step 1: Read the existing block helpers**

Run: `cd app && sed -n '1,60p' src/lib/cms/blocks.ts`

Note the shapes you will reuse: `getBlock(siteId, pageId, name)`, `upsertBlock({ siteId, pageId, name, kind, value })`. There is no delete helper — you will add one.

- [ ] **Step 2: Add a block delete helper**

In `src/lib/cms/blocks.ts`, append:

```ts
/** ADMIN: remove a block (used to discard/consume a page draft). No-op when absent. */
export function deleteBlock(siteId: number, pageId: number | null, name: string): void {
  db.delete(contentBlocks).where(whereBlock(siteId, pageId, name)).run();
}
```

- [ ] **Step 3: Write the draft module**

Create `src/lib/cms/pageDraft.ts`:

```ts
import "server-only";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getBlock, upsertBlock, deleteBlock } from "@/lib/cms/blocks";
import { rebuildBodyWithContent } from "@/lib/cms/pageBody";

const { contentBlocks, pages } = schema;

/**
 * A page draft is a second content_blocks row holding ONLY the content zone
 * (see lib/cms/pageBody.ts) of an edited page. Storing the content zone alone
 * — rather than a whole body — means a draft stays valid if the page is
 * re-imported underneath it: publishing re-joins the draft against whatever
 * head/tail the body holds AT PUBLISH TIME, so new CSS is picked up instead of
 * being clobbered by a stale copy.
 *
 * The existing (site_id, page_id, name) uniqueness gives one draft per page
 * for free, so this needs no schema change.
 */
export const DRAFT_BLOCK = "body:draft";

export function getDraftContent(siteId: number, pageId: number): string | null {
  return getBlock(siteId, pageId, DRAFT_BLOCK)?.value ?? null;
}

export function setDraftContent(siteId: number, pageId: number, content: string): void {
  upsertBlock({ siteId, pageId, name: DRAFT_BLOCK, kind: "html", value: content });
}

export function clearDraft(siteId: number, pageId: number): void {
  deleteBlock(siteId, pageId, DRAFT_BLOCK);
}

/**
 * Publish: rebuild the body as head + draft content + tail, then consume the
 * draft. Returns false when there was nothing to publish.
 */
export function publishDraft(siteId: number, pageId: number): boolean {
  const draft = getDraftContent(siteId, pageId);
  if (draft == null) return false;
  const body = getBlock(siteId, pageId, "body")?.value ?? "";
  upsertBlock({
    siteId,
    pageId,
    name: "body",
    kind: "html",
    value: rebuildBodyWithContent(body, draft),
  });
  clearDraft(siteId, pageId);
  return true;
}

/** Paths of every page in the site that currently has an unpublished draft. */
export function listPagePathsWithDrafts(siteId: number): string[] {
  return db
    .select({ path: pages.path })
    .from(contentBlocks)
    .innerJoin(pages, eq(pages.id, contentBlocks.pageId))
    .where(and(eq(contentBlocks.siteId, siteId), eq(contentBlocks.name, DRAFT_BLOCK)))
    .all()
    .map((r) => r.path);
}
```

- [ ] **Step 4: Change `editBodyHtml` to `editBodyZones`**

In `src/lib/cms/render.ts`, replace the existing function (currently at lines 60-64):

```ts
/** Page body HTML with scripts stripped, for stable editing in the Studio. */
export function editBodyHtml(pc: PageContext): string {
  const row = getBlockValue(pc.ctx.db, pc.ctx.siteId, pc.ctx.pageId, "body");
  return sanitizeHtmlKeepStyles(row?.value ?? "");
}
```

with:

```ts
/**
 * The Studio canvas's view of a page: its three zones (see lib/cms/pageBody),
 * with the DRAFT content zone substituted when one exists.
 *
 * Deliberately NOT sanitised. The live clientflow-live template already renders
 * this exact stored HTML verbatim, scripts included, on the same origin; the
 * canvas is admin-only (canEditNow) and renders strictly less than the live
 * page does (it never renders `tail`). Running it through
 * sanitizeHtmlKeepStyles here was not a security boundary — that sanitiser
 * drops <style> by design, which is what left the canvas unstyled and would
 * have written a CSS-less body back over the live page on the first save.
 */
export function editBodyZones(
  pc: PageContext,
): PageBodyZones & { hasDraft: boolean } {
  const row = getBlockValue(pc.ctx.db, pc.ctx.siteId, pc.ctx.pageId, "body");
  const zones = splitPageBody(row?.value ?? "");
  const draft = getDraftContent(pc.ctx.siteId, pc.ctx.pageId);
  return {
    ...zones,
    content: draft ?? zones.content,
    hasDraft: draft != null,
  };
}
```

Update the imports at the top of `render.ts`: add

```ts
import { splitPageBody, type PageBodyZones } from "@/lib/cms/pageBody";
import { getDraftContent } from "@/lib/cms/pageDraft";
```

and remove the now-unused `import { sanitizeHtmlKeepStyles } from "@/lib/cms/html";` **only if** nothing else in `render.ts` uses it (check with `grep -n sanitizeHtmlKeepStyles src/lib/cms/render.ts`).

- [ ] **Step 5: Replace the server actions**

Replace the whole body of `src/app/cms/[siteSlug]/studio/actions.ts` with:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { getPageByPath } from "@/lib/cms/pages";
import { setDraftContent, clearDraft, publishDraft } from "@/lib/cms/pageDraft";

type Result = { ok: boolean; error?: string };

/** Resolve site + page for the caller's own tenant, or an error result. */
async function resolve(siteSlug: string, path: string) {
  await requireAdminPage();
  const site = await getSiteBySlug(siteSlug);
  if (!site) return { error: "Unknown site." as const };
  const page = getPageByPath(site.id, path);
  if (!page) return { error: `No page at ${path}.` as const };
  return { site, page };
}

/**
 * Autosave from the canvas. Writes ONLY the content zone to the page's draft
 * block — the live page is untouched until publishDraftAction runs.
 */
export async function saveDraftAction(
  siteSlug: string,
  path: string,
  content: string,
): Promise<Result> {
  const r = await resolve(siteSlug, path);
  if ("error" in r) return { ok: false, error: r.error };
  setDraftContent(r.site.id, r.page.id, content);
  return { ok: true };
}

/** Push the draft onto the live page (head + draft content + tail) and consume it. */
export async function publishDraftAction(
  siteSlug: string,
  path: string,
): Promise<Result> {
  const r = await resolve(siteSlug, path);
  if ("error" in r) return { ok: false, error: r.error };
  if (!publishDraft(r.site.id, r.page.id)) {
    return { ok: false, error: "Nothing to publish." };
  }
  revalidatePath(`/site/${siteSlug}${path === "/" ? "" : path}`);
  return { ok: true };
}

/** Throw the draft away; the canvas reloads from the live body. */
export async function discardDraftAction(
  siteSlug: string,
  path: string,
): Promise<Result> {
  const r = await resolve(siteSlug, path);
  if ("error" in r) return { ok: false, error: r.error };
  clearDraft(r.site.id, r.page.id);
  return { ok: true };
}
```

- [ ] **Step 6: Fix the two call sites of the old function**

`editBodyHtml` was used by both public page routes. Update them to pass zones through (the canvas component signature lands in Task 3 — for now keep it compiling by passing the three zones):

In `src/app/site/[siteSlug]/page.tsx` and `src/app/site/[siteSlug]/[...slug]/page.tsx`, change the import `editBodyHtml` to `editBodyZones` and the render line

```tsx
return <RenovaEditCanvas html={editBodyHtml(pc)} path={pc.path} />;
```

to

```tsx
return <StudioCanvas zones={editBodyZones(pc)} path={pc.path} />;
```

updating the component import to `import { StudioCanvas } from "@/components/cms/StudioCanvas";`. `StudioCanvas` does not exist yet — Task 3 creates it, so **typecheck will fail until Task 3 is done**. That is expected; do not stub it.

- [ ] **Step 7: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add app/src/lib/cms/pageDraft.ts app/src/lib/cms/blocks.ts app/src/lib/cms/render.ts app/src/app/cms/\[siteSlug\]/studio/actions.ts app/src/app/site
git commit -m "$(cat <<'EOF'
feat(cms): page drafts, and the canvas stops being sanitised

Edits now land on a body:draft block holding only the content zone, so the
live page is untouched until Publish re-joins it against the body's CURRENT
head and tail (a re-import under an open draft picks up the new CSS rather
than being clobbered by it).

editBodyZones replaces editBodyHtml and no longer sanitises: that sanitiser
drops <style> by design, which is why the canvas rendered unstyled and why a
save would have written a CSS-less body over the live page. The live template
already renders this same HTML verbatim on the same origin, and the canvas is
admin-only and renders strictly less.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The canvas — faithful render, selection, and the edit surface

**Files:**
- Create: `src/components/cms/StudioCanvas.tsx`
- Delete: `src/components/cms/RenovaEditCanvas.tsx`

**Interfaces:**
- Consumes: `PageBodyZones` (Task 1); rendered by the two public site routes wired in Task 2 Step 6.
- Produces: `export function StudioCanvas({ zones, path }: { zones: PageBodyZones & { hasDraft: boolean }; path: string }): JSX.Element`, and this postMessage protocol:

| Direction | Message |
|---|---|
| canvas → shell | `cms:ready{path, hasDraft}` · `cms:dirty{content}` · `cms:selection{kind, label, breadcrumb, props}` · `cms:pickImage{token}` |
| shell → canvas | `cms:setProp{prop, value}` (`prop` ∈ `href` \| `target` \| `alt` \| `hidden`) · `cms:setImage{token, src, alt}` · `cms:selectAncestor{depth}` · `cms:dragStart{asset}` · `cms:dragEnd` · `cms:deselect`

Selection payload type (shared shape the shell's Inspector renders from):

```ts
export type SelectionKind = "text" | "link" | "image" | "section" | null;
export interface SelectionPayload {
  kind: SelectionKind;
  /** Human label for the chip, e.g. "Heading" / "Text" / "Link" / "Image" / "Section". */
  label: string;
  /** Ancestors, outermost first, each with the depth to pass to cms:selectAncestor. */
  breadcrumb: { label: string; depth: number }[];
  props: {
    tag: string;
    words?: number;
    href?: string;
    newTab?: boolean;
    src?: string;
    alt?: string;
    hidden?: boolean;
  };
}
```

- [ ] **Step 1: Read the current canvas end to end**

Run: `cd app && cat src/components/cms/RenovaEditCanvas.tsx`

You are keeping: the `data-cms-text` block/inline selection sets, the floating format toolbar (bold / italic / link / clear), link-navigation blocking, drag-and-drop image replace, and the `clean()` clone that strips editor attributes. You are removing: the `.pt,.intro{display:none!important}` hack (its overlays only existed because scripts were expected to lift them — scripts no longer load at all) and the `img{cursor:pointer}` global in favour of the new selection outline.

- [ ] **Step 2: Write the new canvas**

Create `src/components/cms/StudioCanvas.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";

import type { PageBodyZones } from "@/lib/cms/pageBody";

export type SelectionKind = "text" | "link" | "image" | "section" | null;

export interface SelectionPayload {
  kind: SelectionKind;
  label: string;
  breadcrumb: { label: string; depth: number }[];
  props: {
    tag: string;
    words?: number;
    href?: string;
    newTab?: boolean;
    src?: string;
    alt?: string;
    hidden?: boolean;
  };
}

/**
 * The in-iframe edit surface (was RenovaEditCanvas — it stopped being
 * Renova-specific a long time ago).
 *
 * Renders the page's OWN styles and fonts (`head`) plus its content, and never
 * its scripts (`tail`): the canvas looks exactly like the live site but nothing
 * animates, hijacks scroll, or rewrites the DOM while you edit. GSAP writes
 * inline opacity/transform onto elements as it animates, so running it here
 * would bake those into whatever the editor saves.
 *
 * Talks to the Studio shell over postMessage — see the protocol table in
 * docs/superpowers/plans/2026-09-06-cms-studio-editor.md.
 */
export function StudioCanvas({
  zones,
  path,
}: {
  zones: PageBodyZones & { hasDraft: boolean };
  path: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const parentWin = window.parent;
    const post = (msg: unknown) => parentWin.postMessage(msg, "*");
    const dirty = () => post({ type: "cms:dirty", content: clean() });

    // --- editor chrome (never saved: lives outside #cms-edit-root) ---
    const style = document.createElement("style");
    style.setAttribute("data-cms-editor", "1");
    style.textContent = `
      [data-cms-sel]{outline:2px solid #ef5a24 !important;outline-offset:2px}
      [data-cms-hover]:not([data-cms-sel]){outline:1px dashed rgba(239,90,36,.65) !important;outline-offset:2px}
      [data-cms-text][contenteditable="true"]{background:rgba(239,90,36,.06)}
      [data-cms-hidden-preview]{opacity:.28}
      img.cms-drop-target{outline:3px solid #3fb950 !important;outline-offset:3px}
      #cms-edit-root [data-cms-editable-text]{cursor:text}
    `;
    document.head.appendChild(style);

    const SECTION_SEL = "section,header,footer,article,aside";
    const TEXT_SEL = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dt,dd,th,td";
    const hasText = (el: Element) => (el.textContent || "").trim().length > 0;

    const labelFor = (el: HTMLElement): string => {
      const tag = el.tagName.toLowerCase();
      if (tag === "img") return "Image";
      if (tag === "a") return "Link";
      if (/^h[1-6]$/.test(tag)) return `Heading ${tag[1]}`;
      if (el.matches(SECTION_SEL)) return "Section";
      if (tag === "li") return "List item";
      if (tag === "button") return "Button";
      if (tag === "p") return "Text";
      return tag;
    };

    const kindFor = (el: HTMLElement): SelectionKind => {
      const tag = el.tagName.toLowerCase();
      if (tag === "img") return "image";
      if (tag === "a") return "link";
      if (el.matches(SECTION_SEL) || el.parentElement === root) return "section";
      if (el.matches(TEXT_SEL) || hasText(el)) return "text";
      return "section";
    };

    // --- selection ---
    let selected: HTMLElement | null = null;
    const chain = (el: HTMLElement): HTMLElement[] => {
      const out: HTMLElement[] = [];
      let cur: HTMLElement | null = el;
      while (cur && cur !== root) {
        out.unshift(cur);
        cur = cur.parentElement;
      }
      return out;
    };

    const describe = (el: HTMLElement): SelectionPayload => {
      const kind = kindFor(el);
      const anc = chain(el);
      const img = el as HTMLImageElement;
      const a = el as HTMLAnchorElement;
      return {
        kind,
        label: labelFor(el),
        // depth counts back from the selected element: 0 = itself, 1 = parent…
        breadcrumb: anc.map((n, i) => ({
          label: labelFor(n),
          depth: anc.length - 1 - i,
        })),
        props: {
          tag: el.tagName.toLowerCase(),
          words:
            kind === "text"
              ? ((el.textContent || "").trim().match(/\S+/g) || []).length
              : undefined,
          href: kind === "link" ? a.getAttribute("href") ?? "" : undefined,
          newTab: kind === "link" ? a.getAttribute("target") === "_blank" : undefined,
          src: kind === "image" ? img.getAttribute("src") ?? "" : undefined,
          alt: kind === "image" ? img.getAttribute("alt") ?? "" : undefined,
          hidden:
            kind === "section"
              ? el.style.display === "none" || el.hasAttribute("data-cms-hidden-preview")
              : undefined,
        },
      };
    };

    const select = (el: HTMLElement | null) => {
      if (selected) {
        selected.removeAttribute("data-cms-sel");
        if (selected.getAttribute("contenteditable") === "true") {
          selected.removeAttribute("contenteditable");
        }
      }
      selected = el;
      if (!el) {
        hideToolbar();
        post({ type: "cms:selection", kind: null, label: "", breadcrumb: [], props: { tag: "" } });
        return;
      }
      el.setAttribute("data-cms-sel", "1");
      const payload = describe(el);
      if (payload.kind === "text") {
        el.setAttribute("contenteditable", "true");
        el.focus();
        showToolbar(el);
      } else {
        hideToolbar();
      }
      post({ type: "cms:selection", ...payload });
    };

    // --- hover outline ---
    let hovered: HTMLElement | null = null;
    const onOver = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      const el = t && t !== root ? (t.closest("*") as HTMLElement | null) : null;
      if (hovered === el) return;
      hovered?.removeAttribute("data-cms-hover");
      hovered = el && root.contains(el) && el !== root ? el : null;
      hovered?.setAttribute("data-cms-hover", "1");
    };
    const onLeave = () => {
      hovered?.removeAttribute("data-cms-hover");
      hovered = null;
    };

    // --- floating format toolbar (kept from the old canvas) ---
    const tb = document.createElement("div");
    tb.className = "cms-toolbar";
    tb.style.cssText =
      "position:absolute;z-index:99999;display:none;gap:2px;background:#16161a;border-radius:8px;padding:4px;box-shadow:0 8px 28px rgba(0,0,0,.35)";
    const btn = (cmd: string, label: string, italic = false, bold = false) =>
      `<button data-cmd="${cmd}" style="all:unset;cursor:pointer;color:#fff;font-size:12px;padding:5px 9px;border-radius:5px;${bold ? "font-weight:700;" : ""}${italic ? "font-style:italic;" : ""}">${label}</button>`;
    tb.innerHTML = btn("bold", "B", false, true) + btn("italic", "I", true) + btn("clear", "Clear");
    document.body.appendChild(tb);
    tb.addEventListener("mousedown", (e) => e.preventDefault());
    tb.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b) return;
      const cmd = (b as HTMLElement).dataset.cmd;
      if (cmd === "bold") document.execCommand("bold");
      else if (cmd === "italic") document.execCommand("italic");
      else if (cmd === "clear") {
        document.execCommand("removeFormat");
        document.execCommand("unlink");
      }
      dirty();
    });
    function showToolbar(el: HTMLElement) {
      const r = el.getBoundingClientRect();
      tb.style.display = "flex";
      tb.style.top = `${r.top + window.scrollY - 40}px`;
      tb.style.left = `${r.left + window.scrollX}px`;
    }
    function hideToolbar() {
      tb.style.display = "none";
    }

    // --- clicks: select, never navigate ---
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest(".cms-toolbar")) return;
      if (!root.contains(t)) {
        select(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      select(t === root ? null : t);
    };
    document.addEventListener("click", onClick, true);
    root.addEventListener("mouseover", onOver);
    root.addEventListener("mouseleave", onLeave);
    root.addEventListener("input", dirty, true);

    // --- images: click selects; the shell opens the picker on Replace ---
    const imgToken = (img: HTMLImageElement) => {
      const token = `img-${Date.now()}`;
      img.setAttribute("data-cms-img", token);
      return token;
    };

    // --- serialise: everything the editor added comes back off ---
    function clean(): string {
      const clone = root.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("[contenteditable]").forEach((e) => e.removeAttribute("contenteditable"));
      clone.querySelectorAll("[data-cms-sel]").forEach((e) => e.removeAttribute("data-cms-sel"));
      clone.querySelectorAll("[data-cms-hover]").forEach((e) => e.removeAttribute("data-cms-hover"));
      clone.querySelectorAll("[data-cms-text]").forEach((e) => e.removeAttribute("data-cms-text"));
      clone.querySelectorAll("[data-cms-img]").forEach((e) => e.removeAttribute("data-cms-img"));
      clone.querySelectorAll("[data-cms-hidden-preview]").forEach((e) => {
        e.removeAttribute("data-cms-hidden-preview");
        (e as HTMLElement).style.display = "none";
      });
      clone.querySelectorAll(".cms-toolbar").forEach((e) => e.remove());
      return clone.innerHTML;
    }

    // --- drag-and-drop image replace (kept from the old canvas) ---
    let pendingAsset: { id: number; url: string; alt: string | null } | null = null;
    let dropTarget: HTMLImageElement | null = null;
    const setTarget = (img: HTMLImageElement | null) => {
      if (dropTarget && dropTarget !== img) dropTarget.classList.remove("cms-drop-target");
      dropTarget = img;
      img?.classList.add("cms-drop-target");
    };
    const imgFrom = (t: EventTarget | null) =>
      t instanceof HTMLElement ? (t.closest("img") as HTMLImageElement | null) : null;
    const onDragOver = (e: DragEvent) => {
      if (!pendingAsset) return;
      const img = imgFrom(e.target);
      if (img) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        setTarget(img);
      } else setTarget(null);
    };
    const onDrop = (e: DragEvent) => {
      if (!pendingAsset) return;
      const img = imgFrom(e.target);
      if (img) {
        e.preventDefault();
        img.setAttribute("src", pendingAsset.url);
        if (pendingAsset.alt) img.setAttribute("alt", pendingAsset.alt);
        dirty();
      }
      setTarget(null);
      pendingAsset = null;
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);

    // --- messages from the shell ---
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data || {};
      if (d.type === "cms:setProp" && selected) {
        const el = selected;
        if (d.prop === "href") el.setAttribute("href", String(d.value));
        else if (d.prop === "target") {
          if (d.value) el.setAttribute("target", "_blank");
          else el.removeAttribute("target");
        } else if (d.prop === "alt") el.setAttribute("alt", String(d.value));
        else if (d.prop === "hidden") {
          if (d.value) el.setAttribute("data-cms-hidden-preview", "1");
          else {
            el.removeAttribute("data-cms-hidden-preview");
            if (el.style.display === "none") el.style.removeProperty("display");
          }
        }
        dirty();
        post({ type: "cms:selection", ...describe(el) });
      } else if (d.type === "cms:pickImageRequest" && selected?.tagName === "IMG") {
        post({ type: "cms:pickImage", token: imgToken(selected as HTMLImageElement) });
      } else if (d.type === "cms:setImage") {
        const img = root.querySelector<HTMLImageElement>(`[data-cms-img="${d.token}"]`);
        if (img) {
          img.setAttribute("src", d.src);
          if (d.alt) img.setAttribute("alt", d.alt);
          img.removeAttribute("data-cms-img");
          dirty();
          if (selected === img) post({ type: "cms:selection", ...describe(img) });
        }
      } else if (d.type === "cms:selectAncestor") {
        let el: HTMLElement | null = selected;
        for (let i = 0; i < Number(d.depth || 0) && el && el.parentElement !== root?.parentElement; i++) {
          el = el.parentElement;
        }
        if (el && root.contains(el)) select(el);
      } else if (d.type === "cms:deselect") {
        select(null);
      } else if (d.type === "cms:dragStart") {
        pendingAsset = d.asset || null;
      } else if (d.type === "cms:dragEnd") {
        setTarget(null);
        pendingAsset = null;
      }
    };
    window.addEventListener("message", onMsg);

    // Sections already hidden in the stored HTML render at low opacity here so
    // they can be found and switched back on.
    root.querySelectorAll<HTMLElement>('[style*="display:none"],[style*="display: none"]').forEach((el) => {
      el.setAttribute("data-cms-hidden-preview", "1");
      el.style.removeProperty("display");
    });

    post({ type: "cms:ready", path, hasDraft: zones.hasDraft });

    return () => {
      window.removeEventListener("message", onMsg);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseleave", onLeave);
      tb.remove();
      style.remove();
    };
  }, [zones, path]);

  return (
    <>
      {/* The page's OWN styles and fonts. <style> and <link> inserted via
          innerHTML are applied by the browser (unlike <script>, which is
          inert), so the canvas looks exactly like the live site. */}
      <div dangerouslySetInnerHTML={{ __html: zones.head }} />
      <div id="cms-edit-root" ref={rootRef} dangerouslySetInnerHTML={{ __html: zones.content }} />
    </>
  );
}
```

- [ ] **Step 3: Delete the old canvas**

```bash
cd app && rm src/components/cms/RenovaEditCanvas.tsx
grep -rn "RenovaEditCanvas" src/ || echo "no references left"
```

Expected: `no references left` (Task 2 Step 6 already repointed both routes).

- [ ] **Step 4: Typecheck**

Run: `cd app && npm run typecheck`
Expected: PASS with no output. If `PageBodyZones` import errors, confirm Task 1 exported the type.

- [ ] **Step 5: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add -A app/src/components/cms
git commit -m "$(cat <<'EOF'
feat(cms): the studio canvas renders the real page, and everything is selectable

StudioCanvas (was RenovaEditCanvas, which stopped being Renova-specific long
ago) renders the page's own stylesheet and fonts with its content, and never
its scripts: it looks exactly like the live site, and nothing animates, hijacks
scroll or rewrites the DOM mid-edit. The .pt/.intro overlay hack goes with it —
those overlays only existed because scripts were expected to lift them.

Click anything to select it; the canvas reports what it is, its ancestors, and
the properties the inspector can edit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The inspector panel

**Files:**
- Create: `src/components/cms/studio/Inspector.tsx`

**Interfaces:**
- Consumes: `SelectionPayload`, `SelectionKind` from `@/components/cms/StudioCanvas` (Task 3).
- Produces:

```ts
export function Inspector(props: {
  selection: SelectionPayload | null;
  onSetProp: (prop: "href" | "target" | "alt" | "hidden", value: string | boolean) => void;
  onSelectAncestor: (depth: number) => void;
  onReplaceImage: () => void;
}): JSX.Element
```

- [ ] **Step 1: Write the component**

Create `src/components/cms/studio/Inspector.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Image as ImageIcon, Link2, Type } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { SelectionPayload } from "@/components/cms/StudioCanvas";

const LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
};

/**
 * The right-hand panel: what the selected element is, where it sits, and the
 * few things it can change. Always mounted (empty state included) so selecting
 * something never resizes the canvas.
 */
export function Inspector({
  selection,
  onSetProp,
  onSelectAncestor,
  onReplaceImage,
}: {
  selection: SelectionPayload | null;
  onSetProp: (prop: "href" | "target" | "alt" | "hidden", value: string | boolean) => void;
  onSelectAncestor: (depth: number) => void;
  onReplaceImage: () => void;
}) {
  // Local mirrors so typing feels immediate; re-synced whenever the selection
  // changes underneath (a different element, or the canvas echoing a change).
  const [href, setHref] = useState("");
  const [alt, setAlt] = useState("");
  useEffect(() => {
    setHref(selection?.props.href ?? "");
    setAlt(selection?.props.alt ?? "");
  }, [selection]);

  if (!selection || !selection.kind) {
    return (
      <div style={{ padding: 16, display: "grid", gap: 8, alignContent: "start" }}>
        <div style={LABEL}>Inspector</div>
        <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", lineHeight: 1.6, margin: 0 }}>
          Click anything on the page to edit it. Text edits in place; images,
          links and sections get their own controls here.
        </p>
      </div>
    );
  }

  const { kind, label, breadcrumb, props } = selection;

  return (
    <div style={{ padding: 16, display: "grid", gap: 14, alignContent: "start", minWidth: 0 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={LABEL}>Selected</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {kind === "image" ? <ImageIcon size={14} /> : kind === "link" ? <Link2 size={14} /> : <Type size={14} />}
          <span style={{ fontSize: 14, color: "var(--text-primary)" }}>{label}</span>
          <code style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{props.tag}</code>
        </div>
      </div>

      {breadcrumb.length > 1 && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={LABEL}>Inside</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
            {breadcrumb.map((b, i) => (
              <span key={`${b.label}-${b.depth}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {i > 0 && <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>/</span>}
                <button
                  onClick={() => onSelectAncestor(b.depth)}
                  style={{
                    border: "none",
                    background: b.depth === 0 ? "var(--surface-2)" : "transparent",
                    color: b.depth === 0 ? "var(--text-primary)" : "var(--text-secondary)",
                    borderRadius: 5,
                    padding: "3px 6px",
                    fontSize: 11.5,
                    cursor: "pointer",
                  }}
                >
                  {b.label}
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {kind === "text" && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={LABEL}>Text</div>
          <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.55 }}>
            Edit it straight on the page. Select words for bold, italic or a link.
          </p>
          {props.words != null && (
            <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{props.words} words</div>
          )}
        </div>
      )}

      {kind === "link" && (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={LABEL}>Link</div>
          <Input
            value={href}
            placeholder="/sign-up or https://…"
            onChange={(e) => setHref(e.target.value)}
            onBlur={() => onSetProp("href", href)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-secondary)" }}>
            <input
              type="checkbox"
              checked={!!props.newTab}
              onChange={(e) => onSetProp("target", e.target.checked)}
            />
            Opens in a new tab
          </label>
        </div>
      )}

      {kind === "image" && (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={LABEL}>Image</div>
          {props.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={props.src}
              alt={props.alt || ""}
              style={{
                width: "100%",
                aspectRatio: "16/10",
                objectFit: "cover",
                borderRadius: 8,
                border: "1px solid var(--hairline)",
                display: "block",
              }}
            />
          ) : null}
          <Button size="sm" variant="outline" onClick={onReplaceImage}>
            <ImageIcon size={14} /> Replace image
          </Button>
          <div style={{ display: "grid", gap: 5 }}>
            <div style={LABEL}>Alt text</div>
            <Input
              value={alt}
              placeholder="Describe the image"
              onChange={(e) => setAlt(e.target.value)}
              onBlur={() => onSetProp("alt", alt)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
        </div>
      )}

      {kind === "section" && (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={LABEL}>Section</div>
          <Button size="sm" variant="outline" onClick={() => onSetProp("hidden", !props.hidden)}>
            {props.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
            {props.hidden ? "Show this section" : "Hide this section"}
          </Button>
          <p style={{ fontSize: 11.5, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.55 }}>
            {props.hidden
              ? "Hidden on the live page. It stays here, faded, so you can switch it back on."
              : "Hiding keeps the section in the page but stops it rendering for visitors."}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add app/src/components/cms/studio/Inspector.tsx
git commit -m "$(cat <<'EOF'
feat(cms): the studio inspector

What is selected, where it sits (a breadcrumb you can click to walk up to the
containing section), and the few things that selection can change: link URLs,
image alt and replacement, section visibility. Text still edits in place.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Screens panel + media drawer

**Files:**
- Create: `src/components/cms/studio/ScreensPanel.tsx`
- Create: `src/components/cms/studio/MediaDrawer.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks beyond React.
- Produces:
  - `export function ScreensPanel(props: { siteSlug: string; pages: { path: string; title: string }[]; activePath: string; draftPaths: string[]; onNavigate: (path: string) => void }): JSX.Element`
  - `export interface MediaRow { id: number; url: string; originalName: string; alt: string | null }`
  - `export function MediaDrawer(props: { open: boolean; onClose: () => void; onPick: (m: MediaRow) => void; onDragStart: (m: MediaRow) => void; onDragEnd: () => void }): JSX.Element | null`

- [ ] **Step 1: Write ScreensPanel**

Create `src/components/cms/studio/ScreensPanel.tsx`:

```tsx
"use client";

import Link from "next/link";
import { FileText, Globe, Image as ImageIcon, Newspaper } from "lucide-react";

const HEADING: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: ".12em",
  color: "var(--text-tertiary)",
};

const MANAGE = [
  { key: "pages", label: "Pages & SEO", icon: FileText },
  { key: "blog", label: "Blog", icon: Newspaper },
  { key: "media", label: "Media", icon: ImageIcon },
  { key: "domains", label: "Domains", icon: Globe },
] as const;

/** Left rail: the site's other sections, then the pages you can edit here. */
export function ScreensPanel({
  siteSlug,
  pages,
  activePath,
  draftPaths,
  onNavigate,
}: {
  siteSlug: string;
  pages: { path: string; title: string }[];
  activePath: string;
  draftPaths: string[];
  onNavigate: (path: string) => void;
}) {
  const drafts = new Set(draftPaths);
  return (
    <aside
      style={{
        borderRight: "1px solid var(--hairline)",
        padding: 14,
        overflowY: "auto",
        background: "var(--surface-1)",
      }}
    >
      <div style={{ ...HEADING, marginBottom: 8 }}>Manage site</div>
      <div style={{ display: "grid", gap: 2, marginBottom: 18 }}>
        {MANAGE.map(({ key, label, icon: Icon }) => (
          <Link
            key={key}
            href={`/cms/${siteSlug}/${key}`}
            className="nav-link"
            style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 6, fontSize: 13 }}
          >
            <Icon size={15} strokeWidth={1.75} />
            {label}
          </Link>
        ))}
      </div>

      <div style={{ ...HEADING, marginBottom: 10 }}>Screens</div>
      <div style={{ display: "grid", gap: 2 }}>
        {pages.map((p) => {
          const active = p.path === activePath;
          return (
            <button
              key={p.path}
              onClick={() => onNavigate(p.path)}
              style={{
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                background: active ? "var(--surface-2)" : "transparent",
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {p.title || p.path}
                {drafts.has(p.path) && (
                  <span
                    title="Unpublished draft"
                    style={{ width: 6, height: 6, borderRadius: "50%", background: "#d29922", flex: "none" }}
                  />
                )}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{p.path}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Write MediaDrawer**

Create `src/components/cms/studio/MediaDrawer.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";

export interface MediaRow {
  id: number;
  url: string;
  originalName: string;
  alt: string | null;
}

/**
 * The shared media library, as a drawer INSIDE the inspector column — opened by
 * Replace, or by dragging a thumbnail onto any image on the page. It used to be
 * a third editor column, which resized the whole canvas every time it opened.
 */
export function MediaDrawer({
  open,
  onClose,
  onPick,
  onDragStart,
  onDragEnd,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (m: MediaRow) => void;
  onDragStart: (m: MediaRow) => void;
  onDragEnd: () => void;
}) {
  const [rows, setRows] = useState<MediaRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/cms/library").then((r) => r.json());
    setRows(
      (res.assets || []).map((a: { id: number; originalName: string; alt: string | null }) => ({
        id: a.id,
        originalName: a.originalName,
        alt: a.alt,
        url: `/library-media/${a.id}`,
      })),
    );
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("file", f));
    setUploading(true);
    try {
      const res = await fetch("/api/cms/library", { method: "POST", body: fd }).then((r) => r.json());
      if (!res.ok) toast.error(res.error ?? "Upload failed");
      else {
        toast.success(`Uploaded ${res.assets.length} image(s)`);
        await refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        borderTop: "1px solid var(--hairline)",
        display: "grid",
        gridTemplateRows: "auto auto 1fr",
        minHeight: 0,
        background: "var(--surface-1)",
      }}
    >
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
          Media library
        </span>
        <button
          onClick={onClose}
          aria-label="Close media library"
          style={{ border: "none", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", padding: 2 }}
        >
          <X size={14} />
        </button>
      </div>
      <div style={{ padding: "0 12px 10px" }}>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
        <Button onClick={() => fileInput.current?.click()} disabled={uploading} size="sm" variant="outline" style={{ width: "100%" }}>
          {uploading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
          {uploading ? "Uploading…" : "Upload images"}
        </Button>
        <p style={{ fontSize: 11, color: "var(--text-tertiary)", margin: "8px 2px 0", lineHeight: 1.5 }}>
          Click one to use it, or drag it onto any image on the page.
        </p>
      </div>
      <div style={{ overflowY: "auto", padding: "0 12px 12px" }}>
        {rows.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)", fontSize: 12, padding: "8px 2px" }}>
            No images yet — upload some to get started.
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {rows.map((m) => (
              <button
                key={m.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "copy";
                  e.dataTransfer.setData("text/plain", m.url);
                  onDragStart(m);
                }}
                onDragEnd={onDragEnd}
                onClick={() => onPick(m)}
                title={m.alt || m.originalName}
                style={{
                  border: "1px solid var(--hairline)",
                  borderRadius: 8,
                  overflow: "hidden",
                  background: "var(--surface-2)",
                  cursor: "grab",
                  padding: 0,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.url}
                  alt={m.alt || m.originalName}
                  draggable={false}
                  style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block", pointerEvents: "none" }}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `cd app && npm run typecheck` (expected PASS), then:

```bash
cd /Users/truep/Desktop/Clients/Renova
git add app/src/components/cms/studio/ScreensPanel.tsx app/src/components/cms/studio/MediaDrawer.tsx
git commit -m "$(cat <<'EOF'
feat(cms): studio screens rail and media drawer

The pages list now dots any screen holding an unpublished draft. The library
becomes a drawer inside the inspector instead of a third column that resized
the canvas every time it opened.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The shell — wire it together

**Files:**
- Rewrite: `src/components/cms/StudioShell.tsx` (moves to `src/components/cms/studio/StudioShell.tsx`)
- Modify: `src/app/cms/[siteSlug]/studio/page.tsx`

**Interfaces:**
- Consumes: `ScreensPanel`, `MediaDrawer` + `MediaRow` (Task 5), `Inspector` (Task 4), `SelectionPayload` (Task 3), the three actions (Task 2), `listPagePathsWithDrafts` (Task 2).
- Produces: `export function StudioShell(props: { siteSlug: string; pages: { path: string; title: string }[]; initialPath: string; initialDraftPaths: string[] }): JSX.Element`

- [ ] **Step 1: Move the file and rewrite it**

```bash
cd app && git mv src/components/cms/StudioShell.tsx src/components/cms/studio/StudioShell.tsx
```

Then replace its entire contents with:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Check, ExternalLink, Loader2, Monitor, Smartphone, Tablet, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { Inspector } from "@/components/cms/studio/Inspector";
import { ScreensPanel } from "@/components/cms/studio/ScreensPanel";
import { MediaDrawer, type MediaRow } from "@/components/cms/studio/MediaDrawer";
import type { SelectionPayload } from "@/components/cms/StudioCanvas";
import {
  saveDraftAction,
  publishDraftAction,
  discardDraftAction,
} from "@/app/cms/[siteSlug]/studio/actions";

const DEVICES = {
  desktop: { icon: Monitor, w: "100%" },
  tablet: { icon: Tablet, w: "820px" },
  mobile: { icon: Smartphone, w: "390px" },
} as const;
type Device = keyof typeof DEVICES;

/**
 * The Studio: screens rail | canvas | inspector.
 *
 * Edits autosave to the page's DRAFT; the live site changes only on Publish.
 * The canvas is an iframe on the site's own public route (?cmsedit=1), talking
 * over postMessage — see StudioCanvas for the protocol.
 */
export function StudioShell({
  siteSlug,
  pages,
  initialPath,
  initialDraftPaths,
}: {
  siteSlug: string;
  pages: { path: string; title: string }[];
  initialPath: string;
  initialDraftPaths: string[];
}) {
  const confirm = useConfirm();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [path, setPath] = useState(initialPath);
  const [draftPaths, setDraftPaths] = useState<string[]>(initialDraftPaths);
  const [device, setDevice] = useState<Device>("desktop");
  const [selection, setSelection] = useState<SelectionPayload | null>(null);
  const [libOpen, setLibOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const hasDraft = draftPaths.includes(path);
  const src = (p: string) => `/site/${siteSlug}${p === "/" ? "" : p}?cmsedit=1`;

  const toCanvas = useCallback((msg: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  // --- autosave the draft ---
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;
  const queueSave = useCallback(
    (content: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const p = pathRef.current;
        setSaving(true);
        try {
          const r = await saveDraftAction(siteSlug, p, content);
          if (r.ok) {
            setSavedAt(Date.now());
            setDraftPaths((prev) => (prev.includes(p) ? prev : [...prev, p]));
          } else toast.error(r.error ?? "Couldn't save the draft.");
        } finally {
          setSaving(false);
        }
      }, 1200);
    },
    [siteSlug],
  );

  // --- canvas messages ---
  const pendingToken = useRef<string | null>(null);
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const d = ev.data || {};
      if (d.type === "cms:ready") {
        setSelection(null);
      } else if (d.type === "cms:dirty") {
        queueSave(String(d.content ?? ""));
      } else if (d.type === "cms:selection") {
        setSelection(d.kind ? (d as SelectionPayload) : null);
      } else if (d.type === "cms:pickImage") {
        pendingToken.current = d.token;
        setLibOpen(true);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [queueSave]);

  const reload = useCallback(
    (p: string) => {
      setSelection(null);
      if (iframeRef.current) iframeRef.current.src = src(p);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteSlug],
  );

  function navigate(p: string) {
    setPath(p);
    reload(p);
  }

  async function publish() {
    setPublishing(true);
    try {
      const r = await publishDraftAction(siteSlug, path);
      if (r.ok) {
        toast.success("Published");
        setDraftPaths((prev) => prev.filter((x) => x !== path));
        setSavedAt(null);
      } else toast.error(r.error ?? "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  async function discard() {
    if (
      !(await confirm({
        title: "Discard this draft?",
        body: "The page goes back to what visitors currently see. This can't be undone.",
        confirmLabel: "Discard",
        destructive: true,
      }))
    )
      return;
    const r = await discardDraftAction(siteSlug, path);
    if (r.ok) {
      setDraftPaths((prev) => prev.filter((x) => x !== path));
      setSavedAt(null);
      reload(path);
    } else toast.error(r.error ?? "Couldn't discard the draft.");
  }

  const status = saving
    ? { icon: <Loader2 size={13} className="spin" />, text: "Saving draft…", color: "var(--text-tertiary)" }
    : hasDraft
      ? { icon: <span style={{ color: "#d29922" }}>●</span>, text: "Draft — not published", color: "#d29922" }
      : savedAt
        ? { icon: <Check size={13} />, text: "Published", color: "#3fb950" }
        : { icon: null, text: "Published", color: "var(--text-tertiary)" };

  return (
    <div style={{ display: "grid", gridTemplateRows: "52px 1fr", height: "100vh" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 16px",
          borderBottom: "1px solid var(--hairline)",
          background: "var(--surface-1)",
        }}
      >
        <Link
          href="/cms"
          className="nav-link"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-secondary)", fontSize: 13, padding: "5px 8px", borderRadius: 6 }}
        >
          <ArrowLeft size={16} /> Sites
        </Link>
        <strong style={{ fontSize: 14 }}>Visual editor</strong>
        <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>{path}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: status.color }}>
          {status.icon} {status.text}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {(Object.keys(DEVICES) as Device[]).map((dv) => {
            const Icon = DEVICES[dv].icon;
            return (
              <Tooltip label={dv} key={dv}>
                <button
                  onClick={() => setDevice(dv)}
                  aria-label={dv}
                  style={{
                    border: "none",
                    background: device === dv ? "var(--surface-2)" : "transparent",
                    color: device === dv ? "var(--text-primary)" : "var(--text-tertiary)",
                    borderRadius: 6,
                    padding: 6,
                    cursor: "pointer",
                  }}
                >
                  <Icon size={16} />
                </button>
              </Tooltip>
            );
          })}
          <a
            href={`/site/${siteSlug}${path === "/" ? "" : path}`}
            target="_blank"
            rel="noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--text-secondary)" }}
          >
            View <ExternalLink size={13} />
          </a>
          {hasDraft && (
            <Button size="sm" variant="ghost" onClick={discard}>
              <Trash2 size={14} /> Discard draft
            </Button>
          )}
          <Button size="sm" onClick={publish} disabled={!hasDraft} loading={publishing}>
            <Upload size={14} /> Publish
          </Button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 300px", minHeight: 0 }}>
        <ScreensPanel
          siteSlug={siteSlug}
          pages={pages}
          activePath={path}
          draftPaths={draftPaths}
          onNavigate={navigate}
        />

        <div
          style={{
            background: "var(--surface-2)",
            display: "grid",
            placeItems: "start center",
            overflow: "auto",
            padding: device === "desktop" ? 0 : 20,
          }}
        >
          <iframe
            ref={iframeRef}
            src={src(initialPath)}
            title="Site canvas"
            style={{
              width: DEVICES[device].w,
              height: "100%",
              minHeight: "100%",
              border: device === "desktop" ? "none" : "1px solid var(--hairline)",
              borderRadius: device === "desktop" ? 0 : 12,
              background: "#fff",
            }}
          />
        </div>

        <aside
          style={{
            borderLeft: "1px solid var(--hairline)",
            background: "var(--surface-1)",
            display: "grid",
            gridTemplateRows: libOpen ? "1fr auto" : "1fr",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div style={{ overflowY: "auto", minHeight: 0 }}>
            <Inspector
              selection={selection}
              onSetProp={(prop, value) => toCanvas({ type: "cms:setProp", prop, value })}
              onSelectAncestor={(depth) => toCanvas({ type: "cms:selectAncestor", depth })}
              onReplaceImage={() => toCanvas({ type: "cms:pickImageRequest" })}
            />
          </div>
          <MediaDrawer
            open={libOpen}
            onClose={() => setLibOpen(false)}
            onPick={(m: MediaRow) => {
              if (pendingToken.current) {
                toCanvas({ type: "cms:setImage", token: pendingToken.current, src: m.url, alt: m.alt });
                pendingToken.current = null;
              }
            }}
            onDragStart={(m) => toCanvas({ type: "cms:dragStart", asset: { id: m.id, url: m.url, alt: m.alt } })}
            onDragEnd={() => toCanvas({ type: "cms:dragEnd" })}
          />
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update the page to pass draft paths**

Replace the body of `src/app/cms/[siteSlug]/studio/page.tsx` after `if (!site) notFound();` with:

```tsx
  const pages = listPages(site.id)
    .filter((p) => p.status === "published")
    .map((p) => ({ path: p.path, title: p.title || p.path }));

  const initialPath = searchParams.path || pages[0]?.path || "/";
  const initialDraftPaths = listPagePathsWithDrafts(site.id);

  return (
    <StudioShell
      siteSlug={site.slug}
      pages={pages}
      initialPath={initialPath}
      initialDraftPaths={initialDraftPaths}
    />
  );
```

and fix the two imports at the top:

```tsx
import { StudioShell } from "@/components/cms/studio/StudioShell";
import { listPagePathsWithDrafts } from "@/lib/cms/pageDraft";
```

- [ ] **Step 3: Typecheck, test, build**

```bash
cd app && npm run typecheck && npm test && npx next build
```
Expected: typecheck silent, tests end with `✓ N/N test file(s) passed`, build completes.

- [ ] **Step 4: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add -A app/src
git commit -m "$(cat <<'EOF'
feat(cms): the studio shell, rebuilt around draft and publish

Three columns — screens, canvas, inspector — with the inspector always mounted
so selecting something never resizes the canvas. Edits autosave to the page's
draft and reach visitors only on Publish; Discard puts the page back to what is
live.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Verify against the real site, then deploy

**Files:** none (verification + deploy).

- [ ] **Step 1: Run the app**

```bash
cd app && npm run dev
```

Open `http://localhost:3000/cms/inspire/studio`.

- [ ] **Step 2: Walk the checklist**

Check each, and fix anything that fails before moving on:

1. The home page canvas **looks like the live site** — Bebas headings, dark hero, the counter cards rendering as designed. (Before: browser-default text, bare `0`s.)
2. No page-transition overlay covers the canvas, and the page does not animate or scroll-jack.
3. Hovering outlines elements; clicking selects, and the inspector names what it is.
4. Clicking a heading makes it editable inline; typing flips the top bar to "Saving draft…" then "Draft — not published", and the screens rail dots that page.
5. The breadcrumb walks up from a heading to its section; selecting the section offers Hide, and hiding fades it in the canvas.
6. Selecting the SIGN UP link shows its href; changing it and pressing Enter marks the draft dirty.
7. Selecting an image shows it, Replace opens the drawer, picking swaps it, and dragging a thumbnail onto a different image swaps that one.
8. **Reload the page in the browser** — the draft is still there (it came from `body:draft`).
9. Open the live URL `http://localhost:3000/site/inspire` in another tab — **it still shows the OLD content**, styled and animated, with GSAP running.
10. Press Publish — the live tab now shows the edit, still styled and still animated.
11. Press Discard on a fresh draft — the canvas returns to the published content.

- [ ] **Step 3: Prove the CSS survived a publish**

```bash
cd app && node -e "
const D=require('better-sqlite3');const db=new D('data/tenants/inspire/inspire.db',{readonly:true});
const r=db.prepare(\"select b.value v from pages p join content_blocks b on b.page_id=p.id and b.name='body' where p.path='/'\").get();
console.log('style block present:', r.v.includes('<style'), '| length', r.v.length);
console.log('gsap present:', r.v.includes('gsap.min.js'));
console.log('draft rows:', db.prepare(\"select count(*) c from content_blocks where name='body:draft'\").get().c);
"
```

Expected: `style block present: true`, a length still in the 30,000s, `gsap present: true`, and `draft rows: 0` after publishing.

- [ ] **Step 4: Deploy**

```bash
cd app && npm run typecheck && npm test && npx next build
cd /Users/truep/Desktop/Clients/Renova && git push origin main
cd app && railway up --detach
```

Then confirm the deployment reports SUCCESS and `https://app.adonisagent.ie/api/health` returns 200.
