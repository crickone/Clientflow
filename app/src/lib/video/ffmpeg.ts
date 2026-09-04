import "server-only";

import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
// @ts-expect-error — ffprobe-static has no types
import ffprobeStatic from "ffprobe-static";

const ffmpegPath: string = (ffmpegStatic as unknown as string) || "ffmpeg";
const ffprobePath: string =
  (ffprobeStatic as { path?: string } | string | undefined as { path?: string })
    ?.path || "ffprobe";

export interface ProbeResult {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  /**
   * Display rotation in degrees (0 / 90 / 180 / 270). Phone cameras often
   * record portrait clips as landscape with a rotation tag telling players
   * how to flip them on display. We read this and apply a manual transpose
   * filter at render time so the orientation can't get stripped.
   */
  rotation: number;
}

/**
 * Snap a rotation to 0/90/180/270 in a 0..359 range. Exported for the test that
 * pins the sign convention — the branch feeding this used to skip a negation,
 * which put every phone clip 180 degrees out with nothing to catch it.
 */
export function normaliseRotation(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  // side_data_list values can be negative for clockwise display rotation;
  // normalise to a 0..359 range and snap to the nearest 90.
  const positive = ((raw % 360) + 360) % 360;
  return Math.round(positive / 90) * 90 % 360;
}

export async function probe(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ];
    const child = spawn(ffprobePath, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${code}: ${stderr}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as {
          format?: { duration?: string };
          streams?: Array<{
            codec_type?: string;
            width?: number;
            height?: number;
            tags?: { rotate?: string | number };
            side_data_list?: Array<{ rotation?: number | string }>;
          }>;
        };
        const duration = parsed.format?.duration
          ? Number(parsed.format.duration)
          : 0;
        const video = parsed.streams?.find((s) => s.codec_type === "video");

        // Detect display rotation, normalised to ONE convention across the app:
        // `rotation` is always the CLOCKWISE degrees needed to bring the stored
        // raster upright (what transposeFor() in render.ts expects, and what the
        // operator/AI rotation controls mean).
        //
        // The two metadata sources use OPPOSITE conventions, so they can't share
        // a code path:
        //   - side_data_list[].rotation is av_display_rotation_get(), documented
        //     as the COUNTER-clockwise angle of the transform. ffmpeg's own
        //     autorotate negates it (theta = -rotation) before choosing a
        //     transpose, so we must negate it too. An iPhone portrait clip
        //     reports -90 and needs transpose=1 (clockwise 90) => 90.
        //   - tags.rotate (legacy containers) is ALREADY that negated value, so
        //     it is used as-is.
        // Without the negation a phone clip came out 180 degrees from correct;
        // side_data wins whenever present, and modern ffprobe emits it for
        // essentially all phone footage, so that was the branch actually firing.
        let rotation = 0;
        if (video?.side_data_list) {
          const entry = video.side_data_list.find(
            (d) => d.rotation !== undefined && d.rotation !== null,
          );
          if (entry?.rotation !== undefined) {
            rotation = normaliseRotation(-Number(entry.rotation));
          }
        }
        if (rotation === 0 && video?.tags?.rotate !== undefined) {
          rotation = normaliseRotation(Number(video.tags.rotate));
        }

        resolve({
          durationSeconds: Number.isFinite(duration) ? duration : 0,
          width: video?.width ?? null,
          height: video?.height ?? null,
          rotation,
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Grab a single still frame as a JPEG. Used to show a clip's thumbnail and to
 * let a vision model judge which way is up on footage shot with the camera
 * physically turned (no rotation metadata to read — see detectOrientation).
 *
 * `atSec` is clamped into the clip; the seek happens before -i so it's fast
 * even on long files. `-noautorotate` keeps the frame in its STORED
 * orientation, which is what the detector must reason about (the same reason
 * render.ts passes it — our transpose filter is the single source of truth).
 */
export async function extractFrame(
  videoPath: string,
  outPath: string,
  atSec = 1,
  maxWidth = 640,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-noautorotate",
      "-ss",
      String(Math.max(0, atSec)),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-vf",
      `scale=${maxWidth}:-2:force_original_aspect_ratio=decrease`,
      "-q:v",
      "4",
      outPath,
    ];
    const child = spawn(ffmpegPath, args);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
        return;
      }
      resolve();
    });
  });
}

export async function extractAudio(
  videoPath: string,
  outPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // 16 kHz mono at 128 kbps — Whisper recommends 16 kHz, and a higher
    // bitrate noticeably reduces dropped words on softer / accented speech.
    // 25 MB upload limit still leaves us plenty of headroom for a 60s clip.
    const args = [
      "-y",
      "-i",
      videoPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "128k",
      outPath,
    ];
    const child = spawn(ffmpegPath, args);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
        return;
      }
      resolve();
    });
  });
}
