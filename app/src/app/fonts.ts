import {
  Bebas_Neue,
  Familjen_Grotesk,
  Hanken_Grotesk,
  Inter,
  Manrope,
  Playfair_Display,
  Space_Grotesk,
  Space_Mono,
} from "next/font/google";
import localFont from "next/font/local";

// Hanken Grotesk: a Content Studio design font (lib/image/fonts). The app's
// body text is San Francisco via --font-body in globals.css.
export const body = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-hanken",
});

// Technical monospace — labels, eyebrows, metadata, badges, nav.
export const mono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-mono",
});

// Heading / display face for the admin UI. Space Grotesk is a clean geometric
// grotesque chosen for legibility — it replaces Nebula as `--font-heading` so all
// UI headings read clearly. Nebula stays loaded below for brand/marketing assets.
export const heading = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-heading",
});

// Familjen Grotesk — the marketing-site brand face. Loaded here so the app logo
// (Logo.tsx) renders in the same font as adonisagent.ie, and so it's available
// as `--font-familjen` for any app surface. Google-hosted; next/font self-hosts.
export const familjen = Familjen_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
export const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

export const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-manrope",
});

export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-space-grotesk",
});

export const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-playfair",
});

export const bebasNeue = Bebas_Neue({
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
  variable: "--font-bebas",
});
