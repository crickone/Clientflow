import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { assertAiAllowed, meterAndChargeFlat } from "@/lib/ai/usage";
import { processImageUpload } from "@/lib/image/processUpload";
import { addLibraryAsset, libraryDir } from "@/lib/image/library";
import type { ImageLibraryAsset } from "@/lib/db/schema";
import { falGenerateImage, IMAGE_COST_CENTS, IMAGE_MODEL_ID } from "./falClient";
import { ASPECT_DIMS, type ImageAspect } from "./prompt";

/**
 * The ONE metered path for a post-image generation — the image counterpart of
 * meteredCreate's gate → call → meter contract:
 *   assertAiAllowed → falGenerateImage → save into the image library →
 *   meterAndChargeFlat (flat 4¢/image under agentKey, model fal:flux-1.1-pro).
 *
 * Returns the created library asset (downscaled/re-encoded through
 * processImageUpload exactly like an uploaded photo) — callers set it as a
 * slide's backgroundAssetId. AiCapError and ImageGenError propagate; callers
 * decide (429 in the sync route, image_status='failed' in the detached queue).
 */
export async function generatePostImage(
  input: { prompt: string; aspectRatio: ImageAspect },
  meter: { tenantId: number; agentKey: string },
): Promise<ImageLibraryAsset> {
  assertAiAllowed(meter.tenantId);

  const dims = ASPECT_DIMS[input.aspectRatio] ?? ASPECT_DIMS["1:1"];
  const raw = await falGenerateImage({
    prompt: input.prompt,
    width: dims.width,
    height: dims.height,
  });

  const { buffer, width, height } = await processImageUpload(raw, "image/jpeg");
  const filename = `generated-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.jpg`;
  fs.writeFileSync(path.join(libraryDir(), filename), buffer);

  const asset = addLibraryAsset({
    filename,
    originalName: filename,
    mimeType: "image/jpeg",
    kind: "image",
    sizeBytes: buffer.length,
    width: width ?? dims.width,
    height: height ?? dims.height,
    label: `AI · ${input.prompt.slice(0, 60)}`,
  });

  meterAndChargeFlat(meter.tenantId, meter.agentKey, IMAGE_MODEL_ID, IMAGE_COST_CENTS);
  return asset;
}
