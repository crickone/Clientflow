import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { isSafeConsolePath, listViews, saveViews } from "@/lib/platform/views";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  return NextResponse.json({ views: listViews(g.userId) });
}

// The count limit lives in saveViews so the console gets its readable message, not a schema error.
const schema = z.object({
  views: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().min(1).max(60), href: z.string().max(500).refine(isSafeConsolePath, "Path must be a console path") })),
});

/** Replaces the whole list; the console sends it back edited. Not audited: it is the person's own bookmarks. */
export async function PUT(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That list does not make sense." }, { status: 400 });
  const saved = saveViews(g.userId, parsed.data.views);
  if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error }, { status: 400 });
  return NextResponse.json({ ok: true, views: listViews(g.userId) });
}
