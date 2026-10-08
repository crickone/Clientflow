import "server-only";

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

import { configFor, FONTS_DIR, type AspectRatio } from "@/lib/video/captions";

const ffmpegPath: string = (ffmpegStatic as unknown as string) || "ffmpeg";

/**
 * The last three seconds of a video ad: the business's logo, the button's
 * words in a solid block, and how to reach them. Built per ad from that
 * business's own details (the old shared outro card carried one tenant's
 * name and number and was switched off for that reason).
 */
export async function renderAdEndCard(args: {
  aspectRatio: AspectRatio;
  output: string;
  workDir: string;
  logoPath: string | null;
  cta: string;
  contact: string;
  footer: string;
  seconds?: number;
}): Promise<void> {
  const cfg = configFor(args.aspectRatio);
  const W = cfg.width;
  const H = cfg.height;
  const font = path.join(FONTS_DIR, "ClashDisplay-Variable.ttf").replace(/\\/g, "/").replace(/:/g, "\\:");
  const esc = (t: string) => t.replace(/\\/g, "").replace(/'/g, "’").replace(/:/g, "\\:").replace(/%/g, "\\%");
  const ctaSize = Math.round(W * 0.07);
  const boxW = Math.round(W * 0.62);
  const boxH = Math.round(ctaSize * 2.1);
  const boxY = Math.round(H * 0.5);
  const text = [
    `drawbox=x=(iw-${boxW})/2:y=${boxY}:w=${boxW}:h=${boxH}:color=white@1:t=fill`,
    `drawtext=fontfile='${font}':text='${esc(args.cta)}':fontcolor=0x0c0d10:fontsize=${ctaSize}:x=(w-text_w)/2:y=${boxY}+(${boxH}-text_h)/2`,
    args.contact
      ? `drawtext=fontfile='${font}':text='${esc(args.contact)}':fontcolor=white:fontsize=${Math.round(W * 0.05)}:x=(w-text_w)/2:y=${boxY + boxH + Math.round(H * 0.05)}`
      : null,
    args.footer
      ? `drawtext=fontfile='${font}':text='${esc(args.footer)}':fontcolor=white@0.7:fontsize=${Math.round(W * 0.034)}:x=(w-text_w)/2:y=${boxY + boxH + Math.round(H * 0.05) + Math.round(W * 0.08)}`
      : null,
  ]
    .filter(Boolean)
    .join(",");

  const seconds = args.seconds ?? 3;
  const inputs = ["-y", "-f", "lavfi", "-i", `color=c=0x0c0d10:s=${W}x${H}:d=${seconds}:r=30`, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"];
  let filter: string;
  if (args.logoPath && fs.existsSync(args.logoPath)) {
    inputs.push("-i", args.logoPath);
    filter = `[0:v]format=yuv420p,${text}[bg];[2:v]scale=${Math.round(W * 0.42)}:-1:flags=lanczos[lg];[bg][lg]overlay=x=(W-w)/2:y=H*0.22[vout]`;
  } else {
    filter = `[0:v]format=yuv420p,${text}[vout]`;
  }
  await run(
    [...inputs, "-filter_complex", filter, "-map", "[vout]", "-map", "1:a", "-t", String(seconds), "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", args.output],
    args.workDir,
  );
}

/** Body then card, normalised to one frame rate, pixel shape and sample rate so concat accepts them. */
export async function appendEndCard(args: { body: string; card: string; output: string; workDir: string }): Promise<void> {
  await run(
    [
      "-y",
      "-i", args.body,
      "-i", args.card,
      "-filter_complex",
      "[0:v]fps=30,setsar=1,format=yuv420p[v0];[1:v]fps=30,setsar=1,format=yuv420p[v1];" +
        "[0:a]aresample=44100,aformat=channel_layouts=stereo[a0];[1:a]aresample=44100,aformat=channel_layouts=stereo[a1];" +
        "[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]",
      "-map", "[v]",
      "-map", "[a]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      args.output,
    ],
    args.workDir,
  );
}

function run(argv: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, argv, { cwd });
    let tail = "";
    child.stderr.on("data", (d) => {
      tail = (tail + d.toString()).slice(-3000);
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${tail.slice(-600)}`))));
  });
}
