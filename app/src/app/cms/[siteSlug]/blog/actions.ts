"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import {
  createSiteBlogPost,
  updateBlogMeta,
  setPublishState,
  deleteSiteBlogPost,
} from "@/lib/cms/blog";
import { runBlogGeneration } from "@/lib/blog/generator";

async function siteOrThrow(siteSlug: string) {
  await requireAdminPage();
  const site = await getSiteBySlug(siteSlug);
  if (!site) throw new Error(`Unknown site: ${siteSlug}`);
  return site;
}

export type NewPostState = { ok: boolean; error?: string };

export async function createPostAction(
  siteSlug: string,
  _prev: NewPostState,
  formData: FormData,
): Promise<NewPostState> {
  const site = await siteOrThrow(siteSlug);
  const title = String(formData.get("title") ?? "").trim();
  const prompt = String(formData.get("prompt") ?? "").trim();
  const tone = String(formData.get("tone") ?? "").trim();
  const targetWords = Number(formData.get("targetWords") ?? 700) || 700;
  if (!title) return { ok: false, error: "A title is required." };

  const post = createSiteBlogPost({
    siteId: site.id,
    title,
    inputMode: "prompt",
    prompt: prompt || null,
    tone: tone || null,
    targetWords,
    sourceTherapyId: null,
    sourceVideoProjectId: null,
  });

  // Fire the AI generation (async, updates content+status when done).
  runBlogGeneration(post.id);

  revalidatePath(`/cms/${siteSlug}/blog`);
  redirect(`/cms/${siteSlug}/blog/${post.id}`);
}

export async function savePostAction(
  siteSlug: string,
  postId: number,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const site = await siteOrThrow(siteSlug);
  const cover = String(formData.get("coverImageUrl") ?? "").trim();
  updateBlogMeta(site.id, postId, {
    title: String(formData.get("title") ?? "").trim() || undefined,
    slug: String(formData.get("slug") ?? "").trim() || undefined,
    excerpt: String(formData.get("excerpt") ?? "").trim() || null,
    seoTitle: String(formData.get("seoTitle") ?? "").trim() || null,
    seoDescription: String(formData.get("seoDescription") ?? "").trim() || null,
    content: String(formData.get("content") ?? ""),
    coverImageUrl: cover || null,
    coverAspect: cover ? String(formData.get("coverAspect") ?? "").trim() || null : null,
    coverPosition: cover ? String(formData.get("coverPosition") ?? "").trim() || null : null,
  });
  revalidatePath(`/cms/${siteSlug}/blog/${postId}`);
  revalidatePath(`/cms/${siteSlug}/blog`);
  return { ok: true };
}

export async function publishPostAction(siteSlug: string, postId: number) {
  const site = await siteOrThrow(siteSlug);
  setPublishState(site.id, postId, "published");
  revalidatePath(`/cms/${siteSlug}/blog/${postId}`);
  revalidatePath(`/cms/${siteSlug}/blog`);
}

export async function unpublishPostAction(siteSlug: string, postId: number) {
  const site = await siteOrThrow(siteSlug);
  setPublishState(site.id, postId, "draft");
  revalidatePath(`/cms/${siteSlug}/blog/${postId}`);
  revalidatePath(`/cms/${siteSlug}/blog`);
}

export async function deletePostAction(siteSlug: string, postId: number) {
  const site = await siteOrThrow(siteSlug);
  deleteSiteBlogPost(site.id, postId);
  revalidatePath(`/cms/${siteSlug}/blog`);
  redirect(`/cms/${siteSlug}/blog`);
}
