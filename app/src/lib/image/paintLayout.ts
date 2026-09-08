/**
 * The renderer for AI-composed slides.
 *
 * One function per archetype, each a bounded composition assembled from the
 * primitives templates.ts already exposes — paintBackground, bottomGradient,
 * autoFitHeading, wrapLines, paintLines, paintHighlightedLines,
 * tokenizeHighlight, canvasMeasure, paintSlideChrome. NO NEW DRAWING
 * CAPABILITY enters the codebase here: if a composition cannot be expressed
 * with what the 39 templates already use, it is not in the grammar.
 *
 * WHERE CONTENT COMES FROM. The spec holds STRUCTURE — archetype, ground,
 * photo treatment, which type level each slot uses, spans, rule placement.
 * The slide ROW holds CONTENT and COLOUR, in exactly the columns it already
 * had. So the operator edits a composed slide with the controls they already
 * have, and retyping a heading invalidates nothing about the layout. The
 * binding from row to slot is:
 *
 *     label            -> design.tagline
 *     display/headline -> design.headingText
 *     subhead/body     -> design.bodyText, one LINE per slot when the
 *                         archetype holds several (a list)
 *
 * A slot's own `text` is what the model composed. It is the payload that
 * WRITES those row columns at generation time, and it is used here only when
 * the row has nothing for that slot — never to override an operator who
 * cleared a field.
 *
 * SIZING. Every number in a design system is authored against its own field
 * (1080px for Optimal Health) and scaled by W / field, so one system serves
 * 1:1, 4:5 and 9:16 without a second set of numbers.
 */
import {
  autoFitHeading,
  bottomGradient,
  canvasMeasure,
  paintBackground,
  paintHighlightedLines,
  paintLines,
  tokenizeHighlight,
  wrapLines,
  type DesignState,
  type FontFamilies,
  type MeasureText,
} from "@/lib/image/templates";
import {
  columnWidth,
  fieldScale,
  valueHex,
  type DesignSystem,
  type TypeLevel,
} from "@/lib/design/parse";
import type { LayoutSlot, LayoutSpec } from "@/lib/design/grammar";
import { defaultTypeValue } from "@/lib/design/validate";

/** The system's measurements, resolved to this slide's real pixel size. */
interface Frame {
  k: number;
  margin: number;
  gutter: number;
  column: number;
  /** Width of a run of n columns, gutters included. */
  span: (n: number) => number;
}

function frameFor(system: DesignSystem, W: number): Frame {
  const k = fieldScale(system, W);
  const margin = system.grid.margin * k;
  const gutter = system.grid.gutter * k;
  const column = columnWidth(system) * k;
  return {
    k,
    margin,
    gutter,
    column,
    span: (n) => {
      const cols = Math.max(1, Math.min(n, system.grid.columns));
      return cols * column + (cols - 1) * gutter;
    },
  };
}

interface Step {
  size: number;
  lineHeight: number;
  /** Letter spacing in px, from the level's em tracking. */
  tracking: number;
  font: string;
  upper: boolean;
}

function stepFor(
  system: DesignSystem,
  level: TypeLevel,
  frame: Frame,
  family: string,
): Step {
  const t = system.type[level];
  const size = Math.max(1, Math.round(t.size * frame.k));
  return {
    size,
    lineHeight: size * t.leading,
    tracking: t.tracking * size,
    font: `${t.weight} ${size}px ${family}`,
    upper: t.upper === true,
  };
}

/**
 * Apply a level's tracking to the context.
 *
 * `letterSpacing` is part of the canvas drawing state, so it is stacked by
 * save/restore and — crucially — measureText accounts for it, which means
 * wrapping and auto-fit see the same widths that get painted. The first
 * attempt here drew tracked lines a character at a time instead; that honours
 * the tracking but destroys kerning, and since this system tracks headlines at
 * -0.03em it would have applied to every heading on every composed slide.
 *
 * On a browser too old to support it the assignment is an inert no-op, so the
 * slide renders untracked rather than wrong — and measurement and painting
 * still agree, because both go through the same context.
 */
function setTracking(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.letterSpacing = `${px}px`;
}

// -------------------------------------------------------------------------
//  Binding row content to spec slots
// -------------------------------------------------------------------------

const HEADING_LEVELS: ReadonlySet<TypeLevel> = new Set(["display", "headline"]);
const BODY_LEVELS: ReadonlySet<TypeLevel> = new Set(["subhead", "body"]);

interface BoundSlot extends LayoutSlot {
  /** The text actually drawn: the row's, falling back to the spec's. */
  content: string;
}

/**
 * Resolve each slot's text from the slide row. Body-level slots share
 * `bodyText`: when the archetype holds several of them (a list), its lines
 * fill them in order, which is what makes the body box in the editor edit a
 * list slide's items.
 */
export function bindSlots(spec: LayoutSpec, design: DesignState): BoundSlot[] {
  const bodyLines = design.bodyText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const bodySlots = spec.slots.filter((s) => BODY_LEVELS.has(s.level)).length;
  let bodyIdx = 0;

  return spec.slots.map((slot) => {
    let content: string;
    if (slot.level === "label") {
      content = (design.tagline ?? "").trim();
    } else if (HEADING_LEVELS.has(slot.level)) {
      content = design.headingText;
    } else if (bodySlots <= 1) {
      // One body slot takes the whole body, newlines and all.
      content = design.bodyText;
      bodyIdx++;
    } else {
      content = bodyLines[bodyIdx] ?? "";
      bodyIdx++;
    }
    // The model's own text stands in only where the row has nothing at all.
    return { ...slot, content: content.trim() ? content : slot.text };
  });
}

/**
 * The inverse of bindSlots: the row columns a freshly-composed spec should be
 * persisted into. The model writes its copy INTO the slots, and this pulls it
 * back out into the columns the editor edits — so what is saved round-trips
 * through bindSlots exactly, and slot text and row text can never disagree at
 * the moment a slide is created.
 */
export function rowFromSpec(spec: LayoutSpec): {
  headingText: string;
  bodyText: string;
  tagline: string | null;
} {
  const at = (pred: (level: TypeLevel) => boolean) =>
    spec.slots.filter((s) => pred(s.level)).map((s) => s.text.trim());
  const label = at((l) => l === "label");
  return {
    headingText: at((l) => HEADING_LEVELS.has(l)).join(" ").trim(),
    bodyText: at((l) => BODY_LEVELS.has(l)).filter(Boolean).join("\n"),
    tagline: label.find(Boolean) ?? null,
  };
}

// -------------------------------------------------------------------------
//  Painting a block of slots
// -------------------------------------------------------------------------

interface Block {
  /** Baseline of the first line. */
  height: number;
  paint: (topY: number) => number;
}

/**
 * Lay out the slots as a flush-left column, measuring first so the block can
 * be top-, centre- or bottom-anchored without painting twice.
 */
function buildBlock(
  ctx: CanvasRenderingContext2D,
  measure: MeasureText,
  slots: BoundSlot[],
  system: DesignSystem,
  frame: Frame,
  fonts: FontFamilies,
  x: number,
  design: DesignState,
  inkHex: string,
  accentHex: string,
  maxLinesFor: (slot: BoundSlot) => number,
): Block {
  interface Laid {
    slot: BoundSlot;
    step: Step;
    lines: string[];
    flags: boolean[] | null;
    height: number;
    gapAfter: number;
  }

  const laid: Laid[] = [];
  for (const slot of slots) {
    const family = HEADING_LEVELS.has(slot.level) ? fonts.heading : fonts.body;
    const base = stepFor(system, slot.level, frame, family);
    const maxWidth = frame.span(slot.span);
    const text = base.upper ? slot.content.toUpperCase() : slot.content;
    if (!text.trim()) continue;
    // Set before measuring, so wrapping and auto-fit see the painted widths.
    setTracking(ctx, base.tracking);

    if (HEADING_LEVELS.has(slot.level)) {
      // Headings auto-fit, and carry the operator's size override — the same
      // treatment every template gives a heading.
      const { clean, flags } = tokenizeHighlight(text);
      const weight = String(system.type[slot.level].weight);
      setTracking(ctx, base.tracking);
      const fit = autoFitHeading(
        measure,
        clean,
        weight,
        family,
        base.size,
        Math.max(1, Math.round(base.size * 0.5)),
        maxWidth,
        maxLinesFor(slot),
        design.headingScale,
      );
      const step: Step = {
        ...base,
        size: fit.size,
        lineHeight: fit.size * system.type[slot.level].leading,
        tracking: system.type[slot.level].tracking * fit.size,
        font: `${weight} ${fit.size}px ${family}`,
      };
      laid.push({
        slot,
        step,
        lines: fit.lines,
        flags: flags.some(Boolean) ? flags : null,
        height: fit.lines.length * step.lineHeight,
        gapAfter: fit.size * 0.42,
      });
    } else {
      const lines = wrapLines(measure, base.font, text, maxWidth);
      laid.push({
        slot,
        step: base,
        lines,
        flags: null,
        height: lines.length * base.lineHeight,
        gapAfter: base.size * 0.7,
      });
    }
  }

  const total = laid.reduce(
    (sum, l, i) => sum + l.height + (i < laid.length - 1 ? l.gapAfter : 0),
    0,
  );

  return {
    height: total,
    paint(topY: number) {
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      let y = topY;
      for (let i = 0; i < laid.length; i++) {
        const l = laid[i];
        const firstBaseline = y + l.step.size;
        setTracking(ctx, l.step.tracking);
        if (l.flags) {
          paintHighlightedLines(
            ctx,
            measure,
            l.lines,
            l.flags,
            l.step.font,
            x,
            firstBaseline,
            l.step.lineHeight,
            inkHex,
            accentHex,
          );
        } else {
          ctx.font = l.step.font;
          ctx.fillStyle = inkHex;
          paintLines(ctx, l.lines, x, firstBaseline, l.step.lineHeight);
        }
        y += l.height + (i < laid.length - 1 ? l.gapAfter : 0);
      }
      setTracking(ctx, 0);
      return y;
    },
  };
}

/** The one decorative move the grammar allows: a short rule in an accent
 *  value, above or below the text block. Timber divides and fills. */
function paintAccentRule(
  ctx: CanvasRenderingContext2D,
  spec: LayoutSpec,
  system: DesignSystem,
  frame: Frame,
  x: number,
  y: number,
  fallbackHex: string,
): void {
  if (!spec.accentRule) return;
  const hex = valueHex(system, spec.accentRule.value) ?? fallbackHex;
  const w = frame.column;
  const h = Math.max(2, Math.round(3 * frame.k));
  ctx.fillStyle = hex;
  ctx.fillRect(x, y, w, h);
}

/** Vertical space the accent rule and its clearance take. */
function ruleSpace(spec: LayoutSpec, frame: Frame): number {
  return spec.accentRule ? Math.max(2, Math.round(3 * frame.k)) + frame.gutter : 0;
}

// -------------------------------------------------------------------------
//  paintLayout
// -------------------------------------------------------------------------

/** Lines a heading may take, by archetype — the composition's own promise
 *  about how much room it laid out. */
function headingLines(spec: LayoutSpec): number {
  switch (spec.archetype) {
    case "statement":
      return 4;
    case "stat":
      return 2;
    case "split":
      return 5;
    default:
      return 4;
  }
}

export function paintLayout(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  spec: LayoutSpec,
  system: DesignSystem,
  design: DesignState,
  bg: HTMLImageElement | null,
  fonts: FontFamilies,
): void {
  ctx.save();
  const measure = canvasMeasure(ctx);
  const frame = frameFor(system, W);

  // The ground actually painted: the operator's backgroundColor wins over the
  // spec, because colour lives on the row. Falling back to the spec's ground,
  // then to the first ground the system declares, so a slide always has one.
  const groundHex =
    design.backgroundColor?.trim() ||
    valueHex(system, spec.ground) ||
    valueHex(system, system.grounds[0]?.value ?? "") ||
    "#ffffff";

  const showPhoto = spec.photo !== "none" && !!bg;
  const photoHalf = spec.photo === "half" && showPhoto;

  // A full-bleed photograph takes the whole slide and gets a scrim so type
  // stays readable; anything else sits on the flat ground.
  if (spec.photo === "full" && showPhoto) {
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design);
    bottomGradient(ctx, W, H, H * 0.4);
  } else {
    ctx.fillStyle = groundHex;
    ctx.fillRect(0, 0, W, H);
  }

  // Type colour: what this system puts on this ground, or white over a
  // full-bleed photograph, where the scrim is the ground.
  const overPhoto = spec.photo === "full" && showPhoto;
  const inkHex = overPhoto
    ? "#ffffff"
    : (defaultTypeValue(system, groundHex)?.hex ?? "#000000");
  const accentHex = design.accentColor;

  const slots = bindSlots(spec, design);

  // The text column. A split slide takes the half the photo does not.
  let textX = frame.margin;
  let textW = W - frame.margin * 2;
  if (photoHalf) {
    const half = W / 2;
    const side = spec.photoSide ?? "right";
    if (side === "right") {
      paintBackground(ctx, bg, { x: half, y: 0, w: half, h: H }, design);
      textX = frame.margin;
    } else {
      paintBackground(ctx, bg, { x: 0, y: 0, w: half, h: H }, design);
      textX = half + frame.margin;
    }
    textW = half - frame.margin * 2;
  }

  // Slots may not span wider than the column they sit in.
  const maxCols = Math.max(
    1,
    Math.floor((textW + frame.gutter) / (frame.column + frame.gutter)),
  );
  const fitted = slots.map((s) => ({ ...s, span: Math.min(s.span, maxCols) }));

  const block = buildBlock(
    ctx,
    measure,
    fitted,
    system,
    frame,
    fonts,
    textX,
    design,
    inkHex,
    accentHex,
    () => headingLines(spec),
  );

  // Vertical anchoring is the archetype's own decision.
  const rule = ruleSpace(spec, frame);
  const above = spec.accentRule?.place === "above";
  const contentHeight = block.height + rule;
  let top: number;
  switch (spec.archetype) {
    case "statement":
      // Anchored to the bottom, the way a full-bleed statement reads.
      top = H - frame.margin - contentHeight;
      break;
    case "stack":
    case "list":
      top = frame.margin * 1.6;
      break;
    default:
      // quote, stat, split — optically centred, a touch above true centre.
      top = (H - contentHeight) / 2 - frame.margin * 0.2;
      break;
  }
  top = Math.max(frame.margin, top);

  if (above) {
    paintAccentRule(ctx, spec, system, frame, textX, top, accentHex);
    block.paint(top + rule);
  } else {
    const end = block.paint(top);
    paintAccentRule(ctx, spec, system, frame, textX, end + frame.gutter, accentHex);
  }

  ctx.restore();
}
