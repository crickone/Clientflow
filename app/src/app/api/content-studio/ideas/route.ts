import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { deleteIdea, listIdeas, markIdeaUsed, saveIdea } from "@/lib/content-studio/ideaLibrary";

export const dynamic = "force-dynamic";

/**
 * The ideas library. Admin-gated like the generator that feeds it (the ideas
 * carry the account's positioning, and deleting one is destructive).
 *
 * Deliberately NOT metered: saving, listing and deleting are plain database
 * work. Only generating ideas costs money, and that lives in ../post-ideas.
 */

/** The library, newest first, unused ideas ahead of used ones. */
export async function GET() {
  const __auth = await guard("admin");
  if (__auth) return __auth;
  return NextResponse.json({ ok: true, ideas: listIdeas() });
}

/** Keep an idea. Idempotent on the hook — saving twice returns the existing row. */
export async function POST(req: Request) {
  const __auth = await guard("admin");
  if (__auth) return __auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const hook = str(body.hook).trim();
  if (!hook) return NextResponse.json({ ok: false, error: "An idea needs a hook." }, { status: 400 });

  const idea = saveIdea({
    pillar: str(body.pillar),
    hook,
    teaches: str(body.teaches),
    basis: str(body.basis),
    needsSource: str(body.needsSource) || undefined,
  });
  return NextResponse.json({ ok: true, idea });
}

/** Mark an idea as turned into a post. Kept in the library, not removed. */
export async function PATCH(req: Request) {
  const __auth = await guard("admin");
  if (__auth) return __auth;
  try {
    const { hook } = (await req.json()) as { hook?: string };
    if (typeof hook === "string" && hook.trim()) markIdeaUsed(hook.trim());
  } catch {
    // A malformed body just means nothing to mark — not worth a 400 on a
    // best-effort bookkeeping call the UI doesn't wait on.
  }
  return NextResponse.json({ ok: true });
}

/** Remove an idea from the library for good. */
export async function DELETE(req: Request) {
  const __auth = await guard("admin");
  if (__auth) return __auth;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }
  deleteIdea(id);
  return NextResponse.json({ ok: true });
}
