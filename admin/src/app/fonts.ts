import { Hanken_Grotesk, Space_Grotesk, Space_Mono } from "next/font/google";
import localFont from "next/font/local";

// ClientFlow brand display face — the Nebula wordmark ("ClientFlow" logo lockup).
export const nebula = localFont({
  src: "./fonts/Nebula-Regular.otf",
  display: "swap",
  variable: "--font-nebula",
});

// Primary body font — matches the main ClientFlow app baseline.
export const body = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-body",
});

// Technical monospace — labels, eyebrows, metadata, badges, nav, buttons.
export const mono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-mono",
});

// Heading / display face — clean geometric grotesque for UI headings.
export const heading = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-heading",
});
