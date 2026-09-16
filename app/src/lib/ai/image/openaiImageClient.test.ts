// Run: npm test -- src/lib/ai/image/openaiImageClient.test.ts
//
// The OpenAI image-EDIT chokepoint. Nothing here reaches the network: the
// fetch is injected, which is the whole reason openaiEditImage takes one.
//
// The numbers in the cost checks come from a REAL measured call
// (gpt-image-2.5-sunburst, low quality, 1024x1024, 2026-09-16), so the
// arithmetic is pinned against usage the API actually returned rather than a
// shape invented here.
import assert from "node:assert/strict";

import {
  EDIT_MODEL_ID,
  ImageEditError,
  editCostCents,
  isImageEditConfigured,
  openaiEditImage,
} from "./openaiImageClient";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}
async function throwsWith(fn: () => Promise<unknown>, needle: string): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (err) {
    return err instanceof ImageEditError && err.message.includes(needle);
  }
}

/** Sets OPENAI_API_KEY for the duration of `fn`, restoring it after. */
async function withKey(value: string | undefined, fn: () => Promise<void>) {
  const original = process.env.OPENAI_API_KEY;
  if (value === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = value;
  try {
    await fn();
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
}

const OK_BODY = {
  data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }],
  usage: {
    input_tokens_details: { image_tokens: 1452, text_tokens: 28 },
    output_tokens_details: { image_tokens: 196 },
  },
};
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const IMAGE = Buffer.from("source-photo-bytes");
const INPUT = {
  image: IMAGE,
  mimeType: "image/jpeg",
  prompt: "Replace the person with a woman.",
  size: "1024x1024" as const,
  quality: "high" as const,
};

(async () => {
  // ── Cost ──────────────────────────────────────────────────────────────────
  // 1452 image-in @ $8/Mtok + 28 text-in @ $5/Mtok + 196 image-out @ $30/Mtok
  //   = $0.011616 + $0.00014 + $0.00588 = $0.017636 -> 2c rounded up.
  check(
    "a measured low-quality edit costs 2c",
    editCostCents({ imageInputTokens: 1452, textInputTokens: 28, imageOutputTokens: 196 }) === 2,
  );
  check(
    "image OUTPUT dominates, so quality is what moves the price",
    editCostCents({ imageInputTokens: 1452, textInputTokens: 28, imageOutputTokens: 3200 }) >
      3 * editCostCents({ imageInputTokens: 1452, textInputTokens: 28, imageOutputTokens: 196 }),
  );
  // A charge of zero would let an unbounded number of edits run under a cap
  // that is counted in cents.
  check(
    "a free-looking edit still costs at least a cent",
    editCostCents({ imageInputTokens: 0, textInputTokens: 0, imageOutputTokens: 0 }) === 1,
  );
  check(
    "the cost is rounded UP, never down to the tenant's advantage",
    editCostCents({ imageInputTokens: 100_000, textInputTokens: 0, imageOutputTokens: 0 }) === 80,
  );

  // ── Configuration ─────────────────────────────────────────────────────────
  await withKey(undefined, async () => {
    check("no key means not configured", isImageEditConfigured() === false);
    check(
      "and calling anyway names the missing key rather than failing at OpenAI",
      await throwsWith(() => openaiEditImage(INPUT, async () => jsonResponse(OK_BODY)), "OPENAI_API_KEY"),
    );
  });
  await withKey("   ", async () => {
    check("a blank key is not a key", isImageEditConfigured() === false);
  });

  await withKey("sk-test", async () => {
    check("a key means configured", isImageEditConfigured() === true);

    // ── The request ─────────────────────────────────────────────────────────
    let seenUrl = "";
    let seenAuth = "";
    let form: FormData | null = null;
    const capture: typeof fetch = async (url, init) => {
      seenUrl = String(url);
      seenAuth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
      form = init?.body as FormData;
      return jsonResponse(OK_BODY);
    };
    const { bytes, usage } = await openaiEditImage(INPUT, capture);

    check("it posts to the edits endpoint", seenUrl === "https://api.openai.com/v1/images/edits");
    check("the key travels as a bearer token", seenAuth === "Bearer sk-test");
    check("the editing-precision model is the one asked for", form!.get("model") === "gpt-image-2.5-sunburst");
    check("the instruction is sent as the prompt", String(form!.get("prompt")).includes("Replace the person"));
    check("size and quality are sent", form!.get("size") === "1024x1024" && form!.get("quality") === "high");
    // "image", singular, is silently accepted by some clients and rejected
    // here -- the endpoint takes a LIST.
    check("the source photo is sent as image[], a real file part", form!.get("image[]") instanceof Blob);
    check("and not under the singular name", form!.get("image") === null);

    // ── The response ────────────────────────────────────────────────────────
    check("the base64 image comes back as bytes", bytes.toString() === "fake-png-bytes");
    check(
      "the reported usage is carried out for metering, not re-estimated",
      usage.imageInputTokens === 1452 && usage.textInputTokens === 28 && usage.imageOutputTokens === 196,
    );

    // ── Failures ────────────────────────────────────────────────────────────
    // A refusal and an outage look identical in a generic 500, and the
    // operator's next move is different for each.
    check(
      "a moderation refusal says it was refused, and why",
      await throwsWith(
        () =>
          openaiEditImage(INPUT, async () =>
            jsonResponse(
              {
                error: {
                  code: "moderation_blocked",
                  moderation_details: { moderation_stage: "input", categories: ["harassment"] },
                },
              },
              400,
            ),
          ),
        "refused by OpenAI's content check (harassment)",
      ),
    );
    check(
      "an API error carries OpenAI's own message",
      await throwsWith(
        () => openaiEditImage(INPUT, async () => jsonResponse({ error: { message: "billing hard limit reached" } }, 429)),
        "billing hard limit reached",
      ),
    );
    check(
      "a 200 with no image is an error, not an empty success",
      await throwsWith(() => openaiEditImage(INPUT, async () => jsonResponse({ data: [] })), "returned no image"),
    );
    check(
      "a network failure is reported as one",
      await throwsWith(() => openaiEditImage(INPUT, async () => { throw new Error("ECONNRESET"); }), "ECONNRESET"),
    );
    check(
      "a non-JSON 500 still fails loudly",
      await throwsWith(
        () => openaiEditImage(INPUT, async () => new Response("<html>bad gateway", { status: 502 })),
        "HTTP 502",
      ),
    );
  });

  check(
    "the model id records the provider, so an edit is legible beside a generation in usage",
    EDIT_MODEL_ID === "openai:gpt-image-2.5-sunburst",
  );

  console.log(`\nopenaiImageClient: ${passed} checks passed`);
})();
