import "server-only";

/**
 * The ONLY file that talks to fal.ai — enforced by meteredGuard.test.ts (the
 * `fal.run` pattern is forbidden everywhere else). Raw fetch on purpose, no
 * SDK dependency — the same deliberate choice as MailgunSender.
 */

export const IMAGE_MODEL_ID = "fal:flux-1.1-pro";
/**
 * fal bills FLUX 1.1 Pro at $0.04 per rounded-up megapixel; every ASPECT_DIMS
 * size (lib/ai/image/prompt.ts) is under 1MP, so one image = one flat 4¢ unit.
 */
export const IMAGE_COST_CENTS = 4;

const FAL_ENDPOINT = "https://fal.run/fal-ai/flux-pro/v1.1";

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
 * Generate one JPEG with FLUX 1.1 Pro and return its bytes. `fetchImpl` is
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

  const res = await fetchImpl(FAL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${key}`,
    },
    body: JSON.stringify({
      prompt: input.prompt,
      image_size: { width: input.width, height: input.height },
      num_images: 1,
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
}
