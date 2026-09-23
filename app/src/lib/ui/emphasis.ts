/**
 * Von Restorff, made checkable: counting the emphasis a component spends.
 *
 * One thing on a screen can be the loud one. Two loud things are a choice the
 * reader has to make before they can act; three is wallpaper. This module does
 * the counting so a test can hold the line — see emphasisBudget tests, which
 * read component SOURCE rather than rendering anything.
 *
 * Source-reading is deliberate. Rendering every page in a headless browser to
 * count buttons would be slower, flakier, and would need a signed-in tenant
 * with representative data. The source tells you what a component CAN put on
 * screen, which is the thing worth bounding.
 *
 * Its limit is the mirror image: a file's count is not what is on screen at
 * once. A component with five primaries across five mutually exclusive
 * branches is fine, and only a human reading it can say so. That judgement
 * belongs in the test's exemption list, with its reason written down.
 *
 * Pure: no imports, no `server-only`, so it loads under the plain-tsx runner.
 */

/**
 * Every `<Button …>` open tag's attribute text, in source order.
 *
 * A character scanner rather than a regex, because a regex for "up to the
 * closing `>`" is wrong in three ways that all occur in this codebase: a `>`
 * inside a string prop, a `>` inside a `{…}` expression (an arrow function's
 * `=>`, or `a > b`), and a `>` inside a comment. Each would end the tag early
 * and silently drop the attributes after it — which is how a guard passes
 * while the thing it guards is broken.
 */
export function buttonTags(src: string): string[] {
  const tags: string[] = [];
  const openRe = /<Button\b/g;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(src))) {
    const start = m.index + m[0].length;
    let i = start;
    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    while (i < src.length) {
      const c = src[i];
      if (quote) {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === quote) quote = null;
        i++;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "/") {
        i = src.indexOf("\n", i + 2);
        if (i === -1) i = src.length;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        const closeAt = src.indexOf("*/", i + 2);
        i = closeAt === -1 ? src.length : closeAt + 2;
        continue;
      }
      if (c === "{") {
        depth++;
        i++;
        continue;
      }
      if (c === "}") {
        depth--;
        i++;
        continue;
      }
      if (c === ">" && depth === 0) {
        end = i;
        break;
      }
      i++;
    }
    if (end === -1) continue; // unterminated tag — nothing sane to capture
    let attrs = src.slice(start, end);
    if (attrs.endsWith("/")) attrs = attrs.slice(0, -1); // self-closing `/>`
    tags.push(attrs);
    openRe.lastIndex = end + 1;
  }
  return tags;
}

export const hasVariantProp = (attrs: string) => /\bvariant\s*=/.test(attrs);
export const isExplicitPrimary = (attrs: string) => /variant\s*=\s*"primary"/.test(attrs);

/**
 * Primary-weight = declared primary, OR no variant prop at all — Button
 * defaults to `variant = "primary"`, so an unmarked button is a loud one. That
 * default is why counting matters: emphasis is what you get by not deciding.
 */
export const isPrimaryWeight = (attrs: string) => isExplicitPrimary(attrs) || !hasVariantProp(attrs);
export const isDestructive = (attrs: string) => /variant\s*=\s*"destructive"/.test(attrs);

export interface Emphasis {
  total: number;
  primary: number;
  destructive: number;
}

export function countEmphasis(src: string): Emphasis {
  const tags = buttonTags(src);
  return {
    total: tags.length,
    primary: tags.filter(isPrimaryWeight).length,
    destructive: tags.filter(isDestructive).length,
  };
}
