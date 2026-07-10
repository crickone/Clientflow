import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import {
  deleteBlogPost,
  getBlogPost,
  updateBlogContent,
} from "@/lib/blog/posts";
import { runBlogGeneration } from "@/lib/blog/generator";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const id = Number(params.id);
  const post = getBlogPost(id);
  if (!post) {
    return NextResponse.json(
      { ok: false, error: "Not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, post });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const id = Number(params.id);
  const post = getBlogPost(id);
  if (!post) {
    return NextResponse.json(
      { ok: false, error: "Not found." },
      { status: 404 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const patch: {
    title?: string;
    content?: string;
    coverImageUrl?: string | null;
    coverAspect?: string | null;
    coverPosition?: string | null;
  } = {};
  if (typeof body?.title === "string") patch.title = body.title.trim();
  if (typeof body?.content === "string") patch.content = body.content;
  if ("coverImageUrl" in body) {
    patch.coverImageUrl =
      body.coverImageUrl == null ? null : String(body.coverImageUrl);
  }
  if ("coverAspect" in body) {
    patch.coverAspect =
      body.coverAspect == null ? null : String(body.coverAspect);
  }
  if ("coverPosition" in body) {
    patch.coverPosition =
      body.coverPosition == null ? null : String(body.coverPosition);
  }

  if (body?.action === "regenerate") {
    updateBlogContent(id, { status: "generating", error: null });
    runBlogGeneration(id);
    return NextResponse.json({ ok: true, post: getBlogPost(id) });
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, post });
  }

  updateBlogContent(id, patch);
  return NextResponse.json({ ok: true, post: getBlogPost(id) });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const id = Number(params.id);
  const post = getBlogPost(id);
  if (!post) {
    return NextResponse.json(
      { ok: false, error: "Not found." },
      { status: 404 },
    );
  }
  deleteBlogPost(id);
  return NextResponse.json({ ok: true });
}
