import "server-only";

/**
 * The ONLY file that talks to fal.ai for VIDEO — the sibling of
 * lib/ai/image/falClient.ts, and sanctioned in meteredGuard.test.ts for the
 * same reason: it is a reviewed provider chokepoint whose spend is metered by
 * its orchestrator (lib/ai/video/generateBroll.ts → meterAndChargeFlat), not an
 * escape hatch. Raw fetch on purpose, no SDK dependency.
 *
 * Image-to-video, deliberately: b-roll is generated FROM the client's own gym
 * photos so the footage is actually their business, rather than text-to-video
 * inventing a gym that doesn't exist.
 */

export const VIDEO_MODEL_ID = "fal:kling-2.5-turbo-pro-i2v";
const FAL_MODEL = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";

/**
 * fal bills this model per second of output ($0.07/s at time of writing), so a
 * clip is a flat unit: 35¢ for 5s, 70¢ for 10s. Priced per generation the same
 * way IMAGE_COST_CENTS prices an image.
 */
export const VIDEO_COST_CENTS_PER_5S = 35;
export function videoCostCents(durationSec: 5 | 10): number {
  return durationSec === 10 ? VIDEO_COST_CENTS_PER_5S * 2 : VIDEO_COST_CENTS_PER_5S;
}

const QUEUE_BASE = "https://queue.fal.run";
/** Generation typically lands in 1–3 min; give it 6 before calling it failed. */
const MAX_WAIT_MS = 360_000;
const POLL_INTERVAL_MS = 5_000;

export function isVideoGenConfigured(): boolean {
  return !!process.env.FAL_KEY?.trim();
}

export class VideoGenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoGenError";
  }
}

interface QueueSubmitResponse {
  request_id?: string;
}
interface QueueStatusResponse {
  status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
}
interface VideoResultResponse {
  video?: { url?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Animate a still photo into a short clip and return the MP4 bytes.
 *
 * The source photo is passed as a base64 data URI rather than a public URL —
 * client gym photos live behind auth on the volume and must never be published
 * to a bucket just to feed a model.
 *
 * Uses fal's QUEUE api (submit → poll → fetch), not the synchronous endpoint the
 * image client uses, because video generation takes minutes. `fetchImpl` is
 * injectable for tests. Throws VideoGenError on any failure; callers map it to
 * a failed asset row.
 */
export async function falGenerateVideo(
  input: {
    imageBytes: Buffer;
    imageMime: string;
    prompt: string;
    durationSec: 5 | 10;
  },
  fetchImpl: typeof fetch = fetch,
  waiter: (ms: number) => Promise<unknown> = sleep,
): Promise<Buffer> {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new VideoGenError("Video generation isn't configured (FAL_KEY missing).");
  }
  const auth = { Authorization: `Key ${key}` };
  const dataUri = `data:${input.imageMime};base64,${input.imageBytes.toString("base64")}`;

  try {
    // 1. Submit
    const submitRes = await fetchImpl(`${QUEUE_BASE}/${FAL_MODEL}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: input.prompt,
        image_url: dataUri,
        duration: String(input.durationSec),
      }),
      signal: AbortSignal.timeout(120_000), // the upload leg carries the photo
    });
    if (!submitRes.ok) {
      const text = await submitRes.text().catch(() => "");
      throw new VideoGenError(`Video API error ${submitRes.status}: ${text.slice(0, 200)}`);
    }
    const submitted = (await submitRes.json()) as QueueSubmitResponse;
    const requestId = submitted.request_id;
    if (!requestId) throw new VideoGenError("Video API returned no request id.");

    // 2. Poll until COMPLETED (or we give up)
    const deadline = Date.now() + MAX_WAIT_MS;
    let completed = false;
    while (Date.now() < deadline) {
      await waiter(POLL_INTERVAL_MS);
      const statusRes = await fetchImpl(
        `${QUEUE_BASE}/${FAL_MODEL}/requests/${requestId}/status`,
        { headers: auth, signal: AbortSignal.timeout(30_000) },
      );
      if (!statusRes.ok) continue; // transient — keep waiting until the deadline
      const status = (await statusRes.json()) as QueueStatusResponse;
      if (status.status === "COMPLETED") {
        completed = true;
        break;
      }
    }
    if (!completed) {
      throw new VideoGenError("Video generation timed out. Try again in a moment.");
    }

    // 3. Fetch the result, then download the file
    const resultRes = await fetchImpl(`${QUEUE_BASE}/${FAL_MODEL}/requests/${requestId}`, {
      headers: auth,
      signal: AbortSignal.timeout(60_000),
    });
    if (!resultRes.ok) {
      const text = await resultRes.text().catch(() => "");
      throw new VideoGenError(`Video result error ${resultRes.status}: ${text.slice(0, 200)}`);
    }
    const result = (await resultRes.json()) as VideoResultResponse;
    const url = result.video?.url;
    if (!url) throw new VideoGenError("Video API returned no video.");

    const fileRes = await fetchImpl(url, { signal: AbortSignal.timeout(180_000) });
    if (!fileRes.ok) {
      throw new VideoGenError(`Couldn't download the generated video (${fileRes.status}).`);
    }
    return Buffer.from(await fileRes.arrayBuffer());
  } catch (err) {
    if (err instanceof VideoGenError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new VideoGenError(`Video generation failed: ${detail}`);
  }
}
