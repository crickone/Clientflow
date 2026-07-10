import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import {
  getAssets,
  getProject,
  updateProjectFields,
} from "@/lib/video/projects";
import { CAPTION_FONTS } from "@/lib/video/captions";
import { listTracks } from "@/lib/video/music";
import { computeKeepRanges, DEFAULT_TRIM_CONFIG } from "@/lib/video/trim";

export const dynamic = "force-dynamic";

interface TranscriptShape {
  language?: string;
  durationSeconds?: number;
  text?: string;
  words?: Array<{ word: string; start: number; end: number }>;
  segments?: Array<{ id: number; start: number; end: number; text: string }>;
}

interface PlanShape {
  brollInserts?: Array<{
    startSec: number;
    endSec: number;
    brollAssetId: number;
    reason?: string;
    brollStartSec?: number;
  }>;
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const id = Number(params.id);
  const project = getProject(id);
  if (!project) {
    return NextResponse.json(
      { ok: false, error: "Project not found." },
      { status: 404 },
    );
  }
  const assets = getAssets(id);

  // If auto-trim is on, also compute the duration of the trimmed output so
  // the timeline editor can show times that line up with the final render.
  let outputDurationSec: number | null = null;
  if (project.autoTrimSilence && project.transcriptJson) {
    try {
      const transcript = JSON.parse(project.transcriptJson) as {
        durationSeconds?: number;
        words?: Array<{ word: string; start: number; end: number }>;
      };
      if (
        Array.isArray(transcript.words) &&
        typeof transcript.durationSeconds === "number"
      ) {
        const ranges = computeKeepRanges(
          transcript.words,
          transcript.durationSeconds,
          DEFAULT_TRIM_CONFIG,
        );
        outputDurationSec = ranges.reduce(
          (sum, r) => sum + (r.end - r.start),
          0,
        );
      }
    } catch {
      outputDurationSec = null;
    }
  }

  return NextResponse.json({
    ok: true,
    project,
    assets,
    outputDurationSec,
  });
}

/**
 * Persist user edits to the project: spell-corrected transcript, hand-edited
 * B-roll plan, or caption font choice. Each field is optional. Validates
 * shape and rejects edits during an active render so the in-flight pipeline
 * doesn't read stale state.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const id = Number(params.id);
  const project = getProject(id);
  if (!project) {
    return NextResponse.json(
      { ok: false, error: "Project not found." },
      { status: 404 },
    );
  }
  if (
    project.status === "transcribing" ||
    project.status === "planning" ||
    project.status === "rendering"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `Cannot edit project while status is "${project.status}". Wait for the current run to finish.`,
      },
      { status: 409 },
    );
  }

  let body: {
    transcript?: TranscriptShape;
    plan?: PlanShape;
    timeline?: {
      mainSegments?: Array<{ sourceStart: number; sourceEnd: number }>;
      brollInserts?: PlanShape["brollInserts"];
    };
    captionFont?: string;
    musicFilename?: string | null;
    musicVolume?: number;
    autoTrimSilence?: boolean;
    showIntroOutro?: boolean;
    introDurationSec?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const patch: {
    transcriptJson?: string;
    planJson?: string;
    timelineJson?: string;
    captionFont?: string;
    musicFilename?: string | null;
    musicVolume?: number;
    autoTrimSilence?: boolean;
    showIntroOutro?: boolean;
    introDurationSec?: number;
  } = {};

  if (body.transcript !== undefined) {
    const t = body.transcript;
    if (
      !t ||
      typeof t.language !== "string" ||
      typeof t.durationSeconds !== "number" ||
      !Array.isArray(t.words) ||
      !Array.isArray(t.segments)
    ) {
      return NextResponse.json(
        { ok: false, error: "Transcript shape is invalid." },
        { status: 400 },
      );
    }
    for (const w of t.words) {
      if (
        !w ||
        typeof w.word !== "string" ||
        typeof w.start !== "number" ||
        typeof w.end !== "number" ||
        w.end < w.start
      ) {
        return NextResponse.json(
          { ok: false, error: "Transcript words are invalid." },
          { status: 400 },
        );
      }
    }
    patch.transcriptJson = JSON.stringify(t);
  }

  if (body.plan !== undefined) {
    const p = body.plan;
    if (!p || !Array.isArray(p.brollInserts)) {
      return NextResponse.json(
        { ok: false, error: "Plan shape is invalid." },
        { status: 400 },
      );
    }
    const assets = getAssets(id);
    const brollIds = new Set(
      assets.filter((a) => a.kind === "broll").map((a) => a.id),
    );
    const inserts: Array<{
      startSec: number;
      endSec: number;
      brollAssetId: number;
      reason: string;
      brollStartSec: number;
    }> = [];
    const seenAssets = new Set<number>();
    for (const ins of p.brollInserts) {
      if (
        !ins ||
        typeof ins.startSec !== "number" ||
        typeof ins.endSec !== "number" ||
        typeof ins.brollAssetId !== "number"
      ) {
        return NextResponse.json(
          { ok: false, error: "Plan insert fields are invalid." },
          { status: 400 },
        );
      }
      if (ins.endSec <= ins.startSec + 0.4) {
        return NextResponse.json(
          {
            ok: false,
            error: `B-roll at ${ins.startSec.toFixed(2)}s is too short — needs at least 0.5s.`,
          },
          { status: 400 },
        );
      }
      if (!brollIds.has(ins.brollAssetId)) {
        return NextResponse.json(
          {
            ok: false,
            error: `Unknown B-roll asset ${ins.brollAssetId}.`,
          },
          { status: 400 },
        );
      }
      if (seenAssets.has(ins.brollAssetId)) {
        return NextResponse.json(
          {
            ok: false,
            error: "Each B-roll clip can only be used once per video.",
          },
          { status: 400 },
        );
      }
      seenAssets.add(ins.brollAssetId);
      const brollStart =
        typeof ins.brollStartSec === "number" && ins.brollStartSec > 0
          ? Number(ins.brollStartSec.toFixed(2))
          : 0;
      inserts.push({
        startSec: Number(ins.startSec.toFixed(2)),
        endSec: Number(ins.endSec.toFixed(2)),
        brollAssetId: ins.brollAssetId,
        reason: String(ins.reason ?? "manual edit"),
        brollStartSec: brollStart,
      });
    }
    inserts.sort((a, b) => a.startSec - b.startSec);
    for (let i = 1; i < inserts.length; i++) {
      if (inserts[i].startSec < inserts[i - 1].endSec + 1) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "B-roll inserts overlap — leave at least 1s between them.",
          },
          { status: 400 },
        );
      }
    }
    patch.planJson = JSON.stringify({ brollInserts: inserts });
  }

  if (body.timeline !== undefined) {
    const tl = body.timeline;
    if (!tl || !Array.isArray(tl.mainSegments) || tl.mainSegments.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Timeline needs at least one main segment." },
        { status: 400 },
      );
    }
    for (const s of tl.mainSegments) {
      if (
        !s ||
        typeof s.sourceStart !== "number" ||
        typeof s.sourceEnd !== "number" ||
        s.sourceEnd <= s.sourceStart
      ) {
        return NextResponse.json(
          { ok: false, error: "A main segment has invalid bounds." },
          { status: 400 },
        );
      }
    }
    const inserts = Array.isArray(tl.brollInserts) ? tl.brollInserts : [];
    const assets = getAssets(id);
    const brollIds = new Set(
      assets.filter((a) => a.kind === "broll").map((a) => a.id),
    );
    const cleanInserts: NonNullable<PlanShape["brollInserts"]> = [];
    for (const ins of inserts) {
      // Structurally-broken inserts are a client bug → reject loudly.
      if (
        !ins ||
        typeof ins.startSec !== "number" ||
        typeof ins.endSec !== "number" ||
        typeof ins.brollAssetId !== "number" ||
        ins.endSec <= ins.startSec
      ) {
        return NextResponse.json(
          { ok: false, error: "A b-roll insert is invalid." },
          { status: 400 },
        );
      }
      // A reference to a since-deleted asset just self-heals (drop it) so a
      // stale insert can never wedge autosave.
      if (!brollIds.has(ins.brollAssetId)) continue;
      cleanInserts.push({
        startSec: Number(ins.startSec.toFixed(3)),
        endSec: Number(ins.endSec.toFixed(3)),
        brollAssetId: ins.brollAssetId,
        reason: String(ins.reason ?? "manual edit"),
        brollStartSec:
          typeof ins.brollStartSec === "number" && ins.brollStartSec > 0
            ? Number(ins.brollStartSec.toFixed(3))
            : 0,
      });
    }
    patch.timelineJson = JSON.stringify({
      mainSegments: tl.mainSegments.map((s) => ({
        sourceStart: Number(s.sourceStart.toFixed(3)),
        sourceEnd: Number(s.sourceEnd.toFixed(3)),
      })),
      brollInserts: cleanInserts,
    });
  }

  if (body.captionFont !== undefined) {
    if (!CAPTION_FONTS.some((f) => f.name === body.captionFont)) {
      return NextResponse.json(
        { ok: false, error: "Unknown caption font." },
        { status: 400 },
      );
    }
    patch.captionFont = body.captionFont;
  }

  if (body.musicFilename !== undefined) {
    if (body.musicFilename === null || body.musicFilename === "") {
      patch.musicFilename = null;
    } else {
      const tracks = listTracks();
      if (!tracks.some((t) => t.filename === body.musicFilename)) {
        return NextResponse.json(
          { ok: false, error: "Unknown music track." },
          { status: 400 },
        );
      }
      patch.musicFilename = body.musicFilename;
    }
  }

  if (body.musicVolume !== undefined) {
    const v = Number(body.musicVolume);
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      return NextResponse.json(
        { ok: false, error: "Music volume must be between 0 and 1." },
        { status: 400 },
      );
    }
    patch.musicVolume = v;
  }

  if (body.autoTrimSilence !== undefined) {
    patch.autoTrimSilence = !!body.autoTrimSilence;
  }

  if (body.showIntroOutro !== undefined) {
    patch.showIntroOutro = !!body.showIntroOutro;
  }

  if (body.introDurationSec !== undefined) {
    const v = Number(body.introDurationSec);
    if (!Number.isFinite(v) || v < 0.5 || v > 10) {
      return NextResponse.json(
        { ok: false, error: "Intro length must be between 0.5 and 10 seconds." },
        { status: 400 },
      );
    }
    patch.introDurationSec = v;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { ok: false, error: "Nothing to update." },
      { status: 400 },
    );
  }

  updateProjectFields(id, patch);
  const refreshed = getProject(id);
  const assets = getAssets(id);
  return NextResponse.json({ ok: true, project: refreshed, assets });
}
