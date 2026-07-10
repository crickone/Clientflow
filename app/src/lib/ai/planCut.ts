import "server-only";
import Anthropic from "@anthropic-ai/sdk";

import type { Transcript } from "@/lib/ai/transcribe";
import { getBusinessName, getServicesList } from "@/lib/ai/businessContext";

export interface BrollOption {
  assetId: number;
  originalName: string;
  durationSeconds: number;
}

export interface CutPlan {
  brollInserts: Array<{
    /** Where the B-roll appears in the MAIN timeline. */
    startSec: number;
    /** When the B-roll cuts out in the main timeline. */
    endSec: number;
    brollAssetId: number;
    reason: string;
    /**
     * Optional: which second of the B-ROLL SOURCE to start playing from.
     * Defaults to 0. Lets the operator scrub the b-roll and pick a specific
     * segment to use rather than always playing the source from t=0.
     */
    brollStartSec?: number;
  }>;
}

// Video B-roll placement rules. Business identity + services list (venue-aware,
// from the DB) are prepended at call time — the editor role needs the service
// context to match B-roll to spoken content, but not the copywriter voice.
const PLAN_CUT_RULES = `You receive a word-level transcript of a clip (usually a testimonial or explainer from the owner or a customer) and a list of available B-roll clips. Your job: pick the moments in the main video where each B-roll should cut in.

Rules:
- Place B-roll over moments where the spoken content semantically matches the likely visual (use filenames as hints — e.g. "infrared.mp4" likely shows the infrared bed).
- Each B-roll cutaway should last between 2 and the B-roll's full duration. Do not place a cutaway longer than the B-roll itself.
- Do not place cutaways within the first 1.5 seconds (let the speaker's face land first).
- Do not overlap cutaways. Leave at least 1 second of main-video face time between cutaways.
- If a B-roll doesn't have an obvious relevant moment, skip it — fewer well-placed cutaways beats forcing a bad one.
- NEVER reuse the same B-roll twice in the same video. Each brollAssetId may appear at most once in the output. If you must choose, place it at the strongest semantic match.
- Output ONLY raw JSON, no markdown fences, no preamble. Schema:
{
  "brollInserts": [
    { "startSec": number, "endSec": number, "brollAssetId": number, "reason": "short string" }
  ]
}
`;

function buildUserPrompt(
  transcript: Transcript,
  broll: BrollOption[],
  toneNotes: string | null,
): string {
  const lines: string[] = [];
  lines.push(`Main video duration: ${transcript.durationSeconds.toFixed(2)}s`);
  lines.push(`Language: ${transcript.language}`);
  if (toneNotes) {
    lines.push("");
    lines.push("Operator tone notes:");
    lines.push(toneNotes);
  }
  lines.push("");
  lines.push("Transcript (segment-level with timestamps):");
  for (const seg of transcript.segments) {
    lines.push(
      `[${seg.start.toFixed(2)}-${seg.end.toFixed(2)}] ${seg.text.trim()}`,
    );
  }
  lines.push("");
  lines.push("Available B-roll clips:");
  if (broll.length === 0) {
    lines.push("(none — return empty brollInserts)");
  } else {
    for (const b of broll) {
      lines.push(
        `- assetId=${b.assetId}, name="${b.originalName}", duration=${b.durationSeconds.toFixed(2)}s`,
      );
    }
  }
  lines.push("");
  lines.push(
    "Return the JSON plan now. Remember: ONLY the JSON object, nothing else.",
  );
  return lines.join("\n");
}

export async function planCut(input: {
  transcript: Transcript;
  broll: BrollOption[];
  toneNotes: string | null;
}): Promise<CutPlan> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local in the app/ folder.",
    );
  }

  const client = new Anthropic();

  const systemPrompt =
    `You are a short-form video editor for ${getBusinessName()}.\n\n` +
    `Services offered:\n${getServicesList()}\n\n` +
    PLAN_CUT_RULES;

  const message = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: buildUserPrompt(
          input.transcript,
          input.broll,
          input.toneNotes,
        ),
      },
    ],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  // Strip code fences if Claude wrapped the JSON despite instructions.
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: CutPlan;
  try {
    parsed = JSON.parse(stripped) as CutPlan;
  } catch (err) {
    throw new Error(
      `Could not parse cut plan as JSON. Got: ${stripped.slice(0, 200)}`,
    );
  }

  if (!Array.isArray(parsed.brollInserts)) {
    throw new Error("Cut plan missing brollInserts array.");
  }

  // Validate + clamp each insert against asset durations and main duration.
  const brollById = new Map(input.broll.map((b) => [b.assetId, b]));
  const cleaned: CutPlan["brollInserts"] = [];
  for (const ins of parsed.brollInserts) {
    const asset = brollById.get(ins.brollAssetId);
    if (!asset) continue;
    const start = Math.max(0, Number(ins.startSec));
    const end = Math.min(
      input.transcript.durationSeconds,
      Number(ins.endSec),
      start + asset.durationSeconds,
    );
    if (!(end > start + 0.5)) continue;
    cleaned.push({
      startSec: Number(start.toFixed(2)),
      endSec: Number(end.toFixed(2)),
      brollAssetId: ins.brollAssetId,
      reason: String(ins.reason || ""),
    });
  }

  // De-overlap: sort by start, drop any that overlap the previous accepted one.
  // Also enforce "no B-roll used twice": keep the first occurrence of each
  // brollAssetId. If Claude returned duplicates despite the system rule, the
  // second placement is dropped silently.
  cleaned.sort((a, b) => a.startSec - b.startSec);
  const final: CutPlan["brollInserts"] = [];
  const usedAssetIds = new Set<number>();
  for (const ins of cleaned) {
    if (usedAssetIds.has(ins.brollAssetId)) continue;
    const prev = final[final.length - 1];
    if (prev && ins.startSec < prev.endSec + 1) continue;
    final.push(ins);
    usedAssetIds.add(ins.brollAssetId);
  }

  return { brollInserts: final };
}
