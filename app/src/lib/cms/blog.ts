import "server-only";

import { and, desc, eq, ne } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { BlogPost } from "@/lib/db/schema";
import type { TenantDb } from "@/lib/db/tenant";
import type { BlogInputMode } from "@/lib/blog/posts";

const { blogPosts } = schema;

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Ensure a slug is unique within a site (suffix -2, -3, … on collision). */
function uniqueSlug(siteId: number, base: string, ignoreId?: number): string {
  const root = slugify(base) || "post";
  let candidate = root;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = db
      .select({ id: blogPosts.id })
      .from(blogPosts)
      .where(and(eq(blogPosts.siteId, siteId), eq(blogPosts.slug, candidate)))
      .get();
    if (!clash || clash.id === ignoreId) return candidate;
    candidate = `${root}-${n++}`;
  }
}

export interface CreateSiteBlogInput {
  siteId: number;
  title: string;
  inputMode: BlogInputMode;
  prompt: string | null;
  tone: string | null;
  targetWords: number;
  sourceTherapyId: number | null;
  sourceVideoProjectId: number | null;
}

/** Create a site-scoped post (generation pending). Caller triggers runBlogGeneration. */
export function createSiteBlogPost(input: CreateSiteBlogInput): BlogPost {
  return db
    .insert(blogPosts)
    .values({
      siteId: input.siteId,
      title: input.title,
      inputMode: input.inputMode,
      prompt: input.prompt,
      tone: input.tone,
      targetWords: input.targetWords,
      sourceTherapyId: input.sourceTherapyId,
      sourceVideoProjectId: input.sourceVideoProjectId,
      status: "generating",
      publishState: "draft",
      slug: uniqueSlug(input.siteId, input.title),
    })
    .returning()
    .get();
}

export function listSiteBlogPosts(siteId: number): BlogPost[] {
  return db
    .select()
    .from(blogPosts)
    .where(eq(blogPosts.siteId, siteId))
    .orderBy(desc(blogPosts.createdAt))
    .all();
}

export function getSiteBlogPost(siteId: number, id: number): BlogPost | null {
  return (
    db
      .select()
      .from(blogPosts)
      .where(and(eq(blogPosts.siteId, siteId), eq(blogPosts.id, id)))
      .get() ?? null
  );
}

export interface BlogMetaPatch {
  title?: string;
  slug?: string;
  excerpt?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  content?: string;
  ogImageAssetId?: number | null;
  coverImageUrl?: string | null;
  coverAspect?: string | null;
  coverPosition?: string | null;
}

export function updateBlogMeta(
  siteId: number,
  id: number,
  patch: BlogMetaPatch,
): void {
  const next: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  if (patch.slug !== undefined) {
    next.slug = uniqueSlug(siteId, patch.slug || patch.title || "post", id);
  }
  db.update(blogPosts)
    .set(next)
    .where(and(eq(blogPosts.siteId, siteId), eq(blogPosts.id, id)))
    .run();
}

export function setPublishState(
  siteId: number,
  id: number,
  state: "draft" | "scheduled" | "published",
  scheduledFor?: Date | null,
): void {
  db.update(blogPosts)
    .set({
      publishState: state,
      publishedAt: state === "published" ? new Date() : null,
      scheduledFor: state === "scheduled" ? scheduledFor ?? null : null,
      updatedAt: new Date(),
    })
    .where(and(eq(blogPosts.siteId, siteId), eq(blogPosts.id, id)))
    .run();
}

export function deleteSiteBlogPost(siteId: number, id: number): void {
  db.delete(blogPosts)
    .where(and(eq(blogPosts.siteId, siteId), eq(blogPosts.id, id)))
    .run();
}

// ---- PUBLIC reads: take an explicitly-resolved TenantDb (never the cookie proxy) ----

export function listPublishedPosts(
  publicDb: TenantDb,
  siteId: number,
): BlogPost[] {
  return publicDb
    .select()
    .from(blogPosts)
    .where(
      and(
        eq(blogPosts.siteId, siteId),
        eq(blogPosts.publishState, "published"),
        ne(blogPosts.status, "generating"),
      ),
    )
    .orderBy(desc(blogPosts.publishedAt))
    .all();
}

export function getPublishedPostBySlug(
  publicDb: TenantDb,
  siteId: number,
  slug: string,
): BlogPost | null {
  return (
    publicDb
      .select()
      .from(blogPosts)
      .where(
        and(
          eq(blogPosts.siteId, siteId),
          eq(blogPosts.slug, slug),
          eq(blogPosts.publishState, "published"),
        ),
      )
      .get() ?? null
  );
}
