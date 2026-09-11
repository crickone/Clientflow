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
 * Evidence -- one style, built from a real account's whole feed rather than
 * from one post.
 *
 * It was first modelled as three directions (a paper dossier, a black poster,
 * a data slide) because that is how the references LOOK at a glance. They are
 * one brand: the same lime, the same condensed cut, the same evidence-led
 * voice, using different slide types for different jobs. Splitting them made
 * three directions that shared a family resemblance and none of which was the
 * real thing. They are templates within a style, and that is how they are
 * modelled here.
 *
 * TWO GROUNDS AND TWO DISPLAY FACES, both deliberate: the dossier pages are
 * serif on paper, the posters and data slides are condensed caps on black, and
 * a carousel moves between them. That is the style, not an inconsistency.
 *
 * The lime is usable as type on black (15:1) and unusable on paper (1.15:1).
 * It is NOT in neverType, because forbidding it everywhere would lose the
 * accent headlines the style is known for -- the per-ground contrast floor is
 * what keeps it off paper.
 */
export const EVIDENCE: DesignDirection = {
  id: "evidence",
  name: "Evidence",
  blurb:
    "Evidence-led and high contrast. Serif dossier pages on paper, condensed caps on black, a marker highlight and one hot accent.",
  font: "Playfair Display",
  altFont: "Anton",
  bodyFont: "Inter",
  slots: [
    { key: "paper", label: "Light ground", role: "ground", defaultHex: "#f7f7f4", ground: { share: 0.5, maxRun: 2 } },
    { key: "black", label: "Dark ground", role: "ground", defaultHex: "#0b0b0b", ground: { share: 0.5, maxRun: 3 } },
    { key: "ink", label: "Type on light", role: "type", defaultHex: "#111111" },
    { key: "chalk", label: "Type on dark", role: "type", defaultHex: "#ffffff" },
    { key: "volt", label: "Accent and highlighter", role: "accent", defaultHex: "#d4f000" },
    { key: "azure", label: "Second accent", role: "accent", defaultHex: "#4a9eff" },
    { key: "graphite", label: "Secondary type", role: "type", defaultHex: "#6b6b66" },
  ],
  type: {
    display: { size: 88, leading: 1.0, tracking: -0.02, weight: 600 },
    headline: { size: 62, leading: 1.04, tracking: -0.015, weight: 500 },
    subhead: { size: 28, leading: 1.3, tracking: 0, weight: 500 },
    body: { size: 21, leading: 1.5, tracking: 0, weight: 400 },
    label: { size: 13, leading: 1.2, tracking: 0.16, weight: 600, upper: true },
  },
  grid: { columns: 6, margin: 72, gutter: 24, field: 1080 },
  photo: { saturate: 0.6, contrast: 1.15, brightness: 0.95 },
  rules: { minContrastBody: 4.5, minContrastLarge: 3, neverType: [] },
  motifs: [
    "A running head along the TOP LEFT: a short section label at label size with a slide counter like 02 / 08 beside it, and a hard rule directly beneath it spanning the full width. It never reaches the top-right corner -- the logo is stamped there, and the rule sits below the logo's box rather than across it.",
    "A kicker above the heading at label size -- a short section name such as THE MECHANISM -- preceded by a small ring or dot in the accent.",
    "A marker highlight: a block of the accent sitting behind ONE line or phrase of a serif heading, with ink type on top. Once per slide at most, and only on the light ground.",
    "One or two words of a condensed headline set in the accent while the rest is chalk, the accent words carrying the point of the sentence.",
    "A figure set very large with its unit or percent sign in the accent beside it.",
    "A thin accent line running from a label to the thing it marks, ending in a small filled square.",
    "A footer at label size: the source on the left in the secondary type, and SWIPE on the right.",
    "A hairline-bordered box in the accent holding a short caps label and two lines of detail.",
  ],
  templates: [
    {
      name: "Dossier page",
      structure:
        "Light ground. Running head and slide counter with a hard rule beneath, a kicker, a SERIF heading of one or two lines with a marker highlight behind one of them, a short accent rule, a paragraph of body copy with key terms in bold, and a footer on the very bottom edge. The column of copy runs DOWN TO the bottom margin -- this page is dense. If the copy is short, close it with a hairline-bordered detail box or a figure rather than leaving a band of nothing above the footer. The workhorse for explaining a mechanism.",
    },
    {
      name: "Poster",
      structure:
        "A photograph filling the whole canvas with a dark scrim over it, and a CONDENSED CAPS headline in chalk laid straight on top, stacked in three to five short lines, large enough that a letter is cropped by an edge. One sentence-case line beneath it. Nothing else.",
    },
    {
      name: "Data point",
      structure:
        "Dark ground. A numbered section marker in the accent, one figure set enormous in the condensed face with its unit in the accent, and two or three lines of body copy explaining what it measures. Optionally a hairline-bordered method box beneath.",
    },
    {
      name: "Ledger",
      structure:
        "Light ground. A narrow left column of figures in the serif face with a tiny caps label beside each, rows separated by hairlines, under a short heading. The rows run down to the bottom margin. For three to five related numbers that belong together.",
    },
    {
      name: "Definition list",
      structure:
        "Either ground. A short kicker, then three or four rows stacked down the page, each a term in the accent followed by its explanation in the body face. Separated by space or hairlines, never shut in cards and never side by side. The rows are spaced to fill the height between the kicker and the bottom margin, so the last one ends where the page does.",
    },
    {
      name: "Annotated figure",
      structure:
        "Dark ground. A photograph or figure with small caps labels placed around it, each joined to what it marks by a thin accent line ending in a filled square. A heading above or below, kept clear of the labels.",
    },
    {
      name: "Closing card",
      structure:
        "Dark ground. A condensed caps closing line with one phrase in the accent, a short prompt to save or share it in a hairline-bordered box, and a disclaimer strip in the secondary type along the very bottom.",
    },
  ],
};

export const DESIGN_DIRECTIONS: DesignDirection[] = [
  SAGE_FIELD,
  EDITORIAL,
  BOLD,
  CLINICAL,
  SWISS,
  WARM,
  EVIDENCE,
];

export function getDirection(id: string): DesignDirection | null {
  return DESIGN_DIRECTIONS.find((d) => d.id === id) ?? null;
}
