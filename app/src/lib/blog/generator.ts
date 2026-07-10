import "server-only";

import { db, schema } from "@/lib/db";
import { getCurrentTenant, runWithTenant } from "@/lib/db/tenant";
import { eq } from "drizzle-orm";
import { draftBlogPost, type BlogDraftInput } from "@/lib/ai/draftBlog";
import { getBlogPost, updateBlogContent } from "@/lib/blog/posts";
import type { Transcript } from "@/lib/ai/transcribe";

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

      const result = await draftBlogPost(draftInput);
      updateBlogContent(postId, {
        content: result.content,
        status: "ready",
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Blog generation failed.";
      console.error(`[blog] generation failed for post ${postId}:`, err);
      updateBlogContent(postId, {
        status: "failed",
        error: message,
      });
    }
  });
}
