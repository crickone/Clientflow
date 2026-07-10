import {
  Bebas_Neue,
  Hanken_Grotesk,
  Inter,
  Manrope,
  Playfair_Display,
  Space_Grotesk,
  Space_Mono,
} from "next/font/google";
import localFont from "next/font/local";

// Primary body font — Renova brand baseline.
export const body = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-body",
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
