/**
 * Where every element ACTUALLY landed, read back out of satori's own SVG.
 * ZERO RUNTIME IMPORTS (see ./parse.ts).
 *
 * THE PROBLEM THIS EXISTS FOR. A designed slide positions most of its blocks
 * absolutely -- `top:775px` for the heading, `top:860px` for the paragraph
 * under it. To choose that second number the model has to know how many lines
 * the heading wrapped to, and it cannot: satori does the wrapping, long after
 * the model is done writing. So it guesses, and a heading that takes one line
 * more than it budgeted for lands ON the paragraph. A real slide read
 * "Radiant warmth, nothing enclosing you" with the word "you" sitting across
 * the first line of its own body text -- the heading's real box was 102px tall
 * from top:775, reaching 877, and the body began at 860.
 *
 * The fix cannot be a better guess. It has to be a measurement.
 *
 * WHY THIS IS FREE. satori emits an overflow mask for every element it lays
 * out, and that mask is a <rect> carrying the element's final geometry:
 *
 *     <mask id="satori_om-id-0-3"><rect x="76" y="775" width="860" height="102" .../></mask>
 *
 * The id after "satori_om-" is the element's path from the root, one index per
 * level. So the whole laid-out geometry of a slide is already sitting in the
 * string the renderer produces and then hands to sharp -- no second pass, no
 * font metrics, no pixel reading. This module is the parse and the comparison.
 *
 * The id scheme is satori's internal business, so ./renderDesign.test.ts pins
 * it against a real render: an upgrade that changes the shape fails there
 * rather than quietly returning no boxes and reporting every slide clean.
 */

/** One element's final geometry. `path` is "" for the root, "0-3" for the
 *  fourth child of the first child. */
export interface LaidOutBox {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An element holding nothing but text, and the text it holds. */
export interface TextBlock {
  path: string;
  text: string;
}

/** Two text blocks whose boxes physically overlap on the canvas. */
export interface TextCollision {
  /** The block that starts higher up the canvas. */
  upper: string;
  /** The block it runs into. */
  lower: string;
  /** How far the upper block reaches past the lower one's top edge. */
  overlapPx: number;
}

const MASK_RECT =
  /<mask id="satori_om-id((?:-\d+)*)"[^>]*>\s*<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;

/**
 * Every element's laid-out box, keyed by path.
 *
 * An element with no mask in the SVG is simply absent from the map. That is
 * the deliberate failure mode: a caller looking up a path it cannot find skips
 * the element rather than guessing at it, so a satori version that stops
 * emitting a mask for some element makes this report LESS, never wrongly.
 */
export function laidOutBoxes(svg: string): Map<string, LaidOutBox> {
  const out = new Map<string, LaidOutBox>();
  const re = new RegExp(MASK_RECT.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    // "-0-3" -> "0-3"; "" (the root) stays "".
    const path = m[1].replace(/^-/, "");
    out.set(path, {
      path,
      x: Number(m[2]),
      y: Number(m[3]),
      width: Number(m[4]),
      height: Number(m[5]),
    });
  }
  return out;
}

/**
 * Every text-holding element in a prepared node tree, with the path satori
 * will give it.
 *
 * "Text-holding" is the same test ./renderDesign.ts's `prepare` uses to decide
 * an element needs no explicit display: all of its children are strings. That
 * is deliberate -- the two have to agree about what a leaf is, or a path
 * computed here names a different element than the mask it is matched against.
 *
 * The tree passed to satori sits one level below the root it numbers from, so
 * a single top-level element is "0" and its children are "0-0", "0-1", and so
 * on. That offset is pinned by the real-render test, not assumed.
 */
export function textBlocks(nodes: unknown): TextBlock[] {
  const out: TextBlock[] = [];
  // Whatever is handed to satori IS the root, and the root is the empty path.
  // In practice that node is satori-html's own wrapper rather than the markup's
  // outer <div> -- satori-html always adds one -- so the design's root element
  // is "0" and its blocks are "0-0", "0-1", and so on. Getting this level wrong
  // matches every block against its parent's box, which reports a whole slide
  // as one giant collision; the real-render check in the test pins it.
  walk(nodes, "", out);
  return out;
}

function walk(node: unknown, path: string, out: TextBlock[]): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  const props = (node as { props?: { children?: unknown } }).props;
  if (!props) return;

  const children = props.children;
  const kids =
    children === undefined || children === null
      ? []
      : Array.isArray(children)
        ? children
        : [children];

  const text = kids.filter((k) => typeof k === "string").join("");
  if (kids.length > 0 && kids.every((k) => typeof k === "string")) {
    // A leaf. Blank text occupies a box satori still lays out, but an empty
    // string is not something an operator can see collide, so it is not worth
    // a violation.
    if (text.trim()) out.push({ path, text: text.trim() });
    return;
  }
  kids.forEach((child, i) => walk(child, join(path, i), out));
}

function join(path: string, index: number): string {
  return path === "" ? String(index) : `${path}-${index}`;
}

/**
 * Text blocks that landed on top of one another.
 *
 * BOTH axes have to overlap. Two blocks sharing a band of the canvas in
 * separate columns is an ordinary two-column layout, not a defect, and
 * flagging it would send the repair loop after designs that are already right.
 *
 * `minPx` is the same kind of guard measureLayout uses against its own
 * antialiasing: boxes that abut, or miss by a rounding artefact, are not a
 * collision anyone can see.
 */
export function textCollisions(
  svg: string,
  blocks: TextBlock[],
  minPx = 3,
): TextCollision[] {
  const boxes = laidOutBoxes(svg);
  const placed = blocks
    .map((b) => ({ block: b, box: boxes.get(b.path) }))
    .filter((p): p is { block: TextBlock; box: LaidOutBox } => !!p.box);

  const out: TextCollision[] = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      const vertical =
        Math.min(a.box.y + a.box.height, b.box.y + b.box.height) -
        Math.max(a.box.y, b.box.y);
      if (vertical < minPx) continue;
      const horizontal =
        Math.min(a.box.x + a.box.width, b.box.x + b.box.width) -
        Math.max(a.box.x, b.box.x);
      if (horizontal < minPx) continue;
      const [upper, lower] = a.box.y <= b.box.y ? [a, b] : [b, a];
      out.push({
        upper: upper.block.text,
        lower: lower.block.text,
        overlapPx: Math.round(vertical),
      });
    }
  }
  return out;
}

/** The repair loop's words for a collision. Shaped like overflowViolation:
 *  it names what went wrong and what the model is expected to do about it. */
export function collisionViolation(collisions: TextCollision[]): string {
  const worst = [...collisions].sort((a, b) => b.overlapPx - a.overlapPx)[0];
  const more =
    collisions.length > 1 ? ` (${collisions.length} overlaps in all)` : "";
  return (
    `Text is overlapping text${more}: "${clip(worst.upper)}" runs about ` +
    `${worst.overlapPx}px into "${clip(worst.lower)}". A block's height ` +
    `depends on how many lines its text wraps to, which cannot be known when ` +
    `the "top" is written. Put the blocks that stack in ONE positioned ` +
    `container with "display:flex;flex-direction:column" and a gap, so each ` +
    `one is placed below the last whatever it wraps to, instead of giving ` +
    `every block its own "top".`
  );
}

function clip(text: string, max = 40): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
