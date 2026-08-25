import "server-only";

/**
 * OpenAI Whisper client for the "talk to Adonis" mic button (voice T1) — the
 * ONLY file that talks to OpenAI's `/v1/audio/transcriptions` endpoint for
 * this feature. Raw `fetch`, deliberately NO `openai` npm dependency, same
 * discipline as MailgunSender (lib/marketing/sender/mailgun.ts) and
 * falClient.ts (lib/ai/image/falClient.ts): one small self-contained file, so
 * a future provider swap or API-version bump never has to fight an SDK.
 *
 * NOT the same module as `@/lib/ai/transcribe` (transcribeVideo) — that file
 * already existed for a different feature (Content Studio's video editor:
 * long-form video -> word/segment-timestamped captions, via the `openai` SDK
 * + ffmpeg, and it THROWS when unconfigured — a batch job, not a live
 * request). This module is a distinct, purpose-built client for short
 * mic-recorded chat clips: dependency-free, and it NEVER throws. Keep them
 * separate rather than merging — different dependency footprint, different
 * fail-soft contract, different callers.
 *
 * Fail-soft by design, mirroring adLibrary.ts's house style exactly:
 * `transcribeConfigured()` gates on OPENAI_API_KEY alone, and
 * `transcribeAudio` checks it FIRST — before any network call — so an
 * unconfigured deployment returns `{ok:false,error:"not_configured"}`
 * synchronously-fast and never touches the network. Everything past that
 * gate is wrapped in try/catch, so a timeout, network error, non-2xx
 * response, or malformed body all become a typed `{ok:false,error}` too —
 * this module NEVER throws.
 *
 * Metering lives OUTSIDE this file, in the route (the metering chokepoint) —
 * same split as falClient.falGenerateImage (pure API client) vs
 * generatePostImage.ts (the metered wrapper). `transcribeCostCents` is kept
 * here only because the $/minute rate is OpenAI/Whisper pricing knowledge,
 * the same reasoning falClient.ts owns `IMAGE_COST_CENTS` for fal.ai's rate
 * rather than leaving callers to know or duplicate it.
 */

const TRANSCRIBE_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const NOT_CONFIGURED_ERROR = "not_configured";

/** A mic clip is a few seconds to a few minutes — 20s is generous for Whisper's turnaround on that. */
const TIMEOUT_MS = 20_000;

/** Recorded in ai_usage's `model` column (see meterAndChargeFlat call sites) — mirrors falClient's `IMAGE_MODEL_ID` "provider:model" convention. */
export const TRANSCRIBE_MODEL_ID = "openai:whisper-1";

/** OpenAI bills whisper-1 at $0.006/minute of audio — NOT token-based, so this client never returns/needs a token `Usage`. See `transcribeCostCents`. */
const COST_CENTS_PER_MINUTE = 0.6;

export function transcribeConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/** Mirrors transcribeConfigured()'s exact truthiness check, so the two can never disagree (one saying "configured" while the other refuses). */
function apiKey(): string | null {
  const key = process.env.OPENAI_API_KEY;
  return key ? key : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// --- tiny unknown-payload guard (no `any`) — mirrors adLibrary.ts/mailgun.ts's prop() ---
function prop(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

/** Best-effort, bounded error detail from a non-2xx response — never throws. Mirrors mailgun.ts's safeErrorText; never echoes anything WE sent, so the API key can't leak back out through it. */
async function safeErrorText(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    return (text || res.statusText || `HTTP ${res.status}`).slice(0, 500);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

export type TranscribeResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * POSTs one short audio clip to OpenAI's Whisper endpoint and returns its
 * transcript. `audio` accepts either a Buffer (server-read bytes) or a
 * Blob/File (e.g. a field straight off `req.formData()`) — a Blob/File is
 * used as-is (no redundant re-copy); a Buffer is wrapped in a Blob so it can
 * ride in the multipart body. Never throws — any failure (missing key,
 * timeout, network error, non-2xx, malformed body) resolves to
 * `{ok:false,error}`, logged via `console.error` for server-side visibility.
 */
export async function transcribeAudio(
  audio: Buffer | Blob,
  mimeType: string,
  filename: string,
): Promise<TranscribeResult> {
  const key = apiKey();
  if (!key) return { ok: false, error: NOT_CONFIGURED_ERROR };
  try {
    // `Uint8Array.from` (not a bare `new Blob([audio], …)`) deliberately: a
    // Node Buffer's `.buffer` is typed `ArrayBufferLike` (it could in theory
    // back onto a SharedArrayBuffer), which doesn't satisfy DOM's `BlobPart`
    // (`ArrayBufferView<ArrayBuffer>`) — this copies into a fresh,
    // plain-ArrayBuffer-backed view so it type-checks without an unsafe cast.
    const blob = audio instanceof Blob ? audio : new Blob([Uint8Array.from(audio)], { type: mimeType || "application/octet-stream" });
    const form = new FormData();
    form.set("file", blob, filename || "audio.webm");
    form.set("model", "whisper-1");
    form.set("response_format", "json");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(TRANSCRIBE_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = await safeErrorText(res);
      const message = `transcribeAudio failed (${res.status}): ${detail}`;
      console.error(message);
      return { ok: false, error: message };
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const text = prop(data, "text");
    if (typeof text !== "string") {
      console.error("transcribeAudio: malformed response (no text field)");
      return { ok: false, error: "transcribeAudio: malformed response" };
    }
    return { ok: true, text: text.trim() };
  } catch (err) {
    const message = `transcribeAudio failed: ${errorMessage(err)}`;
    console.error(message);
    return { ok: false, error: message };
  }
}

/**
 * Whisper's per-call cost in cents from clip duration — $0.006/minute,
 * rounded UP to the nearest cent (never under-charge), with a 1¢ floor so
 * even a sub-10-second clip records a nonzero usage row. `durationMs` is
 * client-reported (Task 2's recorder measures it); anything missing/
 * non-finite/non-positive is treated as 0 minutes, which still floors to 1¢
 * rather than 0 or NaN.
 */
export function transcribeCostCents(durationMs: number): number {
  const minutes = Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 60_000 : 0;
  return Math.max(1, Math.ceil(minutes * COST_CENTS_PER_MINUTE));
}
