// Run: npm test -- src/lib/cms/siteMount.test.ts
//
// Links on an imported site, served on its own domain: the preview mount comes
// off, assets and other sites' links stay as they are.
import assert from "node:assert/strict";
import { stripSiteMount } from "./siteMount";

const html =
  '<a href="/site/inspire/about">About</a><a href="/site/inspire">Home</a>' +
  "<a href='/site/inspire/blog?x=1'>Blog</a><a href=\"/site/inspire#top\">Top</a>" +
  '<img src="/sites/inspire/assets/a.jpg"><a href="/site/inspired/x">Other</a>' +
  '<div style="background:url(/site/inspire/bg.jpg)"></div><a href="https://www.inspirehealthandfitness.ie/site/inspire/x">abs</a>';
const out = stripSiteMount(html, "inspire");
assert.ok(out.includes('href="/about"'));
assert.ok(out.includes('href="/">Home'));
assert.ok(out.includes("href='/blog?x=1'"));
assert.ok(out.includes('href="/#top"'));
assert.ok(out.includes('src="/sites/inspire/assets/a.jpg"'), "static assets untouched");
assert.ok(out.includes('href="/site/inspired/x"'), "a different slug that starts the same is untouched");
assert.ok(out.includes("url(/bg.jpg)"));
assert.equal(stripSiteMount(html, ""), html);
console.log("siteMount: 8 checks passed.");
