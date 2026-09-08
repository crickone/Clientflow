/**
 * Audit AI-authored design markup against a tenant's palette.
 * ZERO RUNTIME IMPORTS (see ./parse.ts).
 *
 * DELIBERATELY NARROW, and worth being honest about why. Checking contrast
 * properly in free-form HTML means resolving which background each text node
 * actually sits over -- which means laying the document out, the renderer's job
 * and not a parser's. So this checks the two things that are both cheap and
 * worth catching:
 *
 *   1. a colour that is not in the tenant's palette at all -- the drift a closed
 *      palette exists to prevent; and
 *   2. the value the system forbids as type, used as a `color`. Optimal Health's
 *      timber is the case this exists for: the prettiest value in the palette,
 *      reached for constantly, and failing as text on every ground.
 *
 * Semi-transparent rgb()/rgba() is exempt: that is how a scrim over a
 * photograph is built, and a scrim is not a palette choice.
 *
 * The real check on a free-form design is looking at the rendered image. This
 * catches what a picture would not tell you quickly -- that a colour is
 * off-brand rather than merely ugly.
 */
import type { DesignSystem } from "./parse";
import { valueKeyForHex } from "./validate";

const HEX = /#[0-9a-fA-F]{6}\b/g;
const RGB = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)/g;
/**
 * `color:` specifically. The leading character class is what keeps this from
 * also matching `background-color:` -- the preceding "-" is not in it.
 */
const COLOR_PROP = /(?:^|[;{"'\s])color\s*:\s*(#[0-9a-fA-F]{6})\b/gi;
/** An embedded photograph is bytes, not design. Its payload is a long run of
 *  exactly the characters a colour matcher looks for. */
const DATA_URI = /data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/gi;

function withoutPayloads(html: string): string {
  return html.replace(DATA_URI, "data:image");
}

/** Every distinct colour the markup sets, normalised. */
export function extractColours(html: string): string[] {
  const clean = withoutPayloads(html);
  const out = new Set<string>();
  for (const m of clean.match(HEX) ?? []) out.add(m.toLowerCase());
  for (const m of clean.match(RGB) ?? []) out.add(m.replace(/\s+/g, ""));
  return [...out];
}

/** Colours set specifically as TEXT colour. */
function textColours(html: string): string[] {
  const clean = withoutPayloads(html);
  const out = new Set<string>();
  const re = new RegExp(COLOR_PROP.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) out.add(m[1].toLowerCase());
  return [...out];
}

export type DesignAudit = { ok: true } | { ok: false; violations: string[] };

export function auditDesignHtml(
  html: string,
  system: DesignSystem,
): DesignAudit {
  const violations: string[] = [];
  const palette = system.values.map((v) => v.key).join(", ");

  for (const colour of extractColours(html)) {
    // A scrim, not a palette choice.
    if (colour.startsWith("rgb")) continue;
    if (!valueKeyForHex(system, colour)) {
      violations.push(
        `${colour} is not a value in this design system. The palette is ${palette}, and it is deliberately closed.`,
      );
    }
  }

  for (const colour of textColours(html)) {
    const key = valueKeyForHex(system, colour);
    if (key && system.rules.neverType.includes(key)) {
      violations.push(
        `${key} is set as text. This system never sets type in ${key} -- it is for rules, blocks and fills.`,
      );
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
