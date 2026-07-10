import "server-only";

import type { Transcript } from "@/lib/ai/transcribe";
import type { CutPlan } from "@/lib/ai/planCut";
import { computeKeepRanges, DEFAULT_TRIM_CONFIG } from "@/lib/video/trim";
import {
  fullClipSegment,
  type MainSegment,
  type TimelineBrollInsert,
  type TimelineDoc,
} from "@/lib/video/timeline";

/**
 * Build the initial editable timeline for a project ("the AI first cut"):
 *  - mainSegments = the auto-trim keep-ranges baked into visible, editable
 *    segments (or one full-length segment when auto-trim is off),
 *  - brollInserts = the saved Claude plan (already in output coords).
 *
 * This is also the back-compat path: legacy projects with no timelineJson get
 * one synthesized on open/render so nothing breaks.
 */
export function synthesizeTimeline(
  project: {
    autoTrimSilence: boolean;
    planJson: string | null;
  },
  transcript: Transcript,
): TimelineDoc {
  const duration = Math.max(transcript.durationSeconds || 1, 1);

  let mainSegments: MainSegment[];
  if (project.autoTrimSilence) {
    const ranges = computeKeepRanges(
      transcript.words,
      duration,
      DEFAULT_TRIM_CONFIG,
    );
    mainSegments = ranges.map((r) => ({ sourceStart: r.start, sourceEnd: r.end }));
  } else {
    mainSegments = [fullClipSegment(duration)];
  }

  let brollInserts: TimelineBrollInsert[] = [];
  if (project.planJson) {
    try {
      const plan = JSON.parse(project.planJson) as CutPlan;
      if (Array.isArray(plan.brollInserts)) {
        brollInserts = plan.brollInserts.map((b) => ({
          startSec: b.startSec,
          endSec: b.endSec,
          brollAssetId: b.brollAssetId,
          brollStartSec: b.brollStartSec ?? 0,
          reason: b.reason ?? "",
        }));
      }
    } catch {
      // Malformed plan → start with no cutaways.
    }
  }

  return { mainSegments, brollInserts };
}
