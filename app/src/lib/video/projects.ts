import "server-only";

import fs from "node:fs";
import path from "node:path";
import { db, schema } from "@/lib/db";
import { getCurrentTenant, runWithTenant } from "@/lib/db/tenant";
import { eq, desc } from "drizzle-orm";
import { probe } from "@/lib/video/ffmpeg";
import { transcribeVideo, type Transcript } from "@/lib/ai/transcribe";
import { planCut, type CutPlan } from "@/lib/ai/planCut";
import { renderProject } from "@/lib/video/render";
import { parseTimeline, type MainSegment } from "@/lib/video/timeline";
import { resolveTrackPath } from "@/lib/video/music";
import { resolveRasterLogoPath } from "@/lib/branding";
import { AiCapError } from "@/lib/ai/usage";

/**
 * Distinguishes an expected "tenant is over its monthly AI cap" skip from a
 * genuine planning failure in the logs — both already land the project on
 * "failed" with a message the operator can read (see setStatus calls below),
 * but conflating the two in server logs would make a capped tenant look like
 * a recurring bug every time planning/rendering runs.
 */
function logPlanOutcome(projectId: number, err: unknown): void {
  if (err instanceof AiCapError) {
    console.error(`[content-studio] plan skipped for ${projectId} — tenant is over its monthly AI cap`);
  } else {
    console.error(`[content-studio] plan failed for ${projectId}:`, err);
  }
}

const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

export function uploadDir(projectId: number): string {
  return path.join(UPLOAD_ROOT, String(projectId));
}

export function ensureUploadDir(projectId: number): string {
  const dir = uploadDir(projectId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface CreateProjectInput {
  name: string;
  aspectRatio: "9:16" | "1:1";
  targetSeconds: number;
  toneNotes: string | null;
}

export function createProject(input: CreateProjectInput) {
  const [row] = db
    .insert(schema.videoProjects)
    .values({
      name: input.name,
      aspectRatio: input.aspectRatio,
      targetSeconds: input.targetSeconds,
      toneNotes: input.toneNotes,
      status: "queued",
    })
    .returning()
    .all();
  return row;
}

export function getProject(id: number) {
  const row = db
    .select()
    .from(schema.videoProjects)
    .where(eq(schema.videoProjects.id, id))
    .get();
  return row ?? null;
}

export function listProjects() {
  return db
    .select()
    .from(schema.videoProjects)
    .orderBy(desc(schema.videoProjects.createdAt))
    .all();
}

export function getAssets(projectId: number) {
  return db
    .select()
    .from(schema.videoAssets)
    .where(eq(schema.videoAssets.projectId, projectId))
    .all();
}

export function addAsset(input: {
  projectId: number;
  kind: "main" | "broll";
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  rotation?: number;
}) {
  const [row] = db
    .insert(schema.videoAssets)
    .values({ ...input, rotation: input.rotation ?? 0 })
    .returning()
    .all();
  return row;
}

type ProjectStatus =
  | "queued"
  | "transcribing"
  | "transcribed"
  | "planning"
  | "rendering"
  | "rendered"
  | "failed";

export function setStatus(
  id: number,
  status: ProjectStatus,
  patch: {
    error?: string | null;
    transcriptJson?: string | null;
    planJson?: string | null;
    outputFilename?: string | null;
  } = {},
) {
  db.update(schema.videoProjects)
    .set({
      status,
      ...("error" in patch ? { error: patch.error ?? null } : {}),
      ...("transcriptJson" in patch
        ? { transcriptJson: patch.transcriptJson ?? null }
        : {}),
      ...("planJson" in patch
        ? { planJson: patch.planJson ?? null }
        : {}),
      ...("outputFilename" in patch
        ? { outputFilename: patch.outputFilename ?? null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.videoProjects.id, id))
    .run();
}

/**
 * Persist user edits made on the project page: transcript fixes, plan edits,
 * or caption font choice. Each field is optional; pass only what changed.
 */
export function updateProjectFields(
  id: number,
  patch: {
    transcriptJson?: string;
    planJson?: string;
    timelineJson?: string;
    captionFont?: string;
    musicFilename?: string | null;
    musicVolume?: number;
    autoTrimSilence?: boolean;
    showIntroOutro?: boolean;
    introDurationSec?: number;
  },
) {
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.transcriptJson !== undefined)
    update.transcriptJson = patch.transcriptJson;
  if (patch.planJson !== undefined) update.planJson = patch.planJson;
  if (patch.timelineJson !== undefined)
    update.timelineJson = patch.timelineJson;
  if (patch.captionFont !== undefined) update.captionFont = patch.captionFont;
  if (patch.musicFilename !== undefined)
    update.musicFilename = patch.musicFilename;
  if (patch.musicVolume !== undefined) update.musicVolume = patch.musicVolume;
  if (patch.autoTrimSilence !== undefined)
    update.autoTrimSilence = patch.autoTrimSilence;
  if (patch.showIntroOutro !== undefined)
    update.showIntroOutro = patch.showIntroOutro;
  if (patch.introDurationSec !== undefined)
    update.introDurationSec = patch.introDurationSec;
  db.update(schema.videoProjects)
    .set(update)
    .where(eq(schema.videoProjects.id, id))
    .run();
}

/**
 * Run Claude planning only — produce a fresh B-roll plan, save it, and
 * return the project to "transcribed" so the user can review/edit before
 * triggering the (slow) ffmpeg render. Fire-and-forget.
 */
export function runPlan(projectId: number): void {
  const tenantId = getCurrentTenant().id;
  void runWithTenant(tenantId, async () => {
    try {
      const project = getProject(projectId);
      if (!project) throw new Error("Project not found.");
      if (!project.transcriptJson) {
        throw new Error("Project has no transcript yet.");
      }
      const transcript = JSON.parse(project.transcriptJson) as Transcript;
      const assets = getAssets(projectId);
      const brollAssets = assets.filter((a) => a.kind === "broll");

      setStatus(projectId, "planning", { error: null });
      const plan = await planCut({
        transcript,
        broll: brollAssets.map((b) => ({
          assetId: b.id,
          originalName: b.originalName,
          durationSeconds: b.durationSeconds ?? 0,
        })),
        toneNotes: project.toneNotes ?? null,
        tenantId,
      });
      setStatus(projectId, "transcribed", {
        planJson: JSON.stringify(plan),
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logPlanOutcome(projectId, err);
      setStatus(projectId, "failed", { error: message });
    }
  });
}

/**
 * Kick off the transcription pipeline for a project. Fire-and-forget: the
 * caller doesn't wait. Status is observable via getProject().
 */
export function runTranscription(projectId: number): void {
  const tenantId = getCurrentTenant().id;
  void runWithTenant(tenantId, async () => {
    try {
      setStatus(projectId, "transcribing", { error: null });
      const assets = getAssets(projectId);
      const main = assets.find((a) => a.kind === "main");
      if (!main) throw new Error("No main video uploaded.");
      const filePath = path.join(uploadDir(projectId), main.filename);
      const transcript = await transcribeVideo(filePath);
      setStatus(projectId, "transcribed", {
        transcriptJson: JSON.stringify(transcript),
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[content-studio] transcription failed for ${projectId}:`, err);
      setStatus(projectId, "failed", { error: message });
    }
  });
}

/**
 * Plan the B-roll cuts with Claude, then render the final MP4 via ffmpeg.
 * Fire-and-forget; status moves planning -> rendering -> rendered (or failed).
 *
 * When `useSavedPlan` is true (user clicked "Re-render with my edits"), we
 * skip the Claude planning step and reuse the plan already stored on the
 * project. This is what lets the user drag B-roll to new spots without
 * Claude overwriting their changes.
 */
export function runRender(
  projectId: number,
  opts: { useSavedPlan?: boolean } = {},
): void {
  const tenantId = getCurrentTenant().id;
  void runWithTenant(tenantId, async () => {
    try {
      const project = getProject(projectId);
      if (!project) throw new Error("Project not found.");
      if (!project.transcriptJson) {
        throw new Error("Project has no transcript yet.");
      }
      const transcript = JSON.parse(project.transcriptJson) as Transcript;
      const assets = getAssets(projectId);
      const main = assets.find((a) => a.kind === "main");
      if (!main) throw new Error("No main video uploaded.");
      const brollAssets = assets.filter((a) => a.kind === "broll");
      const projectDir = uploadDir(projectId);

      // The editor's timeline (when present) is the source of truth: it holds
      // the editable main-track cut + b-roll, so we render straight from it and
      // skip Claude re-planning. Legacy projects (no timelineJson) keep the
      // original plan-based flow untouched.
      const timeline = parseTimeline(project.timelineJson);
      let plan: CutPlan;
      let mainSegments: MainSegment[] | undefined;

      if (timeline) {
        mainSegments = timeline.mainSegments;
        plan = {
          brollInserts: timeline.brollInserts.map((b) => ({
            startSec: b.startSec,
            endSec: b.endSec,
            brollAssetId: b.brollAssetId,
            reason: b.reason ?? "",
            brollStartSec: b.brollStartSec ?? 0,
          })),
        };
        setStatus(projectId, "rendering", { error: null });
      } else if (opts.useSavedPlan && project.planJson) {
        plan = JSON.parse(project.planJson) as CutPlan;
        setStatus(projectId, "rendering", { error: null });
      } else {
        setStatus(projectId, "planning", { error: null });
        plan = await planCut({
          transcript,
          broll: brollAssets.map((b) => ({
            assetId: b.id,
            originalName: b.originalName,
            durationSeconds: b.durationSeconds ?? 0,
          })),
          toneNotes: project.toneNotes ?? null,
          tenantId,
        });
        setStatus(projectId, "rendering", {
          planJson: JSON.stringify(plan),
          error: null,
        });
      }

      const outputFilename = `output-${Date.now()}.mp4`;
      const outputPath = path.join(projectDir, outputFilename);
      const musicPath = project.musicFilename
        ? resolveTrackPath(project.musicFilename)
        : null;

      // Rotation is the user's explicit setting (via the Rotate button on
      // each asset). New uploads still get auto-detected from metadata on
      // upload — but at render time we trust the stored value so the user's
      // manual override is always respected.
      const mainAbsolute = path.join(projectDir, main.filename);
      const mainRotation = main.rotation ?? 0;

      await renderProject({
        mainPath: mainAbsolute,
        mainRotation,
        brollAssets: brollAssets.map((b) => ({
          assetId: b.id,
          filePath: path.join(projectDir, b.filename),
          rotation: b.rotation ?? 0,
        })),
        plan,
        mainSegments,
        transcript,
        aspectRatio: project.aspectRatio,
        outputPath,
        workDir: projectDir,
        captionFont: project.captionFont,
        musicPath,
        musicVolume: project.musicVolume,
        autoTrimSilence: project.autoTrimSilence,
        showIntroOutro: project.showIntroOutro,
        logoPath: await resolveRasterLogoPath(),
        introDurationSec: project.introDurationSec,
      });

      setStatus(projectId, "rendered", {
        outputFilename,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof AiCapError) {
        console.error(`[content-studio] render skipped for ${projectId} — tenant is over its monthly AI cap`);
      } else {
        console.error(`[content-studio] render failed for ${projectId}:`, err);
      }
      setStatus(projectId, "failed", { error: message });
    }
  });
}

export { probe };
