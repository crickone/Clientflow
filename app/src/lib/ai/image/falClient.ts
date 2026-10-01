import "server-only";

/**
 * The ONLY file that talks to fal.ai — enforced by meteredGuard.test.ts (the
 * `fal.run` pattern is forbidden everywhere else). Raw fetch on purpose, no
 * SDK dependency — the same deliberate choice as MailgunSender.
 */

export const IMAGE_MODEL_ID = "fal:flux-2-pro";
/**
 * fal bills FLUX.2 [pro] at $0.03 for the first megapixel and $0.015 for each
 * additional one, rounded up. Every ASPECT_DIMS size (lib/ai/image/prompt.ts)
 * is under 1MP, so one image = one flat 3¢ unit.
 *
 * FLUX 1.1 Pro (fal-ai/flux-pro/v1.1, 4¢) until 2026-10-01, when the operator
 * moved post backgrounds to FLUX.2: the newer generation, at a cent less per
 * image. Checked against fal's published schema for fal-ai/flux-2-pro.
 */
export const IMAGE_COST_CENTS = 3;

const FAL_ENDPOINT = "https://fal.run/fal-ai/flux-2-pro";

export function isImageGenConfigured(): boolean {
  return !!process.env.FAL_KEY?.trim();
}

export class ImageGenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGenError";
  }
}

interface FalImageResponse {
  images?: Array<{ url?: string }>;
}

/**
 * Generate one JPEG with FLUX.2 Pro and return its bytes. `fetchImpl` is
 * injectable for tests; defaults to global fetch. Throws ImageGenError on any
 * API/shape failure — callers map it to image_status='failed' (queue) or a
 * 500 (sync route). 60s timeout on each leg; the sync fal.run call typically
 * returns in ~5–10s.
 */
export async function falGenerateImage(
  input: { prompt: string; width: number; height: number },
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new ImageGenError("Image generation isn't configured (FAL_KEY missing).");
  }

  try {
    const res = await fetchImpl(FAL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${key}`,
      },
      body: JSON.stringify({
        prompt: input.prompt,
        // FLUX.2 Pro takes a {width, height} object in multiples of 16; the
        // ASPECT_DIMS sizes are multiples of 32. It has no `num_images` --
        // one request is one image -- so that field, which FLUX 1.1 took, is
        // gone rather than sent to be ignored.
        image_size: { width: input.width, height: input.height },
        output_format: "jpeg",
        enable_safety_checker: true,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ImageGenError(`Image API error ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as FalImageResponse;
    const url = json.images?.[0]?.url;
    if (!url) throw new ImageGenError("Image API returned no image.");

    const imgRes = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
    if (!imgRes.ok) {
      throw new ImageGenError(`Couldn't download the generated image (${imgRes.status}).`);
    }
    return Buffer.from(await imgRes.arrayBuffer());
  } catch (err) {
    if (err instanceof ImageGenError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new ImageGenError(`Image generation failed: ${detail}`);
  }
}
