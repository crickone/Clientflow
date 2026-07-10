import "server-only";

import { db, schema } from "@/lib/db";
import type { BlogPost } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export type BlogInputMode = "prompt" | "therapy" | "video";

export interface CreateBlogPostInput {
  title: string;
  inputMode: BlogInputMode;
  sourceVideoProjectId: number | null;
  sourceTherapyId: number | null;
  prompt: string | null;
  tone: string | null;
  targetWords: number;
}

export function createBlogPost(input: CreateBlogPostInput) {
  const [row] = db
    .insert(schema.blogPosts)
    .values({
      title: input.title,
      inputMode: input.inputMode,
      sourceVideoProjectId: input.sourceVideoProjectId,
      sourceTherapyId: input.sourceTherapyId,
      prompt: input.prompt,
      tone: input.tone,
      targetWords: input.targetWords,
      status: "generating",
    })
    .returning()
    .all();
  return row;
}

export function getBlogPost(id: number) {
  return (
    db
      .select()
      .from(schema.blogPosts)
      .where(eq(schema.blogPosts.id, id))
      .get() ?? null
  );
}

export function listBlogPosts() {
  return db
    .select()
    .from(schema.blogPosts)
    .orderBy(desc(schema.blogPosts.createdAt))
    .all();
}

export function updateBlogContent(
  id: number,
  patch: {
    title?: string;
    content?: string;
    coverImageUrl?: string | null;
    coverAspect?: string | null;
    coverPosition?: string | null;
    status?: BlogPost["status"];
    error?: string | null;
  },
) {
  db.update(schema.blogPosts)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.blogPosts.id, id))
    .run();
}

export function deleteBlogPost(id: number) {
  db.delete(schema.blogPosts).where(eq(schema.blogPosts.id, id)).run();
}
