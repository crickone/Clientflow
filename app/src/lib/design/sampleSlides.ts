/**
 * Sample slides for previewing a design system. Pure: no model call, no DB.
 *
 * The point of a preview is that an operator judges a direction with THEIR
 * colours, as rendered slides, before it starts shaping every post -- numbers
 * on a settings page tell nobody what a headline looks like at feed size.
 *
 * COMPOSITIONS ARE PER DIRECTION. The first version of this file had three
 * fixed layouts rendered for every direction, which meant the picker showed
 * the same three shapes in different colours -- structurally incapable of
 * showing the thing the operator was choosing between, and the reason six
 * directions read as "the same with different colours". Each direction now
 * names three builders that demonstrate ITS motifs.
 *
 * Every builder follows the satori rules the prompt enforces: containers set
 * display:flex, leaves holding text do not, every text element has an explicit
 * width, and nothing enters the top-right corner the logo is stamped into.
 */
import type { DesignSystem, TypeLevel } from "./parse";
import { contrastRatio, defaultTypeValue } from "./validate";

const W = 1080;
const H = 1080;

/** The top-right corner the logo is stamped into after rendering. Sized from
 *  stampLogo's own geometry (a 7% margin and a 19% logo width, see
 *  renderDesign.ts) plus a small gap, so no text block can touch the logo's
 *  real box whatever the direction's margin. */
const LOGO_CORNER_W = Math.round(W * 0.19) + Math.round(W * 0.07) + 12;

/** Display and headline take the display face; everything smaller takes the body face. */
function faceFor(system: DesignSystem, level: TypeLevel): string {
  const isDisplay = level === "display" || level === "headline";
  return isDisplay ? system.font : (system.bodyFont ?? system.font);
}

/**
 * `alt` asks for the system's SECOND display face where it has one -- the
 * condensed cut a style uses for posters and figures while its editorial pages
 * stay serif. A system with one display face is unaffected.
 */
function css(
  system: DesignSystem,
  level: TypeLevel,
  colour: string,
  opts: { alt?: boolean; upper?: boolean } = {},
): string {
  const t = system.type[level];
  const face = opts.alt ? (system.altFont ?? faceFor(system, level)) : faceFor(system, level);
  return (
    `font-family:${face};font-size:${t.size}px;line-height:${t.leading};` +
    `letter-spacing:${t.tracking}em;font-weight:${t.weight};color:${colour};` +
    (t.upper || opts.upper ? "text-transform:uppercase;" : "")
  );
}

function groundHex(system: DesignSystem, i: number): string {
  const g = system.grounds[i % system.grounds.length];
  return system.values.find((v) => v.key === g.value)!.hex;
}

function typeOn(system: DesignSystem, ground: string): string {
  return defaultTypeValue(system, ground)?.hex ?? "#000000";
}

/**
 * An accent to FILL with -- a rule, a block, a highlighter. Any accent will
 * do, including one the system forbids as type: a highlighter is exactly a
 * colour you put behind words rather than into them.
 */
function accentFill(system: DesignSystem): string {
  return (
    system.values.find((v) => v.role === "accent")?.hex ??
    system.values.find((v) => v.role === "type")?.hex ??
    "#000000"
  );
}

/**
 * An accent to SET TYPE IN, on a given ground. Skips anything the system
 * forbids as type and anything that fails the large-text floor against that
 * ground, falling back to the ground's ordinary type colour.
 *
 * Without this the samples set a label and a percent sign in Evidence File's
 * highlighter on paper -- 1.15:1, effectively invisible -- which is the exact
 * mistake the system's own neverType rule exists to prevent. A preview that
 * breaks the brand's rules is worse than no preview.
 */
function accentText(system: DesignSystem, ground: string, which = 0): string {
  const usable = system.values.filter(
    (v) =>
      v.role === "accent" &&
      !system.rules.neverType.includes(v.key) &&
      contrastRatio(v.hex, ground) >= system.rules.minContrastLarge,
  );
  return (usable[which] ?? usable[0])?.hex ?? typeOn(system, ground);
}

interface Ctx {
  system: DesignSystem;
  /** Canvas margin, from the system's grid. */
  m: number;
  /** Widest a text block may be without entering the logo corner. */
  textWidth: number;
  ground: string;
  ink: string;
  /** Safe to set type in on this slide's ground. */
  accent: string;
  /** Safe to fill a block or rule with; may be a colour that must never carry type. */
  fill: string;
  /** A second type-safe accent where the system has one. */
  accent2: string;
}

type Builder = (c: Ctx) => string;

// ─── Builders ────────────────────────────────────────────────────────────────

/** Everything anchored to the bottom, a large quiet field above. */
const anchoredLow: Builder = ({ system, m, textWidth, ground, ink, accent }) =>
  `<div style="display:flex;flex-direction:column;justify-content:flex-end;position:relative;width:${W}px;height:${H}px;background:${ground};padding:${m}px;">` +
  `<span style="width:${textWidth}px;${css(system, "label", accent)}">Recovery</span>` +
  `<span style="width:${textWidth}px;margin-top:20px;${css(system, "display", ink)}">The pressure does the work, not the oxygen.</span>` +
  `</div>`;

/** A headline, a rule, a paragraph. The plainest thing a system can do. */
const ruleAndBody: Builder = ({ system, m, textWidth, ground, ink, fill }) =>
  `<div style="display:flex;flex-direction:column;justify-content:center;position:relative;width:${W}px;height:${H}px;background:${ground};padding:${m}px;">` +
  `<span style="width:${textWidth}px;${css(system, "headline", ink)}">Three sessions a week is not better than two.</span>` +
  `<div style="display:flex;width:120px;height:6px;margin-top:36px;background:${fill};"></div>` +
  `<span style="width:${textWidth}px;margin-top:36px;${css(system, "body", ink)}">Adaptation needs the gap between sessions. Stack them and the body never gets the chance to respond to the first one before the second arrives.</span>` +
  `</div>`;

/** A list as stacked rows, never side-by-side cards. */
const listRows: Builder = ({ system, m, textWidth, ground, ink, accent }) =>
  `<div style="display:flex;flex-direction:column;justify-content:center;position:relative;width:${W}px;height:${H}px;background:${ground};padding:${m}px;">` +
  `<span style="width:${textWidth}px;${css(system, "label", accent)}">What changes</span>` +
  `<span style="width:${textWidth}px;margin-top:32px;${css(system, "subhead", ink)}">Blood flow to tissue that red cells struggle to reach</span>` +
  `<span style="width:${textWidth}px;margin-top:24px;${css(system, "subhead", ink)}">Muscle tension, through the nervous system's response to touch</span>` +
  `<span style="width:${textWidth}px;margin-top:24px;${css(system, "subhead", ink)}">Sleep, which is where most of the recovery actually happens</span>` +
  `</div>`;

/**
 * The dossier page: running head with a counter and a rule, a kicker, a serif
 * headline with a marker highlight through one line, a short accent rule, and
 * a footer. Evidence File's whole grammar in one slide.
 */
const dossier: Builder = ({ system, m, textWidth, ground, ink, fill }) => {
  const grey = system.values.find((v) => v.role === "type" && v.hex !== ink)?.hex ?? ink;
  return (
    `<div style="display:flex;flex-direction:column;position:relative;width:${W}px;height:${H}px;background:${ground};padding:${m}px;">` +
    // Running head + counter, then a hard rule.
    `<div style="display:flex;flex-direction:row;justify-content:space-between;width:${W - m * 2}px;">` +
    `<span style="${css(system, "label", ink)}">Your business</span>` +
    `<span style="${css(system, "label", grey)}">02 / 08</span>` +
    `</div>` +
    `<div style="display:flex;width:${W - m * 2}px;height:3px;margin-top:12px;background:${ink};"></div>` +
    // Kicker.
    `<span style="width:${textWidth}px;margin-top:28px;${css(system, "label", ink)}">The mechanism</span>` +
    // Serif headline, second line marker-highlighted.
    `<span style="width:${textWidth}px;margin-top:16px;${css(system, "display", ink)}">One hormone.</span>` +
    `<div style="display:flex;margin-top:4px;padding:2px 10px;background:${fill};">` +
    `<span style="${css(system, "display", ink)}">Two receipts.</span>` +
    `</div>` +
    `<div style="display:flex;width:96px;height:5px;margin-top:14px;background:${fill};"></div>` +
    `<span style="width:${textWidth}px;margin-top:28px;${css(system, "body", ink)}">Your pancreas builds one molecule, then cuts it in half. The two pieces leave the cell together, one for one, every single time.</span>` +
    // Ledger.
    `<div style="display:flex;flex-direction:row;align-items:center;width:${textWidth}px;margin-top:32px;">` +
    `<div style="display:flex;padding:8px 18px;background:${fill};">` +
    `<span style="${css(system, "display", ink)}">6x</span>` +
    `</div>` +
    `<span style="width:360px;margin-left:24px;${css(system, "label", ink)}">Longer in the blood than the thing everyone measures</span>` +
    `</div>` +
    // Footer.
    `<div style="display:flex;flex-direction:row;justify-content:space-between;position:absolute;left:${m}px;bottom:${m}px;width:${W - m * 2}px;">` +
    `<span style="${css(system, "label", grey)}">Source: add your own</span>` +
    `<span style="${css(system, "label", ink)}">Swipe</span>` +
    `</div>` +
    `</div>`
  );
};

/** A poster: the ground filled, the headline enormous and stacked, one line beneath. */
const posterType: Builder = ({ system, m, ground, ink }) => {
  const lines = ["Every", "distance", "becomes a", "workout"];
  const width = W - m * 2;
  return (
    `<div style="display:flex;flex-direction:column;justify-content:flex-end;position:relative;width:${W}px;height:${H}px;background:${ground};padding:${m}px;">` +
    `<div style="display:flex;flex-direction:column;width:${width}px;">` +
    lines
      .map((l) => `<span style="width:${width}px;${css(system, "display", ink, { alt: true, upper: true })}">${l}</span>`)
      .join("") +
    `</div>` +
    `<span style="width:${width}px;margin-top:28px;${css(system, "subhead", ink)}">You stop seeing blocks and start seeing splits.</span>` +
    `</div>`
  );
};

/**
 * The signal card: a numbered section marker, a headline whose last line is in
 * the accent, capitalised centred body copy, a bordered method card and a
 * footer. Signal's grammar in one slide.
 */
const signalCard: Builder = ({ system, m, textWidth, ground, ink, accent, accent2 }) => {
  const second = accent2;
  const grey = system.values.find((v) => v.role === "type" && v.hex !== ink)?.hex ?? ink;
  return (
    `<div style="display:flex;flex-direction:column;position:relative;width:${W}px;height:${H}px;background:${ground};padding:${m}px;">` +
    `<span style="width:${textWidth}px;${css(system, "label", second)}">01 / The number</span>` +
    `<span style="width:${textWidth}px;margin-top:22px;${css(system, "display", ink)}">Don't chase a hormone.</span>` +
    `<span style="width:${textWidth}px;${css(system, "display", accent)}">Investigate the signal.</span>` +
    `<span style="width:${W - m * 2}px;margin-top:34px;text-align:center;${css(system, "body", ink)}">One reading is a moment, not a pattern. A number that sits outside the range on a single morning is a reason to look again, not a diagnosis.</span>` +
    // Method card.
    `<div style="display:flex;flex-direction:column;width:${textWidth}px;margin-top:34px;padding:20px 22px;border:1px solid ${second};border-radius:10px;">` +
    `<span style="${css(system, "label", second)}">How it was measured</span>` +
    `<span style="width:${textWidth - 60}px;margin-top:10px;${css(system, "body", grey)}">Fasted morning draw, same lab, two weeks apart.</span>` +
    `</div>` +
    // Footer.
    `<div style="display:flex;flex-direction:column;align-items:center;position:absolute;left:${m}px;bottom:${m}px;width:${W - m * 2}px;">` +
    `<span style="${css(system, "label", grey)}">Source: add your own</span>` +
    `<span style="margin-top:10px;${css(system, "label", accent)}">Swipe</span>` +
    `</div>` +
    `</div>`
  );
};

/** A figure set enormous with its unit in the accent, and a sentence beneath. */
const bigNumber: Builder = ({ system, m, textWidth, ground, ink, accent }) =>
  `<div style="display:flex;flex-direction:column;justify-content:center;position:relative;width:${W}px;height:${H}px;background:${ground};padding:${m}px;">` +
  `<span style="width:${textWidth}px;${css(system, "label", accent)}">01 / The number</span>` +
  `<div style="display:flex;flex-direction:row;align-items:flex-start;margin-top:14px;">` +
  `<span style="${css(system, "display", ink, { alt: true })}">54</span>` +
  `<span style="${css(system, "display", accent, { alt: true })}">%</span>` +
  `</div>` +
  `<span style="width:${textWidth}px;margin-top:26px;${css(system, "body", ink)}">More than half of the people who book a first session never book a second one. The gap is almost always the week after, not the session itself.</span>` +
  `</div>`;

const BUILDERS: Record<string, Builder> = {
  anchoredLow,
  ruleAndBody,
  listRows,
  dossier,
  posterType,
  signalCard,
  bigNumber,
};

/**
 * Which three compositions preview a direction. A direction not listed here
 * gets the plain three, which is the right default for a system whose motifs
 * have not been drawn yet.
 */
const PER_DIRECTION: Record<string, [string, string, string]> = {
  "sage-field": ["anchoredLow", "ruleAndBody", "listRows"],
  editorial: ["ruleAndBody", "anchoredLow", "bigNumber"],
  bold: ["posterType", "bigNumber", "anchoredLow"],
  clinical: ["ruleAndBody", "listRows", "bigNumber"],
  swiss: ["ruleAndBody", "bigNumber", "listRows"],
  warm: ["anchoredLow", "listRows", "ruleAndBody"],
  // One style, three of its slide types -- which is the point of the preview:
  // an operator judging Evidence needs to see that it MOVES between a paper
  // dossier page and a black poster, not three variations of one shape.
  evidence: ["dossier", "posterType", "bigNumber"],
};

const FALLBACK: [string, string, string] = ["anchoredLow", "ruleAndBody", "listRows"];

/**
 * Three sample slides for a system. `directionId` selects the compositions
 * that demonstrate that direction's motifs; omit it for the plain three.
 */
export function sampleSlides(system: DesignSystem, directionId?: string): string[] {
  const m = system.grid.margin;
  const textWidth = W - m - LOGO_CORNER_W;
  const keys = (directionId && PER_DIRECTION[directionId]) || FALLBACK;
  return keys.map((key, i) => {
    const ground = groundHex(system, i);
    return (BUILDERS[key] ?? BUILDERS.anchoredLow)({
      system,
      m,
      textWidth,
      ground,
      ink: typeOn(system, ground),
      accent: accentText(system, ground),
      accent2: accentText(system, ground, 1),
      fill: accentFill(system),
    });
  });
}
