// Run: npm test -- src/lib/cms/siteChrome.test.ts
//
// Pages the platform renders itself — the blog index, a blog post — used to
// come out as bare white documents with a system font, on the client's own
// domain. A gym whose entire site is black and gold had a blog that looked
// like somebody else's website.
//
// The fix reads the design the client already has rather than asking them to
// configure one: a page's stored HTML carries the stylesheet, the navbar and
// the footer. These are the properties that has to hold.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "sitechrome-"));
const ORIGINAL_CWD = process.cwd();
process.chdir(SANDBOX);

const HOME_BODY = [
  `<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue" rel="stylesheet"/>`,
  `<style>:root{--bg:#08080a;--ink:#f4f4f5}body{background:var(--bg);color:var(--ink)}</style>`,
  `<header class="head" id="head"><a class="brand" href="/site/acme">LOGO</a>`,
  `<nav class="nav"><a class="lk" href="/site/acme/classes">Classes</a></nav></header>`,
  `<section class="hero"><h1>Welcome</h1></section>`,
  `<footer class="foot"><span>&copy; Acme</span></footer>`,
  `<script>document.getElementById('head');</script>`,
].join("\n");

(async () => {
  try {
    const { getSiteChrome, CHROME_CONTENT_CSS } = await import("./siteChrome");
    const { controlSqlite } = await import("../db/control");
    const { openTenantDb } = await import("../db/tenant");

    controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES ('acme','Acme','tenants/acme/acme.db',1)")
      .run();
    const row = controlSqlite.prepare("SELECT db_file FROM tenants WHERE slug='acme'").get() as { db_file: string };
    const conn = openTenantDb(row.db_file);
    const { sqlite, db } = conn;

    sqlite.prepare("INSERT INTO sites (slug, name, status) VALUES ('acme','Acme','live')").run();
    const sid = (sqlite.prepare("SELECT id FROM sites WHERE slug='acme'").get() as { id: number }).id;

    const addPage = (p: string, body: string, status = "published") => {
      sqlite
        .prepare(
          "INSERT INTO pages (site_id,page_key,path,title,template_id,status,created_at,updated_at) VALUES (?,?,?,?,'clientflow-live',?,?,?)",
        )
        .run(sid, p.replace("/", "") || "index", p, p, status, Date.now(), Date.now());
      const pid = (
        sqlite.prepare("SELECT id FROM pages WHERE site_id=? AND path=?").get(sid, p) as { id: number }
      ).id;
      sqlite
        .prepare(
          "INSERT INTO content_blocks (site_id,page_id,name,kind,value,created_at,updated_at) VALUES (?,?,'body','html',?,?,?)",
        )
        .run(sid, pid, body, Date.now(), Date.now());
    };

    // ── nothing to take is not a failure ───────────────────────────────────
    const empty = getSiteChrome(db, sid);
    assert.equal(empty.head, "", "a site with no pages yields no chrome");
    assert.equal(empty.header, "", "…and no header");

    // ── the real thing ─────────────────────────────────────────────────────
    addPage("/", HOME_BODY);
    const chrome = getSiteChrome(db, sid);

    assert.match(chrome.head, /fonts\.googleapis\.com/, "the font link comes across");
    assert.match(chrome.head, /--bg:#08080a/, "THE STYLESHEET COMES ACROSS — it is the design");
    assert.ok(!chrome.head.includes("<header"), "the head zone is only styles and fonts");

    assert.match(chrome.header, /^<header/, "the header is lifted whole");
    assert.match(chrome.header, /<\/header>$/, "…including its closing tag");
    assert.match(chrome.header, /Classes/, "…with its navigation inside it");
    assert.ok(!chrome.header.includes("<section"), "…and nothing after it");

    assert.match(chrome.footer, /^<footer/, "the footer too");
    assert.match(chrome.footer, /Acme/, "…with its content");

    assert.match(chrome.tail, /getElementById\('head'\)/, "the scripts that make the header work come across");

    // The hero is page content, not chrome — it must NOT be carried onto
    // every blog post.
    assert.ok(!chrome.header.includes("Welcome"), "page content is not mistaken for chrome");
    assert.ok(!chrome.footer.includes("Welcome"), "…in either direction");

    // ── the home page is preferred, but any published page will do ─────────
    const other = "<style>.x{}</style><header id=\"other\">OTHER</header><footer>f</footer>";
    addPage("/about", other);
    assert.match(getSiteChrome(db, sid).header, /href="\/site\/acme"/, "the HOME page is the source when there is one");

    sqlite.prepare("DELETE FROM pages WHERE site_id=? AND path='/'").run(sid);
    assert.match(getSiteChrome(db, sid).header, /id="other"/, "…and another published page is used when there is not");

    // ── a draft page is never the source ───────────────────────────────────
    // Chrome taken from an unpublished page would show visitors a navbar
    // nobody has approved.
    sqlite.prepare("UPDATE pages SET status='draft' WHERE site_id=?").run(sid);
    assert.equal(getSiteChrome(db, sid).header, "", "a draft page is not a source of chrome");

    // ── a site with no header still works ──────────────────────────────────
    sqlite.prepare("DELETE FROM pages WHERE site_id=?").run(sid);
    addPage("/plain", "<style>.y{}</style><main>just content</main>");
    const plain = getSiteChrome(db, sid);
    assert.match(plain.head, /\.y\{\}/, "its stylesheet is still used");
    assert.equal(plain.header, "", "and a missing header is empty, never invented");
    assert.equal(plain.footer, "", "same for the footer");

    // ── the layout CSS names no COLOUR OF ITS OWN ──────────────────────────
    // The site's own stylesheet owns the palette. A literal colour here would
    // be a guess, and wrong on half the sites on the platform — a light rule
    // on a black-and-gold gym site is exactly the bug being fixed.
    //
    // `inherit` and `currentColor` are the opposite of a guess: they are how
    // a rule defers to whatever the site already decided, so they are allowed
    // and the earlier version of this assertion was wrong to flag them.
    const literalColour = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
    assert.ok(!literalColour.test(CHROME_CONTENT_CSS), "the shared content CSS names no literal colour");
    assert.ok(!/background(-color)?\s*:/.test(CHROME_CONTENT_CSS), "…and paints no background");
    assert.ok(!/font-family\s*:/.test(CHROME_CONTENT_CSS), "…and imposes no typeface");
    assert.match(CHROME_CONTENT_CSS, /currentColor/, "…borders defer to the inherited colour");
    assert.match(CHROME_CONTENT_CSS, /max-width/, "…what it DOES set is measure and rhythm");

    // ── the index is a GRID, and it responds at every width ───────────────
    // Asked for explicitly: three across on desktop, and usable on every
    // breakpoint rather than the three someone happens to test.
    assert.match(CHROME_CONTENT_CSS, /\.cms-grid\{[^}]*grid-template-columns:repeat\(3,/, "three across by default");
    const narrower = CHROME_CONTENT_CSS.match(/@media\(max-width:(\d+)px\)\{\.cms-grid\{grid-template-columns:repeat\(2,/);
    assert.ok(narrower, "…dropping to two columns at a stated width");
    const single = CHROME_CONTENT_CSS.match(/@media\(max-width:(\d+)px\)\{\.cms-grid\{grid-template-columns:1fr/);
    assert.ok(single, "…and to one on a phone");
    assert.ok(
      Number(single![1]) < Number(narrower![1]),
      "the single-column breakpoint is narrower than the two-column one — otherwise one never applies",
    );

    // minmax(0,1fr), not 1fr: a long unbroken word in a title otherwise
    // widens its track and knocks the row out of alignment.
    assert.match(CHROME_CONTENT_CSS, /repeat\(3,minmax\(0,1fr\)\)/, "columns cannot be stretched by their content");

    // Clamped sizing means every width between breakpoints is designed for.
    assert.ok((CHROME_CONTENT_CSS.match(/clamp\(/g) || []).length >= 6, "sizes scale fluidly, not in steps");

    // A card's picture must hold its shape, or rows of different-sized
    // photographs stagger.
    assert.match(CHROME_CONTENT_CSS, /\.cms-card__media\{[^}]*aspect-ratio:3\/2/, "card images share one aspect ratio");
    assert.match(CHROME_CONTENT_CSS, /\.cms-card__media img\{[^}]*object-fit:cover/, "…and crop rather than distort");
    assert.match(CHROME_CONTENT_CSS, /\.cms-card__media--empty\{[^}]*aspect-ratio:3\/2/, "a card with no picture keeps the row aligned");

    // Motion is opt-out.
    assert.match(CHROME_CONTENT_CSS, /@media\(prefers-reduced-motion:reduce\)/, "the hover zoom respects reduced motion");
    assert.match(CHROME_CONTENT_CSS, /:focus-visible/, "keyboard focus stays visible");

    console.log("siteChrome.test.ts: all assertions passed");
  } finally {
    process.chdir(ORIGINAL_CWD);
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
