/**
 * Pure parsers for the JSON shapes `generateAsset` (./generate) stores inside
 * a campaign asset's `body` column for the three kinds that don't hold plain
 * text/markdown directly:
 *   - social: `JSON.stringify({ caption, slides })` (see generate.ts's
 *     "social" branch — `slides` mirrors generateCarousel.ts's
 *     `GeneratedSlide[]` shape, duplicated locally below rather than
 *     imported so this file stays genuinely zero-import).
 *   - email:  `JSON.stringify({ subject, content })` (see generate.ts's
 *     "email" branch).
 *   - landing_page (Slice 2): `JSON.stringify({ headline, subhead, bullets,
 *     ctaLabel })` (see generate.ts's "landing_page" branch).
 *
 * parseSocialBody/parseEmailBody are used by ./materialise (Task 4:
 * materialise-on-approve) to turn an approved asset's ALREADY-TRUSTED stored
 * body back into structured data before writing it into its real home (a
 * carousel_sets/email_campaigns row) — social/email's own generators
 * (generateCarouselSlides/draftCampaignEmail) already return structured data
 * at generation time, so nothing needs parsing until then.
 *
 * parseLandingBody is used differently: landing_page has no existing
 * structured generator to reuse (see generate.ts's header comment), so its
 * branch calls `generateRaw` — the same plain-text call offer/ad_copy/
 * video_script use — and parses the MODEL's raw output with this function
 * immediately, at generation time, before ever storing anything (falling
 * back to a safe default object if the model's output doesn't parse — see
 * generate.ts). materialise.ts's landing_page case never calls it at all
 * (landing_page has no external home, so there's nothing to unpack later);
 * a future public-rendering route reads the already-normalised stored body
 * back out with it instead (same "parse a trusted stored body" shape
 * parseSocialBody/parseEmailBody serve materialise.ts with).
 *
 * All three parsers are total — they NEVER throw, returning `null` for
 * anything that isn't well-formed (malformed JSON, wrong top-level shape) —
 * so every caller can treat "couldn't parse" as just another reason to
 * degrade gracefully rather than fail outright. `blog` needs no parser:
 * generate.ts's "blog" branch stores the draft's markdown directly as
 * `body`, no JSON envelope.
 *
 * Zero runtime imports (mirrors src/lib/campaigns/plan.ts and
 * src/lib/campaigns/prompts.ts) — loads under the plain tsx test runner with
 * no DB/server-only module graph behind it.
 */

export interface ParsedSocialSlide {
  template: string;
  heading: string;
  body: string;
  image: string;
}

export interface ParsedSocialBody {
  caption: string;
  slides: ParsedSocialSlide[];
}

export interface ParsedEmailBody {
  subject: string;
  content: string;
}

export interface ParsedLandingBody {
  headline: string;
  subhead: string;
  bullets: string[];
  ctaLabel: string;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Parse a social asset's stored `{caption, slides}` JSON. Returns `null` for
 * malformed JSON, a non-object payload, a missing/non-array `slides`, or an
 * empty `slides` array (nothing to build a carousel from) — a materialising
 * caller has nothing safe to do with any of those. Individual slide fields
 * missing/mistyped default to `""` rather than rejecting the whole body —
 * only the top-level shape is load-bearing.
 */
export function parseSocialBody(raw: string): ParsedSocialBody | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.slides) || obj.slides.length === 0) return null;

  const slides: ParsedSocialSlide[] = obj.slides.map((s: unknown) => {
    const slide = (s && typeof s === "object" ? (s as Record<string, unknown>) : {}) as Record<string, unknown>;
    return {
      template: asString(slide.template),
      heading: asString(slide.heading),
      body: asString(slide.body),
      image: asString(slide.image),
    };
  });

  return { caption: asString(obj.caption), slides };
}

/**
 * Parse an email asset's stored `{subject, content}` JSON. Returns `null`
 * for malformed JSON, a non-object payload, or either field missing/
 * non-string/blank after trimming — an email draft with no subject or no
 * content isn't a usable draft.
 */
export function parseEmailBody(raw: string): ParsedEmailBody | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const obj = value as Record<string, unknown>;
  const subject = asString(obj.subject);
  const content = asString(obj.content);
  if (!subject || !content) return null;

  return { subject, content };
}

/**
 * Parse a landing-page asset's stored/model-output `{headline, subhead,
 * bullets, ctaLabel}` JSON. Returns `null` only for malformed JSON or a
 * non-object/array payload — unlike parseEmailBody, no individual field is
 * load-bearing: every field tolerantly defaults (headline/subhead/ctaLabel
 * to `""`, bullets to `[]`, and non-string bullet entries to `""`) rather
 * than rejecting the whole body. This extra tolerance matters because
 * generate.ts calls this on the MODEL's raw output directly (see this file's
 * header comment) — a model that gets the shape mostly right but drops one
 * field shouldn't fall all the way back to the generic safe-default object
 * when the rest of its output is perfectly usable.
 *
 * Also strips a leading/trailing markdown code fence before parsing —
 * LANDING_FORMAT_RULES (generate.ts) tells the model to return bare JSON,
 * but Claude sometimes wraps it in ```json anyway; the same real-world quirk
 * generateCarousel.ts's extractPayload defends against. A no-op on text
 * that's already bare JSON (e.g. a previously-normalised stored body), so
 * this stays safe for a future caller that only ever sees clean input.
 */
export function parseLandingBody(raw: string): ParsedLandingBody | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const obj = value as Record<string, unknown>;
  const bullets = Array.isArray(obj.bullets) ? obj.bullets.map((b: unknown) => asString(b)) : [];

  return {
    headline: asString(obj.headline),
    subhead: asString(obj.subhead),
    bullets,
    ctaLabel: asString(obj.ctaLabel),
  };
}
