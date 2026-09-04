import "server-only";

/**
 * Runway Gen-4 Turbo image-to-video — the second video provider, alongside
 * lib/ai/video/falVideoClient. Runway is NOT available through fal (their API
 * partnerships went elsewhere), so this talks to Runway's own API and needs its
 * own key. Chosen for b-roll because it holds up better on human motion, which
 * is what gym b-roll is.
 *
 * Metered by the same orchestrator as the fal path (lib/ai/video/generateBroll
 * → meterAndChargeFlat), so spend still runs through one place.
 *
 * Built with the failure mode that bit the fal client designed out: a
 * persistent polling error surfaces the API's OWN message instead of spinning
 * silently until a deadline and reporting a misleading "timed out".
 */

export const RUNWAY_MODEL_ID = "runway:gen4_turbo-i2v";
const API_BASE = "https://api.dev.runwayml.com/v1";
/** Runway pins the request format with a dated version header. */
const API_VERSION = "2024-11-06";

/** Gen-4 Turbo bills $0.05 per second of output. */
export function runwayCostCents(durationSec: 5 | 10): number {
  return durationSec === 10 ? 50 : 25;
}

const MAX_WAIT_MS = 360_000;
const POLL_INTERVAL_MS = 5_000;

export function isRunwayConfigured(): boolean {
  return !!process.env.RUNWAY_API_KEY?.trim();
}

export class RunwayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunwayError";
  }
}

/** Runway takes an explicit output shape; map the project's aspect onto it. */
export function runwayRatio(aspectRatio: string): string {
  return aspectRatio === "1:1" ? "960:960" : "720:1280";
}

interface TaskResponse {
  id?: string;
  status?: "PENDING" | "THROTTLED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  output?: string[];
  failure?: string;
  failureCode?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Animate a still into a clip and return the MP4 bytes.
 *
 * The photo goes as a base64 data URI rather than a public URL — client gym
 * photos must not be published to a bucket just to feed a model.
 */
export async function runwayGenerateVideo(
  input: {
    imageBytes: Buffer;
    imageMime: string;
    prompt: string;
    durationSec: 5 | 10;
    aspectRatio: string;
  },
  fetchImpl: typeof fetch = fetch,
  waiter: (ms: number) => Promise<unknown> = sleep,
): Promise<Buffer> {
  const key = process.env.RUNWAY_API_KEY?.trim();
  if (!key) {
    throw new RunwayError("Runway isn't configured (RUNWAY_API_KEY missing).");
  }
  const headers = {
    Authorization: `Bearer ${key}`,
    "X-Runway-Version": API_VERSION,
    "Content-Type": "application/json",
  };
  const dataUri = `data:${input.imageMime};base64,${input.imageBytes.toString("base64")}`;

  try {
    // 1. Start the task
    const startRes = await fetchImpl(`${API_BASE}/image_to_video`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "gen4_turbo",
        promptImage: dataUri,
        promptText: input.prompt,
        ratio: runwayRatio(input.aspectRatio),
        duration: input.durationSec,
      }),
      signal: AbortSignal.timeout(120_000), // this leg carries the photo
    });
    if (!startRes.ok) {
      const text = await startRes.text().catch(() => "");
      throw new RunwayError(`Runway error ${startRes.status}: ${text.slice(0, 200)}`);
    }
    const started = (await startRes.json()) as TaskResponse;
    const taskId = started.id;
    if (!taskId) throw new RunwayError("Runway returned no task id.");

    // 2. Poll the task
    const deadline = Date.now() + MAX_WAIT_MS;
    let consecutiveErrors = 0;
    let task: TaskResponse | null = null;
    while (Date.now() < deadline) {
      await waiter(POLL_INTERVAL_MS);
      const res = await fetchImpl(`${API_BASE}/tasks/${taskId}`, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const detail = `${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`;
        // A blip is fine; a persistent error means something is actually wrong,
        // and spinning to the deadline would report it as a timeout instead.
        if (++consecutiveErrors >= 3) {
          throw new RunwayError(`Runway status check failed — ${detail}`);
        }
        continue;
      }
      consecutiveErrors = 0;
      task = (await res.json()) as TaskResponse;
      if (task.status === "SUCCEEDED") break;
      if (task.status === "FAILED" || task.status === "CANCELED") {
        // Runway tells us WHY — pass it through rather than a generic failure.
        throw new RunwayError(
          `Runway ${task.status.toLowerCase()}: ${task.failure ?? task.failureCode ?? "no reason given"}`,
        );
      }
    }
    if (task?.status !== "SUCCEEDED") {
      throw new RunwayError("Runway generation timed out. Try again in a moment.");
    }

    const url = task.output?.[0];
    if (!url) throw new RunwayError("Runway returned no video URL.");

    const fileRes = await fetchImpl(url, { signal: AbortSignal.timeout(180_000) });
    if (!fileRes.ok) {
      throw new RunwayError(`Couldn't download the generated video (${fileRes.status}).`);
    }
    return Buffer.from(await fileRes.arrayBuffer());
  } catch (err) {
    if (err instanceof RunwayError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new RunwayError(`Runway generation failed: ${detail}`);
  }
}
