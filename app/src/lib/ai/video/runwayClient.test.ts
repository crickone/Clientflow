// Run: npm test -- src/lib/ai/video/runwayClient.test.ts
//
// Runway Gen-4 Turbo image-to-video, the second b-roll provider (Runway is not
// on fal, so this talks to their own API with its own key).
//
// The fake below is STRICT on purpose — it rejects a request that is missing the
// dated X-Runway-Version header or the bearer token, so a client that drops
// either fails here rather than in production. That's the lesson from the fal
// queue bug: a provider call that's subtly wrong should fail loudly and
// immediately, not hang and then report a misleading timeout.
import assert from "node:assert/strict";

import { runwayGenerateVideo, runwayCostCents, runwayRatio, RUNWAY_MODEL_ID } from "./runwayClient";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

process.env.RUNWAY_API_KEY = "test-key";

const TASK_URL = "https://api.dev.runwayml.com/v1/tasks/task-1";
const VIDEO_URL = "https://runway.example/out.mp4";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const noWait = async () => undefined;

function strictRunway(opts: { runsBeforeDone?: number; fail?: string } = {}) {
  let polls = 0;
  const seen: { body?: string } = {};
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const h = new Headers(init?.headers as HeadersInit | undefined);
    // Reject anything missing the auth or the dated version header.
    if (url.startsWith("https://api.dev.runwayml.com")) {
      if (h.get("Authorization") !== "Bearer test-key") return json({ error: "unauthorized" }, 401);
      if (h.get("X-Runway-Version") !== "2024-11-06") return json({ error: "bad version" }, 400);
    }
    if (url.endsWith("/image_to_video")) {
      seen.body = String(init?.body ?? "");
      return json({ id: "task-1" });
    }
    if (url === TASK_URL) {
      polls++;
      if (opts.fail) return json({ status: "FAILED", failure: opts.fail });
      return json(
        polls >= (opts.runsBeforeDone ?? 1)
          ? { status: "SUCCEEDED", output: [VIDEO_URL] }
          : { status: "RUNNING" },
      );
    }
    if (url === VIDEO_URL) return new Response(new Uint8Array([7, 7, 7]));
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

(async () => {
  // ── Happy path ───────────────────────────────────────────────────────────
  {
    const { fetchImpl, seen } = strictRunway({ runsBeforeDone: 2 });
    const bytes = await runwayGenerateVideo(
      {
        imageBytes: Buffer.from([1, 2]),
        imageMime: "image/jpeg",
        prompt: "she finishes the squat and racks the bar",
        durationSec: 5,
        aspectRatio: "9:16",
      },
      fetchImpl,
      noWait,
    );
    ok("returns the downloaded mp4 bytes", bytes.length === 3);
    const body = JSON.parse(seen.body ?? "{}") as Record<string, unknown>;
    ok("uses the gen4_turbo model", body.model === "gen4_turbo");
    ok("sends the prompt as promptText", body.promptText === "she finishes the squat and racks the bar");
    ok("photo goes inline as a data URI, not a public URL", String(body.promptImage).startsWith("data:image/jpeg;base64,"));
    ok("9:16 maps to a portrait ratio", body.ratio === "720:1280");
    ok("duration is passed through", body.duration === 5);
  }

  // ── A FAILED task surfaces Runway's own reason ───────────────────────────
  {
    const { fetchImpl } = strictRunway({ fail: "moderation: unsafe content" });
    let message = "";
    try {
      await runwayGenerateVideo(
        { imageBytes: Buffer.from([1]), imageMime: "image/jpeg", prompt: "p", durationSec: 5, aspectRatio: "9:16" },
        fetchImpl,
        noWait,
      );
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    ok("a failed task reports Runway's reason", message.includes("moderation: unsafe content"));
    ok("and is not reported as a timeout", !message.includes("timed out"));
  }

  // ── A persistent polling error surfaces, rather than spinning ────────────
  {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/image_to_video")) return json({ id: "task-1" });
      return new Response("gone", { status: 404 });
    }) as unknown as typeof fetch;
    let message = "";
    try {
      await runwayGenerateVideo(
        { imageBytes: Buffer.from([1]), imageMime: "image/jpeg", prompt: "p", durationSec: 5, aspectRatio: "9:16" },
        fetchImpl,
        noWait,
      );
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    ok("a repeated status failure reports the real reason", message.includes("status check failed"));
    ok("and does NOT masquerade as a timeout", !message.includes("timed out"));
  }

  // ── Ratio + cost ─────────────────────────────────────────────────────────
  ok("1:1 maps to a square ratio", runwayRatio("1:1") === "960:960");
  ok("anything else maps to portrait", runwayRatio("9:16") === "720:1280");
  assert.strictEqual(runwayCostCents(5), 25, "5s costs 25c at $0.05/s");
  passed++;
  assert.strictEqual(runwayCostCents(10), 50, "10s costs 50c");
  passed++;
  ok("model id is namespaced to the provider", RUNWAY_MODEL_ID.startsWith("runway:"));

  console.log(`runwayClient.test.ts: all ${passed} assertions passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
