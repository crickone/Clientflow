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

// Finding 1: a leading HTML comment must not defeat head detection — the gap
// check before each head candidate must treat a comment as blank, same as
// whitespace, or the whole head leaks into content.
const LEADING_COMMENT =
  '<!-- Fonts -->\n<link rel="stylesheet" href="/a.css">\n<style>body{margin:0}</style>\n<div>hello</div>';
const leadingComment = splitPageBody(LEADING_COMMENT);
check("leading comment: head holds the comment", leadingComment.head.includes("<!-- Fonts -->"));
check("leading comment: head holds the link", leadingComment.head.includes('<link rel="stylesheet"'));
check("leading comment: head holds the style", leadingComment.head.includes("<style>body{margin:0}"));
check("leading comment: style is NOT in content", !leadingComment.content.includes("<style"));
check("leading comment: content is just the div", leadingComment.content === "\n<div>hello</div>");
check("leading comment: round-trips", joinPageBody(leadingComment) === LEADING_COMMENT);

// Finding 2: a trailing HTML comment must not defeat tail detection —
// symmetric to Finding 1, on the walk-back-from-the-end side.
const TRAILING_COMMENT =
  '<div>hello</div>\n<script src="gsap.js"></script>\n<!-- end analytics -->';
const trailingComment = splitPageBody(TRAILING_COMMENT);
check("trailing comment: tail holds the script", trailingComment.tail.includes('<script src="gsap.js">'));
check("trailing comment: tail holds the comment", trailingComment.tail.includes("<!-- end analytics -->"));
check("trailing comment: script is NOT in content", !trailingComment.content.includes("<script"));
check("trailing comment: content is just the div", trailingComment.content === "<div>hello</div>\n");
check("trailing comment: round-trips", joinPageBody(trailingComment) === TRAILING_COMMENT);

// A comment sitting in the middle of content (not adjacent to a head/tail
// boundary) is ordinary markup and must stay in content.
const MID_COMMENT =
  "<style>a{}</style>\n<section>one</section>\n<!-- a note -->\n<section>two</section>";
const midComment = splitPageBody(MID_COMMENT);
check("mid-content comment stays in content", midComment.content.includes("<!-- a note -->"));
check("mid-content comment is not in head", !midComment.head.includes("<!-- a note -->"));
check("mid-content comment round-trips", joinPageBody(midComment) === MID_COMMENT);

// Uppercase / mixed-case tags: the TOKEN regex already carries the `i` flag,
// but that was never actually exercised by a test.
const CASED =
  "<STYLE>body{margin:0}</STYLE>\n<div>hello</div>\n<SCRIPT>x()</SCRIPT>";
const cased = splitPageBody(CASED);
check("uppercase STYLE lands in head", cased.head.includes("<STYLE>body{margin:0}</STYLE>"));
check("uppercase SCRIPT lands in tail", cased.tail.includes("<SCRIPT>x()</SCRIPT>"));
check("uppercase tags: content is just the div", cased.content === "\n<div>hello</div>\n");
check("uppercase tags round-trips", joinPageBody(cased) === CASED);

// Finding 3: a quoted attribute value containing ">" must not truncate the
// token early — the whole <script>...</script> is ONE token.
const QUOTED_GT = '<script data-cfg="a>b</script>c">real();</script>';
const quotedGt = splitPageBody(QUOTED_GT);
check("quoted '>' in attribute: whole script is one token in head", quotedGt.head === QUOTED_GT);
check("quoted '>' in attribute: content is empty", quotedGt.content === "");
check("quoted '>' in attribute: round-trips", joinPageBody(quotedGt) === QUOTED_GT);

console.log(`pageBody: ${passed} checks passed.`);
