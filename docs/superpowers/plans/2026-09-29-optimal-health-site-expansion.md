# Optimal Health Website Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the Optimal Health website from 9 thin pages to 14 deep ones plus 6 blog posts, on a sticky-rail page structure, with every call to action pointing at something real.

**Architecture:** The site is a static build — `_style.css` plus body partials in `pages/`, composed by `build.mjs` into self-contained HTML files at the folder root. Nothing is a framework. The new structure is a chapter rail: a partial marks sections with `data-chapter="Label"`, and the build derives the numbered index from those marks, so the contents list can never drift from the sections it points at. The scroll-spy that lights the current entry is progressive enhancement in the tail zone; without it the rail is a plain anchor list that still works.

**Tech Stack:** Node (ESM, no dependencies) for the build · GSAP 3.12.5 + ScrollTrigger from jsDelivr for motion · playwright-core (resolved from `app/node_modules`) for screenshots · `tsx` for the import check.

## Global Constraints

- **NO EMOJIS** anywhere — markup, copy, comments, commit messages, console output. `lucide-react` is not available here; this site uses no icon set.
- **Run `node build.mjs` after every edit to `pages/*.html` or `_style.css`.** The root `*.html` files are build output; editing them directly is always wrong and will be overwritten.
- **Every emitted page must stay self-contained** — its own `<style>` in the head, scripts at the end of the body. That is the shape `tools/import-site.cjs` files correctly into the CMS's head / content / tail zones.
- **Claims language:** supports, promotes, may help, encourages. Never treats, cures, heals, eliminates, or reverses. No named medical conditions anywhere on the site. No outcome promises. No before/after framing.
- **Palette is five values, no sixth:** `--sage:#C7D2BB` `--ink:#24231F` `--plaster:#F2F3ED` `--timber:#B0844F` `--deep:#5E6B4E`. Timber never carries type — it is 2.14:1 on sage and fails contrast.
- **Grounds rotate:** plaster about half the sections, sage about a third and never twice running, ink about a sixth.
- **The therapy is the HIFEM chair.** The string `PEMF` appears nowhere on this site.
- **Prices are exactly:** Infrared €50 / €225 for 5 / €400 for 10 · Hyperbaric oxygen €100 / €450 for 5 / €800 for 10 · HIFEM chair €70 / €375 for 6 / €670 for 12. No struck-through "was" prices.
- **Booking URL:** `https://optimalhealthatinspire.simplybook.it/v2` · **Login:** `https://optimalhealthatinspire.simplybook.it/v2/#client/sign-in` · **Vouchers:** `https://optimalhealth.voucherconnect.com`
- **Phone** 083 867 2844 · **Email** info@optimalhealthatinspire.ie · **Address** Unit 12m, Ard Gaoithe Business Park, Clonmel, Co. Tipperary, E91 E049.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
| --- | --- |
| `sites/optimal-health/_source/live-site.md` | Create. The client's live copy, extracted, as the durable source for every content task. |
| `sites/optimal-health/check.ts` | Create. Fails if any built page would not import cleanly or is not Studio-editable. |
| `sites/optimal-health/shots.mjs` | Create. Screenshots every built page at desktop and phone width into `_shots/`. |
| `sites/optimal-health/build.mjs` | Modify. Add the chapter-rail generator and the `META` entries for five new pages. |
| `sites/optimal-health/_style.css` | Modify. Add `.doc` / `.rail` / `.strip` / `.bookbar`, the FAQ accordion and the timeline. |
| `sites/optimal-health/pages/*.html` | Modify 9, create 5 (`recovery` `athletes` `collagen` `testimonials` `blog`). |
| `sites/optimal-health/posts/*.html` | Create. Six blog post partials. |
| `app/src/lib/cms/enquiry.ts` | Modify. Programme list becomes per-site instead of hardcoded to Healthwise. |
| `app/src/lib/cms/enquiry.test.ts` | Modify. Cover both sites' programme sets. |

---

### Task 1: The verification harness and the source of truth

Nothing downstream can be checked without this. `check.ts` is the only automated gate this site has; `shots.mjs` is how you catch what reasoning does not. Both are ported from the Healthwise site, which proved them on 2026-09-28.

**Files:**
- Create: `sites/optimal-health/_source/live-site.md`
- Create: `sites/optimal-health/check.ts`
- Create: `sites/optimal-health/shots.mjs`
- Create: `sites/optimal-health/.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `npx tsx ../sites/optimal-health/check.ts` run from `app/` exits 0 when every page is importable. `node shots.mjs` writes `_shots/<page>-desktop.png` and `_shots/<page>-phone.png`.

- [ ] **Step 1: Extract the client's live site to a committed source file**

The live site is Webflow and will change under us. Capture it once, commit it, and work from the file.

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health
mkdir -p _source/raw
BASE=https://www.optimalhealthatinspire.ie
for p in "" about athletic-performance blog collagen-production contact infrared \
         massage-therapy medical-treatments pemf pricing sign-up testimonials; do
  name="${p:-home}"
  curl -sL --max-time 30 "$BASE/$p" -o "_source/raw/$name.html"
done
for s in accelerate-athlete-recovery-the-power-of-hyperbaric-oxygen-therapy-and-community \
         full-body-infrared-therapy-your-guide-to-pain-relief-and-optimal-health \
         infrared-therapy-for-chronic-pain-a-non-invasive-path-to-lasting-relief \
         pemf-therapy-for-desk-jobs-a-solution-for-pain-fatigue-and-focus \
         rapid-concussion-recovery-with-hyperbaric-oxygen-therapy-hbot \
         the-science-of-stress-relief-how-pemf-therapy-calms-your-nervous-system; do
  curl -sL --max-time 30 "$BASE/post/$s" -o "_source/raw/post-$s.html"
done
ls _source/raw | wc -l
```

Expected: `19`

- [ ] **Step 2: Reduce the raw HTML to readable text**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health
python3 - <<'PY'
import re, os, html
SRC, OUT = "_source/raw", "_source/live-site.md"
def text(p):
    s = open(p, encoding="utf-8", errors="ignore").read()
    s = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", s)
    s = re.sub(r"(?is)<!--.*?-->", " ", s)
    s = re.sub(r"(?i)<br[^>]*>", "\n", s)
    s = re.sub(r"(?i)</(p|div|section|li|h[1-6]|tr|td)>", "\n", s)
    s = html.unescape(re.sub(r"(?s)<[^>]+>", " ", s))
    out, prev = [], None
    for l in (re.sub(r"[ \t\xa0]+", " ", x).strip() for x in s.split("\n")):
        if l and l != prev:
            out.append(l); prev = l
    return "\n".join(out)
parts = ["# The client's live site, as it read on 2026-09-29",
         "",
         "Source material for the rebuild. Captured from www.optimalhealthatinspire.ie,",
         "which is Webflow and will change. Read this rather than re-crawling.",
         "",
         "NOTE: this file records their copy verbatim, including the condition names and",
         "treatment claims we are NOT carrying across. See the spec's reshape rules.",
         ""]
for f in sorted(os.listdir(SRC)):
    parts += [f"## {f[:-5]}", "", "```", text(os.path.join(SRC, f)), "```", ""]
open(OUT, "w").write("\n".join(parts))
print(OUT, os.path.getsize(OUT), "bytes")
PY
```

Expected: roughly 130000 bytes.

- [ ] **Step 3: Keep the raw HTML and the screenshots out of git**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health
cat > .gitignore <<'EOF'
_source/raw/
_shots/
EOF
```

- [ ] **Step 4: Write the import check**

Create `sites/optimal-health/check.ts`:

```ts
// Run from app/:  npx tsx ../sites/optimal-health/check.ts
// Reads the built pages exactly as tools/import-site.cjs will, splits each
// into head/content/tail the way the CMS does, and applies the Studio's
// editability rule. Fails if any page is refused or has an empty head or tail.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { splitPageBody, studioEditability } from "../../app/src/lib/cms/pageBody";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { readSitePages } = require("../../tools/lib/siteHtml.cjs") as {
  readSitePages: (dir: string, slug: string) => Array<{ path: string; body: string }>;
};

let bad = 0;
for (const p of readSitePages(here, "optimal-health")) {
  const z = splitPageBody(p.body);
  const e = studioEditability(z);
  const ok = e.ok && z.head.length > 0 && z.tail.length > 0;
  if (!ok) bad++;
  console.log(
    p.path.padEnd(16),
    e.ok ? "editable" : `REFUSED: ${e.reason}`,
    `| head ${z.head.length} content ${z.content.length} tail ${z.tail.length}`,
  );
}
if (bad) {
  console.error(`${bad} page(s) would not import cleanly`);
  process.exit(1);
}
console.log(`${join(here, "*.html")}: every page splits into three zones and is Studio-editable`);
```

- [ ] **Step 5: Run the check against the nine pages that exist today**

```bash
cd /Users/truep/Desktop/Clients/Renova/app && npx tsx ../sites/optimal-health/check.ts
```

Expected: nine lines each reading `editable`, then the closing line. Exit 0. If any page is REFUSED, stop — the existing site has a problem this plan assumes it does not, and it must be fixed before anything is built on top.

- [ ] **Step 6: Write the screenshot script**

Create `sites/optimal-health/shots.mjs`:

```js
#!/usr/bin/env node
// Screenshot every built page at desktop and phone width and LOOK at them.
// Designing against your own markup does not work; the picture catches what
// reasoning does not (a wrapping wordmark, a rail colliding with body copy,
// a chapter strip that scrolls off its own labels).
//
//   node shots.mjs                       all pages, file:// URLs
//   node shots.mjs http://localhost:4321 against a running server
//
// playwright-core is resolved from app/node_modules; the browser is the
// Playwright Chromium already on this machine.
import { createRequire } from "node:module";
import { mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "..", "app", "package.json"));
const { chromium } = require("playwright-core");

const CHROME = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium_headless_shell-1243",
  "chrome-headless-shell-mac-arm64/chrome-headless-shell",
);
const base = process.argv[2] || null;
const out = join(here, "_shots");
mkdirSync(out, { recursive: true });

const pages = readdirSync(here).filter((f) => f.endsWith(".html")).sort();
const browser = await chromium.launch({ executablePath: CHROME });

for (const [label, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const f of pages) {
    const url = base ? `${base}/${f}` : `file://${join(here, f)}`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(out, `${f.replace(/\.html$/, "")}-${label}.png`), fullPage: true });
    console.log(`  ${label.padEnd(8)} ${f}`);
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${pages.length * 2} screenshots in ${out}`);
```

- [ ] **Step 7: Run it and look at the output**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node shots.mjs
```

Expected: 18 screenshots. **Open at least `index-desktop.png`, `index-phone.png` and `massage-desktop.png` with the Read tool and look at them.** This is the baseline you will compare every later task against. Note in your commit what the massage page's repeated hero looks like — it is a known defect and you are not fixing it here.

- [ ] **Step 8: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add sites/optimal-health/.gitignore sites/optimal-health/check.ts \
        sites/optimal-health/shots.mjs sites/optimal-health/_source/live-site.md
git commit -m "$(cat <<'EOF'
test(optimal-health): the import check and the screenshot pass, and the client's live copy

Ported from the Healthwise site, which proved both on 2026-09-28. check.ts is
the only automated gate a static site like this has: it splits every built page
the way the CMS importer will and fails if one would not import or would not be
Studio-editable. shots.mjs is the other half, because designing against your own
markup does not work and the picture catches what reasoning does not.

_source/live-site.md is the client's live Webflow copy extracted once and
committed, so every later task works from a fixed source rather than re-crawling
a site that changes under us. It records their condition names and treatment
claims verbatim; those are the part we are deliberately not carrying across.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The chapter rail

The structural change the whole plan rests on. Built and proved on `hbot.html` alone; the other pages adopt it in their own tasks.

**Files:**
- Modify: `sites/optimal-health/build.mjs`
- Modify: `sites/optimal-health/_style.css`
- Modify: `sites/optimal-health/pages/hbot.html`

**Interfaces:**
- Consumes: `check.ts`, `shots.mjs` from Task 1.
- Produces: the partial contract — a section opts into the rail with `data-chapter="Label"`, and `<!-- /chapters -->` closes the documented column. The build assigns `id="s01"`, `id="s02"` … in document order, emits `.rail` before the column and `.strip` inside it, and every anchor carries `data-rail="<id>"`. Later tasks only ever write `data-chapter` and the end marker; they never write rail markup by hand.

- [ ] **Step 1: Add the chapter generator to build.mjs**

Insert directly above `const shell = ({ title, description, body }) =>`:

```js
/* ---- the chapter rail -----------------------------------------------
   A partial opts a section into the page index with data-chapter="Label",
   and closes the documented column with <!-- /chapters -->. Everything
   before the first chapter (the hero) and everything after the marker (the
   closing call to action) stays full-bleed.

   The index is DERIVED from the same marks that number the sections, so a
   contents entry can never point at a section that is not there -- the
   failure mode of every hand-written table of contents.
--------------------------------------------------------------------- */
const BOOK = "https://optimalhealthatinspire.simplybook.it/v2";
const CHAPTER_RE = /<section\b([^>]*?)\sdata-chapter="([^"]+)"([^>]*)>/g;

function documentise(body) {
  const chapters = [];
  const marked = body.replace(CHAPTER_RE, (_m, pre, label, post) => {
    const n = String(chapters.length + 1).padStart(2, "0");
    chapters.push({ n, label, id: `s${n}` });
    return `<section${pre} data-chapter="${label}"${post} id="s${n}">`;
  });
  if (!chapters.length) return marked;

  const start = marked.search(/<section\b[^>]*\sdata-chapter=/);
  const endMark = marked.indexOf("<!-- /chapters -->");
  const end = endMark === -1 ? marked.length : endMark;

  const rail = `<aside class="rail" aria-label="On this page">
  <div class="rail__in">
    <p class="rail__k">On this page</p>
    <nav class="rail__nav">
${chapters.map((c) => `      <a class="rail__a" href="#${c.id}" data-rail="${c.id}"><span class="rail__n">${c.n}</span><span class="rail__l">${c.label}</span></a>`).join("\n")}
    </nav>
    <a class="btn btn--rail" href="${BOOK}">Book a session</a>
  </div>
</aside>`;

  const strip = `<nav class="strip" aria-label="On this page">
  <div class="strip__nav">
${chapters.map((c) => `    <a class="strip__a" href="#${c.id}" data-rail="${c.id}"><span class="rail__n">${c.n}</span> ${c.label}</a>`).join("\n")}
  </div>
</nav>`;

  const bar = `<div class="bookbar"><a class="btn" href="${BOOK}">Book a session</a></div>`;

  return [
    marked.slice(0, start),
    `<div class="doc">`,
    rail,
    `<div class="doc__body">`,
    strip,
    marked.slice(start, end),
    `</div>`,
    `</div>`,
    bar,
    marked.slice(end),
  ].join("\n");
}
```

- [ ] **Step 2: Call it from the build loop**

In the `for (const name of readdirSync(...))` loop, replace:

```js
  const body = readFileSync(join(here, "pages", name), "utf8");
  writeFileSync(join(here, meta.file), shell({ ...meta, body }));
```

with:

```js
  const raw = readFileSync(join(here, "pages", name), "utf8");
  const body = documentise(raw);
  writeFileSync(join(here, meta.file), shell({ ...meta, body }));
```

Leave the `console.log` reporting `body.length` as it is — it now reports the composed length, which is what actually ships.

- [ ] **Step 3: Verify the build is unchanged for pages with no chapters**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node build.mjs && git diff --stat -- '*.html'
```

Expected: `9 pages built.` and **no changed files**. `documentise` returns the body untouched when nothing declares a chapter, so a build with no partial edits must be a no-op. If any root `.html` changed, the regex is matching something it should not — fix it before continuing.

- [ ] **Step 4: Add the rail stylesheet**

Append to `_style.css`:

```css
/* ---- the documented page --------------------------------------------
   Long pages carry a numbered index in the left margin. The rail IS the
   label column: each section's own label is simply its live entry, so the
   page never sets the same words twice.

   Below 900px there is no margin to give it. The rail lies down as a strip
   that sticks under the header, and Book moves to a bar pinned to the
   bottom of the viewport -- the thumb's reach, and where a phone visitor
   actually converts.                                                    */
.doc{display:block}
.doc__body{min-width:0}
.rail{display:none}

.strip{
  position:sticky;top:0;z-index:20;
  background:var(--plaster);
  border-bottom:1px solid rgba(36,35,31,.14);
  overflow:hidden;
}
.strip__nav{
  display:flex;gap:8px;align-items:center;
  padding:10px var(--pad);
  overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;
}
.strip__nav::-webkit-scrollbar{display:none}
.strip__a{
  flex:none;text-decoration:none;white-space:nowrap;
  font-size:11px;letter-spacing:.11em;text-transform:uppercase;
  padding:6px 10px;border:1px solid rgba(36,35,31,.22);
  color:var(--ink);opacity:.55;
  transition:opacity .2s ease,background-color .2s ease,color .2s ease;
}
.strip__a.is-on{opacity:1;background:var(--ink);color:var(--plaster);border-color:var(--ink)}

.bookbar{
  position:fixed;left:0;right:0;bottom:0;z-index:30;
  padding:10px var(--pad);
  background:var(--ink);
  padding-bottom:calc(10px + env(safe-area-inset-bottom));
}
.bookbar .btn{display:block;text-align:center;width:100%}

@media (min-width:900px){
  .doc{
    display:grid;
    grid-template-columns:clamp(190px,17vw,250px) minmax(0,1fr);
    gap:clamp(24px,3vw,56px);
    padding-left:var(--pad);
    align-items:start;
  }
  .strip,.bookbar{display:none}

  .rail{display:block;position:sticky;top:0;padding:clamp(40px,6vw,88px) 0}
  .rail__in{border-right:1px solid rgba(36,35,31,.14);padding-right:clamp(16px,1.6vw,24px)}
  .rail__k{
    font-size:11px;letter-spacing:.17em;text-transform:uppercase;
    opacity:.42;margin-bottom:14px;
  }
  .rail__nav{display:flex;flex-direction:column;gap:2px}
  .rail__a{
    display:flex;gap:10px;align-items:baseline;
    text-decoration:none;padding:5px 0;
    font-size:13px;line-height:1.35;
    opacity:.42;transition:opacity .22s ease,color .22s ease;
    border-left:1.5px solid transparent;padding-left:10px;margin-left:-11.5px;
  }
  .rail__a:hover{opacity:.75}
  .rail__a.is-on{opacity:1;color:var(--deep);font-weight:500;border-left-color:var(--timber)}
  .rail__n{font-variant-numeric:tabular-nums;opacity:.6;font-size:11px}
  .btn--rail{display:block;text-align:center;margin-top:22px;font-size:11px}

  /* Inside the column a band is already inset by the grid, so it keeps its
     vertical rhythm and drops the horizontal padding it no longer needs. */
  .doc__body .band{padding-left:0;padding-right:var(--pad)}
}

@media (prefers-reduced-motion:no-preference){
  html{scroll-behavior:smooth}
}
.doc__body [id^="s"]{scroll-margin-top:76px}
@media (min-width:900px){.doc__body [id^="s"]{scroll-margin-top:24px}}
```

- [ ] **Step 5: Add the scroll-spy to the tail zone**

In `build.mjs`, inside the `scripts()` template literal, immediately before the closing `}());`:

```js
  /* ---- the chapter rail ----------------------------------------------
     Progressive enhancement over a plain anchor list: with this script
     removed the rail still lists every section and every link still jumps
     to it. One handler drives both the desktop rail and the phone strip,
     because they are two renderings of the same anchor list.

     Position is decided by a line a quarter of the way down the viewport:
     the current chapter is the last one whose top has crossed it. That is
     deterministic, unlike ranking IntersectionObserver ratios, which
     reorder unpredictably when one section is much taller than another.
  --------------------------------------------------------------------- */
  var railAnchors = [].slice.call(document.querySelectorAll('[data-rail]'));
  if (railAnchors.length) {
    var byId = {};
    railAnchors.forEach(function (a) {
      var id = a.getAttribute('data-rail');
      (byId[id] = byId[id] || []).push(a);
    });
    var ids = Object.keys(byId);
    var sections = ids.map(function (id) { return document.getElementById(id); })
                      .filter(Boolean);
    var current = null;
    var mark = function (id) {
      if (id === current) return;
      current = id;
      railAnchors.forEach(function (a) {
        a.classList.remove('is-on');
        a.removeAttribute('aria-current');
      });
      (byId[id] || []).forEach(function (a) {
        a.classList.add('is-on');
        a.setAttribute('aria-current', 'true');
        var strip = a.parentNode;
        if (strip && strip.className === 'strip__nav') {
          strip.scrollTo({ left: Math.max(0, a.offsetLeft - 16), behavior: 'smooth' });
        }
      });
    };
    var queued = false;
    var settle = function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        var line = window.innerHeight * 0.25;
        var pick = sections[0];
        sections.forEach(function (s) {
          if (s.getBoundingClientRect().top <= line) pick = s;
        });
        if (pick) mark(pick.id);
      });
    };
    window.addEventListener('scroll', settle, { passive: true });
    window.addEventListener('resize', settle);
    settle();
  }
```

- [ ] **Step 6: Mark the HBOT page's sections**

In `pages/hbot.html`, add `data-chapter` to the four existing content sections and close the column. The labels must read as an index, not as headings:

| Existing section | Add |
| --- | --- |
| `<section class="band">` containing `What it is` | `data-chapter="What it is"` |
| `<section class="band band--sage">` containing `What it supports` | `data-chapter="What it supports"` |
| the `Practicalities` / `A session, start to finish` section | `data-chapter="A session"` |
| the `In their words` section | `data-chapter="In their words"` |

Then put `<!-- /chapters -->` on its own line immediately before the final `Getting started` section, so the closing call to action stays full-bleed.

- [ ] **Step 7: Build and check the rail came out right**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node build.mjs && \
  grep -c 'data-rail=' hbot.html && grep -o 'id="s0[0-9]"' hbot.html | sort -u
```

Expected: `8` (four chapters rendered twice — rail and strip), then `id="s01"` through `id="s04"`.

- [ ] **Step 8: Confirm the page still imports**

```bash
cd /Users/truep/Desktop/Clients/Renova/app && npx tsx ../sites/optimal-health/check.ts
```

Expected: nine `editable` lines, exit 0.

- [ ] **Step 9: Look at it**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node shots.mjs
```

**Read `_shots/hbot-desktop.png` and `_shots/hbot-phone.png`.** Check specifically: the rail does not collide with body copy; the ink and sage bands still run to the right edge; the strip does not cover the first heading on the phone; the book bar does not sit on top of the footer's last line. Fix and re-shoot until all four are right.

- [ ] **Step 10: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add sites/optimal-health/build.mjs sites/optimal-health/_style.css \
        sites/optimal-health/pages/hbot.html sites/optimal-health/hbot.html
git commit -m "$(cat <<'EOF'
feat(optimal-health): the chapter rail, proved on the hyperbaric page

The pages are about to carry four times the copy, and what makes that read as
considered rather than dumped is the structure holding it. A sticky numbered
index merged with a two-column ledger: the rail IS the label column, so the
page never sets the same words twice.

The index is derived from the same marks that number the sections -- a partial
writes data-chapter="Label" and closes the column with <!-- /chapters --> -- so
a contents entry cannot point at a section that is not there, which is the
failure mode of every hand-written table of contents.

The scroll-spy is progressive enhancement: strip the script and the rail is
still a plain anchor list that jumps. It decides position from a line a quarter
down the viewport rather than by ranking IntersectionObserver ratios, which
reorder unpredictably when one section is much taller than its neighbour.

Below 900px the rail lies down as a sticky strip and Book moves to a bar pinned
to the bottom of the viewport, which is the thumb's reach.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Every call to action points at something

The smallest change that removes the site's worst defect. Independent of the rail.

**Files:**
- Modify: `sites/optimal-health/build.mjs`
- Modify: all nine files in `sites/optimal-health/pages/`
- Modify: `sites/optimal-health/_style.css`

**Interfaces:**
- Consumes: `BOOK` from Task 2.
- Produces: `BOOK`, `LOGIN`, `VOUCHERS` exported as module constants in `build.mjs` for later tasks.

- [ ] **Step 1: Add the remaining destinations beside `BOOK`**

In `build.mjs`, directly under `const BOOK = …`:

```js
const LOGIN = "https://optimalhealthatinspire.simplybook.it/v2/#client/sign-in";
const VOUCHERS = "https://optimalhealth.voucherconnect.com";
```

- [ ] **Step 2: Put booking and vouchers in the header**

Replace the `nav()` template's `.nav__links` block with:

```js
  <nav class="nav__links" aria-label="Primary">
${NAV_LINKS.map(([h, t]) => `    <a href="${h}">${t}</a>`).join("\n")}
    <a href="${VOUCHERS}">Vouchers</a>
    <a class="nav__book" href="${BOOK}">Book</a>
  </nav>`;
```

- [ ] **Step 3: Put the client login in the footer**

In `footer()`, replace the `Get in touch` cell's `<p class="foot__v">` with:

```js
      <p class="foot__v"><a href="tel:+353838672844">083 867 2844</a><a href="mailto:info@optimalhealthatinspire.ie">info@optimalhealthatinspire.ie</a><a href="${LOGIN}">Client login</a></p>
```

- [ ] **Step 4: Style the header Book link**

Append to `_style.css`:

```css
/* The one link in the header that is asking for something. */
.nav__book{
  border:1px solid currentColor;
  padding:5px 12px;
  text-decoration:none;
}
```

- [ ] **Step 5: Repoint every in-page booking link**

Every `href="contact.html"` whose link text is `Book a session` becomes the SimplyBook URL. Contact stays for `Contact` and `Get in touch` links.

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health
grep -rn 'Book a session' pages/ | wc -l
sed -i '' 's|href="contact.html">Book a session|href="https://optimalhealthatinspire.simplybook.it/v2">Book a session|g' pages/*.html
grep -rn 'contact.html">Book a session' pages/ | wc -l
```

Expected: a count, then `0`.

- [ ] **Step 6: Verify no dead CTA survives**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node build.mjs && \
  grep -o 'href="#"' *.html | wc -l && grep -c 'simplybook' index.html
```

Expected: `0` dead hrefs. A non-zero `simplybook` count on the home page. (The contact form's `action="#"` is Task 14 and is not an `href`.)

- [ ] **Step 7: Check and shoot**

```bash
cd /Users/truep/Desktop/Clients/Renova/app && npx tsx ../sites/optimal-health/check.ts && \
cd ../sites/optimal-health && node shots.mjs
```

**Read `_shots/index-desktop.png` and `_shots/index-phone.png`.** The header now carries two more links — confirm it has not wrapped on the phone. If it has, the nav needs the overflow treatment before you commit.

- [ ] **Step 8: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add sites/optimal-health/build.mjs sites/optimal-health/_style.css \
        sites/optimal-health/pages sites/optimal-health/*.html
git commit -m "$(cat <<'EOF'
feat(optimal-health): every call to action now points at something

Every "Book a session" button on this site went to a contact page with a form
that posted to "#". The client already runs SimplyBook.me and a voucher shop;
neither appeared anywhere on our rebuild.

Booking and vouchers join the header, the client login joins the footer, and
every in-page Book link goes to the booking system rather than the contact
page. Contact keeps the links that are actually asking to talk to someone.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The hyperbaric page, deepened

The reference implementation for the other three. Whoever picks up Tasks 5 to 7 should read this page's partial first.

**Files:**
- Modify: `sites/optimal-health/pages/hbot.html`
- Modify: `sites/optimal-health/_style.css`

**Interfaces:**
- Consumes: `data-chapter` from Task 2; `_source/live-site.md` from Task 1.
- Produces: `.qa` accordion markup and the `data-chapter` label vocabulary that Tasks 5 to 7 reuse verbatim.

**Source:** `_source/live-site.md`, sections `medical-treatments` and `home`. The FAQ is the eighteen questions under `faq` in `medical-treatments`.

- [ ] **Step 1: Restructure the partial to six chapters**

The page's sections, in order, with their `data-chapter` labels:

```
(hero — no chapter)
01  What it is            keep the existing section
02  How it works          NEW
03  What it supports      keep, extend from four clusters to five
04  A session             keep the existing four-step section
05  Questions             NEW — the FAQ
06  Pricing               NEW — the three HBOT prices and a booking link
(<!-- /chapters -->)
(closing call to action — no chapter)
(In their words moves up, into 01)
```

- [ ] **Step 2: Write chapter 02, How it works**

Rewrite from the live site's `How HBOT works` (in `_source/live-site.md`, section `medical-treatments`). Their text is factual and plainly written; keep the mechanism, drop the clinical destinations.

Keep: oxygen under gentle pressure; a clear comfortable chamber; pressure dissolves more oxygen into the blood than it can carry at room pressure; oxygen is the body's fuel for repair; over a series of sessions it encourages new capillaries and stronger collagen.

Drop: "chronic wounds, post-surgical areas, or tissue affected by radiation or diabetes"; "support infection control"; "helping stubborn wounds close".

Three paragraphs, roughly 90 words each, in the existing `.says` two-column layout with `assets/hbot.jpg` alongside.

- [ ] **Step 3: Extend chapter 03 to five benefit clusters**

The page has four. The live site's wellness-framed list (in `_source/live-site.md`, section `home`, under `HBOT`) has five: Overall wellness · Recovery and repair · Brain function · Circulation and cardiovascular support · Sleep, stress and longevity.

Use that fifth cluster's material to split the current merged "Circulation, sleep and rest" into two. Every bullet keeps the live site's wellness wording — that list is already written to the conservative line. Change `Brain function` to `Focus and clarity` to match the heading already on our page.

- [ ] **Step 4: Add the FAQ accordion markup as chapter 05**

```html
<!-- PLASTER -->
<section class="band" data-chapter="Questions">
  <div>
    <div class="band__head">
      <div class="band__head__l">
        <p class="title">Questions</p>
        <h2 class="lede">What people ask before their first session.</h2>
      </div>
    </div>
    <div class="qa" data-stagger>
      <details class="qa__row">
        <summary class="qa__q">Is this a medical treatment?</summary>
        <div class="qa__a">
          <p>No. Hospitals and accredited clinics use higher-pressure hyperbaric oxygen for specific medical indications under a doctor's care. What we offer is mild hyperbaric oxygen for general wellness goals: energy, clarity, sleep, and feeling more ready between training or busy days. We do not diagnose or treat medical conditions.</p>
        </div>
      </details>
      <!-- seventeen more, same shape -->
    </div>
  </div>
</section>
```

Use `<details>`/`<summary>` rather than a scripted accordion: it is open-able without JavaScript, keyboard-operable for free, and findable by the browser's in-page search, which a scripted panel is not.

- [ ] **Step 5: Carry all eighteen questions across**

From `_source/live-site.md`, section `medical-treatments`, under `faq`. Fifteen of the eighteen need no edit beyond Irish spelling and our sentence rhythm. Three need care:

| Question | Change |
| --- | --- |
| *What is Hyperbaric Oxygen Therapy?* | Keep entirely, including "we offer mild HBOT for general wellness only; we don't diagnose or treat medical conditions" — reworded to our voice, same meaning. |
| *Who is HBOT suitable for?* | Keep. Ends "If you have specific medical concerns, speak with your GP first" — that line stays. |
| *Are there people who should avoid HBOT altogether?* | Keep the pneumothorax and ear-surgery cautions. These are safety information, not claims, and removing them would be worse than keeping them. |

The contraindication questions (pregnancy, ear and sinus problems, implanted devices, claustrophobia, colds) all stay as written. They are the most valuable content on their site.

- [ ] **Step 6: Style the accordion**

Append to `_style.css`:

```css
/* ---- questions -------------------------------------------------------
   <details> rather than a scripted panel: open-able with no JavaScript,
   keyboard-operable for free, and findable by the browser's own in-page
   search, which a scripted accordion is not.                            */
.qa{border-top:1px dotted rgba(36,35,31,.4)}
.qa__row{border-bottom:1px dotted rgba(36,35,31,.4)}
.qa__q{
  list-style:none;cursor:pointer;
  padding:18px 34px 18px 0;position:relative;
  font-size:clamp(15px,1.25vw,18px);line-height:1.4;
}
.qa__q::-webkit-details-marker{display:none}
.qa__q::after{
  content:"";position:absolute;right:6px;top:50%;
  width:9px;height:9px;margin-top:-6px;
  border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;
  transform:rotate(45deg);transition:transform .25s ease;
}
.qa__row[open] .qa__q::after{transform:rotate(-135deg);margin-top:-2px}
.qa__q:focus-visible{outline:2px solid var(--deep);outline-offset:3px}
.qa__a{padding:0 clamp(24px,6vw,90px) 22px 0;max-width:62ch;opacity:.85}
.qa__a p+p{margin-top:12px}
```

- [ ] **Step 7: Write chapter 06, Pricing**

Three rows using the existing `.roll--rates` markup: `€50 one session` · `€450 five sessions` · `€800 ten sessions`. No struck-through prices. A `Book a session` button to the SimplyBook URL and a quiet link to the full pricing page.

- [ ] **Step 8: Build, check, shoot**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node build.mjs && \
cd ../../app && npx tsx ../sites/optimal-health/check.ts && \
cd ../sites/optimal-health && node shots.mjs
```

Expected: nine `editable` lines. **Read `_shots/hbot-desktop.png` and `_shots/hbot-phone.png`.** Check: six entries in the rail; the FAQ reads as a list and not a wall; the accordion chevrons are on the right of each row, not floating; the pricing rows line up.

- [ ] **Step 9: Verify the claims line held**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health
grep -icE 'arthritis|fibromyalgia|neuropathy|ulcer|radiation|osteomyelitis|concussion|sciatica|psoriasis|eczema|cancer|cure[sd]?|treats|heals' hbot.html
```

Expected: `0`. Any hit is a claim that must come out before commit. (`Oncology cancer care massage` is a treatment NAME on the massage page and is the one permitted exception there — it must not appear here.)

- [ ] **Step 10: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add sites/optimal-health/pages/hbot.html sites/optimal-health/_style.css sites/optimal-health/hbot.html
git commit -m "$(cat <<'EOF'
content(optimal-health): the hyperbaric page, six chapters deep

Three chapters the page did not have: how it works, the eighteen questions
people actually ask before a first session, and its own prices.

The FAQ is the client's own, carried across almost unedited, because it is
already written to the conservative line their medical page abandons -- it says
in plain words that this is mild hyperbaric oxygen for general wellness, that we
do not diagnose or treat, and who should talk to a GP first. The contraindication
answers stay in full: that is safety information, not marketing, and cutting it
would be worse than keeping it.

Built on <details> rather than a scripted accordion, so it opens without
JavaScript, takes keyboard operation for free, and stays findable by the
browser's own in-page search.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: The infrared page, deepened

**Files:**
- Modify: `sites/optimal-health/pages/infrared.html`
- Modify: `sites/optimal-health/_style.css`

**Interfaces:**
- Consumes: the chapter labels, `.qa` markup and claims rules from Task 4.
- Produces: `.arc` timeline markup, reused by Task 11.

**Source:** `_source/live-site.md`, sections `infrared`, `collagen-production`, `home`.

- [ ] **Step 1: Seven chapters**

`What it is` · `How it works` · `What it supports` · `A session` · `What to expect` · `Questions` · `Pricing`

- [ ] **Step 2: Write How it works**

From the live site's infrared mechanism text: red and near-infrared light passing into tissue like sunlight through a window; cells absorbing it the way a solar panel does; mitochondria making more usable energy; small blood vessels opening so more oxygen and nutrients arrive; collagen support.

**Include the wavelengths — 633, 660, 810, 850 and 940 nm — as a specification of the bed, not as a claim about what they do.** Drop every clinical destination: eczema, psoriasis, neuropathy, sciatica, arthritis, wound and scar healing.

- [ ] **Step 3: Write What to expect as a three-stage timeline**

From `collagen-production`'s results section. Reshaped: it describes what the process is doing, never what the client will get.

| Stage | Keep | Cut |
| --- | --- | --- |
| Week 1–2 | improved circulation, calmer tissue, collagen has not rebuilt yet | "skin looks brighter" as a promise — reframe as what people commonly notice |
| Weeks 4–6 | fibroblasts laying down procollagen, skin holding water, early firmness | "scars begin to feel softer" |
| Weeks 8–12+ | collagen fibres reorganising, mature Type I fibres, breakdown enzymes dialling down | "visible remodelling", "improved scar pliability", all photo comparisons |

The honesty in stage one — that nothing has rebuilt yet — is the most persuasive thing on the page. Keep it.

- [ ] **Step 4: Style the timeline**

Append to `_style.css`:

```css
/* ---- an arc over time ------------------------------------------------
   Three stages, each a dotted rule with its span in the left margin, so
   the page reads as a sequence rather than three unrelated panels.       */
.arc{border-top:1px dotted rgba(36,35,31,.4)}
.arc__row{
  display:grid;gap:clamp(10px,2vw,32px);
  grid-template-columns:minmax(0,1fr);
  padding:clamp(20px,2.4vw,30px) 0;
  border-bottom:1px dotted rgba(36,35,31,.4);
}
@media (min-width:760px){.arc__row{grid-template-columns:130px minmax(0,1fr)}}
.arc__k{
  font-size:11px;letter-spacing:.15em;text-transform:uppercase;
  opacity:.55;font-variant-numeric:tabular-nums;
}
.arc__t{font-size:clamp(16px,1.4vw,21px);line-height:1.35;margin-bottom:10px}
.arc__b{max-width:60ch;opacity:.85}
```

- [ ] **Step 5: Six to eight questions**

Written to Task 4's pattern: what it feels like, what to wear, how often, can I use it the same day as training, is it a sunbed (no — it emits no UV), who should check with a GP first.

- [ ] **Step 6: Pricing chapter** — `€50 one session` · `€225 five sessions` · `€400 ten sessions`.

- [ ] **Step 7: Build, check, shoot, verify claims**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node build.mjs && \
cd ../../app && npx tsx ../sites/optimal-health/check.ts && \
cd ../sites/optimal-health && node shots.mjs && \
grep -icE 'arthritis|fibromyalgia|neuropathy|ulcer|radiation|psoriasis|eczema|cancer|cure[sd]?|treats|heals' infrared.html
```

Expected: nine `editable` lines, then `0`. **Read `_shots/infrared-desktop.png`** and check the timeline reads as a sequence.

- [ ] **Step 8: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add sites/optimal-health/pages/infrared.html sites/optimal-health/_style.css sites/optimal-health/infrared.html
git commit -m "$(cat <<'EOF'
content(optimal-health): the infrared page, and an arc over twelve weeks

Adds how it works, a three-stage account of what the first twelve weeks
actually do, questions, and the page's own prices. The bed's wavelengths --
633, 660, 810, 850 and 940 nm -- are stated as a specification of the machine,
which is a fact, rather than as a claim about what they achieve.

The timeline keeps the one thing that makes it credible: that in the first two
weeks nothing has rebuilt yet and what changes is circulation. A page that
admits its first fortnight is unglamorous is easier to believe about week
twelve.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The HIFEM page, deepened

**Files:**
- Modify: `sites/optimal-health/pages/hifem.html`

**Interfaces:** Consumes Task 4's chapter labels, `.qa` markup and claims rules.

**Source:** `_source/live-site.md`, sections `pemf` and `home`. **Their copy calls this PEMF throughout. Ours calls it the HIFEM chair, everywhere, without exception.**

- [ ] **Step 1: Six chapters** — `What it is` · `How it works` · `What it supports` · `A session` · `Questions` · `Pricing`

- [ ] **Step 2: Write How it works**

HIFEM is High-Intensity Focused Electromagnetic fields. You sit fully clothed; the field causes muscle contractions deeper and more completely than voluntary effort reaches. Short sessions. Most people feel a firm pulsing and nothing else.

Do not reuse the live site's PEMF mechanism paragraph — low-frequency magnetic pulses inducing microcurrents is a different machine, and copying it would describe equipment the clinic does not have. Write this one fresh.

- [ ] **Step 3: Four benefit clusters** — Pelvic floor support · Everyday energy · Circulation · Muscle and joint comfort.

Pelvic floor leads, because it is what the chair is for. The live site's wording under `PELVIC FLOOR SUPPORT` is usable: bladder control on coughing, sneezing, running or lifting, post-pregnancy and menopause included; pelvic engagement for everyday tasks; coordination with the deep core. Keep "may help" throughout. Drop the "stress urinary incontinence" naming from the medical page.

- [ ] **Step 4: Questions** — fully clothed, yes; how it feels; how many before people notice; who should not use it (pacemakers, implanted metal, pregnancy — talk to your GP); can it be combined with the other two.

- [ ] **Step 5: Pricing** — `€70 one session` · `€375 six sessions` · `€670 twelve sessions`. **Six and twelve, not five and ten.** This is the block structure the client confirmed on 2026-09-29.

- [ ] **Step 6: Build, check, shoot, verify**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node build.mjs && \
cd ../../app && npx tsx ../sites/optimal-health/check.ts && \
cd ../sites/optimal-health && node shots.mjs && \
grep -c 'PEMF' hifem.html && \
grep -icE 'arthritis|neuropathy|sciatica|incontinence|cure[sd]?|treats|heals' hifem.html
```

Expected: `0` and `0`.

- [ ] **Step 7: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add sites/optimal-health/pages/hifem.html sites/optimal-health/hifem.html
git commit -m "$(cat <<'EOF'
content(optimal-health): the HIFEM page, and the chair's own block sizes

The client's live site calls this machine PEMF and sells it in fives and tens.
It is the HIFEM chair and it sells in sixes and twelves -- confirmed by the
operator on 2026-09-29, which also settles the pricing page that 223437b fixed
and 0afb614 reverted.

The mechanism paragraph is written fresh rather than carried across. Low
frequency magnetic pulses inducing microcurrents describes a PEMF mat, and
copying it would have put equipment on the page that the clinic does not own.

Pelvic floor leads the benefits, because that is what the chair is for.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The massage page, deepened

**Files:**
- Modify: `sites/optimal-health/pages/massage.html`

**Interfaces:** Consumes Task 4's chapter labels and `.qa` markup. Produces the insurance block reused by Task 8.

**Source:** `_source/live-site.md`, section `massage-therapy`.

- [ ] **Step 1: Fix the repeated hero**

The page uses `assets/massage.jpg` twice. Replace the second with `assets/room.jpg` until a photography pass exists. Note it in the commit as a stopgap.

- [ ] **Step 2: Six chapters** — `What we offer` · `Massage` · `Lymphatic drainage` · `Reflexology` · `Insurance` · `Prices`

- [ ] **Step 3: The full menu under What we offer**

Ten treatments: Swedish, deep tissue, sports, hot lava shells, reflexology, sculpting lifting facial, Indian head, oncology cancer care, cupping, lymphatic drainage. All delivered by clinical therapists.

`Oncology cancer care massage` is the treatment's actual name and stays as written. It is the single permitted exception to the no-conditions rule, and it must not be described as doing anything for cancer — it is a massage adapted for people in or after treatment, and the page says only that.

- [ ] **Step 4: Three discipline chapters**

Massage, lymphatic drainage and reflexology each get their own chapter, from the live site's text, which is well written and needs mostly trimming.

Cut from reflexology: IBS, constipation, acid reflux, thyroid imbalance, menstrual irregularity, menopausal symptoms, "well-documented effect on digestive function", and "organs, glands and systems throughout the body" stated as fact — reframe as the principle the discipline works from.

Cut from lymphatic drainage: post-surgical claims, immune-response claims, "detoxification" as a mechanism.

- [ ] **Step 5: The insurance chapter**

```html
<!-- SAGE -->
<section class="band band--sage" data-chapter="Insurance">
  <div>
    <div class="band__head">
      <div class="band__head__l">
        <p class="title">Insurance</p>
        <h2 class="lede">You may be able to claim some of this back.</h2>
      </div>
    </div>
    <div class="cols4" data-stagger>
      <div>
        <p class="cell__k">Irish Life and Laya</p>
        <p class="cell__v">Members may be able to claim back for massage therapy, depending on the plan.</p>
      </div>
      <div>
        <p class="cell__k">VHI</p>
        <p class="cell__v">Members may be able to claim back for reflexology, depending on the plan.</p>
      </div>
      <div>
        <p class="cell__k">Before you book</p>
        <p class="cell__v">Contact your provider to confirm what complementary therapy benefit you have. We are happy to help with any questions.</p>
      </div>
    </div>
  </div>
</section>
```

"May be able to, depending on your plan" is load-bearing. Never state that a treatment is covered.

- [ ] **Step 6: Prices** — the existing ten-treatment table, unchanged. It is already correct.

- [ ] **Step 7: Build, check, shoot**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node build.mjs && \
cd ../../app && npx tsx ../sites/optimal-health/check.ts && \
cd ../sites/optimal-health && node shots.mjs && \
grep -o 'assets/massage.jpg' massage.html | wc -l
```

Expected: `1`. **Read `_shots/massage-desktop.png`** and confirm the two photographs are now different.

- [ ] **Step 8: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add sites/optimal-health/pages/massage.html sites/optimal-health/massage.html
git commit -m "$(cat <<'EOF'
content(optimal-health): the massage page, the full menu, and the insurance line

Ten treatments rather than three, each discipline with its own chapter, and the
health insurance section the site has been leaving on the table: Irish Life and
Laya for massage, VHI for reflexology, worded as may-be-able-to-claim depending
on the plan, which is the only honest way to put it.

Reflexology loses the digestive and hormonal condition list. Lymphatic drainage
loses the post-surgical and immune claims. What both keep is what the therapist
actually does, which is the part a client is choosing between anyway.

"Oncology cancer care massage" keeps its name because that is the treatment's
name. The page does not say it does anything for cancer; it says it is massage
adapted for people in or after treatment, which is what it is.

The second photograph is now the treatment room rather than the hero again --
a stopgap until this site has more than eight pictures.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Pricing, corrected

Reinstates the fix that `223437b` made and `0afb614` reverted, now that the client has confirmed the flyer was current.

**Files:**
- Modify: `sites/optimal-health/pages/pricing.html`

**Interfaces:** Consumes the insurance block from Task 7.

- [ ] **Step 1: Read the reverted fix before writing anything**

```bash
cd /Users/truep/Desktop/Clients/Renova && git show 223437b:sites/optimal-health/pages/pricing.html | head -80
```

That commit had this right. Recover its structure rather than re-deriving it.

- [ ] **Step 2: Five chapters** — `Sessions` · `Memberships` · `Massage` · `Insurance` · `Worth knowing`

- [ ] **Step 3: Write the Sessions chapter**

Three therapies, each with its own single and block prices, each row carrying its own session count — because the chair sells in sixes and twelves where the other two sell in fives and tens, so a single header row would be true for two rows out of three.

| Therapy | Single | Block | Block |
| --- | --- | --- | --- |
| Infrared | €50 | €225 / 5 sessions | €400 / 10 sessions |
| Hyperbaric oxygen | €100 | €450 / 5 sessions | €800 / 10 sessions |
| HIFEM chair | €70 | €375 / 6 sessions | €670 / 12 sessions |

**No struck-through prices.** Descriptions describe the technique, never an outcome.

Delete the existing `Single therapy` and `Combined` headings entirely. They describe a product the clinic does not sell.

- [ ] **Step 4: Write the Memberships chapter**

€169, €299 and €399 a month. Their live site prices the top tier `$399` — a typo; ours is euro.

Their tier contents are written in HBOT, Infrared and PEMF sessions. PEMF is the chair, which sells in sixes, so the monthly counts need the client's confirmation. Until then write each tier as its price, who it suits, and the line *"Ask us what each month includes — we will build it around what you are actually doing."* Do not invent session counts.

Add an HTML comment above the section:

```html
<!-- OPEN: the three tiers' session counts are unconfirmed. Their live site
     lists them in PEMF sessions, and PEMF is the HIFEM chair, which sells in
     sixes and twelves rather than fives and tens. Ask the client before
     putting numbers here. -->
```

- [ ] **Step 5: Massage chapter** — the ten-treatment table, already correct.

- [ ] **Step 6: Insurance chapter** — the same block as Task 7, plus a vouchers line linking `https://optimalhealth.voucherconnect.com`.

- [ ] **Step 7: Worth knowing** — the four existing questions, converted to `.qa` accordion markup for consistency with the therapy pages.

- [ ] **Step 8: Build, check, shoot, verify the numbers**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node build.mjs && \
cd ../../app && npx tsx ../sites/optimal-health/check.ts && \
cd ../sites/optimal-health && node shots.mjs
grep -oE '€(50|100|70|225|400|450|800|375|670|169|299|399)\b' pricing.html | sort -u | wc -l
grep -cE '€(315|560|250|600|450|1200).*was|was.*€' pricing.html
grep -c 'Combined therapies\|Single therapy' pricing.html
```

Expected: `11` distinct prices, then `0`, then `0`.

- [ ] **Step 9: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add sites/optimal-health/pages/pricing.html sites/optimal-health/pricing.html
git commit -m "$(cat <<'EOF'
fix(optimal-health): the pricing page sells what the clinic sells

223437b found this page presenting six correct numbers under invented labels --
"Single therapy" and "Combined therapies", products the clinic does not sell --
and fixed it against the printed price list. 0afb614 reverted that two minutes
later, on the grounds that the flyer was superseded and the numbers already on
the page were current.

Both halves of that were half right. The numbers were current; the labels were
the bug, and the revert restored them. The operator has now confirmed the flyer:
the HIFEM chair sells in sixes and twelves where infrared and hyperbaric sell in
fives and tens, which is exactly why one header row could never have been true
for all three.

So each row carries its own session count. The struck-through "was" prices stay
gone: a strike-through is a claim that the higher price was genuinely charged,
and a live page repeating it is not a source we can stand over.

Memberships go up at their three prices with no session counts, because their
contents are written in PEMF sessions and PEMF is the chair. Flagged in the
markup rather than guessed at.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: The Recovery and Everyday Health page

The reshaped replacement for their `/medical-treatments`. The highest-risk page on their site becomes the one that routes the largest audience.

**Files:**
- Create: `sites/optimal-health/pages/recovery.html`
- Modify: `sites/optimal-health/build.mjs`

**Interfaces:** Consumes the chapter contract and claims rules. Produces `META.recovery`.

- [ ] **Step 1: Register the page**

Add to `META` in `build.mjs`:

```js
  recovery: {
    file: "recovery.html",
    title: "Recovery and everyday health | Optimal Health & Recovery at Inspire",
    description:
      "Recovery sessions in Clonmel for people living busy lives: infrared, hyperbaric oxygen and the HIFEM chair, guided from start to finish.",
  },
```

- [ ] **Step 2: Five chapters** — `Who it is for` · `Where people start` · `The three therapies` · `When people come` · `Questions`

- [ ] **Step 3: Write Who it is for**

Their page opens by listing conditions. Ours opens on the situation: long working weeks, disturbed sleep, stiffness that has become normal, energy that does not last the day, coming back from a period of doing very little.

**Not one condition is named.** If a sentence needs a diagnosis to make sense, it is the wrong sentence.

- [ ] **Step 4: Write The three therapies**

One panel each, what it supports and how long, linking to the full page. Use the wellness-framed bullets from the live site's home page, never the medical page's clusters.

- [ ] **Step 5: Write When people come**

Their `WHEN TO USE THESE THERAPIES` is five numbered cards, every one anchored to a diagnosis. Rebuild the format and replace all five occasions:

1. After a stretch of long weeks
2. When sleep has gone off
3. Coming back after time off
4. Alongside a training habit you want to keep
5. When everything is fine and you would like it to stay that way

- [ ] **Step 6: Questions** — five or six routing questions: which one should I start with, do I need to know, can I combine them, how often, do I need to be fit.

- [ ] **Step 7: Build, check, shoot, verify**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node build.mjs && \
cd ../../app && npx tsx ../sites/optimal-health/check.ts && \
cd ../sites/optimal-health && node shots.mjs && \
grep -icE 'arthritis|fibromyalgia|neuropathy|ulcer|radiation|osteomyelitis|concussion|sciatica|psoriasis|eczema|cancer|chronic (pain|fatigue)|post-viral|inflammation' recovery.html
```

Expected: ten `editable` lines, then `0`.

- [ ] **Step 8: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add sites/optimal-health/build.mjs sites/optimal-health/pages/recovery.html sites/optimal-health/recovery.html
git commit -m "$(cat <<'EOF'
content(optimal-health): recovery and everyday health, the page their medical one should be

Their /medical-treatments page names arthritis, fibromyalgia, diabetic foot
ulcers, radiation injury, chronic bone infection and cancer aftercare, and then
states in its own FAQ further down the same page that this is mild hyperbaric
oxygen for general wellness and they do not diagnose or treat. Both cannot
stand.

This page takes the structure and the weight and leaves the diagnoses. It opens
on the situation rather than the condition -- long weeks, sleep gone off, coming
back after time off -- and its five occasions to come in are rewritten from
scratch, because every one of theirs was anchored to a diagnosis.

Not one condition is named. A sentence that needs one to make sense was the
wrong sentence.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: The Athletic Performance page

**Files:**
- Create: `sites/optimal-health/pages/athletes.html`
- Modify: `sites/optimal-health/build.mjs`

**Source:** `_source/live-site.md`, section `athletic-performance`. The least compliance-troubled page they have — its problem is the opposite one, a physiology lecture where a training conversation belongs.

- [ ] **Step 1: Register the page**

```js
  athletes: {
    file: "athletes.html",
    title: "Athletic performance and recovery | Optimal Health & Recovery at Inspire",
    description:
      "Recovery between hard sessions, in Clonmel. Infrared, hyperbaric oxygen and the HIFEM chair, around a training week.",
  },
```

- [ ] **Step 2: Five chapters** — `Who it is for` · `The three therapies` · `Around a training week` · `In their words` · `Questions`

- [ ] **Step 3: Write The three therapies for athletes**

Their bullets run to `NF-κB`, `PGC-1α`, `phosphocreatine`, `excitation-contraction coupling` and `satellite cells`. Keep at most one mechanism term per therapy and only where it earns its place. Everything else becomes what a person training four or five times a week would recognise: next-day stiffness, legs that feel heavy into a second session, sleep after a late finish, the week after a race.

Keep "supports" and "may". Drop "measurably faster recovery", "better force output" and every performance promise.

- [ ] **Step 4: Write Around a training week**

Their five occasions are good and need only the claims trimmed: post-session, pre-event, coming back from a niggle, heavy blocks, travel and tournaments. Rewrite "healing injuries in record time" and "reducing your risk of future injuries" — both are promises.

- [ ] **Step 5: In their words**

Micheal Sandbach, Hyrox World Elite, and Caolan Loughran, UFC. Both are about the chamber and both are usable as written.

- [ ] **Step 6: Build, check, shoot, verify**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node build.mjs && \
cd ../../app && npx tsx ../sites/optimal-health/check.ts && \
cd ../sites/optimal-health && node shots.mjs && \
grep -icE 'NF-κB|PGC-1|phosphocreatine|satellite cell|excitation|cytokine|VEGF|record time|reduces? your risk' athletes.html
```

Expected: eleven `editable` lines, then `0`.

- [ ] **Step 7: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add sites/optimal-health/build.mjs sites/optimal-health/pages/athletes.html sites/optimal-health/athletes.html
git commit -m "$(cat <<'EOF'
content(optimal-health): athletic performance, in a training vocabulary

Their athletic page is the least compliance-troubled thing they have and the
hardest to read: NF-κB, PGC-1α, phosphocreatine and excitation-contraction
coupling, in bullet lists, for an audience deciding whether to spend an hour in
a chamber on a Tuesday.

One mechanism term per therapy survives, and only where it earns the space. The
rest is what someone training five times a week would recognise -- next-day
stiffness, legs heavy into a second session, sleep after a late finish, the week
after a race.

"Healing injuries in record time" and "reducing your risk of future injuries"
are gone. Both are promises, and neither is ours to make.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: The Skin and Collagen page

**Files:**
- Create: `sites/optimal-health/pages/collagen.html`
- Modify: `sites/optimal-health/build.mjs`

**Interfaces:** Consumes `.arc` from Task 5.

- [ ] **Step 1: Register the page**

```js
  collagen: {
    file: "collagen.html",
    title: "Skin and collagen | Optimal Health & Recovery at Inspire",
    description:
      "Infrared light for skin and connective tissue at our Clonmel clinic. What collagen is, what the bed does, and what the first twelve weeks look like.",
  },
```

- [ ] **Step 2: Five chapters** — `Why collagen` · `What the bed does` · `What it supports` · `What to expect` · `Prices`

- [ ] **Step 3: Write Why collagen**

Their opening is strong and needs almost nothing: collagen is the body's scaffold, keeping skin firm and tendons strong; age, sun, training load, hormones and injury all slow new collagen and speed its breakdown.

- [ ] **Step 4: Write What the bed does**

The photobiomodulation explanation with the wavelengths, fibroblasts making procollagen, breakdown enzymes dialling down, microcirculation improving. Factual, and it stays.

- [ ] **Step 5: What it supports — two clusters, not four**

Keep: skin firmness and texture; tendon, ligament and joint comfort.

Cut both of theirs: `Scar and Stretch-Mark Care` (post-surgical scars, C-section, traumatic scars) and `Wound and Post-Procedure Support`. Wound and scar work is clinical, and the rest of this site does not claim it.

Cut the tendon cluster's named conditions — Achilles and patellar tendinopathy, tennis elbow, rotator cuff, plantar fasciitis. Keep the tissue it acts on.

- [ ] **Step 6: What to expect** — Task 5's `.arc` timeline, same three stages, same reshaping.

- [ ] **Step 7: Prices** — infrared's three, since this is the infrared bed.

- [ ] **Step 8: Build, check, shoot, verify**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node build.mjs && \
cd ../../app && npx tsx ../sites/optimal-health/check.ts && \
cd ../sites/optimal-health && node shots.mjs && \
grep -icE 'scar|stretch mark|c-section|wound|tendinopathy|plantar|rotator cuff|tennis elbow|acne|sun damage' collagen.html
```

Expected: twelve `editable` lines, then `0`.

- [ ] **Step 9: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add sites/optimal-health/build.mjs sites/optimal-health/pages/collagen.html sites/optimal-health/collagen.html
git commit -m "$(cat <<'EOF'
content(optimal-health): skin and collagen, without the wound care

Their collagen page is two pages wearing one name. The first is a good, clear
account of what collagen is and what red light does to fibroblasts, and it comes
across nearly whole. The second offers scar remodelling, C-section and traumatic
scar care, stretch marks and post-procedure wound support, and that is clinical
work this site does not claim anywhere else.

So two benefit clusters instead of four, the tendon list without its diagnoses,
and the twelve-week arc reused from the infrared page.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: The Testimonials page

**Files:**
- Create: `sites/optimal-health/pages/testimonials.html`
- Modify: `sites/optimal-health/build.mjs`

- [ ] **Step 1: Register the page**

```js
  testimonials: {
    file: "testimonials.html",
    title: "What people say | Optimal Health & Recovery at Inspire",
    description:
      "What clients and athletes say about the hyperbaric chamber, infrared and the HIFEM chair at our Clonmel clinic.",
  },
```

- [ ] **Step 2: Two chapters** — `Athletes` · `Clients`

- [ ] **Step 3: The quotes that go in**

| Quote | Attribution |
| --- | --- |
| "I'm in my hyperbaric chamber 6 days a week and can honestly say my recovery is so much better" | Micheal Sandbach, Hyrox World Elite |
| "I have been using the hyperbaric chamber for a little over 2 years now, and I can honestly say it's changed my game forever" | Caolan Loughran, UFC |
| "I can't recommend Optimal Health's hyperbaric chamber enough. It's truly transformed how I feel on a day to day basis, and I'm so grateful to have found this as part of my wellness journey." | Samantha Faiers |
| "It has made a huge difference to me physically and mentally. It's given me my freedom back" | Deirdre Cronin |

Fix `reccomend` to `recommend` and `i` to `I` in the Faiers quote — typographic correction only, not a change of words. Deirdre Cronin's attribution on their site reads `PEMF Therapy Client`; ours reads `HIFEM chair`.

- [ ] **Step 4: The two that stay out, and why**

Do not add Sean O'Brien's ("it really felt like there was a heart attack going to come on") or Paul Cremin's ("if this keeps going I won't need the second operation"). A testimonial implying a therapy replaced cardiac care or avoided surgery is an outcome claim in someone else's voice, and publishing it is no different from making it ourselves. Record this in the partial:

```html
<!-- Two testimonials from the client's live site are deliberately absent: one
     referring to chest tightness and a feared heart attack, one saying a second
     operation would not be needed. A claim in a client's mouth is still a claim.
     Do not add them back without the compliance document. -->
```

- [ ] **Step 5: Build, check, shoot**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node build.mjs && \
cd ../../app && npx tsx ../sites/optimal-health/check.ts && \
cd ../sites/optimal-health && node shots.mjs && \
grep -icE 'heart attack|second operation|Cremin|O.Brien' testimonials.html
```

Expected: thirteen `editable` lines, then `0`.

- [ ] **Step 6: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add sites/optimal-health/build.mjs sites/optimal-health/pages/testimonials.html sites/optimal-health/testimonials.html
git commit -m "$(cat <<'EOF'
content(optimal-health): what people say, minus the two that cannot go up

Four quotes: two athletes, a television personality, and a client on the HIFEM
chair. Their attributions say PEMF; ours say the chair.

Two more are on the client's live site and stay off ours. One describes chest
tightness and a feared heart attack; one says a second operation will not be
needed. A claim in a client's mouth is still a claim, and publishing it is not
meaningfully different from making it. The partial records why, so nobody adds
them back wondering if it was an oversight.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: The home, therapies and about pages, connected up

The five new pages exist but nothing links to them.

**Files:**
- Modify: `sites/optimal-health/build.mjs`
- Modify: `sites/optimal-health/pages/index.html`, `pages/therapies.html`, `pages/about.html`

- [ ] **Step 1: Widen the navigation**

In `build.mjs`:

```js
const NAV_LINKS = [
  ["therapies.html", "Therapies"],
  ["recovery.html", "Recovery"],
  ["athletes.html", "Athletes"],
  ["pricing.html", "Pricing"],
  ["about.html", "About"],
  ["contact.html", "Contact"],
];
```

That is six links plus Vouchers and Book. **Check the phone screenshot before committing** — if it wraps, the nav needs a scrolling row or a menu, and that is part of this task, not a follow-up.

- [ ] **Step 2: Extend the footer's therapy column**

Add `Skin and collagen` (`collagen.html`) and `What people say` (`testimonials.html`) to the footer links.

- [ ] **Step 3: Add audience routing to the home page**

After the existing therapies section, two panels: *Recovery and everyday health* and *Athletic performance*, each a sentence and a link. Use the existing `.duo` markup so it inherits the page's rhythm.

- [ ] **Step 4: Put insurance on the home page**

A quiet one-line mention linking to the massage page's insurance chapter: `You may be able to claim some of this back — Irish Life, Laya and VHI, depending on your plan.`

- [ ] **Step 5: Add the third and fourth testimonials to the home page**

The home page shows two. Add Caolan Loughran and Samantha Faiers, and a link to the testimonials page.

- [ ] **Step 6: Give the therapies page the two audience routes**

`pages/therapies.html` lists the four therapies and stops. Add a closing section, above the existing call to action, offering the two ways in — *Recovery and everyday health* and *Athletic performance* — with a sentence each and a link. Same `.duo` markup as the home page's, so the two pages answer the same question the same way.

This page does not take the chapter rail. It is a four-item index, and an index of an index is noise.

- [ ] **Step 7: Build, check, shoot**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node build.mjs && \
cd ../../app && npx tsx ../sites/optimal-health/check.ts && \
cd ../sites/optimal-health && node shots.mjs
```

**Read `_shots/index-phone.png` and `_shots/index-desktop.png`.** The navigation is the thing to look at. Then verify nothing is orphaned:

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health
for p in recovery athletes collagen testimonials; do
  printf "%-14s inbound links: %s\n" "$p" "$(grep -l "$p.html" *.html | grep -v "^$p.html$" | wc -l)"
done
```

Expected: every page has at least one inbound link.

- [ ] **Step 8: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add sites/optimal-health/build.mjs sites/optimal-health/pages sites/optimal-health/*.html
git commit -m "$(cat <<'EOF'
feat(optimal-health): the new pages are reachable

Five pages were built and nothing pointed at them. Recovery and Athletes join
the header, collagen and testimonials join the footer, the home page routes to
both audiences and carries two more testimonials and the insurance line.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: The contact form lands as a lead

The only task that touches application code, and the only one with a real test runner. Strict TDD.

**Files:**
- Modify: `app/src/lib/cms/enquiry.ts`
- Modify: `app/src/lib/cms/enquiry.test.ts`
- Modify: `sites/optimal-health/pages/contact.html`

**Interfaces:**
- Consumes: `validateEnquiry(fields)` and `ENQUIRY_PROGRAMMES` as they stand.
- Produces: `programmesForSite(slug: string): readonly string[]` and `validateEnquiry(fields, slug?)`. `slug` defaults to `"healthwise"`, so every existing caller is unchanged.

- [ ] **Step 1: Read what exists before changing it**

```bash
cd /Users/truep/Desktop/Clients/Renova/app && cat src/lib/cms/enquiry.ts && cat src/lib/cms/enquiry.test.ts
```

`ENQUIRY_PROGRAMMES` is `["livewell", "vitality", "heartwise", "unsure"]` — Healthwise's programmes, hardcoded in a module whose name promises to be site-neutral. Healthwise's behaviour must not change.

- [ ] **Step 2: Write the failing test**

Append to `app/src/lib/cms/enquiry.test.ts`:

```ts
test("a site's programme set is its own", () => {
  assert.deepEqual(programmesForSite("healthwise"), ["livewell", "vitality", "heartwise", "unsure"]);
  assert.deepEqual(programmesForSite("optimal-health"), ["hbot", "infrared", "hifem", "massage", "unsure"]);
});

test("an unknown site falls back to the one neutral option", () => {
  assert.deepEqual(programmesForSite("nobody"), ["unsure"]);
});

test("a programme from another site is rejected", () => {
  const r = validateEnquiry(
    { name: "Aoife", phone: "0838672844", programme: "livewell" },
    "optimal-health",
  );
  assert.equal(r.ok, false);
});

test("optimal-health accepts its own therapies", () => {
  const r = validateEnquiry(
    { name: "Aoife", phone: "0838672844", programme: "hifem" },
    "optimal-health",
  );
  assert.equal(r.ok, true);
});

test("healthwise still validates with no slug passed", () => {
  const r = validateEnquiry({ name: "Aoife", phone: "0838672844", programme: "vitality" });
  assert.equal(r.ok, true);
});
```

Add `programmesForSite` to the file's existing import from `./enquiry`.

- [ ] **Step 3: Run it and watch it fail**

```bash
cd /Users/truep/Desktop/Clients/Renova/app && npm test 2>&1 | tail -20
```

Expected: FAIL — `programmesForSite is not a function`.

- [ ] **Step 4: Implement**

In `app/src/lib/cms/enquiry.ts`, replace the `ENQUIRY_PROGRAMMES` / `PROGRAMME_LABEL` block with:

```ts
/**
 * A bespoke site's enquiry form offers that site's own programmes. The sets
 * live here rather than in each site's markup because the server has to
 * reject a programme the form could not have offered -- a check the form
 * itself cannot be trusted to have made.
 */
const SITE_PROGRAMMES: Record<string, Record<string, string>> = {
  healthwise: {
    livewell: "Livewell 40-60",
    vitality: "Vitality 60+",
    heartwise: "Heartwise",
    unsure: "Not sure yet",
  },
  "optimal-health": {
    hbot: "Hyperbaric oxygen",
    infrared: "Infrared",
    hifem: "HIFEM chair",
    massage: "Massage and bodywork",
    unsure: "Not sure yet",
  },
};

const NEUTRAL: Record<string, string> = { unsure: "Not sure yet" };
const DEFAULT_SITE = "healthwise";

export function programmesForSite(slug: string): readonly string[] {
  return Object.keys(SITE_PROGRAMMES[slug] ?? NEUTRAL);
}

export function programmeLabel(slug: string, programme: string): string {
  return (SITE_PROGRAMMES[slug] ?? NEUTRAL)[programme] ?? programme;
}

/** @deprecated Kept for callers that predate per-site programmes. */
export const ENQUIRY_PROGRAMMES = programmesForSite(DEFAULT_SITE);
export type EnquiryProgramme = string;
```

Then change the signature and the programme check:

```ts
export function validateEnquiry(
  fields: Record<string, string>,
  slug: string = DEFAULT_SITE,
): ValidateEnquiryResult {
```

```ts
  const rawProgramme = asString(fields.programme);
  const allowed = programmesForSite(slug);
  const programme = allowed.includes(rawProgramme) ? rawProgramme : null;
  if (!programme) return { ok: false, error: "Please choose one of the options." };
```

Replace every later use of `PROGRAMME_LABEL[programme]` with `programmeLabel(slug, programme)`.

- [ ] **Step 5: Run the tests**

```bash
cd /Users/truep/Desktop/Clients/Renova/app && npm test 2>&1 | tail -20
```

Expected: PASS, including every pre-existing Healthwise test.

- [ ] **Step 6: Typecheck**

```bash
cd /Users/truep/Desktop/Clients/Renova/app && npm run typecheck
```

Expected: clean. If a caller breaks on `EnquiryProgramme` narrowing, fix the caller — do not widen the test.

- [ ] **Step 7: Wire the contact form**

In `sites/optimal-health/pages/contact.html`, change `action="#"` to `action="/api/site/enquiry"`, add the honeypot field, and add a `programme` select offering the four therapies plus "Not sure yet", with values matching `SITE_PROGRAMMES["optimal-health"]` exactly. Read `sites/healthwise/build.mjs`'s `{{FORM}}` block for the exact field names and token handling before writing it.

- [ ] **Step 8: Build, check, shoot**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node build.mjs && \
cd ../../app && npx tsx ../sites/optimal-health/check.ts && \
cd ../sites/optimal-health && node shots.mjs && grep -c 'action="#"' contact.html
```

Expected: thirteen `editable` lines, then `0`.

- [ ] **Step 9: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add app/src/lib/cms/enquiry.ts app/src/lib/cms/enquiry.test.ts \
        sites/optimal-health/pages/contact.html sites/optimal-health/contact.html
git commit -m "$(cat <<'EOF'
feat(cms): a bespoke site's enquiry form offers that site's own programmes

lib/cms/enquiry.ts is named for every bespoke site and had Healthwise's four
programmes hardcoded in it, so Optimal Health's contact form had nowhere to
post. The set is now per-site and the slug defaults to healthwise, which leaves
every existing caller and every existing test untouched.

The sets live in the module rather than in each site's markup because the server
has to reject a programme the form could not have offered, and the form is not a
source it can trust for that.

Optimal Health's contact form now posts to /api/site/enquiry and lands in tenant
1028 instead of posting to "#".

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: The blog, carried across

Six posts at `/post/<slug>` on their live site. Their URLs are worth keeping.

**Files:**
- Create: `sites/optimal-health/pages/blog.html`
- Create: `sites/optimal-health/posts/*.html` (six)
- Modify: `sites/optimal-health/build.mjs`

- [ ] **Step 1: Read how Healthwise did this first**

```bash
cd /Users/truep/Desktop/Clients/Renova && git show 55561a8 --stat && git show ed88285 --stat
```

Twenty-one Webflow posts were carried across on 2026-09-28. Follow that shape; do not invent a second one.

- [ ] **Step 2: Build the blog index**

Six cards, each a title, the excerpt from `_source/live-site.md`'s `blog` section, and a link. Two chapters: `Latest` and `About the blog`.

- [ ] **Step 3: Carry the six posts across**

Sources are `_source/raw/post-*.html`. Each post needs the same claims pass as every other page, and **three of the six are titled around exactly what we do not claim**:

| Their title | Ours |
| --- | --- |
| Infrared Therapy for Chronic Pain: A Non-Invasive Path to Lasting Relief | Infrared and everyday aches: what the light is actually doing |
| Rapid Concussion Recovery with Hyperbaric Oxygen Therapy | Hyperbaric oxygen and mental clarity after a hard week |
| PEMF Therapy for Desk Jobs: A Solution for Pain, Fatigue, and Focus | The HIFEM chair, and a week spent sitting down |

The other three need retitling only for the PEMF-to-HIFEM change and house sentence rhythm.

- [ ] **Step 4: Preserve the old URLs**

Their posts live at `/post/<slug>`. `c30cab5` added a redirect map for exactly this; the shape is `app/public/sites/healthwise/_redirects.json` — read it before writing.

Create `sites/optimal-health/_redirects.json` with the six mappings, `/post/<their-slug>` to `/blog/<our-slug>`. The file is picked up when the site is bundled, which is out of scope here — writing it now means the bundle step has nothing to work out later.

- [ ] **Step 5: Build, check, shoot, verify**

```bash
cd /Users/truep/Desktop/Clients/Renova/sites/optimal-health && node build.mjs && \
cd ../../app && npx tsx ../sites/optimal-health/check.ts && \
cd ../sites/optimal-health && node shots.mjs && \
grep -licE 'chronic pain|concussion|PEMF|lasting relief|a solution for' *.html | wc -l
```

Expected: twenty `editable` lines, then `0` files matching.

- [ ] **Step 6: Commit**

```bash
cd /Users/truep/Desktop/Clients/Renova
git add sites/optimal-health/build.mjs sites/optimal-health/pages/blog.html \
        sites/optimal-health/posts sites/optimal-health/blog.html
git commit -m "$(cat <<'EOF'
content(optimal-health): the six blog posts, carried across and retitled

Their old /post/ URLs redirect to the new ones, following the redirect map
c30cab5 added for Healthwise.

Three of the six are titled around the one thing this site does not claim:
chronic pain relief, concussion recovery, and a solution for pain and fatigue.
A claims pass on the body of an article whose headline promises relief is not a
claims pass. All three are retitled to what the article can honestly be about,
and the three that only needed PEMF changing to HIFEM got that.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## After the plan

Not in scope here, in the order they matter:

1. **Photography.** The site runs on eight images and wants about thirty. This is now the biggest remaining gap and it is the one thing the rail design was chosen to defer.
2. **Import to the CMS and go live** — bundle, site row, domain, GA4 and the Meta Pixel.
3. **The three open client questions** — the compliance document, the membership contents, and whether the struck-through prices can be stood over.
