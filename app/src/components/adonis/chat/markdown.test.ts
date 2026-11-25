// Run: npm test -- src/components/adonis/chat/markdown.test.ts
//
// The markdown Adonis writes, parsed into blocks and inline runs for the
// answer document. Built as data, never HTML; partial input always parses.
import assert from "node:assert/strict";

import { parseBlocks, parseInline, splitRow } from "./markdown";

const doc = parseBlocks("# Title\n\nPara one\nline two\n\n- a\n- b\n\n- c\n1. x\n2. y\n---\n```\ncode here\n```\n#### Deep");
assert.deepEqual(
  doc.map((b) => b.kind),
  ["heading", "paragraph", "list", "list", "rule", "code", "heading"],
  "headings, paragraphs, lists, a rule and code",
);
assert.deepEqual(doc[0], { kind: "heading", level: 1, text: "Title" });
assert.deepEqual(doc[1], { kind: "paragraph", lines: ["Para one", "line two"] }, "lines of one paragraph stay together");
assert.deepEqual(doc[2], { kind: "list", ordered: false, start: 1, items: ["a", "b", "c"] }, "a blank line inside a list does not split it");
assert.deepEqual(doc[3], { kind: "list", ordered: true, start: 1, items: ["x", "y"] });
assert.deepEqual(doc[5], { kind: "code", text: "code here" });
assert.deepEqual(doc[6], { kind: "heading", level: 3, text: "Deep" }, "deeper headings are shown as the smallest level");

assert.deepEqual(parseBlocks("3. third\n4. fourth")[0], { kind: "list", ordered: true, start: 3, items: ["third", "fourth"] }, "a numbered list keeps its first number");
assert.deepEqual(
  parseBlocks("| Offer | Sold |\n|---|---:|\n| Massage | 6 |\n| Bundle |\nAfter"),
  [
    { kind: "table", header: ["Offer", "Sold"], rows: [["Massage", "6"], ["Bundle", ""]] },
    { kind: "paragraph", lines: ["After"] },
  ],
  "a table, short rows padded, ends at the first line without a pipe",
);
assert.deepEqual(parseBlocks("| Offer | Sold |"), [{ kind: "paragraph", lines: ["| Offer | Sold |"] }], "a header still waiting for its divider is a paragraph");
assert.deepEqual(parseBlocks("```\nlet a = 1"), [{ kind: "code", text: "let a = 1" }], "an unclosed fence is code to the end");
assert.deepEqual(parseBlocks("**Bold** start"), [{ kind: "paragraph", lines: ["**Bold** start"] }], "bold at the start of a line is not a bullet");
assert.deepEqual(parseBlocks(""), []);
assert.deepEqual(splitRow("| a | b |"), ["a", "b"]);

assert.deepEqual(parseInline("**6 sold** against `2`"), [
  { kind: "strong", text: "6 sold" },
  { kind: "text", text: " against " },
  { kind: "code", text: "2" },
]);
assert.deepEqual(parseInline("_quiet_ and *soft*"), [
  { kind: "em", text: "quiet" },
  { kind: "text", text: " and " },
  { kind: "em", text: "soft" },
]);
assert.deepEqual(parseInline("use list_leads_today now"), [{ kind: "text", text: "use list_leads_today now" }], "snake_case is not italic");
assert.deepEqual(parseInline("2 * 3 * 4"), [{ kind: "text", text: "2 * 3 * 4" }], "spaced asterisks are not italic");
assert.deepEqual(parseInline("Visit https://adonisagent.ie/pricing."), [
  { kind: "text", text: "Visit " },
  { kind: "link", text: "https://adonisagent.ie/pricing", href: "https://adonisagent.ie/pricing" },
  { kind: "text", text: "." },
], "a bare link drops the full stop after it");
assert.deepEqual(parseInline("[Open the ads](/marketing/ads/12)"), [{ kind: "link", text: "Open the ads", href: "/marketing/ads/12" }], "a link inside the app");
for (const bad of ["[x](javascript:alert(1))", "[x](//evil.example)", "[x](data:text/html,hi)"]) {
  const out = parseInline(bad);
  assert.ok(out.every((n) => n.kind === "text"), `${bad} is never a link`);
  assert.equal(out.map((n) => n.text).join(""), bad, "and its text is kept as written");
}

console.log("markdown: all checks passed");
