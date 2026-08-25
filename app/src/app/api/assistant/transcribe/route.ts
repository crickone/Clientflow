import { type NextRequest } from "next/server";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { runWithTenant } from "@/lib/db/tenant";
import { assertAiAllowed, AiCapError, meterAndChargeFlat } from "@/lib/ai/usage";
import { transcribeAudio, transcribeConfigured, transcribeCostCents, TRANSCRIBE_MODEL_ID } from "@/lib/ai/voiceTranscribe";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const AGENT_KEY = "transcribe";

// A mic dictation clip is short by construction — reject anything that looks
// like an arbitrary upload rather than a few seconds/minutes of speech.
const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Server-side audio -> text for the chat mic button (voice T2 wires this
 * up). The recording is posted here — never to the browser's own
 * speech-recognition service — and relayed to OpenAI Whisper
 * (@/lib/ai/voiceTranscribe): private, metered per tenant like every other
 * paid AI call, fail-soft (503) when OPENAI_API_KEY isn't set.
 *
 * Auth mirrors /api/assistant/execute's shape (requireUser +
 * getCurrentMembership + runWithTenant) MINUS its admin-only gate: voice
 * input is for any signed-in user, not just admins approving writes.
 *
 * Whisper bills per minute of audio, not tokens, so this meters like the
 * flat-cost image generator (generatePostImage.ts: assertAiAllowed ->
 * provider call -> meterAndChargeFlat) rather than the token-based
 * meteredCreate/recordUsage path — there's no token Usage to record here.
 *
 * The whole handler is one try/catch so nothing — including an auth failure
 * — ever leaks a raw exception/stack to the client; every path returns a
 * typed `{ok,...}` JSON body.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const membership = getCurrentMembership();
    if (!membership) return Response.json({ ok: false, error: "No active account" }, { status: 401 });
    const tenantId = membership.tenant.id;

    if (!transcribeConfigured()) {
      return Response.json({ ok: false, error: "not_configured" }, { status: 503 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid form data.";
      return Response.json({ ok: false, error: message }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return Response.json({ ok: false, error: "No audio file supplied." }, { status: 400 });
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return Response.json({ ok: false, error: "Recording is too large (max 20MB)." }, { status: 413 });
    }

    // Client-reported clip length, used both to reject an over-long
    // recording and (below) to compute the metered cost. Anything absent or
    // not a plausible positive number is treated as 0 rather than trusted —
    // transcribeCostCents floors that to 1 cent, it never becomes NaN/free.
    const durationField = form.get("durationMs");
    const durationRaw = typeof durationField === "string" ? Number(durationField) : NaN;
    const durationMs = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0;
    if (durationMs > MAX_DURATION_MS) {
      return Response.json({ ok: false, error: "Recording is too long (max 5 minutes)." }, { status: 400 });
    }

    return await runWithTenant(tenantId, async () => {
      try {
        assertAiAllowed(tenantId);
      } catch (err) {
        if (err instanceof AiCapError) {
          return Response.json({ ok: false, error: "cap" }, { status: 402 });
        }
        throw err;
      }

      // `file` is already a Blob (File extends Blob) — passed straight
      // through rather than buffered into a redundant in-memory copy.
      const result = await transcribeAudio(file, file.type, file.name);
      if (!result.ok) {
        return Response.json({ ok: false, error: result.error }, { status: 502 });
      }

      meterAndChargeFlat(tenantId, AGENT_KEY, TRANSCRIBE_MODEL_ID, transcribeCostCents(durationMs));
      return Response.json({ ok: true, text: result.text });
    });
  } catch (err) {
    console.error("[assistant/transcribe] unhandled error:", err);
    return Response.json({ ok: false, error: "Transcription failed." }, { status: 500 });
  }
}
