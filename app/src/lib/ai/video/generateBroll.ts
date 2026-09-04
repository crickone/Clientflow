import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { assertAiAllowed, meterAndChargeFlat } from "@/lib/ai/usage";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getCurrentTenant, runWithTenant } from "@/lib/db/tenant";
import { libraryFilePath, getLibraryAsset } from "@/lib/image/library";
import { probe } from "@/lib/video/ffmpeg";
import { uploadDir } from "@/lib/video/projects";
import {
  falGenerateVideo,
  videoCostCents,
  VIDEO_MODEL_ID,
} from "./falVideoClient";
import {
  isRunwayConfigured,
  runwayCostCents,
  runwayGenerateVideo,
  RUNWAY_MODEL_ID,
} from "./runwayClient";
import { getProject } from "@/lib/video/projects";

/**
 * The ONE metered path for AI b-roll — the video counterpart of
 * generatePostImage's gate → call → meter contract:
 *   assertAiAllowed → falGenerateVideo → save into the project's assets →
 *   meterAndChargeFlat (flat per-clip cost under agentKey, model
 *   fal:kling-2.5-turbo-pro-i2v).
 *
 * IMAGE-TO-VIDEO on the client's OWN gym photo, deliberately: the clip is their
 * real space with motion added, not a text-prompted gym that doesn't exist.
 *
 * Generation takes 1–3 minutes, so this is fire-and-forget like
 * runTranscription: the caller inserts a 'generating' asset row first and this
 * fills it in (or marks it 'failed'). Never throws to the caller.
 */
export function runBrollGeneration(input: {
  assetId: number;
  projectId: number;
  libraryAssetId: number;
  prompt: string;
  durationSec: 5 | 10;
}): void {
  const tenantId = getCurrentTenant().id;
  void runWithTenant(tenantId, async () => {
    const fail = (message: string) => {
      db.update(schema.videoAssets)
        .set({ genStatus: "failed", genError: message.slice(0, 300) })
        .where(eq(schema.videoAssets.id, input.assetId))
        .run();
    };
    try {
      // The cap is enforced BEFORE we call out, same as the image path.
      assertAiAllowed(tenantId);

      const source = getLibraryAsset(input.libraryAssetId);
      if (!source) throw new Error("Source photo not found.");
      const srcPath = libraryFilePath(source.filename);
      const imageBytes = fs.readFileSync(srcPath);

      // Runway Gen-4 holds up better on human motion, which is what gym b-roll
      // is — so it's preferred whenever its key is set, with fal/Kling as the
      // fallback so the feature still works without a Runway account.
      const useRunway = isRunwayConfigured();
      const aspectRatio = getProject(input.projectId)?.aspectRatio ?? "9:16";
      const mp4 = useRunway
        ? await runwayGenerateVideo({
            imageBytes,
            imageMime: source.mimeType || "image/jpeg",
            prompt: input.prompt,
            durationSec: input.durationSec,
            aspectRatio,
          })
        : await falGenerateVideo({
            imageBytes,
            imageMime: source.mimeType || "image/jpeg",
            prompt: input.prompt,
            durationSec: input.durationSec,
          });

      const filename = `aibroll-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.mp4`;
      const dest = path.join(uploadDir(input.projectId), filename);
      fs.writeFileSync(dest, mp4);

      // Probe so the timeline knows the clip's real duration/dimensions.
      let durationSeconds: number | null = null;
      let width: number | null = null;
      let height: number | null = null;
      try {
        const p = await probe(dest);
        durationSeconds = p.durationSeconds || null;
        width = p.width;
        height = p.height;
      } catch {
        // A probe failure shouldn't lose the clip — the timeline falls back.
      }

      db.update(schema.videoAssets)
        .set({
          filename,
          sizeBytes: mp4.length,
          durationSeconds,
          width,
          height,
          genStatus: "ready",
          genError: null,
        })
        .where(eq(schema.videoAssets.id, input.assetId))
        .run();

      // Charge only once the clip actually landed, against whichever provider
      // actually produced it.
      meterAndChargeFlat(
        tenantId,
        "video",
        useRunway ? RUNWAY_MODEL_ID : VIDEO_MODEL_ID,
        useRunway ? runwayCostCents(input.durationSec) : videoCostCents(input.durationSec),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[content-studio] b-roll generation failed for ${input.assetId}:`, err);
      fail(message);
    }
  });
}
