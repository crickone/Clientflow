// Run: npm test -- src/components/messaging/voiceInput.test.ts
//
// Voice-to-Adonis Task 2 (frontend) unit tests for the pure helpers behind
// the chat mic button — mime-type selection, transcript append, error-kind
// classification/copy, and the elapsed-time label. `useVoiceInput.ts` itself
// (getUserMedia/MediaRecorder/fetch) is NOT covered here — see that file's
// doc comment for why (browser-only APIs, no headless harness in this repo);
// `npm run typecheck` + `npx next build` are the gate for it instead.
import assert from "node:assert/strict";

import {
  appendTranscript,
  audioFileExtension,
  AUDIO_MIME_CANDIDATES,
  formatElapsed,
  isPermissionDenied,
  pickAudioMimeType,
  voiceErrorMessage,
} from "./voiceInput";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// ════════════════════════════════════════════════════════════════════
// pickAudioMimeType
// ════════════════════════════════════════════════════════════════════
check(
  "pickAudioMimeType: picks the first supported candidate (Chrome-like: webm;codecs=opus wins)",
  pickAudioMimeType(AUDIO_MIME_CANDIDATES, (t) => t === "audio/webm;codecs=opus" || t === "audio/webm") ===
    "audio/webm;codecs=opus",
);
check(
  "pickAudioMimeType: falls through to a later candidate when earlier ones are unsupported (Safari-like: mp4 only)",
  pickAudioMimeType(AUDIO_MIME_CANDIDATES, (t) => t === "audio/mp4") === "audio/mp4",
);
check(
  "pickAudioMimeType: null when nothing in the list is supported",
  pickAudioMimeType(AUDIO_MIME_CANDIDATES, () => false) === null,
);
check(
  "pickAudioMimeType: never calls isSupported past the first match (short-circuits)",
  (() => {
    const calls: string[] = [];
    pickAudioMimeType(AUDIO_MIME_CANDIDATES, (t) => {
      calls.push(t);
      return t === "audio/webm;codecs=opus";
    });
    return calls.length === 1;
  })(),
);

// ════════════════════════════════════════════════════════════════════
// audioFileExtension
// ════════════════════════════════════════════════════════════════════
check("audioFileExtension: audio/webm;codecs=opus -> webm", audioFileExtension("audio/webm;codecs=opus") === "webm");
check("audioFileExtension: audio/webm -> webm", audioFileExtension("audio/webm") === "webm");
check("audioFileExtension: audio/mp4 -> mp4", audioFileExtension("audio/mp4") === "mp4");
check("audioFileExtension: audio/ogg -> ogg", audioFileExtension("audio/ogg") === "ogg");
check("audioFileExtension: unknown mime -> webm fallback", audioFileExtension("audio/x-made-up") === "webm");
check("audioFileExtension: empty string -> webm fallback", audioFileExtension("") === "webm");

// ════════════════════════════════════════════════════════════════════
// appendTranscript — never clobbers, appends with a separating space.
// ════════════════════════════════════════════════════════════════════
check("appendTranscript: empty box -> just the transcript", appendTranscript("", "hello there") === "hello there");
check(
  "appendTranscript: non-empty box -> appended with one separating space",
  appendTranscript("book an appointment for", "next Tuesday at 3pm") === "book an appointment for next Tuesday at 3pm",
);
check(
  "appendTranscript: trims trailing/leading whitespace around the join",
  appendTranscript("existing text   ", "  more text  ") === "existing text more text",
);
check("appendTranscript: blank transcript (silence) is a no-op", appendTranscript("kept as-is", "") === "kept as-is");
check(
  "appendTranscript: whitespace-only transcript is a no-op",
  appendTranscript("kept as-is", "   ") === "kept as-is",
);
check(
  "appendTranscript: whitespace-only transcript leaves an empty box untouched (returns current, not a trimmed copy)",
  appendTranscript("", "   ") === "",
);

// ════════════════════════════════════════════════════════════════════
// isPermissionDenied — structural check, no DOMException dependency.
// ════════════════════════════════════════════════════════════════════
check(
  "isPermissionDenied: true for a getUserMedia-shaped NotAllowedError",
  isPermissionDenied({ name: "NotAllowedError" }) === true,
);
check(
  "isPermissionDenied: true for the legacy PermissionDeniedError name",
  isPermissionDenied({ name: "PermissionDeniedError" }) === true,
);
check(
  "isPermissionDenied: true for a real Error instance with that name (e.g. thrown by a mock)",
  isPermissionDenied(Object.assign(new Error("denied"), { name: "NotAllowedError" })) === true,
);
check("isPermissionDenied: false for an unrelated error name", isPermissionDenied({ name: "NotFoundError" }) === false);
check("isPermissionDenied: false for a plain Error with the default name", isPermissionDenied(new Error("boom")) === false);
check("isPermissionDenied: false for null/undefined/non-object input", isPermissionDenied(null) === false && isPermissionDenied(undefined) === false && isPermissionDenied("denied") === false);

// ════════════════════════════════════════════════════════════════════
// voiceErrorMessage — exact copy from the brief.
// ════════════════════════════════════════════════════════════════════
check(
  "voiceErrorMessage: permission",
  voiceErrorMessage("permission") === "Allow microphone access to use voice.",
);
check("voiceErrorMessage: cap", voiceErrorMessage("cap") === "You've hit this month's AI limit.");
check("voiceErrorMessage: other", voiceErrorMessage("other") === "Couldn't transcribe that — try again.");

// ════════════════════════════════════════════════════════════════════
// formatElapsed — mm:ss, floored, zero/negative-safe.
// ════════════════════════════════════════════════════════════════════
check("formatElapsed: 0ms -> 0:00", formatElapsed(0) === "0:00");
check("formatElapsed: 999ms -> 0:00 (floors, doesn't round up)", formatElapsed(999) === "0:00");
check("formatElapsed: 1000ms -> 0:01", formatElapsed(1000) === "0:01");
check("formatElapsed: 65_000ms -> 1:05", formatElapsed(65_000) === "1:05");
check("formatElapsed: 9_000ms -> 0:09 (seconds stay zero-padded under 10)", formatElapsed(9_000) === "0:09");
check("formatElapsed: 600_000ms -> 10:00", formatElapsed(600_000) === "10:00");
check("formatElapsed: negative -> 0:00 (never negative/garbage)", formatElapsed(-5000) === "0:00");
check("formatElapsed: NaN -> 0:00", formatElapsed(NaN) === "0:00");

console.log(`\nvoiceInput: ${passed} checks passed.`);
