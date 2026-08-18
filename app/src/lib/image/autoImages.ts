import "server-only";

import { runWithTenant } from "@/lib/db/tenant";
import { updateSlide } from "@/lib/image/carousels";
import { AiCapError } from "@/lib/ai/usage";
import { generatePostImage } from "@/lib/ai/image/generatePostImage";
import type { ImageAspect } from "@/lib/ai/image/prompt";

export interface SlideImageJob {
  slideId: number;
  prompt: string;
  aspectRatio: ImageAspect;
}

/**
 * Fire-and-forget background generation of slide images — the
 * runBlogGeneration pattern: the caller captures the tenant while still in
 * the request; this detached continuation re-enters it after the response
 * has gone out (Railway runs a persistent `next start`, not serverless).
 *
 * SEQUENTIAL on purpose: gentle on fal rate limits, and a 5-slide set still
 * completes in ~30–60s. Per-slide failure marks that slide 'failed' and
 * continues; AiCapError marks the current + ALL remaining slides 'failed'
 * with the cap message and stops (no pointless further gate-hits).
 */
export function queueSlideImages(tenantId: number, jobs: SlideImageJob[]): void {
  if (jobs.length === 0) return;
  void runWithTenant(tenantId, async () => {
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      try {
        const asset = await generatePostImage(
          { prompt: job.prompt, aspectRatio: job.aspectRatio },
          { tenantId, agentKey: "carousel" },
        );
        updateSlide(job.slideId, {
          backgroundAssetId: asset.id,
          imageStatus: "ready",
          imageError: null,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Image generation failed.";
        if (err instanceof AiCapError) {
          for (const rest of jobs.slice(i)) {
            updateSlide(rest.slideId, { imageStatus: "failed", imageError: message });
          }
          console.error("[autoImages] stopped — tenant over its AI allowance");
          return;
        }
        updateSlide(job.slideId, { imageStatus: "failed", imageError: message });
        console.error(`[autoImages] slide ${job.slideId} failed:`, err);
      }
    }
  });
}
