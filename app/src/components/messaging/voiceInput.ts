/**
 * Pure, DOM-free helpers for the chat mic button (Voice T2 — the frontend
 * half of "talk to Adonis"; T1 built `POST /api/assistant/transcribe`, see
 * `@/lib/ai/voiceTranscribe`). Deliberately split out of `useVoiceInput.ts`
 * (which owns the actual getUserMedia/MediaRecorder/fetch state machine —
 * browser APIs this repo can't unit-test headlessly) so the decision logic
 * below can be exercised by a plain `node:assert` test, same split as
 * `campaignProgress.ts` (pure model) vs `AssistantChat.tsx`'s send()/
 * approve() (the stateful callers).
 */

/**
 * Candidate `MediaRecorder` mime types, in preference order — the first one
 * the browser's `MediaRecorder.isTypeSupported` accepts wins. Chrome/Edge
 * support `audio/webm` (opus preferred when explicit); Safari only supports
 * `audio/mp4`; `audio/ogg` is a last-resort fallback for anything else.
 */
export const AUDIO_MIME_CANDIDATES: readonly string[] = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];

/**
 * Picks the first candidate mime type `isSupported` accepts, or `null` if
 * none are (a browser with no usable `MediaRecorder` audio format at all).
 * `isSupported` is injected (rather than calling `MediaRecorder.isTypeSupported`
 * directly) purely so this stays testable outside a browser.
 */
export function pickAudioMimeType(candidates: readonly string[], isSupported: (type: string) => boolean): string | null {
  for (const type of candidates) {
    if (isSupported(type)) return type;
  }
  return null;
}

/**
 * File extension matching a recorded mime type, so the multipart filename
 * (`voice.webm` / `voice.mp4` / `voice.ogg`) reflects its actual
 * `Content-Type` instead of always claiming `.webm`. Whisper keys off the
 * `Content-Type` header the browser sets for the Blob, not the filename, so
 * this is a courtesy for logs/debugging rather than correctness-critical —
 * an unrecognised mime type falls back to `.webm`.
 */
export function audioFileExtension(mimeType: string): string {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

/**
 * Appends a transcript into whatever's already in the compose box —
 * NEVER clobbers typed text, same "don't stomp the operator's own input"
 * principle as AssistantChat's `initialInput` seed effect (`cur || initialInput`),
 * just concatenating instead of only-filling-when-empty. A blank/whitespace-only
 * transcript (silence) is a no-op — returns `current` completely unchanged
 * (not even re-trimmed), so it never surprises the caller with a trimmed
 * version of text the operator was mid-typing.
 */
export function appendTranscript(current: string, transcribed: string): string {
  const text = transcribed.trim();
  if (!text) return current;
  const cur = current.trim();
  return cur ? `${cur} ${text}` : text;
}

/**
 * Structural (not `instanceof DOMException`) check for a getUserMedia
 * permission denial — real rejections are a `DOMException` with this
 * `.name`, but checking the property directly avoids depending on the
 * `DOMException` global existing in every runtime this module might load in
 * (this file has no "use client"; it's plain, environment-agnostic logic).
 */
export function isPermissionDenied(err: unknown): boolean {
  const name = (err as { name?: unknown } | null | undefined)?.name;
  return name === "NotAllowedError" || name === "PermissionDeniedError";
}

export type VoiceErrorKind = "permission" | "cap" | "other";

/** Friendly, non-technical copy for each error path the mic flow can hit — exact wording from the Voice T2 brief. */
export function voiceErrorMessage(kind: VoiceErrorKind): string {
  switch (kind) {
    case "permission":
      return "Allow microphone access to use voice.";
    case "cap":
      return "You've hit this month's AI limit.";
    default:
      return "Couldn't transcribe that — try again.";
  }
}

/** mm:ss elapsed-time label for the recording button's live timer. Negative/non-finite input floors to "0:00" rather than showing garbage. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
