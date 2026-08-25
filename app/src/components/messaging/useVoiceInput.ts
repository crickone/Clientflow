"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AUDIO_MIME_CANDIDATES, audioFileExtension, formatElapsed, isPermissionDenied, pickAudioMimeType, voiceErrorMessage } from "./voiceInput";

export type VoiceInputState = "idle" | "recording" | "transcribing";

const TRANSCRIBE_ENDPOINT = "/api/assistant/transcribe";

/**
 * Voice T2's recording state machine: idle -> recording -> transcribing ->
 * idle. Owns every browser API this feature touches (getUserMedia,
 * MediaRecorder, the transcribe POST) so `AssistantChat.tsx` itself only
 * ever sees the 3-state machine + a single `toggle()` call — the stateful
 * counterpart to this file's sibling `voiceInput.ts` (pure, TDD'd helpers;
 * see that file's doc comment for why the split, and why THIS file can't be
 * unit-tested headlessly: rely on `typecheck` + `next build` for it).
 *
 * The mic is released (stream tracks stopped) the INSTANT recording stops —
 * before the transcribe POST even starts — and also on unmount or any
 * failure path, so it is never left "on" past the moment audio is actually
 * needed. `onTranscript` fires only on a genuine `{ok:true,text}` with
 * non-empty text; every other outcome (permission denied, `cap`, any other
 * `{ok:false}`, a network/parse failure) surfaces as a `sonner` toast and
 * returns the machine to `idle` — the caller never has to distinguish success
 * from failure itself.
 *
 * Also exposes the live `MediaStream` while (and only while) `state ===
 * "recording"`, purely so the soundwave visualizer (`Soundwave.tsx`) can
 * read it into a Web Audio AnalyserNode — ownership of the stream doesn't
 * change: this hook alone still stops its tracks (`releaseMic`, above), the
 * soundwave only ever reads.
 */
export function useVoiceInput(onTranscript: (text: string) => void) {
  const [state, setState] = useState<VoiceInputState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startingRef = useRef(false); // guards a rapid double-click firing two overlapping getUserMedia calls
  const mountedRef = useRef(true);
  // Always the latest onTranscript, so the MediaRecorder `stop` listener
  // (attached once per recording, inside start()) never closes over a stale
  // callback if the identity passed in changes between start() and stop().
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const stopTick = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Unmount mid-recording/transcribing: never leave the mic "on". Stopping
  // the recorder triggers its own `stop` listener (below), which does the
  // stopTick()+releaseMic() itself — the two direct calls here are
  // belt-and-suspenders for the case a recorder was never started (both are
  // no-ops then: stopTick on a null ref, releaseMic on a null stream).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try {
        recorderRef.current?.stop();
      } catch {
        /* already inactive */
      }
      stopTick();
      releaseMic();
    };
  }, [releaseMic, stopTick]);

  const finish = useCallback(async (mimeType: string) => {
    const durationMs = Date.now() - startedAtRef.current;
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];
    if (blob.size === 0) {
      if (mountedRef.current) setState("idle");
      return;
    }
    setState("transcribing");
    try {
      const form = new FormData();
      form.append("file", blob, `voice.${audioFileExtension(mimeType)}`);
      form.append("durationMs", String(durationMs));
      const res = await fetch(TRANSCRIBE_ENDPOINT, { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string } | null;
      if (!mountedRef.current) return;
      if (data?.ok && typeof data.text === "string" && data.text) {
        onTranscriptRef.current(data.text);
      } else {
        toast.error(voiceErrorMessage(data?.error === "cap" ? "cap" : "other"));
      }
    } catch {
      if (mountedRef.current) toast.error(voiceErrorMessage("other"));
    } finally {
      if (mountedRef.current) setState("idle");
    }
  }, []);

  const start = useCallback(async () => {
    if (state !== "idle" || startingRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error(voiceErrorMessage("other"));
      return;
    }
    startingRef.current = true;
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        toast.error(voiceErrorMessage(isPermissionDenied(err) ? "permission" : "other"));
        return;
      }
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop()); // unmounted while the permission prompt was open — release immediately
        return;
      }

      const mimeType = pickAudioMimeType(AUDIO_MIME_CANDIDATES, (t) => MediaRecorder.isTypeSupported(t));
      if (!mimeType) {
        stream.getTracks().forEach((t) => t.stop());
        toast.error(voiceErrorMessage("other"));
        return;
      }

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { mimeType });
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        toast.error(voiceErrorMessage("other"));
        return;
      }

      streamRef.current = stream;
      chunksRef.current = [];
      recorder.addEventListener("dataavailable", (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      });
      recorder.addEventListener("stop", () => {
        // Runs whether triggered by stop() below, or by the unmount cleanup
        // above calling recorder.stop() directly — the single place that
        // actually releases the mic + stops the elapsed-timer tick, so every
        // trigger path is covered uniformly.
        stopTick();
        releaseMic();
        if (mountedRef.current) void finish(mimeType);
        else chunksRef.current = [];
      });
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start();
      setElapsedMs(0);
      tickRef.current = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 1000);
      setState("recording");
    } finally {
      startingRef.current = false;
    }
  }, [state, finish, releaseMic, stopTick]);

  const stop = useCallback(() => {
    if (state !== "recording") return;
    try {
      recorderRef.current?.stop(); // fires the `stop` listener registered in start()
    } catch {
      /* already inactive */
    }
  }, [state]);

  const toggle = useCallback(() => {
    if (state === "idle") void start();
    else if (state === "recording") stop();
    // "transcribing": ignored — the button is disabled then anyway, but this
    // guards a rapid double-fire (e.g. Enter+click) from starting a second
    // recording before the first transcript lands.
  }, [state, start, stop]);

  return {
    state,
    elapsedLabel: formatElapsed(elapsedMs),
    toggle,
    // `start()` sets streamRef.current BEFORE setState("recording"), so the
    // re-render that flips state to "recording" already sees the live
    // stream; the "stop" listener nulls streamRef.current and moves state
    // off "recording" together (see releaseMic()/finish() above), so this
    // and `state === "recording"` never disagree.
    stream: state === "recording" ? streamRef.current : null,
  };
}
