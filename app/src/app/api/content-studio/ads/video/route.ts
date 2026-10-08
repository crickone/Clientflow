import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { getCurrentTenant } from "@/lib/db/tenant";
import { AiCapError, assertAiAllowed } from "@/lib/ai/usage";
import { createProject } from "@/lib/video/projects";
import { saveClips } from "@/lib/video/saveClips";
import { AD_GOALS, parseBrief } from "@/lib/ads/adCopy";
import { createAdCreative } from "@/lib/ads/creatives";
import { queueVideoAd } from "@/lib/ads/videoAds";
import { titleFrom } from "@/lib/content-studio/title";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Start a video ad: the brief plus the clip (and any b-roll). Saves the clip
 * into a video project, records the ad, and hands the rest (transcribe, cut,
 * text, render) to a detached run.
 */
export async function POST(req: Request) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "The upload did not arrive. Try again." }, { status: 400 });
  }
  const tenantId = getCurrentTenant().id;
  const brief = parseBrief({
    offer: form.get("offer"),
    audience: form.get("audience"),
    goal: form.get("goal"),
    linkUrl: form.get("linkUrl"),
  });
  if (brief.offer.length < 3) return NextResponse.json({ ok: false, error: "Say what the ad is for." }, { status: 400 });
  if (!(AD_GOALS as readonly string[]).includes(String(form.get("goal")))) return NextResponse.json({ ok: false, error: "Pick what people should do." }, { status: 400 });
  if (brief.linkUrl && !/^https:\/\//i.test(brief.linkUrl)) return NextResponse.json({ ok: false, error: "The link must start with https://" }, { status: 400 });
  const main = form.get("main");
  if (!(main instanceof File) || main.size === 0) return NextResponse.json({ ok: false, error: "Upload the clip for the ad." }, { status: 400 });
  try {
    assertAiAllowed(tenantId);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof AiCapError ? err.message : "AI is not available right now." }, { status: 429 });
  }
  const seconds = Math.max(8, Math.min(60, Number(form.get("seconds")) || 25));
  const broll = form.getAll("broll").filter((v): v is File => v instanceof File && v.size > 0);

  const name = titleFrom(brief.offer, 80) || "Video ad";
  const project = createProject({ name: `Ad: ${name}`, aspectRatio: "9:16", targetSeconds: seconds, toneNotes: "Paid ad" });
  try {
    await saveClips(project.id, tenantId, { main, broll, libraryBroll: [] });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Could not save the clip." }, { status: 500 });
  }
  const ad = createAdCreative({ name, kind: "video", brief, videoProjectId: project.id });
  queueVideoAd(tenantId, ad.id);
  return NextResponse.json({ ok: true, id: ad.id });
}
