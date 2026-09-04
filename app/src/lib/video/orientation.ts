import "server-only";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MODELS } from "@/lib/ai/client";
import { meteredCreateFailSoft } from "@/lib/ai/metered";
import { extractFrame, type ProbeResult } from "@/lib/video/ffmpeg";

/**
 * Orientation help for footage shot with the camera physically turned on its
 * side (e.g. a Sony A6400 rotated to film "portrait"). Unlike a phone — which
 * records portrait as a landscape frame plus a rotation flag we can just read
 * (see probe()) — a turned camera writes a genuinely landscape file with NO
 * metadata saying so. Nothing can know for certain which way is up, so we ask a
 * vision model to look at a frame and SUGGEST a rotation; the operator confirms
 * it before it sticks (the suggestion is never applied silently).
 */

/** A landscape clip with no rotation flag is the "maybe shot sideways" case. */
export function mayBeShotSideways(probe: Pick<ProbeResult, "width" | "height" | "rotation">): boolean {
  if (probe.rotation !== 0) return false; // the file already tells us — trust it
  const { width, height } = probe;
  if (!width || !height) return false;
  return width > height;
}

/**
 * Ask a vision model which way is up. Returns the CLOCKWISE rotation (in
 * degrees) that would bring the frame upright — 0 when the footage is already
 * correct (a genuine landscape shot), 90 or 270 when it was filmed sideways.
 *
 * Best-effort by design: routed through meteredCreateFailSoft, so an over-cap
 * tenant, missing API key, or any failure resolves to 0 ("no suggestion") and
 * the upload proceeds untouched. Never throws.
 */
export async function detectOrientation(
  videoPath: string,
  tenantId: number,
): Promise<0 | 90 | 180 | 270> {
  let framePath: string | null = null;
  try {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cs-orient-"));
    framePath = path.join(dir, "frame.jpg");
    await extractFrame(videoPath, framePath, 1, 640);
    const bytes = await fs.readFile(framePath);

    const result = await meteredCreateFailSoft<0 | 90 | 180 | 270>(
      { tenantId, agentKey: "video" },
      () => ({
        model: MODELS.haiku,
        max_tokens: 16,
        system:
          "You judge the orientation of a still frame taken from a video. " +
          "Some footage is filmed with the camera physically turned on its side, so the " +
          "image is stored sideways. Look at gravity cues: which way do people stand, " +
          "how are faces oriented, where is the floor/ceiling, which way does text read? " +
          "Answer with ONLY one number — the CLOCKWISE rotation in degrees needed to make " +
          "the image upright: 0 if it is already upright, 90, 180, or 270. No other words.",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: bytes.toString("base64") },
              },
              {
                type: "text",
                text: "What clockwise rotation makes this frame upright? Reply with only 0, 90, 180 or 270.",
              },
            ],
          },
        ],
      }),
      (text) => {
        const m = text.match(/\d{1,3}/);
        const n = m ? Number(m[0]) : 0;
        return n === 90 || n === 180 || n === 270 ? n : 0;
      },
      0,
      "video-orientation",
    );
    return result;
  } catch {
    return 0; // detection is a convenience — never block an upload on it
  } finally {
    if (framePath) {
      await fs.rm(path.dirname(framePath), { recursive: true, force: true }).catch(() => {});
    }
  }
}
