import "server-only";

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

import type { AspectRatio } from "@/lib/video/captions";
import { configFor, FONTS_DIR } from "@/lib/video/captions";
import { resolveLogoPath } from "@/lib/branding";

const ffmpegPath: string = (ffmpegStatic as unknown as string) || "ffmpeg";

const CARDS_ROOT = path.join(process.cwd(), "data", "cards");

const BRAND = {
  bg: "0x0a0a0a",
  fg: "white",
  accent: "0x2ed8c3",
  business: "RENOVA",
  tagline: "CELLULAR HEALTH",
  outro1: "RENOVACELLULARHEALTH.IE",
  outro2: "083 867 2844",
  outro3: "CLONMEL, CO. TIPPERARY",
} as const;

function cardDir(aspectRatio: AspectRatio): string {
  return path.join(CARDS_ROOT, aspectRatio.replace(":", "x"));
}

export function getCardPaths(aspectRatio: AspectRatio): {
  intro: string;
  outro: string;
} {
  const dir = cardDir(aspectRatio);
  return {
    intro: path.join(dir, "intro.mp4"),
    outro: path.join(dir, "outro.mp4"),
  };
}

/**
 * Pre-render the branded intro and outro cards for this aspect ratio. When a
 * logo is configured under Settings → Branding, it replaces the "RENOVA"
 * wordmark on the intro and sits as a small mark above the contact details
 * on the outro. Otherwise the wordmark is drawn as text.
 *
 * Cards are cached by aspect ratio and invalidated by the branding API
 * (delete-on-upload). Each card has a silent stereo audio track so the
 * downstream concat keeps audio mapped uniformly.
 */
export async function ensureCards(
  aspectRatio: AspectRatio,
  fallbackWorkDir: string,
): Promise<void> {
  const dir = cardDir(aspectRatio);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const { intro, outro } = getCardPaths(aspectRatio);
  const cfg = configFor(aspectRatio);

  const nebula = path.join(FONTS_DIR, "Nebula-Regular.otf");
  const fontPath = fs.existsSync(nebula)
    ? nebula
    : path.join(FONTS_DIR, "Nebula-Hollow.otf");
  const logoPath = resolveLogoPath();

  // Intro is no longer a standalone card — it's a logo fade-in overlay drawn
  // by render.ts over the first ~1.6s of the actual footage. We intentionally
  // do NOT generate intro.mp4 here. The path is still surfaced via
  // getCardPaths so existing callers don't break.
  void intro;

  if (!fs.existsSync(outro)) {
    await renderCard({
      output: outro,
      duration: 3,
      width: cfg.width,
      height: cfg.height,
      fontPath,
      logo: logoPath
        ? {
            path: logoPath,
            // Smaller mark up top on the outro so the contact details have room.
            scaleExpr: `${Math.round(cfg.width * 0.36)}:-1`,
            x: "(W-w)/2",
            y: "H*0.14",
          }
        : null,
      lines: logoPath
        ? [
            {
              text: BRAND.outro1,
              color: BRAND.accent,
              size: Math.round(cfg.width * 0.045),
              y: "h*0.46",
            },
            {
              text: BRAND.outro2,
              color: BRAND.fg,
              size: Math.round(cfg.width * 0.07),
              y: "h*0.56",
            },
            {
              text: BRAND.outro3,
              color: BRAND.fg,
              size: Math.round(cfg.width * 0.038),
              y: "h*0.72",
            },
          ]
        : [
            {
              text: BRAND.business + "  " + BRAND.tagline,
              color: BRAND.fg,
              size: Math.round(cfg.width * 0.06),
              y: "h*0.30",
            },
            {
              text: BRAND.outro1,
              color: BRAND.accent,
              size: Math.round(cfg.width * 0.045),
              y: "h*0.46",
            },
            {
              text: BRAND.outro2,
              color: BRAND.fg,
              size: Math.round(cfg.width * 0.07),
              y: "h*0.56",
            },
            {
              text: BRAND.outro3,
              color: BRAND.fg,
              size: Math.round(cfg.width * 0.038),
              y: "h*0.72",
            },
          ],
      showAccentBar: false,
      workDir: fallbackWorkDir,
    });
  }
}

interface CardLine {
  text: string;
  color: string;
  size: number;
  y: string; // ffmpeg expression
}

interface CardLogo {
  path: string;
  scaleExpr: string; // e.g. "600:-1"
  x: string;
  y: string;
}

async function renderCard(args: {
  output: string;
  duration: number;
  width: number;
  height: number;
  fontPath: string;
  lines: CardLine[];
  logo: CardLogo | null;
  showAccentBar: boolean;
  workDir: string;
}): Promise<void> {
  const fontForFilter = args.fontPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  const drawtexts = args.lines.map((l) => {
    const escaped = l.text.replace(/'/g, "’").replace(/:/g, "\\:");
    return `drawtext=fontfile='${fontForFilter}':text='${escaped}':fontcolor=${l.color}:fontsize=${l.size}:x=(w-text_w)/2:y=${l.y}`;
  });
  const vfilterParts: string[] = [];
  if (drawtexts.length > 0) vfilterParts.push(drawtexts.join(","));
  if (args.showAccentBar) {
    const accentBarY = args.height * 0.42;
    vfilterParts.push(
      `drawbox=x=(w-w/6)/2:y=${accentBarY.toFixed(
        0,
      )}:w=w/6:h=4:color=${BRAND.accent}@1.0:t=fill`,
    );
  }

  const inputs: string[] = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${BRAND.bg}:s=${args.width}x${args.height}:d=${args.duration}:r=30`,
    "-f",
    "lavfi",
    "-i",
    `anullsrc=channel_layout=stereo:sample_rate=44100`,
  ];

  // The video filter chain ends in [vout]; with a logo we run drawtext on
  // the bg, then overlay the scaled logo on top.
  let filterComplex: string;
  if (args.logo) {
    inputs.push("-i", args.logo.path);
    const textChain =
      vfilterParts.length > 0 ? `,${vfilterParts.join(",")}` : "";
    filterComplex =
      `[0:v]format=yuva420p${textChain}[bg];` +
      `[2:v]scale=${args.logo.scaleExpr}:flags=lanczos[lg];` +
      `[bg][lg]overlay=x=${args.logo.x}:y=${args.logo.y}[vout]`;
  } else {
    filterComplex =
      vfilterParts.length > 0
        ? `[0:v]${vfilterParts.join(",")}[vout]`
        : `[0:v]copy[vout]`;
  }

  const ff = [
    ...inputs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-map",
    "1:a",
    "-t",
    String(args.duration),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    "-movflags",
    "+faststart",
    args.output,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, ff, { cwd: args.workDir });
    let stderrTail = "";
    child.stderr.on("data", (d) => {
      stderrTail += d.toString();
      if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `card render failed (${code}). Last stderr:\n${stderrTail.slice(
              -1500,
            )}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}
