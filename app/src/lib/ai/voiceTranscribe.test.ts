// Run: npm test -- src/lib/ai/voiceTranscribe.test.ts
//
// Voice-to-Adonis Task 1 (backend) unit tests for the OpenAI Whisper client
// used by the chat mic button. Zero live network calls: every scenario
// temporarily replaces `globalThis.fetch` (save the original, restore in
// `finally`) — the exact `withMockFetch`/`withApiKey` helpers from
// adLibrary.test.ts, replicated here for OPENAI_API_KEY (same reasoning as
// voiceTranscribe.ts keeping its own prop()/errorMessage() rather than
// importing adLibrary.ts's: one small self-contained file per client).
import assert from "node:assert/strict";

import { transcribeAudio, transcribeConfigured, transcribeCostCents } from "./voiceTranscribe";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

type FetchCall = { url: string; init?: RequestInit };

/**
 * Installs a mock `fetch` for the duration of `fn`, recording every call
 * (url + init), then restores the original fetch even if `fn` throws.
 */
async function withMockFetch<T>(
  impl: (url: string, init?: RequestInit) => Response | Promise<Response>,
  fn: (calls: FetchCall[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** Sets OPENAI_API_KEY for the duration of `fn`, restoring it after — `undefined` deletes it entirely. */
async function withApiKey<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const original = process.env.OPENAI_API_KEY;
  if (value === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
  }
}

(async () => {
  // ════════════════════════════════════════════════════════════════════
  // transcribeConfigured()
  // ════════════════════════════════════════════════════════════════════
  await withApiKey(undefined, async () => {
    check("transcribeConfigured(): false when OPENAI_API_KEY is unset", transcribeConfigured() === false);
  });
  await withApiKey("test-openai-key", async () => {
    check("transcribeConfigured(): true when OPENAI_API_KEY is set", transcribeConfigured() === true);
  });

  // ════════════════════════════════════════════════════════════════════
  // Missing key -> {ok:false,error:"not_configured"}, and NEVER calls fetch
  // at all (fail-soft gate happens before any network).
  // ════════════════════════════════════════════════════════════════════
  await withApiKey(undefined, async () => {
    await withMockFetch(
      () => {
        throw new Error("fetch must not be called when unconfigured");
      },
      async (calls) => {
        const result = await transcribeAudio(Buffer.from("fake-audio-bytes"), "audio/webm", "clip.webm");
        check("transcribeAudio: not_configured", result.ok === false && result.error === "not_configured");
        check("missing key: zero fetch calls made", calls.length === 0);
      },
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // Happy path — mocked 200 {text} -> {ok:true,text} (trimmed), and the
  // outgoing request shape (endpoint, auth header, multipart fields).
  // ════════════════════════════════════════════════════════════════════
  await withApiKey("test-openai-key", async () => {
    await withMockFetch(
      () => new Response(JSON.stringify({ text: "  hello from the mic  " }), { status: 200 }),
      async (calls) => {
        const result = await transcribeAudio(Buffer.from("fake-audio-bytes"), "audio/webm", "clip.webm");
        check("transcribeAudio: ok:true", result.ok === true);
        check("transcribeAudio: text is trimmed", result.ok === true && result.text === "hello from the mic");

        const call = calls[0];
        check(
          "transcribeAudio: hits the OpenAI transcriptions endpoint",
          call.url === "https://api.openai.com/v1/audio/transcriptions",
        );
        check("transcribeAudio: POST", call.init?.method === "POST");
        const headers = call.init?.headers as Record<string, string> | undefined;
        check("transcribeAudio: Authorization header carries the key", headers?.Authorization === "Bearer test-openai-key");
        check("transcribeAudio: body is multipart FormData", call.init?.body instanceof FormData);
        const body = call.init?.body as FormData;
        check("transcribeAudio: model=whisper-1", body.get("model") === "whisper-1");
        check("transcribeAudio: response_format=json", body.get("response_format") === "json");
        check("transcribeAudio: file field present as a Blob", body.get("file") instanceof Blob);
      },
    );
  });

  // Blob/File input (what the route actually passes through from
  // req.formData()) is used as-is, not re-wrapped or re-copied.
  await withApiKey("test-openai-key", async () => {
    await withMockFetch(
      () => new Response(JSON.stringify({ text: "from a blob" }), { status: 200 }),
      async () => {
        const blob = new Blob(["fake-audio-bytes"], { type: "audio/webm" });
        const result = await transcribeAudio(blob, "audio/webm", "clip.webm");
        check("transcribeAudio: accepts a Blob directly", result.ok === true && result.text === "from a blob");
      },
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // Failure modes — non-2xx, a malformed 200 body, and a throwing fetch all
  // resolve to {ok:false,...} — NEVER throw.
  // ════════════════════════════════════════════════════════════════════
  await withApiKey("test-openai-key", async () => {
    await withMockFetch(
      () => new Response("Invalid file format.", { status: 400, statusText: "Bad Request" }),
      async () => {
        const result = await transcribeAudio(Buffer.from("fake-audio-bytes"), "audio/webm", "clip.webm");
        check("transcribeAudio: HTTP 400 -> ok:false", result.ok === false);
      },
    );
  });

  await withApiKey("test-openai-key", async () => {
    await withMockFetch(
      () => new Response("not json", { status: 200 }),
      async () => {
        const result = await transcribeAudio(Buffer.from("fake-audio-bytes"), "audio/webm", "clip.webm");
        check("transcribeAudio: malformed 200 body (no text field) -> ok:false", result.ok === false);
      },
    );
  });

  await withApiKey("test-openai-key", async () => {
    await withMockFetch(
      () => {
        throw new TypeError("network down");
      },
      async () => {
        await assert.doesNotReject(async () => {
          const result = await transcribeAudio(Buffer.from("fake-audio-bytes"), "audio/webm", "clip.webm");
          check("transcribeAudio: fetch throws -> ok:false (never throws)", result.ok === false);
        });
      },
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // transcribeCostCents — $0.006/minute, rounded up, 1¢ floor.
  // ════════════════════════════════════════════════════════════════════
  check("transcribeCostCents: 0ms -> 1¢ floor", transcribeCostCents(0) === 1);
  check("transcribeCostCents: 5s -> 1¢ floor (well under a cent of Whisper cost)", transcribeCostCents(5_000) === 1);
  check("transcribeCostCents: exactly 1 minute -> 1¢ (0.6 rounded up)", transcribeCostCents(60_000) === 1);
  check("transcribeCostCents: 10 minutes -> 6¢", transcribeCostCents(600_000) === 6);
  check(
    "transcribeCostCents: negative/NaN -> 1¢ floor, never NaN or 0",
    transcribeCostCents(-5) === 1 && transcribeCostCents(NaN) === 1,
  );

  console.log(`\nvoiceTranscribe: ${passed} checks passed.`);
})();
