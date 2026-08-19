/**
 * Pure parsers for the JSON shapes `generateAsset` (./generate) stores inside
 * a campaign asset's `body` column for the two kinds that don't hold plain
 * text/markdown directly:
 *   - social: `JSON.stringify({ caption, slides })` (see generate.ts's
 *     "social" branch — `slides` mirrors generateCarousel.ts's
 *     `GeneratedSlide[]` shape, duplicated locally below rather than
 *     imported so this file stays genuinely zero-import).
 *   - email:  `JSON.stringify({ subject, content })` (see generate.ts's
 *     "email" branch).
 *
 * Used by ./materialise (Task 4: materialise-on-approve) to turn an approved
 * asset's stored body back into structured data before writing it into its
 * real home (a carousel_sets/email_campaigns row). Both parsers are total —
 * they NEVER throw, returning `null` for anything that isn't well-formed
 * (malformed JSON, wrong shape, missing/blank required fields) — so a
 * materialisation call can treat "couldn't parse" as just another reason to
 * degrade gracefully (log + skip the external link) rather than fail the
 * whole approve. `blog` needs no parser: generate.ts's "blog" branch stores
 * the draft's markdown directly as `body`, no JSON envelope.
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
