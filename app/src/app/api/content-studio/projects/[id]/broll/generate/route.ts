import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { addAsset, ensureUploadDir, getProject } from "@/lib/video/projects";
import { getLibraryAsset } from "@/lib/image/library";
import { isVideoGenConfigured, videoCostCents } from "@/lib/ai/video/falVideoClient";
import { runBrollGeneration } from "@/lib/ai/video/generateBroll";
import { MOTION_PRESETS, type MotionPreset } from "@/lib/ai/video/motionPresets";

export const dynamic = "force-dynamic";

/**
 * Generate AI b-roll for a project from the client's own photos.
 *
 * Spending money is an admin action (same bar as the other paid AI surfaces).
 * Each requested photo becomes one 'generating' asset row immediately so the
 * editor can show it in the tray and poll; the actual fal call runs detached
 * (1–3 min per clip) and fills the row in — see runBrollGeneration.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("admin");
  if (__auth) return __auth;

  const projectId = Number(params.id);
  const project = getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "Project not found." }, { status: 404 });
  }
  if (!isVideoGenConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Video generation isn't configured (FAL_KEY missing)." },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const input = body as {
    libraryAssetIds?: unknown;
    prompt?: unknown;
    durationSec?: unknown;
    motion?: unknown;
  };

  const ids = Array.isArray(input.libraryAssetIds)
    ? input.libraryAssetIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (ids.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Pick at least one photo to animate." },
      { status: 400 },
    );
  }
  // A sane ceiling — each clip is a real charge, so a fat-fingered request
  // can't queue up dozens of generations at once.
  if (ids.length > 6) {
    return NextResponse.json(
      { ok: false, error: "You can generate up to 6 clips at a time." },
      { status: 400 },
    );
  }

  const durationSec = Number(input.durationSec) === 10 ? 10 : 5;
  // A typed preset unless the operator wrote their own words.
  const preset: MotionPreset =
    input.motion === "camera" || input.motion === "pan" ? input.motion : "action";
  const basePrompt =
    typeof input.prompt === "string" && input.prompt.trim()
      ? input.prompt.trim().slice(0, 400)
      : MOTION_PRESETS[preset];

  const created: number[] = [];
  ensureUploadDir(projectId);

  for (const libraryAssetId of ids) {
    const source = getLibraryAsset(libraryAssetId);
    if (!source) continue; // silently skip unknown photos
    const asset = addAsset({
      projectId,
      kind: "broll",
      filename: "", // filled in when generation completes
      originalName: `AI b-roll · ${source.originalName}`,
      mimeType: "video/mp4",
      sizeBytes: 0,
      durationSeconds: null,
      width: null,
      height: null,
    });
    db.update(schema.videoAssets)
      .set({ genStatus: "generating", genPrompt: basePrompt })
      .where(eq(schema.videoAssets.id, asset.id))
      .run();
    created.push(asset.id);
    runBrollGeneration({
      assetId: asset.id,
      projectId,
      libraryAssetId,
      prompt: basePrompt,
      durationSec,
    });
  }

  if (created.length === 0) {
    return NextResponse.json(
      { ok: false, error: "None of those photos could be found." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    assetIds: created,
    estimatedCostCents: created.length * videoCostCents(durationSec),
  });
}
