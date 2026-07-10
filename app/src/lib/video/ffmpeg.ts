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

function normaliseRotation(raw: number): number {
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

        // Detect display rotation. Modern ffmpeg writes the rotation under
        // side_data_list[].rotation (often negative for clockwise display);
        // older containers put it in tags.rotate (positive degrees).
        let rotation = 0;
        if (video?.side_data_list) {
          const entry = video.side_data_list.find(
            (d) => d.rotation !== undefined && d.rotation !== null,
          );
          if (entry?.rotation !== undefined) {
            rotation = normaliseRotation(Number(entry.rotation));
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
