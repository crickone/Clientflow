import "server-only";

import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { runWithTenant } from "@/lib/db/tenant";
import { adCreatives } from "@/lib/db/schema";
import { transcribeVideo, type Transcript } from "@/lib/ai/transcribe";
import { planAdCut } from "@/lib/ai/planAdCut";
import { planCut } from "@/lib/ai/planCut";
import { writeAdCopy } from "@/lib/ai/writeAdCopy";
import { AiCapError } from "@/lib/ai/usage";
import { getAssets, getProject, setStatus, updateProjectFields, uploadDir } from "@/lib/video/projects";
import { renderProject } from "@/lib/video/render";
import { adSegmentsFromIds, fallbackAdSegments } from "@/lib/video/adCut";
import { appendEndCard, renderAdEndCard } from "@/lib/video/adEndCard";
import { outputDuration, remapWordsThroughSegments, type MainSegment } from "@/lib/video/timeline";
import { resolveRasterLogoPath } from "@/lib/branding";
import { resolveTrackPath } from "@/lib/video/music";
import { getBusinessProfile } from "@/lib/businessProfile";
import { parseBrief } from "./adCopy";
import { ctaWords } from "./creatives";

/**
 * A video ad: the operator's clip cut as an ad. Transcribe, let Adonis pick
 * the opening line and the sentences that earn their place (inside the
 * length limit), place any b-roll on that cut, write the ad text, then render
 * it twice -- 9:16 for Stories and Reels, square for the feed -- each ending
 * on the business's own end card. The cut is saved as the video project's
 * timeline, so it can be opened and adjusted in the normal video editor.
 */

export const VIDEO_AD_SIZES = ["9:16", "1:1"] as const;
export type VideoAdSize = (typeof VIDEO_AD_SIZES)[number];

const setState = (id: number, patch: Record<string, unknown>) =>
  db.update(adCreatives).set({ ...patch, updatedAt: new Date() }).where(eq(adCreatives.id, id)).run();

export function queueVideoAd(tenantId: number, adId: number): void {
  setState(adId, { status: "writing", stage: "Transcribing the clip", error: null, startedAt: new Date() });
  void runWithTenant(tenantId, async () => {
    try {
      await runVideoAd(tenantId, adId);
      setState(adId, { status: null, stage: null, error: null });
    } catch (err) {
      console.error(`[ads] video ad ${adId} failed:`, err);
      setState(adId, {
        status: "failed",
        stage: null,
        error: err instanceof AiCapError ? err.message : err instanceof Error ? err.message : "The video ad could not be made.",
      });
    }
  });
}

async function runVideoAd(tenantId: number, adId: number): Promise<void> {
  const ad = db.select().from(adCreatives).where(eq(adCreatives.id, adId)).get();
  if (!ad?.videoProjectId) throw new Error("This ad has no clip.");
  const project = getProject(ad.videoProjectId);
  if (!project) throw new Error("The clip for this ad is gone.");
  const brief = parseBrief(JSON.parse(ad.brief || "{}"));
  const assets = getAssets(project.id);
  const main = assets.find((a) => a.kind === "main");
  if (!main) throw new Error("No clip was uploaded.");
  const dir = uploadDir(project.id);
  const mainPath = path.join(dir, main.filename);

  // 1. What was said (reuse an existing transcript on a "make it again").
  let transcript: Transcript;
  if (project.transcriptJson) transcript = JSON.parse(project.transcriptJson) as Transcript;
  else {
    setStatus(project.id, "transcribing", { error: null });
    transcript = await transcribeVideo(mainPath);
    setStatus(project.id, "transcribed", { transcriptJson: JSON.stringify(transcript), error: null });
  }
  if (!transcript.words.length) throw new Error("No speech was found in the clip. A video ad needs someone talking (captions are built from what is said).");

  // 2. The cut: hook first, then what earns its place.
  setState(adId, { stage: "Choosing the opening line and the cut" });
  const maxSec = Math.max(8, Math.min(60, project.targetSeconds || 25));
  const picked = await planAdCut({ tenantId, transcript, brief, maxSeconds: maxSec }).catch((err) => {
    if (err instanceof AiCapError) throw err;
    return { order: [] as number[], hook: "" };
  });
  let segments: MainSegment[] = adSegmentsFromIds(picked.order, transcript.segments, transcript.words, transcript.durationSeconds, maxSec);
  if (segments.length === 0) segments = fallbackAdSegments(transcript.segments, transcript.words, transcript.durationSeconds, maxSec);

  // B-roll, placed against the CUT (output time), not the original clip.
  const broll = assets.filter((a) => a.kind === "broll" && !!a.filename && a.genStatus !== "generating" && a.genStatus !== "failed");
  let brollInserts: { startSec: number; endSec: number; brollAssetId: number; reason: string; brollStartSec?: number }[] = [];
  if (broll.length) {
    setState(adId, { stage: "Placing the b-roll" });
    const outTranscript: Transcript = { ...transcript, words: remapWordsThroughSegments(transcript.words, segments), durationSeconds: outputDuration(segments) };
    try {
      const plan = await planCut({
        transcript: outTranscript,
        broll: broll.map((b) => ({ assetId: b.id, originalName: b.originalName, durationSeconds: b.durationSeconds ?? 0 })),
        toneNotes: "A paid ad: keep the speaker on screen for the opening line.",
        tenantId,
      });
      brollInserts = plan.brollInserts;
    } catch (err) {
      if (err instanceof AiCapError) throw err;
    }
  }
  updateProjectFields(project.id, {
    timelineJson: JSON.stringify({ mainSegments: segments, brollInserts: brollInserts.map((b) => ({ ...b, brollStartSec: b.brollStartSec ?? 0 })) }),
    showIntroOutro: false,
  });

  // 3. The ad text, written from what the video actually says.
  setState(adId, { stage: "Writing the ad text" });
  const said = segments
    .map((s) => transcript.words.filter((w) => w.start >= s.sourceStart && w.end <= s.sourceEnd).map((w) => w.word).join(" "))
    .join(" ")
    .slice(0, 900);
  const copies = await writeAdCopy(tenantId, { ...brief, offer: `${brief.offer}\n\nThe video ad says: "${said}"` });
  setState(adId, { copy: JSON.stringify(copies) });

  // 4. Two renders, each ending on the end card.
  const profile = getBusinessProfile();
  const logoPath = await resolveRasterLogoPath();
  const contact = profile.phone || profile.website.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const footer = [profile.businessName, profile.location].filter(Boolean).join(" · ");
  const cta = ctaWords(copies[0]?.cta ?? "LEARN_MORE");
  const outputs: Partial<Record<VideoAdSize, string>> = {};
  const stamp = Date.now();
  const timeline = { mainSegments: segments, brollInserts };
  for (const size of VIDEO_AD_SIZES) {
    setState(adId, { stage: size === "9:16" ? "Rendering Stories and Reels (9:16)" : "Rendering the square feed version" });
    setStatus(project.id, "rendering", { error: null });
    const tag = size.replace(":", "x");
    const body = path.join(dir, `adbody-${tag}-${stamp}.mp4`);
    const card = path.join(dir, `adcard-${tag}-${stamp}.mp4`);
    const final = `ad-${tag}-${stamp}.mp4`;
    await renderProject({
      mainPath,
      mainRotation: main.rotation ?? 0,
      brollAssets: broll.map((b) => ({ assetId: b.id, filePath: path.join(dir, b.filename), rotation: b.rotation ?? 0 })),
      plan: { brollInserts: timeline.brollInserts },
      mainSegments: timeline.mainSegments,
      transcript,
      aspectRatio: size,
      outputPath: body,
      workDir: dir,
      captionFont: project.captionFont,
      musicPath: project.musicFilename ? resolveTrackPath(project.musicFilename) : null,
      musicVolume: project.musicVolume,
      autoTrimSilence: false,
      showIntroOutro: false,
      logoPath: null,
      introDurationSec: 0,
    });
    await renderAdEndCard({ aspectRatio: size, output: card, workDir: dir, logoPath, cta, contact, footer });
    await appendEndCard({ body, card, output: path.join(dir, final), workDir: dir });
    for (const f of [body, card]) fs.rmSync(f, { force: true });
    outputs[size] = final;
  }
  setStatus(project.id, "rendered", { outputFilename: outputs["9:16"] ?? null, error: null });
  setState(adId, { videoOutputs: JSON.stringify(outputs) });
}
