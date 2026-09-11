/**
 * The six authored design directions. Data only, zero runtime imports.
 *
 * Each is a transcription of a set of decisions someone made and then LOOKED
 * AT as rendered slides -- not a palette with a name on it. The defaults are
 * the direction's own look for the picker; a tenant replaces them slot by
 * slot with their brand colours and the structure stays.
 *
 * SAGE_FIELD is Optimal Health's system with the hexes lifted into slots, and
 * directions.test.ts pins that it composes back to the hand-authored preset
 * byte for byte. The other five are distinct in TYPEFACE and STRUCTURE, not
 * just colour -- six directions in one face would be six colour schemes.
 *
 * Shares are ceilings (fraction of a set) and need not sum to 1; maxRun is
 * how many consecutive slides may carry that ground.
 */
import type { DesignDirection } from "./direction";

export const SAGE_FIELD: DesignDirection = {
  id: "sage-field",
  name: "Sage Field",
  blurb: "Calm, clinical warmth. Plaster and sage grounds, ink type, a timber accent that is never text.",
  font: "Inter",
  slots: [
    { key: "sage", label: "Signature ground", role: "ground", defaultHex: "#c7d2bb", ground: { share: 0.33, maxRun: 1 } },
    { key: "ink", label: "Type, and the anchor ground", role: "type", defaultHex: "#24231f", ground: { share: 0.17, maxRun: 2 } },
    { key: "plaster", label: "Main ground", role: "ground", defaultHex: "#f2f3ed", ground: { share: 0.5, maxRun: 3 } },
    { key: "timber", label: "Accent (rules and fills, never text)", role: "accent", defaultHex: "#b0844f" },
    { key: "deep-green", label: "Secondary type", role: "type", defaultHex: "#5e6b4e" },
    { key: "navy", label: "Reserved (signage only)", role: "reserved", defaultHex: "#26334e" },
  ],
  type: {
    display: { size: 84, leading: 0.96, tracking: -0.035, weight: 600 },
    headline: { size: 64, leading: 1.02, tracking: -0.03, weight: 600 },
    subhead: { size: 30, leading: 1.26, tracking: -0.01, weight: 500 },
    body: { size: 21, leading: 1.52, tracking: 0, weight: 400 },
    label: { size: 15, leading: 1, tracking: 0.2, weight: 600, upper: true },
  },
  grid: { columns: 6, margin: 76, gutter: 28, field: 1080 },
  photo: { saturate: 0.52, contrast: 0.9, brightness: 1.06, wash: { slot: "timber", alpha: 0.07 } },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: ["timber"] },
  motifs: [
    "A composition anchored hard to the top or the bottom, with a large quiet field across the rest of the frame. The empty part is the design, not an unfinished slide.",
    "A single timber hairline rule under a heading, or crossing the full width. Never a box, never a card with a border.",
    "A full-bleed photograph with a panel of plaster or sage overlapping its lower third, type set inside that panel.",
    "A list as generously spaced rows stacked down the page, each separated by a hairline rather than shut inside a card.",
    "One word of the heading set in deep green while the rest is ink -- used once in a set, never on every slide.",
  ],
};

export const EDITORIAL: DesignDirection = {
  id: "editorial",
  name: "Editorial",
  blurb: "Magazine serif at scale. Paper and a warm tint, ink type, a deep red accent used sparingly.",
  font: "Playfair Display",
  slots: [
    { key: "paper", label: "Main ground", role: "ground", defaultHex: "#f5f1e8", ground: { share: 0.55, maxRun: 4 } },
    { key: "tint", label: "Second ground", role: "ground", defaultHex: "#e6dccb", ground: { share: 0.25, maxRun: 2 } },
    { key: "ink", label: "Type, and the dark ground", role: "type", defaultHex: "#1a1a1a", ground: { share: 0.2, maxRun: 1 } },
    { key: "accent", label: "Accent", role: "accent", defaultHex: "#8b2c2c" },
  ],
  type: {
    display: { size: 96, leading: 0.94, tracking: -0.02, weight: 600 },
    headline: { size: 68, leading: 1.0, tracking: -0.015, weight: 500 },
    subhead: { size: 32, leading: 1.25, tracking: 0, weight: 500 },
    body: { size: 22, leading: 1.5, tracking: 0, weight: 400 },
    label: { size: 14, leading: 1, tracking: 0.12, weight: 600, upper: true },
  },
  grid: { columns: 6, margin: 80, gutter: 24, field: 1080 },
  photo: { saturate: 0.7, contrast: 1.0, brightness: 1.0 },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
  motifs: [
    "A serif heading set large with a rule directly beneath it, the rule no wider than the text above it.",
    "A pull-quote slide: one sentence at display size with generous leading, a short rule above, nothing else on the ground.",
    "A drop-style opening: the first word or number very large, the sentence continuing beside it at body size.",
    "A photograph inset with a wide paper margin around it -- never bled to the edge -- with a small caption line beneath in the label style.",
    "A second-ground band cutting across the lower third, carrying the supporting sentence.",
  ],
};

export const BOLD: DesignDirection = {
  id: "bold",
  name: "Bold",
  blurb: "Oversized grotesk, black and white, one signal colour. Loud at thumbnail size.",
  font: "Archivo",
  slots: [
    { key: "black", label: "Main ground, and type on light", role: "ground", defaultHex: "#0a0a0a", ground: { share: 0.5, maxRun: 3 } },
    { key: "white", label: "Light ground, and type on dark", role: "ground", defaultHex: "#ffffff", ground: { share: 0.35, maxRun: 2 } },
    { key: "signal", label: "Signal colour (accent, and an occasional ground)", role: "accent", defaultHex: "#ffd400", ground: { share: 0.15, maxRun: 1 } },
  ],
  type: {
    display: { size: 120, leading: 0.9, tracking: -0.04, weight: 700 },
    headline: { size: 76, leading: 0.96, tracking: -0.03, weight: 700 },
    subhead: { size: 32, leading: 1.2, tracking: -0.01, weight: 600 },
    body: { size: 22, leading: 1.45, tracking: 0, weight: 500 },
    label: { size: 16, leading: 1, tracking: 0.16, weight: 700, upper: true },
  },
  grid: { columns: 4, margin: 64, gutter: 24, field: 1080 },
  photo: { saturate: 0.3, contrast: 1.15, brightness: 0.95, wash: { slot: "black", alpha: 0.1 } },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
  motifs: [
    "The heading so large the canvas crops a letter at an edge. Scale is the whole idea.",
    "A full-bleed block of the signal colour as the ground, with black type on it.",
    "Type stacked in three or four short lines, line height under 1, each line hard against the left margin.",
    "A number set enormous -- two hundred pixels or more -- with its label small and tight beside it.",
    "A hard split: the frame divided into two flat blocks of ground, type in the larger one.",
  ],
};

export const CLINICAL: DesignDirection = {
  id: "clinical",
  name: "Clinical",
  blurb: "Soft, precise, medical without being cold. Cloud and mist grounds, slate type, a teal signal.",
  font: "Manrope",
  slots: [
    { key: "cloud", label: "Main ground", role: "ground", defaultHex: "#f4f6f5", ground: { share: 0.6, maxRun: 4 } },
    { key: "mist", label: "Second ground", role: "ground", defaultHex: "#dfe7e4", ground: { share: 0.25, maxRun: 2 } },
    { key: "slate", label: "Type, and the dark ground", role: "type", defaultHex: "#1f2a2e", ground: { share: 0.15, maxRun: 1 } },
    { key: "deep", label: "Secondary type", role: "type", defaultHex: "#0f3b3a" },
    { key: "signal", label: "Accent", role: "accent", defaultHex: "#2f7f6f" },
  ],
  type: {
    display: { size: 80, leading: 0.98, tracking: -0.03, weight: 600 },
    headline: { size: 60, leading: 1.04, tracking: -0.02, weight: 600 },
    subhead: { size: 28, leading: 1.3, tracking: 0, weight: 500 },
    body: { size: 21, leading: 1.55, tracking: 0, weight: 400 },
    label: { size: 14, leading: 1, tracking: 0.18, weight: 600, upper: true },
  },
  grid: { columns: 8, margin: 72, gutter: 24, field: 1080 },
  photo: { saturate: 0.6, contrast: 0.95, brightness: 1.08, wash: { slot: "mist", alpha: 0.06 } },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
  motifs: [
    "A measured stack: heading, a thin signal rule, then body copy, each separated by even space, nothing overlapping.",
    "A photograph in a wide band across the middle of the frame with type above and below it.",
    "A definition row -- a short term in the signal colour, its explanation beside it in slate -- repeated down the page.",
    "A slide that is mostly quiet mist ground with one short sentence set at subhead size, centred vertically.",
    "A number and its unit set large on cloud, with a caption beneath explaining what was measured.",
  ],
};

export const SWISS: DesignDirection = {
  id: "swiss",
  name: "Swiss",
  blurb: "Grid, grotesk, red. Monochrome photography, black type, white ground, one hard accent.",
  font: "Space Grotesk",
  slots: [
    { key: "white", label: "Main ground", role: "ground", defaultHex: "#ffffff", ground: { share: 0.5, maxRun: 3 } },
    { key: "black", label: "Type, and the dark ground", role: "type", defaultHex: "#111111", ground: { share: 0.3, maxRun: 2 } },
    { key: "red", label: "Accent, and an occasional ground", role: "accent", defaultHex: "#c8001a", ground: { share: 0.2, maxRun: 1 } },
    { key: "grey", label: "Secondary type", role: "type", defaultHex: "#6b6b6b" },
  ],
  type: {
    display: { size: 100, leading: 0.92, tracking: -0.04, weight: 500 },
    headline: { size: 64, leading: 1.0, tracking: -0.03, weight: 500 },
    subhead: { size: 30, leading: 1.25, tracking: -0.01, weight: 500 },
    body: { size: 22, leading: 1.45, tracking: 0, weight: 400 },
    label: { size: 15, leading: 1, tracking: 0.1, weight: 500, upper: true },
  },
  grid: { columns: 12, margin: 60, gutter: 20, field: 1080 },
  photo: { saturate: 0, contrast: 1.1, brightness: 1.0 },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
  motifs: [
    "Everything locked to the grid: type starting exactly on a column edge, blocks spanning whole columns, nothing floating between them.",
    "A hairline rule running the full width of the frame, with the heading sitting hard against it.",
    "One red element per slide and no more -- a rule, a word, a small block. Never two.",
    "A monochrome photograph filling one half of the frame on the column line, type in the other half.",
    "A wide empty margin left deliberately unfilled on one side of the composition.",
  ],
};

export const WARM: DesignDirection = {
  id: "warm",
  name: "Warm",
  blurb: "Soft serif, cream and cocoa, terracotta. Feels like a good kitchen.",
  font: "Fraunces",
  slots: [
    { key: "cream", label: "Main ground", role: "ground", defaultHex: "#f7efe4", ground: { share: 0.5, maxRun: 3 } },
    { key: "terracotta", label: "Accent, and a warm ground", role: "accent", defaultHex: "#a34a2a", ground: { share: 0.3, maxRun: 1 } },
    { key: "cocoa", label: "Type, and the dark ground", role: "type", defaultHex: "#3b2a22", ground: { share: 0.2, maxRun: 2 } },
    { key: "olive", label: "Secondary type", role: "type", defaultHex: "#5c6b3a" },
  ],
  type: {
    display: { size: 88, leading: 0.96, tracking: -0.02, weight: 500 },
    headline: { size: 62, leading: 1.04, tracking: -0.01, weight: 500 },
    subhead: { size: 30, leading: 1.3, tracking: 0, weight: 500 },
    body: { size: 22, leading: 1.5, tracking: 0, weight: 400 },
    label: { size: 14, leading: 1, tracking: 0.14, weight: 600, upper: true },
  },
  grid: { columns: 6, margin: 76, gutter: 28, field: 1080 },
  photo: { saturate: 0.8, contrast: 0.95, brightness: 1.05, wash: { slot: "terracotta", alpha: 0.08 } },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
  motifs: [
    "A heading on a tinted card of the terracotta ground, the card inset from the canvas edges with cream around it.",
    "A photograph with generous cream margin and a caption line beneath it in olive.",
    "A short rule in terracotta under the first line of a heading, the width of a word or two.",
    "A list as stacked rows with a terracotta dot or dash marking each, plenty of space between them.",
    "A quiet slide: one sentence at subhead size on cream, low in the frame, everything else empty.",
  ],
};


/**
 * Evidence File -- the dossier. A paper ground with a running head and a page
 * counter, a serif headline with a marker highlight through the key phrase,
 * numbers set as a ledger, and photography cropped to a band rather than bled.
 *
 * The marker is explicitly never type: it is a highlighter, it sits BEHIND
 * words, and lime letters on paper are 1.15:1 -- unreadable. The derived check
 * would not catch it, because the colour passes on the ink ground.
 */
export const EVIDENCE_FILE: DesignDirection = {
  id: "evidence-file",
  name: "Evidence File",
  blurb: "A dossier. Paper, a serif headline with a marker highlight, numbers as a ledger, photography in a band.",
  font: "Playfair Display",
  bodyFont: "Inter",
  slots: [
    { key: "paper", label: "Main ground", role: "ground", defaultHex: "#f7f7f4", ground: { share: 0.7, maxRun: 4 } },
    { key: "ink", label: "Type, and the dark ground", role: "type", defaultHex: "#111111", ground: { share: 0.3, maxRun: 1 } },
    { key: "marker", label: "Highlighter (behind words, never text)", role: "accent", defaultHex: "#d4f000" },
    { key: "graphite", label: "Secondary type", role: "type", defaultHex: "#6b6b66" },
  ],
  type: {
    display: { size: 88, leading: 1.0, tracking: -0.02, weight: 600 },
    headline: { size: 62, leading: 1.04, tracking: -0.015, weight: 500 },
    subhead: { size: 28, leading: 1.3, tracking: 0, weight: 500 },
    body: { size: 22, leading: 1.5, tracking: 0, weight: 400 },
    label: { size: 13, leading: 1.2, tracking: 0.16, weight: 600, upper: true },
  },
  grid: { columns: 6, margin: 72, gutter: 24, field: 1080 },
  photo: { saturate: 0.75, contrast: 1.05, brightness: 1.0 },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: ["marker"] },
  motifs: [
    "A running head across the top: the business name at label size on the left, a slide counter like 02 / 08 on the right, with a hard rule directly beneath spanning the full width.",
    "A kicker above the heading at label size -- a short section name such as THE MECHANISM -- preceded by a small ring or dot in the accent.",
    "A marker highlight: a block of the highlighter colour sitting behind ONE line or phrase of the serif heading, with ink type on top. Use it once per slide at most.",
    "A short accent rule, roughly the width of a word, directly under the heading.",
    "A stat block: a numeral set very large inside a filled highlighter square, with a two-line caps label beside it.",
    "A ledger: a narrow left column of figures with a tiny caps label beside each, rows separated by hairlines.",
    "A photograph cropped to a wide letterbox band across the lower third, or to a tall column down the right-hand side. Never full bleed.",
    "A footer line at label size: the source or a note on the left, and SWIPE on the right.",
  ],
};

/**
 * Poster -- one photograph, one enormous condensed headline, nothing else.
 *
 * The references this came from get part of their force from grain and from
 * type passing behind the subject. satori has no filters and no masks, so
 * neither is available: what carries here is scale, crop and stacking.
 */
export const POSTER: DesignDirection = {
  id: "poster",
  name: "Poster",
  blurb: "One photograph, one enormous condensed headline, nothing else. Loudest of the set at thumbnail size.",
  font: "Anton",
  bodyFont: "Inter",
  slots: [
    { key: "black", label: "Main ground, and type on light", role: "ground", defaultHex: "#0b0b0b", ground: { share: 0.75, maxRun: 4 } },
    { key: "chalk", label: "Type on dark, and the light ground", role: "type", defaultHex: "#ffffff", ground: { share: 0.25, maxRun: 1 } },
    { key: "signal", label: "Signal colour, used once at most", role: "accent", defaultHex: "#d4f000" },
  ],
  type: {
    display: { size: 150, leading: 0.92, tracking: -0.01, weight: 400, upper: true },
    headline: { size: 104, leading: 0.94, tracking: -0.005, weight: 400, upper: true },
    subhead: { size: 30, leading: 1.24, tracking: 0, weight: 500 },
    body: { size: 22, leading: 1.45, tracking: 0, weight: 400 },
    label: { size: 14, leading: 1.2, tracking: 0.18, weight: 600, upper: true },
  },
  grid: { columns: 4, margin: 56, gutter: 20, field: 1080 },
  photo: { saturate: 0, contrast: 1.25, brightness: 0.85 },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
  motifs: [
    "A full-bleed photograph as the ground, with the headline laid straight over it in chalk -- no panel, no card, no box behind the type.",
    "The headline stacked in three to five short lines, each line its own child, line height under 0.9, every line hard against the left margin.",
    "The headline large enough that the canvas crops a letter at the left or the right edge.",
    "A scrim: a vertical rgba gradient from the black ground at the bottom to transparent at the top, sitting over the photograph and under the type, so the words stay readable.",
    "One short sentence-case line beneath the headline at subhead size, and nothing else on the slide.",
    "A single word of the headline in the signal colour while the rest is chalk. Once in a set, not on every slide.",
  ],
};

/**
 * Signal -- near-black, clinical, data-shaped. Accent words inside a white
 * headline, numbered section markers, and the furniture of a diagram:
 * annotation boxes with hairline borders, connector lines, method cards.
 */
export const SIGNAL: DesignDirection = {
  id: "signal",
  name: "Signal",
  blurb: "Near-black and clinical. A condensed headline with one word in the accent, numbered sections, diagram furniture.",
  font: "Anton",
  bodyFont: "Inter",
  slots: [
    { key: "void", label: "Main ground", role: "ground", defaultHex: "#08090b", ground: { share: 0.65, maxRun: 3 } },
    { key: "deep", label: "Second ground", role: "ground", defaultHex: "#101826", ground: { share: 0.35, maxRun: 2 } },
    { key: "chalk", label: "Type", role: "type", defaultHex: "#ffffff" },
    { key: "volt", label: "Accent", role: "accent", defaultHex: "#c8f000" },
    { key: "azure", label: "Second accent", role: "accent", defaultHex: "#4a9eff" },
    { key: "slate", label: "Secondary type", role: "type", defaultHex: "#8b93a1" },
  ],
  type: {
    display: { size: 96, leading: 0.92, tracking: -0.01, weight: 400, upper: true },
    headline: { size: 70, leading: 0.96, tracking: -0.005, weight: 400, upper: true },
    subhead: { size: 26, leading: 1.3, tracking: 0.01, weight: 600 },
    body: { size: 19, leading: 1.55, tracking: 0.02, weight: 500 },
    label: { size: 13, leading: 1.2, tracking: 0.2, weight: 600, upper: true },
  },
  grid: { columns: 8, margin: 64, gutter: 20, field: 1080 },
  photo: { saturate: 0.85, contrast: 1.2, brightness: 0.8, wash: { slot: "deep", alpha: 0.18 } },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
  motifs: [
    "A numbered section marker above the heading at label size, in the accent: a figure, a slash, then the section name -- 03 / THE BELIEF SHIFT.",
    "One or two words of the headline set in the accent while the rest is chalk, the accent words carrying the point of the sentence.",
    "A block of body copy set in capitals and centred -- for a definition or a caption, not for every paragraph on every slide.",
    "A figure set enormous with its unit or percent sign in the accent beside it, and a sentence beneath explaining what it measures.",
    "A method card: a rounded rectangle with a hairline border in the accent, a caps label inside it, and two or three short lines of detail.",
    "A thin accent line running from a label to the thing it marks, ending in a small filled square.",
    "A footer: the source at label size in slate, and SWIPE centred in the accent beneath it.",
    "A disclaimer strip along the very bottom inside a thin bordered box, tiny, in slate.",
  ],
};

export const DESIGN_DIRECTIONS: DesignDirection[] = [
  SAGE_FIELD,
  EDITORIAL,
  BOLD,
  CLINICAL,
  SWISS,
  WARM,
  EVIDENCE_FILE,
  POSTER,
  SIGNAL,
];

export function getDirection(id: string): DesignDirection | null {
  return DESIGN_DIRECTIONS.find((d) => d.id === id) ?? null;
}
