import "server-only";

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

import type { AspectRatio, CaptionConfig } from "@/lib/video/captions";
import {
  buildAssCaptions,
  configFor,
  findFont,
  FONTS_DIR,
} from "@/lib/video/captions";
import type { CutPlan } from "@/lib/ai/planCut";
import type { Transcript } from "@/lib/ai/transcribe";
import {
  buildTimeRemap,
  computeKeepRanges,
  DEFAULT_TRIM_CONFIG,
  remapWords,
  selectExpr,
} from "@/lib/video/trim";
import {
  layoutSegments,
  outputDuration,
  remapWordsThroughSegments,
  type MainSegment,
} from "@/lib/video/timeline";
import { ensureCards, getCardPaths } from "@/lib/video/cards";

const ffmpegPath: string = (ffmpegStatic as unknown as string) || "ffmpeg";

export interface RenderInput {
  mainPath: string;
  /** Detected display rotation of the main clip in degrees (0/90/180/270). */
  mainRotation?: number;
  brollAssets: Array<{
    assetId: number;
    filePath: string;
    /** Detected display rotation of this B-roll clip. */
    rotation?: number;
  }>;
  plan: CutPlan;
  transcript: Transcript;
  aspectRatio: AspectRatio;
  outputPath: string;
  workDir: string;
  captionFont?: string | null;
  /** Absolute path to background music track, or null for no music. */
  musicPath?: string | null;
  /** Music gain (0..1). Defaults to 0.2 when not provided. */
  musicVolume?: number | null;
  /**
   * The editable main-track cut: an ordered list of source-clip slices that
   * are split out and concatenated (in this order) to form the main stream.
   * When present this SUPERSEDES `autoTrimSilence` (the trim is already baked
   * into the segments) and supports reordering. B-roll insert times and the
   * transcript are expected in OUTPUT coordinates relative to these segments.
   */
  mainSegments?: MainSegment[];
  /** Cut long silences to a short pause. Legacy path when no `mainSegments`. */
  autoTrimSilence?: boolean;
  /** Bookend the reel with Renova intro + outro cards. */
  showIntroOutro?: boolean;
  /** Path to the business logo image (PNG/JPG). Used for the intro fade-in. */
  logoPath?: string | null;
  /** Total seconds the logo is visible at the start (fade + hold + fade). */
  introDurationSec?: number | null;
}

/**
 * Map a clockwise display rotation (0/90/180/270) to an ffmpeg filter
 * fragment that brings the frame upright. Returns an empty string for 0.
 */
function transposeFor(rotation: number | undefined): string {
  const r = ((Number(rotation) || 0) % 360 + 360) % 360;
  if (r === 90) return "transpose=1,";
  if (r === 180) return "transpose=1,transpose=1,";
  if (r === 270) return "transpose=2,";
  return "";
}

/**
 * Render the final MP4: main video scaled/cropped to target ratio, B-roll
 * cutaways overlaid at the planned times, kinetic word-by-word captions
 * burned in via libass. Optionally trims silences and bookends the result
 * with branded intro / outro cards.
 */
export async function renderProject(input: RenderInput): Promise<void> {
  const cfg = configFor(input.aspectRatio);
  const font = findFont(input.captionFont);

  if (font.file) {
    const src = path.join(FONTS_DIR, font.file);
    const dst = path.join(input.workDir, font.file);
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, dst);
      } catch (err) {
        console.warn(`[render] could not stage font ${font.file}:`, err);
      }
    }
  }

  // ── Main-track planning ───────────────────────────────────────────────
  // Two paths:
  //  • SEGMENTING (new): an explicit ordered segment list from the editor.
  //    We split the source into those slices and concat them — this supports
  //    reordering, which the legacy `select` expression cannot express.
  //  • LEGACY: auto-trim silence via a single keep-range `select`, or the
  //    untouched full clip. Kept for back-compat / projects without a timeline.
  const segments =
    input.mainSegments && input.mainSegments.length > 0
      ? input.mainSegments
      : null;
  const trimming = !segments && !!input.autoTrimSilence;
  const keepRanges = trimming
    ? computeKeepRanges(
        input.transcript.words,
        input.transcript.durationSeconds,
        DEFAULT_TRIM_CONFIG,
      )
    : [
        {
          start: 0,
          end: Math.max(input.transcript.durationSeconds || 1, 1),
        },
      ];
  const remap = buildTimeRemap(keepRanges);
  const effectiveDuration = segments
    ? Math.max(outputDuration(segments), 1)
    : trimming
      ? remap.newDuration
      : Math.max(input.transcript.durationSeconds || 1, 1);

  const renderWords = segments
    ? remapWordsThroughSegments(input.transcript.words, segments)
    : trimming
      ? remapWords(input.transcript.words, remap)
      : input.transcript.words;

  const ass = buildAssCaptions(renderWords, cfg, font.name);
  const assPath = path.join(input.workDir, "captions.ass");
  fs.writeFileSync(assPath, ass, "utf8");

  // ── Inputs ─────────────────────────────────────────────────────────────
  // -noautorotate before each video input disables ffmpeg's silent rotation
  // pass so our explicit transpose=... filter is the single source of truth.
  // Without this, ffmpeg can double-rotate (or strip rotation through the
  // filter graph) and we end up with sideways output.
  const ffArgs: string[] = ["-y", "-noautorotate", "-i", input.mainPath];
  const brollByAssetId = new Map(
    input.brollAssets.map((b) => [b.assetId, b]),
  );
  const inserts: Array<{
    inputIndex: number;
    startSec: number;
    endSec: number;
    rotation: number;
    /** Where to start playing in the b-roll source (defaults to 0). */
    sourceStart: number;
  }> = [];
  for (const ins of input.plan.brollInserts) {
    const asset = brollByAssetId.get(ins.brollAssetId);
    if (!asset) continue;
    // Plan times are already in output-timeline coordinates (the timeline
    // editor shows the trimmed duration when auto-trim is on). Don't remap.
    const startSec = ins.startSec;
    const endSec = ins.endSec;
    if (endSec - startSec < 0.4) continue;
    const inputIndex = inserts.length + 1;
    const sourceStart = Math.max(0, ins.brollStartSec ?? 0);
    // Input-level seek (-ss before -i) — far more reliable than a 'trim'
    // filter for picking which segment of the b-roll source to use, and
    // avoids decoding everything before the offset.
    if (sourceStart > 0) {
      ffArgs.push(
        "-noautorotate",
        "-ss",
        sourceStart.toFixed(3),
        "-i",
        asset.filePath,
      );
    } else {
      ffArgs.push("-noautorotate", "-i", asset.filePath);
    }
    inserts.push({
      inputIndex,
      startSec,
      endSec,
      rotation: asset.rotation ?? 0,
      sourceStart,
    });
  }

  let musicInputIndex: number | null = null;
  if (input.musicPath && fs.existsSync(input.musicPath)) {
    musicInputIndex = inserts.length + 1;
    ffArgs.push("-i", input.musicPath);
  }

  let logoInputIndex: number | null = null;
  const wantsLogoIntro =
    !!input.showIntroOutro &&
    !!input.logoPath &&
    fs.existsSync(input.logoPath);
  const introDuration = Math.max(
    0.5,
    Math.min(10, Number(input.introDurationSec ?? 1.6)),
  );
  if (wantsLogoIntro) {
    logoInputIndex =
      (musicInputIndex !== null
        ? musicInputIndex
        : inserts.length) + 1;
    // `-loop 1` turns the still image into a continuous video stream so the
    // fade filter has multiple frames to animate over. `-t` caps it so the
    // looped input doesn't outlive the overlay window.
    ffArgs.push(
      "-loop",
      "1",
      "-framerate",
      "30",
      "-t",
      (introDuration + 0.1).toFixed(2),
      "-i",
      input.logoPath as string,
    );
  }

  // ── Filter graph: video ────────────────────────────────────────────────
  const mainTranspose = transposeFor(input.mainRotation);
  const filters: string[] = [];
  if (segments) {
    // Split each segment out of the source, then concat in timeline order.
    // Scaling/cropping happens AFTER the concat so it runs once on the joined
    // stream. All slices come from the same input, so resolution/SAR match.
    // A filter input pad ([0:v]) can only be consumed once, so we `split` it
    // into one branch per segment first.
    const vins = segments.map((_, i) => `[vin${i}]`).join("");
    filters.push(`[0:v]split=${segments.length}${vins}`);
    const vlabels: string[] = [];
    segments.forEach((s, i) => {
      filters.push(
        `[vin${i}]trim=start=${s.sourceStart.toFixed(3)}:end=${s.sourceEnd.toFixed(
          3,
        )},setpts=PTS-STARTPTS[sv${i}]`,
      );
      vlabels.push(`[sv${i}]`);
    });
    filters.push(
      `${vlabels.join("")}concat=n=${segments.length}:v=1:a=0[catv]`,
    );
    filters.push(
      `[catv]${mainTranspose}scale=${cfg.width}:${cfg.height}:force_original_aspect_ratio=increase,crop=${cfg.width}:${cfg.height},setsar=1,fps=30[main]`,
    );
  } else if (trimming) {
    filters.push(
      `[0:v]select='${selectExpr(keepRanges)}',setpts=N/FRAME_RATE/TB,${mainTranspose}scale=${cfg.width}:${cfg.height}:force_original_aspect_ratio=increase,crop=${cfg.width}:${cfg.height},setsar=1,fps=30[main]`,
    );
  } else {
    filters.push(
      `[0:v]${mainTranspose}scale=${cfg.width}:${cfg.height}:force_original_aspect_ratio=increase,crop=${cfg.width}:${cfg.height},setsar=1,fps=30[main]`,
    );
  }
  for (const ins of inserts) {
    const brollTranspose = transposeFor(ins.rotation);
    // The source offset is already applied via -ss on the input (see above),
    // so the input stream's PTS already starts from the scrubbed-to point.
    // setpts at the end positions it at the right moment in the main timeline.
    filters.push(
      `[${ins.inputIndex}:v]${brollTranspose}scale=${cfg.width}:${cfg.height}:force_original_aspect_ratio=increase,crop=${cfg.width}:${cfg.height},setsar=1,fps=30,setpts=PTS-STARTPTS+${ins.startSec.toFixed(3)}/TB[b${ins.inputIndex}]`,
    );
  }
  let lastLabel = "main";
  for (let i = 0; i < inserts.length; i++) {
    const ins = inserts[i];
    const out = i === inserts.length - 1 ? "premerge" : `m${i + 1}`;
    filters.push(
      `[${lastLabel}][b${ins.inputIndex}]overlay=enable='between(t,${ins.startSec.toFixed(3)},${ins.endSec.toFixed(3)})':eof_action=pass[${out}]`,
    );
    lastLabel = out;
  }
  const sourceForCaptions = inserts.length === 0 ? "main" : "premerge";

  const assPathForFilter = escapeFilterPath(assPath);
  const captionedLabel = wantsLogoIntro ? "captioned" : "vout";
  filters.push(
    `[${sourceForCaptions}]subtitles='${assPathForFilter}':fontsdir='${escapeFilterPath(
      path.dirname(assPath),
    )}'[${captionedLabel}]`,
  );

  // Logo intro: fade the brand mark in over the first frames of the actual
  // footage, hold briefly, fade out. No standalone card → no dead frame.
  if (wantsLogoIntro && logoInputIndex !== null) {
    // Fades scale with total duration but stay snappy. For a 1.6s intro
    // that's 0.35s in / 0.9s hold / 0.35s out; for a 3s intro it's 0.4s in
    // / 2.2s hold / 0.4s out.
    const fadeIn = Math.min(0.45, Math.max(0.15, introDuration * 0.22));
    const fadeOutStart = Math.max(0, introDuration - fadeIn);
    const logoWidth = Math.round(cfg.width * 0.55);
    filters.push(
      `[${logoInputIndex}:v]format=rgba,scale=${logoWidth}:-1:flags=lanczos,` +
        `fade=t=in:st=0:d=${fadeIn.toFixed(2)}:alpha=1,` +
        `fade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeIn.toFixed(2)}:alpha=1[logo_anim]`,
    );
    filters.push(
      `[captioned][logo_anim]overlay=x=(W-w)/2:y=(H-h)/2:enable='between(t,0,${introDuration.toFixed(2)})':eof_action=pass[vout]`,
    );
  }

  // ── Filter graph: audio ────────────────────────────────────────────────
  // [main_audio] is the speaker's audio, cut/reordered to match the video.
  // When music is present we mix it on top → [aout].
  if (segments) {
    const ains = segments.map((_, i) => `[ain${i}]`).join("");
    filters.push(`[0:a]asplit=${segments.length}${ains}`);
    const alabels: string[] = [];
    segments.forEach((s, i) => {
      filters.push(
        `[ain${i}]atrim=start=${s.sourceStart.toFixed(3)}:end=${s.sourceEnd.toFixed(
          3,
        )},asetpts=PTS-STARTPTS[sa${i}]`,
      );
      alabels.push(`[sa${i}]`);
    });
    filters.push(
      `${alabels.join("")}concat=n=${segments.length}:v=0:a=1[main_audio]`,
    );
  } else if (trimming) {
    filters.push(
      `[0:a]aselect='${selectExpr(keepRanges)}',asetpts=N/SR/TB[main_audio]`,
    );
  }
  const hasMainAudioLabel = !!segments || trimming;
  const voiceLabel = hasMainAudioLabel ? "[main_audio]" : "[0:a]";
  let audioMapArg = hasMainAudioLabel ? "[main_audio]" : "0:a?";

  if (musicInputIndex !== null) {
    const fadeOutStart = Math.max(0, effectiveDuration - 1);
    const rawVol =
      typeof input.musicVolume === "number" ? input.musicVolume : 0.2;
    const vol = Math.max(0, Math.min(1, rawVol));
    filters.push(
      `[${musicInputIndex}:a]atrim=duration=${effectiveDuration.toFixed(
        2,
      )},asetpts=PTS-STARTPTS,volume=${vol.toFixed(
        3,
      )},afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeOutStart.toFixed(
        2,
      )}:d=1[mus]`,
    );
    filters.push(
      `${voiceLabel}[mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
    );
    audioMapArg = "[aout]";
  }

  ffArgs.push("-filter_complex", filters.join(";"));
  ffArgs.push("-map", "[vout]");
  ffArgs.push("-map", audioMapArg);
  ffArgs.push(
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
    "-movflags",
    "+faststart",
    "-shortest",
  );

  // The body filter graph already includes the optional logo fade-in
  // (controlled by wantsLogoIntro / input.showIntroOutro). The outro card
  // has been intentionally removed — videos end on the last frame of the
  // main content instead of a Renova card.
  ffArgs.push(input.outputPath);

  await runFfmpeg(ffArgs, input.workDir);
}

async function concatWithOutro(args: {
  body: string;
  outro: string;
  output: string;
  workDir: string;
}): Promise<void> {
  const ff = [
    "-y",
    "-i",
    args.body,
    "-i",
    args.outro,
    "-filter_complex",
    "[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[v][a]",
    "-map",
    "[v]",
    "-map",
    "[a]",
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
    "-movflags",
    "+faststart",
    args.output,
  ];
  await runFfmpeg(ff, args.workDir);
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function runFfmpeg(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Log the full command so the operator can see exactly what filters are
    // being applied — handy when an edit (e.g. trim / transpose) doesn't seem
    // to take effect in the rendered output.
    console.log(
      "[render] ffmpeg",
      args
        .map((a) =>
          a.includes(" ") || a.includes(";") || a.includes("[") ? `"${a}"` : a,
        )
        .join(" "),
    );
    const child = spawn(ffmpegPath, args, { cwd });
    let stderrTail = "";
    child.stderr.on("data", (d) => {
      stderrTail += d.toString();
      if (stderrTail.length > 4000) {
        stderrTail = stderrTail.slice(-4000);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg exited ${code}.\nLast stderr:\n${stderrTail.slice(-1500)}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

export { runFfmpeg, ffmpegPath };
export type { CaptionConfig };
