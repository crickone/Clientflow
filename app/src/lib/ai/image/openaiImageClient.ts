import "server-only";

/**
 * The ONLY file that talks to OpenAI's image API — enforced by
 * meteredGuard.test.ts (the `images/edits` pattern is forbidden everywhere
 * else). Raw fetch on purpose, no SDK dependency — the same deliberate choice
 * as ./falClient and MailgunSender.
 *
 * WHY A SECOND IMAGE PROVIDER EXISTS. ./falClient generates a picture FROM
 * WORDS: FLUX 1.1 Pro takes a prompt and nothing else. An operator asking to
 * "replace the guy in the photo with a woman" is not asking for a new picture
 * from a description -- they are asking for THIS photograph, changed. That is
 * a different capability (instruction-based editing), and the model chosen for
 * it is gpt-image-2.5-sunburst, which OpenAI documents as the one to pick
 * "where editing precision matters most" (its sibling, -flare, is tuned for
 * fast generation instead).
 *
 * Generation stays on fal. This is only for edits.
 */

/** Recorded against the tenant's usage, so an edit is legible beside a
 *  generation in the usage breakdown rather than merged into it. */
export const EDIT_MODEL_ID = "openai:gpt-image-2.5-sunburst";

const EDIT_ENDPOINT = "https://api.openai.com/v1/images/edits";
const EDIT_MODEL = "gpt-image-2.5-sunburst";

/**
 * Published rates, in dollars per MILLION tokens, as of 2026-09-16.
 * gpt-image-2.5-sunburst and -flare are priced identically.
 *
 * These are the only numbers here that can silently go stale, which is why the
 * cost is computed from the usage the API ITSELF reports rather than from a
 * flat per-image constant like IMAGE_COST_CENTS: the token counts are exact
 * and come back with every response, so only the rate card can drift, and a
 * drifting rate card misprices by a percentage rather than by a multiple.
 */
const RATE_PER_MTOK = {
  imageInput: 8.0,
  textInput: 5.0,
  imageOutput: 30.0,
} as const;

/**
 * What an edit costs the tenant, in cents, from the usage the call reported.
 *
 * Rounded UP to the nearest cent, and never to zero: a charge of zero would
 * let an unbounded number of edits run under a cap that is measured in cents.
 */
export function editCostCents(usage: ImageEditUsage): number {
  const dollars =
    (usage.imageInputTokens * RATE_PER_MTOK.imageInput +
      usage.textInputTokens * RATE_PER_MTOK.textInput +
      usage.imageOutputTokens * RATE_PER_MTOK.imageOutput) /
    1_000_000;
  return Math.max(1, Math.ceil(dollars * 100));
}

export interface ImageEditUsage {
  imageInputTokens: number;
  textInputTokens: number;
  imageOutputTokens: number;
}

export function isImageEditConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY?.trim();
}

export class ImageEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageEditError";
  }
}

/** The sizes gpt-image-2.5 accepts for a square, landscape and portrait
 *  result. Custom sizes are allowed too, but these three cover every aspect
 *  ratio Content Studio renders, and the library re-processes the result
 *  anyway. */
export type EditSize = "1024x1024" | "1536x1024" | "1024x1536";

interface EditResponse {
  data?: Array<{ b64_json?: string }>;
  usage?: {
    input_tokens_details?: { image_tokens?: number; text_tokens?: number };
    output_tokens_details?: { image_tokens?: number };
  };
  error?: {
    message?: string;
    code?: string;
    moderation_details?: { moderation_stage?: string; categories?: string[] };
  };
}

/**
 * Edit one photograph with an instruction, returning the new bytes and what
 * the call actually cost in tokens.
 *
 * `fetchImpl` is injectable for tests; defaults to global fetch. Throws
 * ImageEditError on any API/shape failure, including a moderation refusal --
 * which is reported in the operator's words rather than as a raw code, because
 * "the picture was refused" and "the API is down" need different reactions
 * from them and look identical in a generic 500.
 *
 * The timeout is generous on purpose: a measured edit took 16.8 seconds at low
 * quality, and quality costs time. The route this sits behind allows 120s.
 */
export async function openaiEditImage(
  input: {
    image: Buffer;
    mimeType: string;
    prompt: string;
    size: EditSize;
    /** "high" is the default at the call site: these are published marketing
     *  assets, and the usage-based charge stays exact whatever is chosen. */
    quality: "low" | "medium" | "high";
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Buffer; usage: ImageEditUsage }> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new ImageEditError(
      "Photo editing isn't configured (OPENAI_API_KEY missing).",
    );
  }

  const form = new FormData();
  form.append("model", EDIT_MODEL);
  form.append("prompt", input.prompt);
  form.append("size", input.size);
  form.append("quality", input.quality);
  // "image[]", not "image": the endpoint takes a LIST of source images, and
  // the singular name is silently accepted by some clients and not by this
  // one. Sending the bytes as a real file part is required -- a JSON-encoded
  // binary is rejected.
  form.append(
    "image[]",
    new Blob([new Uint8Array(input.image)], { type: input.mimeType }),
    `photo.${input.mimeType === "image/png" ? "png" : "jpg"}`,
  );

  let res: Response;
  try {
    res = await fetchImpl(EDIT_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(110_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ImageEditError(`Photo editing failed to reach OpenAI: ${message}`);
  }

  const json = (await res.json().catch(() => null)) as EditResponse | null;

  if (json?.error) {
    if (json.error.code === "moderation_blocked") {
      const why = json.error.moderation_details?.categories?.join(", ");
      throw new ImageEditError(
        `That edit was refused by OpenAI's content check${why ? ` (${why})` : ""}. Try describing the change differently.`,
      );
    }
    throw new ImageEditError(
      json.error.message || `Photo editing failed (HTTP ${res.status}).`,
    );
  }
  if (!res.ok) {
    throw new ImageEditError(`Photo editing failed (HTTP ${res.status}).`);
  }

  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) {
    throw new ImageEditError("Photo editing returned no image.");
  }

  return {
    bytes: Buffer.from(b64, "base64"),
    usage: {
      imageInputTokens: json?.usage?.input_tokens_details?.image_tokens ?? 0,
      textInputTokens: json?.usage?.input_tokens_details?.text_tokens ?? 0,
      imageOutputTokens: json?.usage?.output_tokens_details?.image_tokens ?? 0,
    },
  };
}
