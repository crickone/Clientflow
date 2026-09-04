// Run: npm test -- src/lib/ai/video/falVideoQueue.test.ts
//
// The fal QUEUE flow for AI b-roll: submit → poll → fetch result → download.
//
// THE BUG THIS PINS: fal's submit response hands back `status_url` and
// `response_url`. The first version ignored them and built its own
// `/{model}/requests/{id}/status`, which does NOT resolve for a model whose id
// has a path (fal-ai/kling-video/v2.5-turbo/pro/image-to-video). Every poll
// 404'd, the code treated that as transient, and the job span for the full
// 6-minute deadline before reporting a misleading "timed out" — the operator
// just saw "generating" for six minutes, then "failed".
//
// So: the fake below answers ONLY the URLs fal returned. A client that builds
// its own would 404 forever and fail the test, which is exactly the regression
// we want caught.
import assert from "node:assert/strict";

import { falGenerateVideo, videoCostCents } from "./falVideoClient";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

process.env.FAL_KEY = "test-key";

const STATUS_URL = "https://queue.fal.run/fal-ai/kling-video/requests/req-123/status";
const RESULT_URL = "https://queue.fal.run/fal-ai/kling-video/requests/req-123";
const VIDEO_URL = "https://storage.example/out.mp4";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

function makeFal(opts: { pollsBeforeDone?: number } = {}) {
  const calls: string[] = [];
  let polls = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/image-to-video")) {
      // Submit — hand back the URLs the caller is expected to use.
      return json({ request_id: "req-123", status_url: STATUS_URL, response_url: RESULT_URL });
    }
    if (url === STATUS_URL) {
      polls++;
      return json({ status: polls >= (opts.pollsBeforeDone ?? 1) ? "COMPLETED" : "IN_PROGRESS" });
    }
    if (url === RESULT_URL) return json({ video: { url: VIDEO_URL } });
    if (url === VIDEO_URL) return new Response(new Uint8Array([1, 2, 3, 4]));
    // Anything else is a URL the client invented — the bug.
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const noWait = async () => undefined;

(async () => {
  // ── The happy path uses the RETURNED urls ────────────────────────────────
  {
    const { fetchImpl, calls } = makeFal({ pollsBeforeDone: 2 });
    const bytes = await falGenerateVideo(
      { imageBytes: Buffer.from([9, 9]), imageMime: "image/jpeg", prompt: "slow push-in", durationSec: 5 },
      fetchImpl,
      noWait,
    );
    ok("returns the downloaded mp4 bytes", bytes.length === 4);
    ok("polled the status_url fal returned", calls.includes(STATUS_URL));
    ok("fetched the response_url fal returned", calls.includes(RESULT_URL));
    ok("never invented its own /requests/ url", !calls.some((u) => u.includes("/pro/image-to-video/requests/")));
    ok("polled more than once while IN_PROGRESS", calls.filter((u) => u === STATUS_URL).length === 2);
  }

  // ── The source photo goes as a data URI, never a public URL ──────────────
  {
    const seen: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/image-to-video")) {
        seen.push(String(init?.body ?? ""));
        return json({ request_id: "r", status_url: STATUS_URL, response_url: RESULT_URL });
      }
      if (url === STATUS_URL) return json({ status: "COMPLETED" });
      if (url === RESULT_URL) return json({ video: { url: VIDEO_URL } });
      return new Response(new Uint8Array([0]));
    }) as unknown as typeof fetch;
    await falGenerateVideo(
      { imageBytes: Buffer.from([1, 2, 3]), imageMime: "image/png", prompt: "p", durationSec: 10 },
      fetchImpl,
      noWait,
    );
    const body = JSON.parse(seen[0]) as { image_url: string; duration: string };
    ok("photo is sent inline as a data URI, not uploaded anywhere", body.image_url.startsWith("data:image/png;base64,"));
    ok("requested duration is passed through", body.duration === "10");
  }

  // ── A PERSISTENT status error surfaces, instead of spinning to the deadline
  {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/image-to-video")) {
        return json({ request_id: "r", status_url: STATUS_URL, response_url: RESULT_URL });
      }
      return new Response("gone", { status: 404 });
    }) as unknown as typeof fetch;
    let message = "";
    try {
      await falGenerateVideo(
        { imageBytes: Buffer.from([1]), imageMime: "image/jpeg", prompt: "p", durationSec: 5 },
        fetchImpl,
        noWait,
      );
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    ok("a repeated status failure reports the real reason", message.includes("status check failed"));
    ok("and does NOT masquerade as a timeout", !message.includes("timed out"));
  }

  // ── A failed submit is reported immediately ──────────────────────────────
  {
    const fetchImpl = (async () => new Response("bad request", { status: 422 })) as unknown as typeof fetch;
    let message = "";
    try {
      await falGenerateVideo(
        { imageBytes: Buffer.from([1]), imageMime: "image/jpeg", prompt: "p", durationSec: 5 },
        fetchImpl,
        noWait,
      );
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    ok("submit failure surfaces the API status", message.includes("422"));
  }

  // Cost math is what the tenant is billed — kept alongside the flow it bills.
  ok("5s costs 35c", videoCostCents(5) === 35);
  ok("10s costs 70c", videoCostCents(10) === 70);

  console.log(`falVideoQueue.test.ts: all ${passed} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
