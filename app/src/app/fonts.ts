import localFont from "next/font/local";

// Every face is loaded from files in ./fonts, including the Google ones
// (./fonts/google, Latin subset, variable where Google ships one). next/font/
// google downloads them from Google during every build, and Google started
// refusing Railway's builder (2026-10-09: three failed deploys in a row on
// "An error occurred in next/font"); a deploy must not depend on that. To add
// a weight or a face, download its woff2 from fonts.googleapis.com/css2 into
// ./fonts/google and list it here.

// Hanken Grotesk: a Content Studio design font (lib/image/fonts). The app's
// body text is San Francisco via --font-body in globals.css.
export const body = localFont({
  src: "./fonts/google/hanken-grotesk-300-700-normal.woff2",
  weight: "300 700",
  display: "swap",
  variable: "--font-hanken",
});

// Technical monospace — labels, eyebrows, metadata, badges, nav.
export const mono = localFont({
  src: [
    { path: "./fonts/google/space-mono-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/google/space-mono-700-normal.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-mono",
});

// Heading / display face for the admin UI. Space Grotesk is a clean geometric
// grotesque chosen for legibility — it replaces Nebula as `--font-heading` so all
// UI headings read clearly. Nebula stays loaded below for brand/marketing assets.
export const heading = localFont({
  src: "./fonts/google/space-grotesk-400-700-normal.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-heading",
});

// Familjen Grotesk — the marketing-site brand face. Loaded here so the app logo
// (Logo.tsx) renders in the same font as adonisagent.ie, and so it's available
// as `--font-familjen` for any app surface. Served from ./fonts/google.
export const familjen = localFont({
  src: "./fonts/google/familjen-grotesk-400-700-normal.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-familjen",
});

// Local display fonts already shipped in /fonts. Nebula is the marketing/brand
// display face (video + image cards reference it by name); it no longer drives
// the UI heading variable.
export const nebula = localFont({
  src: "./fonts/Nebula-Regular.otf",
  display: "swap",
  variable: "--font-nebula",
});

export const nebulaHollow = localFont({
  src: "./fonts/Nebula-Hollow.otf",
  display: "swap",
  variable: "--font-heading-hollow",
});

// Preon: the ADONIS logo face, the app's default heading font. The file is
// the DEMO cut -- letters and digits only, no punctuation -- so headings
// fall back to Space Grotesk for any other character (see lib/theme.ts).
export const preon = localFont({
  src: "./fonts/Preon.otf",
  display: "swap",
  variable: "--font-preon",
  // Letters only. Its digits read badly ("0" is a lowercase o) and it has no
  // punctuation or currency, so every figure, "€" and full stop comes from
  // Space Grotesk, the next face in --font-heading.
  declarations: [{ prop: "unicode-range", value: "U+0020, U+0041-005A, U+0061-007A" }],
  // No generated Arial stand-in: it sits between Preon and Space Grotesk in
  // the stack, sized for Preon, and caught every digit at the wrong size.
  adjustFontFallback: false,
});

export const clashDisplay = localFont({
  src: "./fonts/ClashDisplay-Variable.ttf",
  display: "swap",
  variable: "--font-clash",
  weight: "200 700",
});

// Google fonts available in the Content Studio font picker.
export const inter = localFont({
  src: "./fonts/google/inter-400-700-normal.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-inter",
});

export const manrope = localFont({
  src: "./fonts/google/manrope-400-700-normal.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-manrope",
});

export const spaceGrotesk = localFont({
  src: "./fonts/google/space-grotesk-400-700-normal.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-space-grotesk",
});

export const playfairDisplay = localFont({
  src: "./fonts/google/playfair-display-400-700-normal.woff2",
  weight: "400 700",
  display: "swap",
  variable: "--font-playfair",
});

export const bebasNeue = localFont({
  src: "./fonts/google/bebas-neue-400-normal.woff2",
  weight: "400",
  display: "swap",
  variable: "--font-bebas",
});
