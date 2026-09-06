// Run: npm test -- src/lib/ai/signoff.test.ts
//
// Pure tests for the per-format sign-off rules. The point of the module is
// that the CTA differs by where the copy lands — a social post has no link to
// click, an ad has nothing else BUT its link — so these assert the formats
// stay told apart, and that the banned enquiry-desk phrasing is on every one
// of them. signoff.ts has zero imports, so this loads with a plain static
// import (no react-server shim), like campaigns/plan.test.ts.
import assert from "node:assert/strict";

import { signoffRule, type CopyFormat } from "./signoff";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const ALL: CopyFormat[] = ["social", "ad", "blog", "email"];
const URL = "https://inspirehealthandfitness.ie/sign-up";

// Every format bans the phrasing that started this.
for (const f of ALL) {
  const out = signoffRule(f, URL);
  check(`${f}: bans "register your interest"`, out.includes('"register your interest"'));
  check(`${f}: asks them to sign up`, /sign up/i.test(out));
}

// Social is the ONLY format that says "link in bio" — an ad's link is the ad.
check("social: points at the link in bio", signoffRule("social").includes("link in bio"));
check("ad: click the link, never the bio", signoffRule("ad").includes("Click the link to sign up") && signoffRule("ad").includes('Never say "link in bio"'));
check("blog: does not say link in bio", !signoffRule("blog", URL).includes("link in bio"));
check("email: does not say link in bio", !signoffRule("email", URL).includes("link in bio"));

// Blog and email carry a real URL when one is configured.
check("blog: links the sign-up URL as markdown", signoffRule("blog", URL).includes(`](${URL})`));
check("email: gives the bare URL (plain-text body)", signoffRule("email", URL).includes(URL) && !signoffRule("email", URL).includes(`](${URL})`));

// ...and degrade to a plain instruction when it isn't.
check("blog: no URL set -> no link, no invented one", !signoffRule("blog").includes("http"));
check("email: no URL set -> no link, no invented one", !signoffRule("email").includes("http"));
check("blog: no URL set -> still asks for the sign-up", signoffRule("blog").includes("Click the link to sign up"));

// A blank/whitespace URL is treated as unset, not linked as "".
check("blank URL is treated as unset", !signoffRule("blog", "   ").includes("]("));

// Social ignores the URL entirely — there is nowhere to put it.
check("social: never carries a URL", !signoffRule("social", URL).includes(URL));

console.log(`signoff: ${passed} checks passed.`);
