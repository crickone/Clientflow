import "server-only";

import { db, schema } from "@/lib/db";
import { getCurrentTenant, runWithTenant } from "@/lib/db/tenant";
import { eq } from "drizzle-orm";
import { draftBlogPost, type BlogDraftInput } from "@/lib/ai/draftBlog";
import { getBlogPost, updateBlogContent } from "@/lib/blog/posts";
import type { Transcript } from "@/lib/ai/transcribe";
import { AiCapError } from "@/lib/ai/usage";

function loadTherapy(id: number | null) {
  if (!id) return null;
  return (
    db
      .select()
      .from(schema.therapies)
      .where(eq(schema.therapies.id, id))
      .get() ?? null
  );
}

function loadVideoContext(id: number | null): {
  name: string | null;
  transcript: string | null;
} {
  if (!id) return { name: null, transcript: null };
  const project = db
    .select()
    .from(schema.videoProjects)
    .where(eq(schema.videoProjects.id, id))
    .get();
  if (!project) return { name: null, transcript: null };
  let transcriptText: string | null = null;
  if (project.transcriptJson) {
    try {
      const parsed = JSON.parse(project.transcriptJson) as Transcript;
      transcriptText = parsed.text ?? null;
    } catch {
      transcriptText = null;
    }
  }
  return { name: project.name, transcript: transcriptText };
}

/**
 * Fire-and-forget: writes the generated content (or an error) back to the
 * blog_posts row. Safe to call without awaiting from an API route.
 *
 * Metering: `draftBlogPost` self-meters via `meteredCreate` (@/lib/ai/metered)
 * — it enforces the tenant's monthly AI cap and records the spend — so this is
 * a SEPARATE, non-agent call path to the same generator (the CMS blog editor's
 * "Generate" button, not the Marketing agent chat) that just passes its own
 * agentKey ("blog") rather than "marketing", keeping the per-agent spend
 * breakdown meaningful. AiCapError is left to propagate into the catch below,
 * which ALREADY converts any error (missing key, model failure, ...) into
 * `status: "failed"` + an operator-visible `error` message — for a capped
 * tenant that message is AiCapError's own clean text, which is exactly the
 * "surface it, don't crash" outcome this fire-and-forget flow needs (never any
 * different from how every other failure here is handled).
 */
export function runBlogGeneration(postId: number) {
  // Capture the tenant while still in the request; the detached body below runs
  // after the response, when cookie context is gone. Without this the generated
  // blog would be written to the default tenant's DB, not this clinic's.
  const tenantId = getCurrentTenant().id;
  void runWithTenant(tenantId, async () => {
    const post = getBlogPost(postId);
    if (!post) return;
    try {
      const therapy = loadTherapy(post.sourceTherapyId);
      const video = loadVideoContext(post.sourceVideoProjectId);

      const draftInput: BlogDraftInput = {
        title: post.title,
        inputMode: post.inputMode,
        prompt: post.prompt,
        tone: post.tone,
        targetWords: post.targetWords,
        therapy,
        videoTranscript: video.transcript,
        videoProjectName: video.name,
      };

      // draftBlogPost self-meters (assertUnderCap + recordUsage inside, via
      // meteredCreate) under this "blog" agentKey — AiCapError propagates to
      // the catch below, which surfaces it as this post's `failed` status.
      const result = await draftBlogPost(draftInput, { tenantId, agentKey: "blog" });
      updateBlogContent(postId, {
        content: result.content,
        status: "ready",
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Blog generation failed.";
      if (err instanceof AiCapError) {
        console.error(`[blog] generation skipped for post ${postId} — tenant is over its monthly AI cap`);
      } else {
        console.error(`[blog] generation failed for post ${postId}:`, err);
      }
      updateBlogContent(postId, {
        status: "failed",
        error: message,
      });
    }
  });
}
