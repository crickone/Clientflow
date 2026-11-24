import "server-only";

import { getBrandImageStyle } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";
import { buildImagePrompt, defaultImageStyle } from "@/lib/ai/image/prompt";
import { isImageGenConfigured } from "@/lib/ai/image/falClient";
import { generatePostImage } from "@/lib/ai/image/generatePostImage";
import { libraryFilePath } from "@/lib/image/library";
import type { PhotoChoice } from "@/lib/ai/designPost.parse";

/**
 * Makes a photograph to a slide's scene, in the business's house style, and
 * returns it as a library choice. Undefined when image generation isn't set
 * up, so callers fall back to the library. Throws AiCapError at the monthly
 * cap (the caller decides what to do); any other failure is the caller's to
 * catch too.
 */
export function scenePhotographer(
  tenantId: number,
  agentKey: string,
  fallbackTopic: string,
): ((scene: string) => Promise<PhotoChoice | null>) | undefined {
  if (!isImageGenConfigured()) return undefined;
  const houseStyle = getBrandImageStyle() ?? defaultImageStyle(getBusinessProfile());
  if (!houseStyle) return undefined;
  return async (scene: string) => {
    const asset = await generatePostImage(
      { prompt: buildImagePrompt({ houseStyle, scene: scene || fallbackTopic }), aspectRatio: "1:1" },
      { tenantId, agentKey },
    );
    return { id: asset.id, path: libraryFilePath(asset.filename) };
  };
}
