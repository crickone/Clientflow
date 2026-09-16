import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { assertAiAllowed, meterAndChargeFlat } from "@/lib/ai/usage";
import { processImageUpload } from "@/lib/image/processUpload";
import { addLibraryAsset, libraryDir } from "@/lib/image/library";
import type { ImageLibraryAsset } from "@/lib/db/schema";
import {
  EDIT_MODEL_ID,
  editCostCents,
  openaiEditImage,
  type EditSize,
} from "./openaiImageClient";
import { ASPECT_DIMS, type ImageAspect } from "./prompt";

/**
 * The ONE metered path for editing a photograph the slide already has — the
 * counterpart of ./generatePostImage, and the same gate → call → meter
 * contract: assertAiAllowed → openaiEditImage → save into the image library →
 * meterAndChargeFlat.
 *
 * The one real difference from a generation is the charge. A FLUX image is a
 * flat 4¢, so generatePostImage can name the price before it calls. An edit is
 * billed on tokens that depend on the size of the photograph going in and the
 * quality coming out, so the cost is computed from the usage the call reports
 * and charged afterwards. The cap is still checked BEFORE the call -- that is
 * what assertAiAllowed is -- so an over-cap tenant never reaches OpenAI; what
 * moves is only how the amount is known.
 *
 * THE RESULT IS A NEW LIBRARY ASSET, never a replacement. The photograph that
 * went in is a real picture of a real room, and an edit is a derived thing
 * that may be wrong, refused or simply not what the operator meant. Writing
 * over the original would destroy the only copy on a maybe.
 */
export async function editPostImage(
  input: {
    /** The library asset being edited — its file is the source image. */
    sourcePath: string;
    /** What the operator asked for, in their own words. */
    instruction: string;
    aspectRatio: ImageAspect;
    quality?: "low" | "medium" | "high";
  },
  meter: { tenantId: number; agentKey: string },
): Promise<ImageLibraryAsset> {
  assertAiAllowed(meter.tenantId);

  const source = fs.readFileSync(input.sourcePath);
  const mimeType = input.sourcePath.toLowerCase().endsWith(".png")
    ? "image/png"
    : "image/jpeg";

  const { bytes, usage } = await openaiEditImage({
    image: source,
    mimeType,
    prompt: editPrompt(input.instruction),
    size: editSizeFor(input.aspectRatio),
    quality: input.quality ?? "high",
  });

  const dims = ASPECT_DIMS[input.aspectRatio] ?? ASPECT_DIMS["1:1"];
  // The model returns PNG; processImageUpload re-encodes to the library's JPEG
  // exactly as it does for an upload or a generation, so an edited photograph
  // is the same kind of thing as every other photograph in the library.
  const { buffer, width, height } = await processImageUpload(bytes, "image/png");
  const filename = `edited-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.jpg`;
  fs.writeFileSync(path.join(libraryDir(), filename), buffer);

  const asset = addLibraryAsset({
    filename,
    originalName: filename,
    mimeType: "image/jpeg",
    kind: "image",
    sizeBytes: buffer.length,
    width: width ?? dims.width,
    height: height ?? dims.height,
    label: `Edited · ${input.instruction.slice(0, 60)}`,
  });

  meterAndChargeFlat(
    meter.tenantId,
    meter.agentKey,
    EDIT_MODEL_ID,
    editCostCents(usage),
  );
  return asset;
}

/**
 * The instruction, wrapped so the model changes ONE thing.
 *
 * Without this an edit model happily re-imagines the whole frame: asked to
 * change the person, it returns a different room, a different light and a
 * different camera position, and the slide's composition -- which was designed
 * around that photograph -- no longer fits it. Naming what must not change is
 * what keeps an edit an edit.
 */
export function editPrompt(instruction: string): string {
  return (
    `Edit this photograph. ${instruction.trim()}\n\n` +
    `Change ONLY what that asks for. Keep everything else exactly as it is: ` +
    `the room, the equipment, the framing, the camera angle, the lighting and ` +
    `the colour. Do not add text, signage or lettering. The result must look ` +
    `like a real photograph taken in this room, not an illustration.`
  );
}

/** The canvas aspect, as one of the three sizes the edit endpoint takes. */
export function editSizeFor(aspectRatio: ImageAspect): EditSize {
  if (aspectRatio === "9:16" || aspectRatio === "4:5") return "1024x1536";
  return "1024x1024";
}
