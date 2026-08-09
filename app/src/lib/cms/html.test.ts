/**
 * Unit tests for the CMS HTML sanitizers (Batch 2a — allow-list rewrite on
 * `sanitize-html`). Pure, no I/O. Run: npx tsx src/lib/cms/html.test.ts
 */
import assert from "node:assert/strict";

import { sanitizeHtml, sanitizeHtmlKeepStyles } from "./html";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// ---------------------------------------------------------------------------
// Shared vectors — both functions must neutralise these regardless of their
// different allow-list breadth.
// ---------------------------------------------------------------------------
for (const [label, fn] of [
  ["sanitizeHtml", sanitizeHtml],
  ["sanitizeHtmlKeepStyles", sanitizeHtmlKeepStyles],
] as const) {
  ok(`${label}: null/undefined → ""`, fn(null) === "" && fn(undefined) === "");

  const scripted = fn('<p>hi</p><script>alert(1)</script>');
  ok(`${label}: strips <script>…</script> tag and body`, !/<script/i.test(scripted) && !/alert\(1\)/.test(scripted));

  const onerror = fn('<img src="x" onerror="alert(1)">');
  ok(`${label}: strips onerror handler`, !/onerror/i.test(onerror) && !/alert\(1\)/.test(onerror));

  const onclickDiv = fn('<div onclick="alert(1)">hi</div>');
  ok(`${label}: strips onclick handler on div`, !/onclick/i.test(onclickDiv));

  const jsHref = fn('<a href="javascript:alert(1)">click</a>');
  ok(`${label}: neutralises javascript: URL in href`, !/javascript:/i.test(jsHref));

  const jsUpper = fn('<a href="JaVaScRiPt:alert(1)">click</a>');
  ok(`${label}: neutralises javascript: URL regardless of case`, !/javascript:/i.test(jsUpper));

  const iframe = fn('<iframe src="https://evil.example/"></iframe>');
  ok(`${label}: strips <iframe>`, !/<iframe/i.test(iframe));

  const objectEmbed = fn('<object data="evil.swf"></object><embed src="evil.swf">');
  ok(`${label}: strips <object>/<embed>`, !/<object/i.test(objectEmbed) && !/<embed/i.test(objectEmbed));

  // Classic malformed/nested-tag mutation trick: a single-pass string
  // sanitizer that removes the literal substring "<script>" turns
  // "<scr<script>ipt>" into a reconstructed "<script>". A real tokenizer
  // (htmlparser2, via sanitize-html) must not fall for this.
  const nested = fn("<scr<script>ipt>alert(document.domain)</script>");
  ok(`${label}: malformed nested "<scr<script>ipt>" does not reconstruct a <script> tag`, !/<\s*script/i.test(nested));

  // Without any closing tag at all, the tokenizer folds the whole thing into
  // one mutant tag name ("scr<script") that isn't in any allow-list, so
  // everything after it is inert trailing text (htmlparser2 never re-opens a
  // tag context) — assert no `<` survives, i.e. it is provably impossible for
  // this output to be interpreted as a tag/attribute when re-inserted as HTML.
  const nestedNoClose = fn("<scr<script>ipt src=x onerror=alert(1)>");
  ok(`${label}: malformed nested payload without closing tag leaves no live tag delimiter`, !nestedNoClose.includes("<"));

  // Legit rich text must survive.
  const richText = fn("<p><strong>hi</strong> there, <em>friend</em></p>");
  ok(`${label}: keeps legit <p><strong>/<em> markup`, /<strong>hi<\/strong>/.test(richText) && /<em>friend<\/em>/.test(richText));

  const link = fn('<a href="https://example.com">link</a>');
  ok(`${label}: keeps allowed https:// <a href>`, /href="https:\/\/example\.com"/.test(link));
  ok(`${label}: forces rel="noopener noreferrer" on <a>`, /rel="noopener noreferrer"/.test(link));
}

// ---------------------------------------------------------------------------
// sanitizeHtml — narrow rich-text allow-list specifics.
// ---------------------------------------------------------------------------
ok(
  "sanitizeHtml: drops structural tags outside the rich-text allow-list (e.g. <section>)",
  !/<section/i.test(sanitizeHtml("<section><p>hi</p></section>")),
);
ok(
  "sanitizeHtml: keeps the <p> content when unwrapping a disallowed wrapper",
  /<p>hi<\/p>/.test(sanitizeHtml("<section><p>hi</p></section>")),
);
ok(
  "sanitizeHtml: strips <style> block and its CSS text",
  (() => {
    const out = sanitizeHtml("<style>body{background:url(javascript:alert(1))}</style><p>hi</p>");
    return !/<style/i.test(out) && !/background/i.test(out) && /<p>hi<\/p>/.test(out);
  })(),
);
ok(
  "sanitizeHtml: table family survives",
  (() => {
    const out = sanitizeHtml("<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>");
    return /<table>/.test(out) && /<th>H<\/th>/.test(out) && /<td>D<\/td>/.test(out);
  })(),
);

// ---------------------------------------------------------------------------
// sanitizeHtmlKeepStyles — broad bespoke-site allow-list specifics. This
// backs the Studio edit canvas + clientflow-page template for imported first-
// party sites, so it must preserve structural/semantic tags, not just
// rich text, or an admin's next save would amputate live markup.
// ---------------------------------------------------------------------------
ok(
  "sanitizeHtmlKeepStyles: keeps inline style=\"color:red\" (editor formatting)",
  /style="color:red"/.test(sanitizeHtmlKeepStyles('<p style="color:red">hi</p>')),
);
ok(
  "sanitizeHtmlKeepStyles: strips a dangerous inline style value (expression/javascript:)",
  (() => {
    const out = sanitizeHtmlKeepStyles(
      '<div style="width:expression(alert(1));background:url(javascript:alert(1))">hi</div>',
    );
    return !/expression/i.test(out) && !/javascript:/i.test(out);
  })(),
);
ok(
  "sanitizeHtmlKeepStyles: strips <style> block entirely, keeps sibling markup (Batch 2a mXSS fix)",
  (() => {
    const out = sanitizeHtmlKeepStyles("<style>.hero{color:red}</style><div class=\"hero\">hi</div>");
    return !/<style/i.test(out) && !/\.hero\{color:red\}/.test(out) && /<div class="hero">hi<\/div>/.test(out);
  })(),
);
ok(
  "sanitizeHtmlKeepStyles: preserves bespoke structural + SVG markup end-to-end",
  (() => {
    const bespoke =
      '<header class="nav" data-gsap="fade"><nav><a href="/site/acme/about">About</a></nav></header>' +
      '<section class="hero"><svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="#fff"/></svg>' +
      '<video src="/sites/acme/assets/hero.mp4" controls></video></section>';
    const out = sanitizeHtmlKeepStyles(bespoke);
    // NOTE: htmlparser2 lowercases tag/attribute names in HTML mode, so
    // "viewBox" comes back as "viewbox" in the sanitized STRING — the browser
    // restores proper SVG camelCase from this lowercase form at DOM-parse
    // time (dangerouslySetInnerHTML goes through the real HTML parser and its
    // standard "foreign content" adjustment table), so this is correct output,
    // not a bug. See the BESPOKE_TAGS comment in html.ts for the full story.
    return (
      /<header class="nav" data-gsap="fade">/.test(out) &&
      /<nav><a href="\/site\/acme\/about"/.test(out) &&
      /<section class="hero">/.test(out) &&
      /<svg viewbox="0 0 24 24">/.test(out) &&
      /<path d="M0 0h24v24H0z" fill="#fff">/.test(out) &&
      /<video src="\/sites\/acme\/assets\/hero\.mp4" controls>/.test(out)
    );
  })(),
);
ok(
  "sanitizeHtmlKeepStyles: keeps Google Fonts <link> tag (import-site.cjs prepends it)",
  (() => {
    // `link` is a self-closing/void element by default, so sanitize-html
    // serialises it as `<link ... />` — match on the surviving attributes
    // rather than a rigid full-tag string.
    const out = sanitizeHtmlKeepStyles(
      '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">',
    );
    return (
      out.startsWith("<link") &&
      out.includes('href="https://fonts.googleapis.com/css2?family=Inter"') &&
      out.includes('rel="stylesheet"')
    );
  })(),
);
ok(
  "sanitizeHtmlKeepStyles: strips both <style> and <script> from the same input",
  (() => {
    const out = sanitizeHtmlKeepStyles("<style>.a{color:red}</style><script>alert(1)</script>");
    return !/<script/i.test(out) && !/<style/i.test(out);
  })(),
);

// ---------------------------------------------------------------------------
// sanitizeHtmlKeepStyles — mutation-XSS regression (Batch 2a review fix).
//
// The previous config set `allowVulnerableTags: true` and included "style" in
// the allow-list. sanitize-html/htmlparser2 tokenizes an allowed <style>
// element's content as inert rawtext CSS, so it never re-examines that text
// for banned tags/attributes — but a browser parsing the SAME sanitized
// string via `dangerouslySetInnerHTML` (templates.tsx:27, render.ts:64) does
// NOT treat <style> content as inert once it's nested inside an SVG
// <foreignObject>: the browser's foreign-content tree-construction tokenizes
// the "rawtext" back into live elements/attributes, so a payload smuggled
// through <svg><foreignObject><style>…</style></foreignObject></svg> comes
// out the other side as real, executing markup. Confirmed against the
// pre-fix code: all three payloads below survived with their dangerous
// substrings intact (e.g. the first produced the literal string
// `<svg><style><img src=x onerror=alert(document.domain)></style></svg>`).
//
// Fix: "style" is no longer an allowed tag (so it — and, per sanitize-html's
// default `nonTextTags`, its entire text content — is discarded, closing the
// smuggling channel structurally) and `allowVulnerableTags` is removed since
// nothing needs it anymore. This restores the old regex sanitizer's
// behaviour of stripping <style> blocks outright. Inline style="" attributes
// are a separate, per-property-filtered code path (`allowedStyles` /
// `BESPOKE_STYLES`) and are deliberately unaffected — asserted below.
// ---------------------------------------------------------------------------
ok(
  "sanitizeHtmlKeepStyles: mXSS bypass — svg>foreignObject>style>img[onerror] is fully neutralised",
  (() => {
    const out = sanitizeHtmlKeepStyles(
      "<svg><foreignObject><style><img src=x onerror=alert(document.domain)></style></foreignObject></svg>",
    );
    return !/<style/i.test(out) && !/onerror/i.test(out) && !/<script/i.test(out);
  })(),
);
ok(
  "sanitizeHtmlKeepStyles: mXSS bypass — svg>foreignObject>style>script is fully neutralised",
  (() => {
    const out = sanitizeHtmlKeepStyles(
      "<svg><foreignObject><style><script>alert(document.domain)</script></style></foreignObject></svg>",
    );
    return !/<style/i.test(out) && !/<script/i.test(out) && !/alert\(document\.domain\)/.test(out);
  })(),
);
ok(
  "sanitizeHtmlKeepStyles: mXSS bypass — svg>foreignObject>style>svg[onload] is fully neutralised",
  (() => {
    const out = sanitizeHtmlKeepStyles(
      "<svg><foreignObject><style><svg onload=alert(document.domain)></style></foreignObject></svg>",
    );
    return !/<style/i.test(out) && !/onload/i.test(out) && !/<script/i.test(out);
  })(),
);
ok(
  "sanitizeHtmlKeepStyles: legit inline style=\"color:red\" still survives the mXSS fix",
  /<p style="color:red">hi<\/p>/.test(sanitizeHtmlKeepStyles('<p style="color:red">hi</p>')),
);

console.log(`\nhtml sanitizers: ${passed} checks passed.`);
