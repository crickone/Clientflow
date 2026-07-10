import "server-only";

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import OpenAI from "openai";

import { extractAudio } from "@/lib/video/ffmpeg";

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  language: string;
  durationSeconds: number;
  text: string;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
}

/**
 * Whisper has a 25MB upload limit. We always extract a 16kHz mono 64kbps
 * audio track first, which keeps a 60s clip well under that ceiling.
 */
export async function transcribeVideo(videoPath: string): Promise<Transcript> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local in the app/ folder.",
    );
  }

  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "renova-transcribe-"),
  );
  const audioPath = path.join(
    tmpDir,
    `${crypto.randomBytes(6).toString("hex")}.mp3`,
  );

  try {
    await extractAudio(videoPath, audioPath);

    const client = new OpenAI();
    const file = fs.createReadStream(audioPath);
    const result = await client.audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word", "segment"],
      language: "en",
      temperature: 0,
    });

    const r = result as unknown as {
      language: string;
      duration: number;
      text: string;
      words?: Array<{ word: string; start: number; end: number }>;
      segments?: Array<{
        id: number;
        start: number;
        end: number;
        text: string;
      }>;
    };

    return {
      language: r.language,
      durationSeconds: r.duration,
      text: r.text,
      words: (r.words ?? []).map((w) => ({
        word: w.word,
        start: w.start,
        end: w.end,
      })),
      segments: (r.segments ?? []).map((s) => ({
        id: s.id,
        start: s.start,
        end: s.end,
        text: s.text,
      })),
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
}
