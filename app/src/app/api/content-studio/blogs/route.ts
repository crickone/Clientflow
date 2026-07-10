import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import {
  createBlogPost,
  listBlogPosts,
  type BlogInputMode,
} from "@/lib/blog/posts";
import { runBlogGeneration } from "@/lib/blog/generator";

export const dynamic = "force-dynamic";

export async function GET() {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const posts = listBlogPosts();
  return NextResponse.json({ ok: true, posts });
}

export async function POST(req: Request) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const title = String(body?.title ?? "").trim();
  const inputMode = String(body?.inputMode ?? "") as BlogInputMode;
  const prompt = body?.prompt ? String(body.prompt).trim() : null;
  const tone = body?.tone ? String(body.tone).trim() : null;
  const targetWords = Number(body?.targetWords);
  const sourceTherapyId = body?.sourceTherapyId
    ? Number(body.sourceTherapyId)
    : null;
  const sourceVideoProjectId = body?.sourceVideoProjectId
    ? Number(body.sourceVideoProjectId)
    : null;

  if (!title) {
    return NextResponse.json(
      { ok: false, error: "Title is required." },
      { status: 400 },
    );
  }
  if (!["prompt", "therapy", "video"].includes(inputMode)) {
    return NextResponse.json(
      { ok: false, error: "inputMode must be prompt | therapy | video." },
      { status: 400 },
    );
  }
  if (inputMode === "therapy" && !sourceTherapyId) {
    return NextResponse.json(
      { ok: false, error: "Pick a therapy." },
      { status: 400 },
    );
  }
  if (inputMode === "video" && !sourceVideoProjectId) {
    return NextResponse.json(
      { ok: false, error: "Pick a video to repurpose." },
      { status: 400 },
    );
  }

  const post = createBlogPost({
    title,
    inputMode,
    sourceVideoProjectId,
    sourceTherapyId,
    prompt,
    tone,
    targetWords:
      Number.isFinite(targetWords) && targetWords >= 200 && targetWords <= 2500
        ? targetWords
        : 700,
  });

  runBlogGeneration(post.id);

  return NextResponse.json({ ok: true, postId: post.id });
}
