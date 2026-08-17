import assert from "node:assert/strict";
import {
  falGenerateImage,
  ImageGenError,
  isImageGenConfigured,
  IMAGE_COST_CENTS,
  IMAGE_MODEL_ID,
} from "./falClient";

(async () => {
  const prevKey = process.env.FAL_KEY;
  try {
    process.env.FAL_KEY = "test-key-123";
    assert.equal(isImageGenConfigured(), true);

    // Happy path: request shape + bytes round-trip via injected fetch.
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const okFetch = (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("fal.run")) {
        return new Response(
          JSON.stringify({ images: [{ url: "https://cdn.example/img.jpg" }] }),
          { status: 200 },
        );
      }
      return new Response(bytes, { status: 200 });
    }) as typeof fetch;

    const buf = await falGenerateImage(
      { prompt: "a calm room", width: 992, height: 992 },
      okFetch,
    );
    assert.equal(buf.length, 4, "returns the downloaded bytes");
    assert.equal(calls.length, 2, "one generate call + one download");
    assert.equal(calls[0].url, "https://fal.run/fal-ai/flux-pro/v1.1");
    const hdrs = calls[0].init?.headers as Record<string, string>;
    assert.equal(hdrs.Authorization, "Key test-key-123");
    const body = JSON.parse(String(calls[0].init?.body));
    assert.equal(body.prompt, "a calm room");
    assert.deepEqual(body.image_size, { width: 992, height: 992 });
    assert.equal(body.num_images, 1);
    assert.equal(body.output_format, "jpeg");
    assert.equal(body.enable_safety_checker, true);
    assert.equal(calls[1].url, "https://cdn.example/img.jpg", "downloads the URL the API returned");

    // API error → ImageGenError.
    const errFetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    await assert.rejects(
      () => falGenerateImage({ prompt: "x", width: 992, height: 992 }, errFetch),
      ImageGenError,
    );

    // Empty images array → ImageGenError.
    const emptyFetch = (async () =>
      new Response(JSON.stringify({ images: [] }), { status: 200 })) as typeof fetch;
    await assert.rejects(
      () => falGenerateImage({ prompt: "x", width: 992, height: 992 }, emptyFetch),
      ImageGenError,
    );

    // Network-level failure (e.g. timeout abort) → wrapped as ImageGenError.
    const throwingFetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await assert.rejects(
      () => falGenerateImage({ prompt: "x", width: 992, height: 992 }, throwingFetch),
      ImageGenError,
    );

    // Missing key → ImageGenError before any fetch.
    delete process.env.FAL_KEY;
    assert.equal(isImageGenConfigured(), false);
    await assert.rejects(
      () => falGenerateImage({ prompt: "x", width: 992, height: 992 }, okFetch),
      ImageGenError,
    );
    assert.equal(calls.length, 2, "missing key throws before any fetch happens");

    assert.equal(IMAGE_COST_CENTS, 4);
    assert.equal(IMAGE_MODEL_ID, "fal:flux-1.1-pro");
    console.log("falClient.test.ts: all assertions passed");
  } finally {
    if (prevKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = prevKey;
  }
})();
