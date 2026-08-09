/**
 * HTML sanitizers for CMS editable content — Batch 2a (XSS core defense).
 *
 * Two functions, two different threat models. Both are real allow-lists
 * (via the `sanitize-html` library, built on htmlparser2's tokenizer) rather
 * than the previous regex/blocklist, so malformed/nested-tag bypass tricks
 * (e.g. `<scr<script>ipt>`, which a single-pass string-replace can
 * reconstruct into a live `<script>`) are closed structurally: the parser
 * builds a real tag tree from `<`/`>` tokenization, it doesn't pattern-match
 * "tag-shaped" substrings.
 *
 * - `sanitizeHtml` — for arbitrary, freeform admin/AI-authored `kind:'html'`
 *   content blocks (see `components/cms/Block.tsx`), shared across every
 *   tenant's generic CMS templates and typed straight into a plain
 *   `<textarea>` in the page editor. On the shared origin, a script planted
 *   in one tenant's block would run in ANY tenant's session that views it, so
 *   this allow-list is deliberately narrow: rich text only.
 *
 * - `sanitizeHtmlKeepStyles` — for first-party BESPOKE SITE page bodies
 *   imported via `tools/import-site.cjs` (Renova, clientflow.ie, …). It backs
 *   the `clientflow-page` template AND the Studio's in-place edit canvas
 *   (`lib/cms/render.ts#editBodyHtml`, rendered by `RenovaEditCanvas`) for
 *   pages on EITHER bespoke template. This is not rich text — it's a full
 *   page body (header/nav/section/svg/video/forms/tables), authored by the
 *   agency, not by tenant end-users. The Studio save path
 *   (`cms/[siteSlug]/studio/actions.ts`) round-trips the edited canvas HTML
 *   back into the page's PERMANENT stored `body` block (re-appending only
 *   the original `<script>` tags), so an allow-list that's too narrow here
 *   would silently amputate live site markup the next time an admin edits
 *   and saves the page. So this allow-list is broad (structural/semantic
 *   HTML5 + SVG), while still excluding every script-execution vector: no
 *   `<script>`, no `<style>` (a `<style>` element is NOT in the allow-list —
 *   allowing it, even without event handlers of its own, is a documented
 *   mutation-XSS vector: `<svg><foreignObject><style>` smuggles markup that
 *   this sanitizer's parser treats as inert rawtext CSS but that a browser
 *   re-parses as live elements once inserted via `dangerouslySetInnerHTML`
 *   — see html.test.ts for the payload), no event handlers, no
 *   `javascript:`/`vbscript:` URLs, no `<iframe>`/`<object>`/`<embed>`.
 *   Inline `style=""` attributes are a separate, per-property-filtered path
 *   (`allowedStyles` / `BESPOKE_STYLES` below) and are unaffected.
 *
 *   IMPORTANT: the `clientflow-live` template's actual PUBLIC render
 *   (`lib/cms/sites/renova/templates.tsx`) does NOT call either function —
 *   by design it renders the stored `body` value verbatim, scripts included,
 *   for the imported bespoke sites' GSAP/Lenis animations. That path is
 *   untouched by this file and by this batch of work.
 *
 * Both functions keep their original signature — `(html: string | null |
 * undefined) => string` — so every existing call site keeps working.
 */
import sanitizeHtmlLib from "sanitize-html";

/** Shared safe URL schemes for both functions (drops `ftp` from the library
 *  default; `javascript:`/`vbscript:`/`data:` are never in this list). */
const SAFE_SCHEMES = ["http", "https", "mailto", "tel"];

/** Force a safe `rel` onto every surviving `<a>` (harmless with or without
 *  `target`, and stops the classic `target="_blank"` reverse-tabnabbing
 *  footgun as a side effect). */
const FORCE_SAFE_REL = sanitizeHtmlLib.simpleTransform(
  "a",
  { rel: "noopener noreferrer" },
  true,
);

// ---------------------------------------------------------------------------
// sanitizeHtml — narrow rich-text allow-list for generic kind:'html' blocks.
// ---------------------------------------------------------------------------

const RICH_TEXT_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br",
  "ul", "ol", "li",
  "a",
  "strong", "em", "b", "i", "u",
  "blockquote", "code", "pre",
  "img",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "span", "div",
];

const RICH_TEXT_ATTRIBUTES: sanitizeHtmlLib.IOptions["allowedAttributes"] = {
  a: ["href", "target", "rel"],
  img: ["src", "alt"],
};

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtmlLib(html, {
    allowedTags: RICH_TEXT_TAGS,
    allowedAttributes: RICH_TEXT_ATTRIBUTES,
    allowedSchemes: SAFE_SCHEMES,
    allowProtocolRelative: false,
    transformTags: { a: FORCE_SAFE_REL },
  });
}

// ---------------------------------------------------------------------------
// sanitizeHtmlKeepStyles — broad structural allow-list for first-party
// bespoke site page bodies (see file doc comment for why this is broad, not
// rich-text).
// ---------------------------------------------------------------------------

const BESPOKE_TAGS = [
  // sectioning / structure
  "header", "footer", "nav", "main", "section", "article", "aside",
  "div", "span",
  // headings / text
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "br", "hr",
  "strong", "em", "b", "i", "u", "s", "small", "sub", "sup", "mark", "q", "cite", "abbr",
  "blockquote", "code", "pre",
  "ul", "ol", "li", "dl", "dt", "dd",
  "a",
  // media
  "img", "picture", "source", "video", "audio", "track", "canvas", "figure", "figcaption",
  // tables
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  // forms (no script-bearing attributes are ever allowed on these — see below)
  "form", "input", "label", "select", "option", "optgroup", "textarea", "button", "fieldset", "legend",
  // misc structural
  "details", "summary", "template", "time",
  // "head-ish" — import-site.cjs prepends a Google Fonts <link> onto the body
  // fragment, so it must survive. NOTE: "style" is deliberately NOT in this
  // list — see the file doc comment above (mutation-XSS via
  // <svg><foreignObject><style>) and html.test.ts. The page's own <style>
  // block is dropped entirely by this sanitizer, same as the old regex one.
  "link",
  // svg (the bespoke sites use inline SVG for icons/gradients/decorative art).
  // NOTE: htmlparser2 lowercases every tag/attribute name in HTML mode (the
  // mode sanitize-html always runs in), so camelCase SVG names below are
  // spelled in their lowercased form — e.g. "lineargradient", not
  // "linearGradient" — or they would never match and would be silently
  // dropped. This is safe: these are exactly the names in the HTML5 "adjust
  // SVG tag names" foreign-content table, so every browser restores the
  // correct camelCase when this (lowercase) HTML is parsed back into the DOM
  // via dangerouslySetInnerHTML — the same mechanism that makes hand-typed
  // lowercase SVG markup work in ordinary HTML documents.
  "svg", "g", "path", "circle", "ellipse", "rect", "line", "polygon", "polyline",
  "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern",
  "use", "symbol", "text", "tspan", "textpath", "title", "desc", "marker",
  "filter", "fegaussianblur", "feoffset", "femerge", "femergenode", "fecolormatrix", "feblend",
];

/** Applies to every allowed tag above (sanitize-html merges the `'*'` entry
 *  into each tag's own list) — includes SVG presentation attributes so they
 *  don't need repeating per shape element. Never includes `on*`. */
const GLOBAL_ATTRS = [
  "class", "id", "style", "title", "role", "tabindex", "lang", "dir", "hidden",
  "data-*", "aria-*",
  // SVG presentation attributes (harmless no-ops on non-SVG tags)
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-opacity", "fill-opacity", "fill-rule", "opacity",
  "transform", "clip-path",
];

const BESPOKE_ATTRIBUTES: sanitizeHtmlLib.IOptions["allowedAttributes"] = {
  "*": GLOBAL_ATTRS,
  a: ["href", "target", "name", "rel"],
  img: ["src", "srcset", "sizes", "alt", "width", "height", "loading", "decoding"],
  source: ["src", "srcset", "type", "media", "sizes"],
  video: ["src", "poster", "controls", "autoplay", "muted", "loop", "playsinline", "preload", "width", "height", "crossorigin"],
  audio: ["src", "controls", "autoplay", "muted", "loop", "preload"],
  track: ["src", "kind", "srclang", "label", "default"],
  link: [
    { name: "rel", values: ["stylesheet", "preconnect", "preload", "dns-prefetch", "icon", "manifest"] },
    "href", "as", "type", "crossorigin", "media",
  ],
  form: ["action", "method", "name", "autocomplete", "novalidate", "target"],
  input: ["type", "name", "value", "placeholder", "checked", "disabled", "required", "readonly", "min", "max", "step", "pattern", "autocomplete", "maxlength"],
  label: ["for"],
  select: ["name", "disabled", "required", "multiple"],
  option: ["value", "selected", "disabled"],
  textarea: ["name", "rows", "cols", "placeholder", "disabled", "required", "maxlength"],
  button: ["type", "disabled", "name", "value"],
  th: ["colspan", "rowspan", "scope", "headers"],
  td: ["colspan", "rowspan", "headers"],
  col: ["span"],
  colgroup: ["span"],
  time: ["datetime"],
  // (see the BESPOKE_TAGS comment above re: lowercase SVG names/attributes)
  svg: ["viewbox", "xmlns", "xmlns:xlink", "width", "height", "preserveaspectratio"],
  use: ["href", "xlink:href", "x", "y", "width", "height"],
  path: ["d"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  rect: ["x", "y", "width", "height", "rx", "ry"],
  line: ["x1", "y1", "x2", "y2"],
  polygon: ["points"],
  polyline: ["points"],
  lineargradient: ["id", "x1", "y1", "x2", "y2", "gradientunits", "gradienttransform"],
  radialgradient: ["id", "cx", "cy", "r", "fx", "fy", "gradientunits", "gradienttransform"],
  stop: ["offset", "stop-color", "stop-opacity"],
  text: ["x", "y", "dx", "dy", "text-anchor", "font-family", "font-size"],
  tspan: ["x", "y", "dx", "dy"],
  pattern: ["id", "width", "height", "patternunits"],
  fegaussianblur: ["in", "stddeviation", "result"],
  feoffset: ["in", "dx", "dy", "result"],
  femergenode: ["in"],
  fecolormatrix: ["type", "values", "in"],
  feblend: ["in", "in2", "mode"],
};

/** Common CSS properties allowed in an inline `style=""` attribute. Values
 *  may be anything EXCEPT the known script-execution escapes — this is
 *  intentionally broad (first-party agency-authored CSS, not tenant text)
 *  but still a real allow-list per-property, per the brief (not a raw
 *  passthrough). This governs ONLY the inline `style=""` attribute — the
 *  page's own `<style>` BLOCK element is not in `BESPOKE_TAGS` at all (see
 *  above), so it never reaches this filter: it's discarded outright. */
const SAFE_STYLE_VALUE = [/^(?!.*(javascript:|expression\(|-moz-binding|behaviou?r\s*:|vbscript:)).*$/i];
const STYLE_PROPS = [
  "color", "background", "background-color", "background-image", "background-position",
  "background-size", "background-repeat", "background-attachment",
  "font", "font-family", "font-size", "font-weight", "font-style", "line-height",
  "letter-spacing", "text-align", "text-decoration", "text-transform", "text-shadow", "white-space",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "display", "position", "top", "left", "right", "bottom", "z-index",
  "overflow", "overflow-x", "overflow-y",
  "flex", "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis",
  "align-items", "align-content", "align-self", "justify-content", "justify-items", "justify-self",
  "gap", "row-gap", "column-gap",
  "grid-template-columns", "grid-template-rows", "grid-column", "grid-row", "grid-gap",
  "border", "border-radius", "border-color", "border-width", "border-style",
  "border-top", "border-right", "border-bottom", "border-left",
  "box-shadow", "opacity", "transform", "transform-origin", "transition", "animation",
  "cursor", "object-fit", "object-position", "vertical-align", "aspect-ratio",
  "filter", "backdrop-filter", "list-style", "list-style-type", "clip-path",
  "pointer-events", "visibility", "fill", "stroke",
];
const BESPOKE_STYLES: sanitizeHtmlLib.IOptions["allowedStyles"] = {
  "*": Object.fromEntries(STYLE_PROPS.map((prop) => [prop, SAFE_STYLE_VALUE])),
};

export function sanitizeHtmlKeepStyles(html: string | null | undefined): string {
  if (!html) return "";
  return sanitizeHtmlLib(html, {
    allowedTags: BESPOKE_TAGS,
    allowedAttributes: BESPOKE_ATTRIBUTES,
    allowedStyles: BESPOKE_STYLES,
    allowedSchemes: SAFE_SCHEMES,
    allowProtocolRelative: true,
    parseStyleAttributes: true,
    transformTags: { a: FORCE_SAFE_REL },
  });
}
