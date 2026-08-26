// Run: npm test -- src/lib/research/seo.test.ts
//
// Content-gap analysis — pure HTML -> on-page-SEO extraction (lib/research/
// seo.ts's extractSeo). Zero imports in seo.ts itself, so this file needs no
// Module._load shim at all — a plain top-level import, mirroring
// buildModel.test.ts's simplicity for a pure module.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSeo } from "./seo";

test("extractSeo: a realistic page -> exact extraction", () => {
  const html = `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sports Massage Clonmel | Optimal Health &amp; Inspire</title>
  <meta name="description" content="Deep tissue &amp; sports massage in Clonmel. Book online today.">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <script>console.log("noindex me");</script>
  <style>.hero { color: red; }</style>
  <h1>Sports Massage &amp; Recovery</h1>
  <p>We help athletes recover faster with targeted deep tissue work.</p>
  <h2>What to expect</h2>
  <p>Your first session starts with an assessment.</p>
  <h2>Pricing</h2>
  <p>Sessions start at &pound;60.</p>
</body>
</html>`.trim();

  const seo = extractSeo(html, "https://example.com/services/sports-massage");

  assert.equal(seo.title, "Sports Massage Clonmel | Optimal Health & Inspire");
  assert.equal(seo.metaDescription, "Deep tissue & sports massage in Clonmel. Book online today.");
  assert.equal(seo.h1, "Sports Massage & Recovery");
  assert.deepEqual(seo.h2s, ["What to expect", "Pricing"]);
  assert.ok(seo.wordCount > 0, "word count is a positive number");
  // Script/style text must never leak into the word count.
  assert.ok(!Number.isNaN(seo.wordCount));
});

test("extractSeo: script/style content is excluded from the word count", () => {
  const withScript = extractSeo("<html><body><p>Two words</p></body></html>", "https://x.test");
  const withNoise = extractSeo(
    "<html><body><script>var reallyLongVariableNameThatWouldInflateTheCount = 1;</script><style>.a{color:red}</style><p>Two words</p></body></html>",
    "https://x.test",
  );
  assert.equal(withScript.wordCount, withNoise.wordCount, "script/style text contributes nothing to wordCount");
  assert.equal(withNoise.wordCount, 2);
});

test("extractSeo: meta description is case/attr-order tolerant", () => {
  const reversedOrder = extractSeo(
    `<html><head><meta content="Reversed attr order" name="description"></head><body></body></html>`,
    "https://x.test",
  );
  assert.equal(reversedOrder.metaDescription, "Reversed attr order");

  const upperCaseTag = extractSeo(
    `<html><head><META NAME="DESCRIPTION" CONTENT="Shouty tag"></head><body></body></html>`,
    "https://x.test",
  );
  assert.equal(upperCaseTag.metaDescription, "Shouty tag");

  const singleQuoted = extractSeo(
    `<html><head><meta name='description' content='Single quoted'></head><body></body></html>`,
    "https://x.test",
  );
  assert.equal(singleQuoted.metaDescription, "Single quoted");

  const otherMetaFirst = extractSeo(
    `<html><head><meta name="viewport" content="width=device-width"><meta name="description" content="The real one"></head><body></body></html>`,
    "https://x.test",
  );
  assert.equal(otherMetaFirst.metaDescription, "The real one", "a non-description meta tag before it is skipped, not matched");
});

test("extractSeo: h2s are capped at 10", () => {
  const h2s = Array.from({ length: 15 }, (_, i) => `<h2>Heading ${i + 1}</h2>`).join("\n");
  const seo = extractSeo(`<html><body>${h2s}</body></html>`, "https://x.test");
  assert.equal(seo.h2s.length, 10);
  assert.equal(seo.h2s[0], "Heading 1");
  assert.equal(seo.h2s[9], "Heading 10");
});

test("extractSeo: decodes common HTML entities and collapses whitespace", () => {
  const seo = extractSeo(
    `<html><head><title>Fish &amp; Chips —   with   extra   spaces &lt;3</title></head><body></body></html>`,
    "https://x.test",
  );
  assert.equal(seo.title, "Fish & Chips — with extra spaces <3");
});

test("extractSeo: malformed/empty HTML -> all-null/zero, never throws", () => {
  const empty = extractSeo("", "https://x.test");
  assert.deepEqual(empty, { title: null, metaDescription: null, h1: null, h2s: [], wordCount: 0 });

  const noSeoTags = extractSeo("<html><body><p>Just a plain paragraph with no title or headings.</p></body></html>", "https://x.test");
  assert.equal(noSeoTags.title, null);
  assert.equal(noSeoTags.metaDescription, null);
  assert.equal(noSeoTags.h1, null);
  assert.deepEqual(noSeoTags.h2s, []);
  assert.ok(noSeoTags.wordCount > 0, "body text still counts even with no title/h1/meta");

  assert.doesNotThrow(() => extractSeo("<title>unterminated", "https://x.test"));
  assert.doesNotThrow(() => extractSeo("<<<not even close to html>>>", "https://x.test"));
  assert.doesNotThrow(() => extractSeo("<h1></h1><h2>   </h2>", "https://x.test"));

  // Empty/whitespace-only title and h1 tags -> null, not "".
  const blankTags = extractSeo("<html><head><title>   </title></head><body><h1></h1></body></html>", "https://x.test");
  assert.equal(blankTags.title, null);
  assert.equal(blankTags.h1, null);
});

test("extractSeo: only the FIRST title/h1 counts; all h2s are collected", () => {
  const seo = extractSeo(
    "<html><head><title>First</title><title>Second</title></head><body><h1>H1 One</h1><h1>H1 Two</h1></body></html>",
    "https://x.test",
  );
  assert.equal(seo.title, "First");
  assert.equal(seo.h1, "H1 One");
});
