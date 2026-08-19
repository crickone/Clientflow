/**
 * Pure tests for the campaign-asset body parsers (Campaign Engine Slice 1:
 * materialise-on-approve). assetBody.ts has zero runtime imports, so this
 * loads under the plain tsx test runner exactly like
 * src/lib/campaigns/prompts.test.ts — no DB, no shim needed.
 * Run: npm test -- src/lib/campaigns/assetBody.test.ts
 */
import assert from "node:assert/strict";

import { parseSocialBody, parseEmailBody, parseLandingBody } from "./assetBody";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// ── parseSocialBody ─────────────────────────────────────────────────────────

const validSocialRaw = JSON.stringify({
  caption: "Summer is here — grab the offer.",
  slides: [
    { template: "carousel-cover", heading: "Summer Shape Up", body: "6 weeks to a new you.", image: "a bright gym" },
    { template: "carousel-cta", heading: "Book now", body: "Spots are limited.", image: "a reception desk" },
  ],
});

{
  const parsed = parseSocialBody(validSocialRaw);
  check("parseSocialBody: valid JSON returns non-null", parsed !== null);
  check("parseSocialBody: caption round-trips", parsed?.caption === "Summer is here — grab the offer.");
  check("parseSocialBody: slides round-trip (count)", parsed?.slides.length === 2);
  check("parseSocialBody: slide fields round-trip", parsed?.slides[0].heading === "Summer Shape Up");
  check("parseSocialBody: slide template round-trips", parsed?.slides[1].template === "carousel-cta");
}

check(
  "parseSocialBody: malformed JSON returns null (not a throw)",
  parseSocialBody("not json{") === null,
);

check(
  "parseSocialBody: a JSON array (not an object) returns null",
  parseSocialBody(JSON.stringify([1, 2, 3])) === null,
);

check(
  "parseSocialBody: missing `slides` key returns null",
  parseSocialBody(JSON.stringify({ caption: "hi" })) === null,
);

check(
  "parseSocialBody: `slides` not an array returns null",
  parseSocialBody(JSON.stringify({ caption: "hi", slides: "nope" })) === null,
);

check(
  "parseSocialBody: empty `slides` array returns null (nothing to materialise)",
  parseSocialBody(JSON.stringify({ caption: "hi", slides: [] })) === null,
);

{
  // Missing per-slide fields default to "" rather than throwing/undefined.
  const raw = JSON.stringify({ slides: [{ template: "carousel-cover" }] });
  const parsed = parseSocialBody(raw);
  check("parseSocialBody: tolerates missing slide fields (non-null)", parsed !== null);
  check("parseSocialBody: missing slide.heading defaults to ''", parsed?.slides[0].heading === "");
  check("parseSocialBody: missing slide.body defaults to ''", parsed?.slides[0].body === "");
  check("parseSocialBody: missing slide.image defaults to ''", parsed?.slides[0].image === "");
  check("parseSocialBody: missing top-level caption defaults to ''", parsed?.caption === "");
}

check(
  "parseSocialBody: empty string body returns null",
  parseSocialBody("") === null,
);

// ── parseEmailBody ───────────────────────────────────────────────────────────

const validEmailRaw = JSON.stringify({ subject: "Summer Shape Up is here", content: "Here's the offer..." });

{
  const parsed = parseEmailBody(validEmailRaw);
  check("parseEmailBody: valid JSON returns non-null", parsed !== null);
  check("parseEmailBody: subject round-trips", parsed?.subject === "Summer Shape Up is here");
  check("parseEmailBody: content round-trips", parsed?.content === "Here's the offer...");
}

check(
  "parseEmailBody: malformed JSON returns null (not a throw)",
  parseEmailBody("{subject: no quotes}") === null,
);

check(
  "parseEmailBody: missing subject returns null",
  parseEmailBody(JSON.stringify({ content: "body only" })) === null,
);

check(
  "parseEmailBody: missing content returns null",
  parseEmailBody(JSON.stringify({ subject: "subject only" })) === null,
);

check(
  "parseEmailBody: non-string subject returns null",
  parseEmailBody(JSON.stringify({ subject: 123, content: "x" })) === null,
);

check(
  "parseEmailBody: whitespace-only subject/content returns null after trim",
  parseEmailBody(JSON.stringify({ subject: "   ", content: "  " })) === null,
);

{
  const parsed = parseEmailBody(JSON.stringify({ subject: "  Trimmed  ", content: "  also trimmed  " }));
  check("parseEmailBody: trims surrounding whitespace", parsed?.subject === "Trimmed" && parsed?.content === "also trimmed");
}

// ── parseLandingBody ─────────────────────────────────────────────────────────

const validLandingRaw = JSON.stringify({
  headline: "Summer Shape Up is here",
  subhead: "6 weeks to a stronger you.",
  bullets: ["Small-group coaching", "Personalised plan", "Real accountability"],
  ctaLabel: "Register your interest",
});

{
  const parsed = parseLandingBody(validLandingRaw);
  check("parseLandingBody: valid JSON returns non-null", parsed !== null);
  check("parseLandingBody: headline round-trips", parsed?.headline === "Summer Shape Up is here");
  check("parseLandingBody: subhead round-trips", parsed?.subhead === "6 weeks to a stronger you.");
  check("parseLandingBody: bullets round-trip (count)", parsed?.bullets.length === 3);
  check("parseLandingBody: bullet content round-trips", parsed?.bullets[1] === "Personalised plan");
  check("parseLandingBody: ctaLabel round-trips", parsed?.ctaLabel === "Register your interest");
}

check(
  // generate.ts calls this directly on the model's raw output (see this
  // file's header comment) — LANDING_FORMAT_RULES tells the model not to,
  // but Claude sometimes wraps JSON in a fence anyway (the same real-world
  // quirk generateCarousel.ts's extractPayload defends against).
  "parseLandingBody: strips a markdown code fence Claude sometimes wraps JSON in anyway",
  (() => {
    const fenced = "```json\n" + validLandingRaw + "\n```";
    const parsed = parseLandingBody(fenced);
    return parsed !== null && parsed.headline === "Summer Shape Up is here" && parsed.bullets.length === 3;
  })(),
);

check(
  "parseLandingBody: malformed JSON returns null (not a throw)",
  parseLandingBody("not json{") === null,
);

check(
  "parseLandingBody: a JSON array (not an object) returns null",
  parseLandingBody(JSON.stringify([1, 2, 3])) === null,
);

{
  // Missing fields default rather than rejecting the whole body — tolerant parse
  // (this is called on the MODEL's raw output in generate.ts, so it must degrade
  // gracefully field-by-field rather than reject the whole thing outright).
  const parsed = parseLandingBody(JSON.stringify({}));
  check("parseLandingBody: tolerates an empty object (non-null)", parsed !== null);
  check("parseLandingBody: missing headline defaults to ''", parsed?.headline === "");
  check("parseLandingBody: missing subhead defaults to ''", parsed?.subhead === "");
  check("parseLandingBody: missing bullets defaults to []", Array.isArray(parsed?.bullets) && parsed?.bullets.length === 0);
  check("parseLandingBody: missing ctaLabel defaults to ''", parsed?.ctaLabel === "");
}

check(
  "parseLandingBody: `bullets` not an array defaults to [] rather than rejecting",
  (() => {
    const parsed = parseLandingBody(JSON.stringify({ headline: "hi", bullets: "nope" }));
    return parsed !== null && parsed.bullets.length === 0;
  })(),
);

{
  // Non-string bullet entries coerce to "" rather than throwing/rejecting.
  const parsed = parseLandingBody(JSON.stringify({ bullets: ["ok", 123, null] }));
  check("parseLandingBody: tolerates non-string bullet entries (non-null)", parsed !== null);
  check("parseLandingBody: bullets coerce non-strings to ''", parsed?.bullets[1] === "" && parsed?.bullets[2] === "");
}

check(
  "parseLandingBody: empty string body returns null",
  parseLandingBody("") === null,
);

console.log(`\n${passed} passed`);
