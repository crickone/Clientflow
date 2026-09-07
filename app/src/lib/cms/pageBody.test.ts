// Run: npm test -- src/lib/cms/pageBody.test.ts
//
// Pure tests for the three-zone split that keeps the Studio from eating a
// site's CSS. The editable canvas only ever holds `content`; `head` (the
// page's own <style> + font links) and `tail` (GSAP/Lenis/init scripts) are
// carried around it untouched. The round-trip invariant below is the whole
// safety property: if join(split(x)) ever stops being byte-identical to x,
// saving a page silently rewrites markup nobody edited.
import assert from "node:assert/strict";

import { splitPageBody, joinPageBody, rebuildBodyWithContent, studioEditability } from "./pageBody";
import type { PageBodyZones } from "./pageBody";

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

// Defect 2 (comment-aware scan): a commented-out OLD <link> must not produce
// a phantom head token that aborts head detection before the LIVE stylesheet
// is ever reached. Exact repro from the audit.
const COMMENTED_OLD_LINK = [
  '<!-- <link rel="stylesheet" href="old.css"> -->',
  '<link rel="stylesheet" href="live.css">',
  "<style>body{margin:0}</style>",
  '<div class="page">Real content</div>',
  '<script src="gsap.js"></script>',
].join("\n");
const commentedOldLink = splitPageBody(COMMENTED_OLD_LINK);
check(
  "defect 2 / commented-out old link: head holds the LIVE stylesheet link",
  commentedOldLink.head.includes('<link rel="stylesheet" href="live.css">'),
);
check(
  "defect 2 / commented-out old link: head holds the live <style>",
  commentedOldLink.head.includes("<style>body{margin:0}</style>"),
);
check(
  "defect 2 / commented-out old link: content has NEITHER the live link NOR the style",
  !commentedOldLink.content.includes("<link") && !commentedOldLink.content.includes("<style"),
);
check(
  "defect 2 / commented-out old link: content is just the real div",
  commentedOldLink.content === '\n<div class="page">Real content</div>\n',
);
check("defect 2 / commented-out old link: round-trips", joinPageBody(commentedOldLink) === COMMENTED_OLD_LINK);

// Symmetric tail case: a real script, then a comment containing a
// <script>-lookalike, then a real script. Both real scripts must land in
// tail; the phantom inside the comment must not appear in content either.
const COMMENTED_SCRIPT_IN_TAIL = [
  "<div>hello</div>",
  '<script src="real-1.js"></script>',
  '<!-- <script src="dead.js"></script> -->',
  '<script src="real-2.js"></script>',
].join("\n");
const commentedScriptInTail = splitPageBody(COMMENTED_SCRIPT_IN_TAIL);
check(
  "defect 2 / commented-out dead script in tail: tail holds real-1.js",
  commentedScriptInTail.tail.includes("real-1.js"),
);
check(
  "defect 2 / commented-out dead script in tail: tail holds real-2.js",
  commentedScriptInTail.tail.includes("real-2.js"),
);
check(
  "defect 2 / commented-out dead script in tail: content holds neither real script",
  !commentedScriptInTail.content.includes("<script"),
);
check(
  "defect 2 / commented-out dead script in tail: content is just the div",
  commentedScriptInTail.content === "<div>hello</div>\n",
);
check(
  "defect 2 / commented-out dead script in tail: round-trips",
  joinPageBody(commentedScriptInTail) === COMMENTED_SCRIPT_IN_TAIL,
);

// Several consecutive comments before the real head tokens: head must still
// be found (each comment's gap is blank, so head detection keeps walking).
const MANY_LEADING_COMMENTS = [
  "<!-- one -->",
  "<!-- two -->",
  "<!-- three -->",
  '<link rel="stylesheet" href="/a.css">',
  "<style>a{}</style>",
  "<div>hi</div>",
].join("\n");
const manyLeadingComments = splitPageBody(MANY_LEADING_COMMENTS);
check(
  "several consecutive leading comments: head still holds the link",
  manyLeadingComments.head.includes('<link rel="stylesheet" href="/a.css">'),
);
check(
  "several consecutive leading comments: head still holds the style",
  manyLeadingComments.head.includes("<style>a{}</style>"),
);
check(
  "several consecutive leading comments: content has neither",
  !manyLeadingComments.content.includes("<link") && !manyLeadingComments.content.includes("<style"),
);
check(
  "several consecutive leading comments: round-trips",
  joinPageBody(manyLeadingComments) === MANY_LEADING_COMMENTS,
);

// A comment sitting BETWEEN two head tokens: both tokens still land in head,
// with the comment carried along in the gap.
const COMMENT_BETWEEN_HEAD_TOKENS = [
  '<link rel="stylesheet" href="/a.css">',
  "<!-- second font, added later -->",
  '<link rel="stylesheet" href="/b.css">',
  "<div>hi</div>",
].join("\n");
const commentBetweenHeadTokens = splitPageBody(COMMENT_BETWEEN_HEAD_TOKENS);
check(
  "comment between two head links: head holds the first link",
  commentBetweenHeadTokens.head.includes('<link rel="stylesheet" href="/a.css">'),
);
check(
  "comment between two head links: head holds the second link",
  commentBetweenHeadTokens.head.includes('<link rel="stylesheet" href="/b.css">'),
);
check(
  "comment between two head links: content has neither link",
  !commentBetweenHeadTokens.content.includes("<link"),
);
check(
  "comment between two head links: round-trips",
  joinPageBody(commentBetweenHeadTokens) === COMMENT_BETWEEN_HEAD_TOKENS,
);

// An unterminated "<!--" before what LOOKS like a <style> tag: everything
// from the unterminated comment marker onward is comment text (browsers run
// an unclosed comment to EOF), so the phantom "<style>" must NOT be treated
// as a head token, and must not leak the rest of the document as content.
const UNTERMINATED_COMMENT_BEFORE_STYLE =
  '<link rel="stylesheet" href="/a.css">\n<!-- disabled: <style>a{color:red}</style>';
const unterminatedCommentBeforeStyle = splitPageBody(UNTERMINATED_COMMENT_BEFORE_STYLE);
check(
  "unterminated <!-- before phantom <style>: head holds the real link",
  unterminatedCommentBeforeStyle.head.includes('<link rel="stylesheet" href="/a.css">'),
);
check(
  "unterminated <!-- before phantom <style>: head does NOT gain a <style> token (phantom is dead)",
  !unterminatedCommentBeforeStyle.head.includes("<style"),
);
check(
  "unterminated <!-- before phantom <style>: the dangling comment + phantom style live in content, not head",
  unterminatedCommentBeforeStyle.content === "\n<!-- disabled: <style>a{color:red}</style>",
);
check(
  "unterminated <!-- before phantom <style>: round-trips",
  joinPageBody(unterminatedCommentBeforeStyle) === UNTERMINATED_COMMENT_BEFORE_STYLE,
);

// A comment that legitimately opens the CONTENT zone (head tokens end, then
// a comment, then a <div>): the comment and the div both stay in content —
// nothing gets pulled backward into head.
const COMMENT_OPENING_CONTENT =
  "<style>a{}</style>\n<!-- start of page markup -->\n<div>hi</div>";
const commentOpeningContent = splitPageBody(COMMENT_OPENING_CONTENT);
check(
  "comment opening content: head is just the style",
  commentOpeningContent.head === "<style>a{}</style>",
);
check(
  "comment opening content: content holds the comment",
  commentOpeningContent.content.includes("<!-- start of page markup -->"),
);
check(
  "comment opening content: content holds the div",
  commentOpeningContent.content.includes("<div>hi</div>"),
);
check(
  "comment opening content: round-trips",
  joinPageBody(commentOpeningContent) === COMMENT_OPENING_CONTENT,
);

// Defect 1 (ReDoS regression guard): an unterminated <script ...> opening tag
// with a long run of quoted attributes used to explore exponentially many
// quoted/unquoted splits before failing. This must stay fast at a size far
// past where the old ambiguous regex was already unusable (n=18 took ~1.5s;
// this uses n=2000).
const REDOS_INPUT = "<script " + 'x="a"'.repeat(2000) + " no close here";
const redosStart = Date.now();
splitPageBody(REDOS_INPUT);
const redosMs = Date.now() - redosStart;
check(`defect 1 / ReDoS guard: n=2000 unterminated tag completes in under 100ms (took ${redosMs}ms)`, redosMs < 100);

// THE REGRESSION (two-pass scanner): a "<!--" inside a live <script> body is
// NOT a markup comment — script content is raw text, so a browser's
// tokenizer never looks for comments inside it. The old two-pass scanner
// computed comment ranges over the raw string first, saw this "<!--", found
// no later "-->", and treated the rest of the document as commented out —
// stranding BOTH trailing scripts in content and leaving tail empty. Exact
// repro from the regression report.
const SCRIPT_BODY_CONTAINS_COMMENT_OPENER = [
  '<link rel="stylesheet" href="/a.css">',
  "<style>a{}</style>",
  "<div>hi</div>",
  '<script>gsap.to(".hero",{opacity:1}); <!-- legacy marker</script>',
  '<script src="lenis.min.js"></script>',
].join("\n");
const scriptBodyContainsCommentOpener = splitPageBody(SCRIPT_BODY_CONTAINS_COMMENT_OPENER);
check(
  "regression: head still holds the link",
  scriptBodyContainsCommentOpener.head.includes('<link rel="stylesheet" href="/a.css">'),
);
check(
  "regression: head still holds the style",
  scriptBodyContainsCommentOpener.head.includes("<style>a{}</style>"),
);
check(
  "regression: content has NO script tag",
  !scriptBodyContainsCommentOpener.content.includes("<script"),
);
check(
  "regression: tail holds the script with the embedded comment opener",
  scriptBodyContainsCommentOpener.tail.includes("legacy marker"),
);
check(
  "regression: tail holds the second trailing script",
  scriptBodyContainsCommentOpener.tail.includes("lenis.min.js"),
);
check(
  "regression: tail is NOT empty",
  scriptBodyContainsCommentOpener.tail !== "",
);
check(
  "regression: round-trips",
  joinPageBody(scriptBodyContainsCommentOpener) === SCRIPT_BODY_CONTAINS_COMMENT_OPENER,
);

// A "<!--" inside a live <style> body, with real head tokens before it and
// real scripts after: the style body's raw text is not scanned for
// comments, so head and tail are still detected correctly around it.
const STYLE_BODY_CONTAINS_COMMENT_OPENER = [
  '<link rel="stylesheet" href="/a.css">',
  '<style>.icon::before{content:"<!--"}</style>',
  "<div>hi</div>",
  '<script src="a.js"></script>',
  "<script>init();</script>",
].join("\n");
const styleBodyContainsCommentOpener = splitPageBody(STYLE_BODY_CONTAINS_COMMENT_OPENER);
check(
  "style body has comment opener: head holds the link",
  styleBodyContainsCommentOpener.head.includes('<link rel="stylesheet" href="/a.css">'),
);
check(
  "style body has comment opener: head holds the whole style tag",
  styleBodyContainsCommentOpener.head.includes('.icon::before{content:"<!--"}'),
);
check(
  "style body has comment opener: content is just the div",
  styleBodyContainsCommentOpener.content === "\n<div>hi</div>\n",
);
check(
  "style body has comment opener: tail holds both scripts",
  styleBodyContainsCommentOpener.tail.includes('src="a.js"') &&
    styleBodyContainsCommentOpener.tail.includes("init();"),
);
check(
  "style body has comment opener: round-trips",
  joinPageBody(styleBodyContainsCommentOpener) === STYLE_BODY_CONTAINS_COMMENT_OPENER,
);

// A "-->" appearing inside a <style>'s CSS text must not truncate or shift
// the zones — the style tag is consumed as one raw-text unit regardless of
// what its body contains.
const STYLE_BODY_CONTAINS_COMMENT_CLOSER = [
  '<link rel="stylesheet" href="/a.css">',
  '<style>.icon::after{content:"-->"}</style>',
  "<div>hi</div>",
  '<script src="a.js"></script>',
].join("\n");
const styleBodyContainsCommentCloser = splitPageBody(STYLE_BODY_CONTAINS_COMMENT_CLOSER);
check(
  "style body has comment closer: head holds the link and the whole style tag",
  styleBodyContainsCommentCloser.head.includes('<link rel="stylesheet" href="/a.css">') &&
    styleBodyContainsCommentCloser.head.includes('.icon::after{content:"-->"}'),
);
check(
  "style body has comment closer: content is just the div",
  styleBodyContainsCommentCloser.content === "\n<div>hi</div>\n",
);
check(
  "style body has comment closer: tail holds the script",
  styleBodyContainsCommentCloser.tail.includes('src="a.js"'),
);
check(
  "style body has comment closer: round-trips",
  joinPageBody(styleBodyContainsCommentCloser) === STYLE_BODY_CONTAINS_COMMENT_CLOSER,
);

// A comment immediately abutting a token with no whitespace between them:
// the zero-length gap counts as blank, same as any whitespace-only gap.
const COMMENT_ABUTTING_TOKEN = '<!--f--><link rel="stylesheet" href="/a.css"><div>hi</div>';
const commentAbuttingToken = splitPageBody(COMMENT_ABUTTING_TOKEN);
check(
  "comment abutting token: head holds the comment",
  commentAbuttingToken.head.includes("<!--f-->"),
);
check(
  "comment abutting token: head holds the link",
  commentAbuttingToken.head.includes('<link rel="stylesheet" href="/a.css">'),
);
check(
  "comment abutting token: content is just the div",
  commentAbuttingToken.content === "<div>hi</div>",
);
check(
  "comment abutting token: round-trips",
  joinPageBody(commentAbuttingToken) === COMMENT_ABUTTING_TOKEN,
);

// studioEditability: refuses a body the three-zone model doesn't fit, rather
// than silently mangling it on the first save.

// A complete HTML document stored as the body block (e.g. clientflow's
// adonisagent home page) must be refused, even with leading whitespace.
const DOCUMENT_BODY = "  \n<!doctype html><html lang=\"en\"><head><title>x</title></head><body><p>hi</p></body></html>";
const documentEditability = studioEditability(splitPageBody(DOCUMENT_BODY));
check("document-shaped body: refused", documentEditability.ok === false);
check(
  "document-shaped body: reason is operator-facing text",
  !documentEditability.ok && typeof documentEditability.reason === "string" && documentEditability.reason.length > 0,
);

// A bare <html ...> start (no doctype) is refused the same way.
const HTML_TAG_BODY = "<html><body><p>hi</p></body></html>";
check("<html>-shaped body: refused", studioEditability(splitPageBody(HTML_TAG_BODY)).ok === false);

// A normal bespoke body (head carries the <style>, content is markup, tail
// carries scripts) is allowed.
check("bespoke body: allowed", studioEditability(bespoke).ok === true);

// A plain HTML fragment with no head and no style/script in content is
// allowed — this is the ordinary case for most CMS pages.
check("plain fragment, no head/style/script: allowed", studioEditability(plain).ok === true);

// Empty head but a <style> living inside content: the three-zone split
// plainly didn't apply (e.g. every clientflow page stores <style> inside
// content) — refused.
const STYLE_IN_CONTENT = splitPageBody("<div><style>a{color:red}</style><p>hi</p></div>");
check("empty head, <style> inside content: refused", studioEditability(STYLE_IN_CONTENT).ok === false);

// Symmetric case: empty head, <script> inside content.
const SCRIPT_IN_CONTENT: PageBodyZones = { head: "", content: "<div><script>x()</script></div>", tail: "" };
check("empty head, <script> inside content: refused", studioEditability(SCRIPT_IN_CONTENT).ok === false);

// Defect 1: the document-shape check is a prefix test, so a leading HTML
// comment (or starting mid-document at <head> or <body>) must not be able to
// slip a document-shaped body past it — these are exactly the shapes a
// hand-pasted document ends up in.
const LEADING_COMMENT_BEFORE_DOCTYPE: PageBodyZones = {
  head: "",
  content:
    '<!-- saved from url --><!doctype html><html><head><link rel=stylesheet href="/a.css"></head><body><p>hi</p></body></html>',
  tail: "",
};
check(
  "defect 1: leading HTML comment before <!doctype> is still refused",
  studioEditability(LEADING_COMMENT_BEFORE_DOCTYPE).ok === false,
);

const STARTS_AT_HEAD: PageBodyZones = {
  head: "",
  content: '<head><link rel="stylesheet" href="/a.css"></head><body><p>hi</p></body>',
  tail: "",
};
check("defect 1: content starting at <head> is refused", studioEditability(STARTS_AT_HEAD).ok === false);

const STARTS_AT_BODY: PageBodyZones = { head: "", content: "<body><p>hi</p></body>", tail: "" };
check("defect 1: content starting at <body> is refused", studioEditability(STARTS_AT_BODY).ok === false);

// A leading comment followed by ORDINARY content must still be allowed — the
// comment-skip is only there to see past it to a document marker, not to
// refuse every commented-out body.
const LEADING_COMMENT_THEN_ORDINARY: PageBodyZones = {
  head: "",
  content: "<!-- hero --><section><h1>Hi</h1></section>",
  tail: "",
};
check(
  "defect 1: leading comment then ordinary content is still allowed",
  studioEditability(LEADING_COMMENT_THEN_ORDINARY).ok === true,
);

// A tag that merely SHARES a document-marker prefix (<header>, not <head>)
// must not be mistaken for one — this is exactly the bespoke shape (content
// starts with a <header> nav) and must keep passing.
const STARTS_WITH_HEADER_TAG: PageBodyZones = {
  head: "",
  content: '<header class="nav"><a href="/">Home</a></header>',
  tail: "",
};
check(
  "defect 1: <header> is not mistaken for <head>",
  studioEditability(STARTS_WITH_HEADER_TAG).ok === true,
);

console.log(`pageBody: ${passed} checks passed.`);
