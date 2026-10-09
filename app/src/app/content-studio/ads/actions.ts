"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { AiCapError, assertAiAllowed } from "@/lib/ai/usage";
import { CTAS } from "@/lib/ads/spec";
import { AD_GOALS, LIMITS, coerceCopy, parseBrief, type AdCopy } from "@/lib/ads/adCopy";
import {
  createAdCreative,
  deleteAdCreative,
  getAdCreative,
  queueImageAd,
  redesignAdImage,
  saveVideoCopy,
  setAdSaved,
  relabelAdButton,
  ctaWords,
  renameAdCreative,
  saveVersionCopy,
  type AdCreativeView,
} from "@/lib/ads/creatives";
import { titleFrom } from "@/lib/content-studio/title";
import { queueVideoAd } from "@/lib/ads/videoAds";

type Fail = { ok: false; error: string };
const tenantId = () => getCurrentMembership()!.tenant.id;

const briefSchema = z.object({
  offer: z.string().trim().min(3, "Say what the ad is for.").max(600),
  audience: z.string().trim().max(300).default(""),
  goal: z.enum(AD_GOALS),
  linkUrl: z.string().trim().max(500).default(""),
});

/** Start an image ad: saved at once, written and designed in the background. */
export async function createImageAdAction(input: z.input<typeof briefSchema>): Promise<{ ok: true; id: number } | Fail> {
  await requireUser();
  const parsed = briefSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the brief." };
  if (parsed.data.linkUrl && !/^https:\/\//i.test(parsed.data.linkUrl)) return { ok: false, error: "The link must start with https://" };
  try {
    assertAiAllowed(tenantId());
  } catch (err) {
    return { ok: false, error: err instanceof AiCapError ? err.message : "AI is not available right now." };
  }
  const brief = parseBrief(parsed.data);
  const row = createAdCreative({ name: titleFrom(brief.offer, 80) || "New ad", kind: "image", brief });
  queueImageAd(tenantId(), row.id);
  revalidatePath("/content-studio");
  return { ok: true, id: row.id };
}

export async function adStatusAction(id: number): Promise<AdCreativeView | null> {
  await requireUser();
  return getAdCreative(id);
}

export async function retryAdAction(id: number): Promise<{ ok: true } | Fail> {
  await requireUser();
  const ad = getAdCreative(id);
  if (!ad) return { ok: false, error: "That ad is gone." };
  if (ad.status === "writing") return { ok: false, error: "Adonis is already making this ad." };
  try {
    assertAiAllowed(tenantId());
  } catch (err) {
    return { ok: false, error: err instanceof AiCapError ? err.message : "AI is not available right now." };
  }
  if (ad.kind === "video") queueVideoAd(tenantId(), id);
  else queueImageAd(tenantId(), id);
  return { ok: true };
}

const copySchema = z.object({
  angle: z.string().max(60),
  hook: z.string().max(60),
  support: z.string().max(110),
  primaryText: z.string().trim().min(1, "The main text cannot be empty.").max(LIMITS.primaryText),
  headline: z.string().trim().min(1, "The headline cannot be empty.").max(40),
  description: z.string().max(30),
  cta: z.enum(CTAS),
});

/** Save one version's ad copy (what Meta shows around the image). */
export async function saveAdCopyAction(adId: number, designId: number, copy: AdCopy): Promise<{ ok: true } | Fail> {
  await requireUser();
  const ad = getAdCreative(adId);
  if (!ad?.versions.some((v) => v.designId === designId)) return { ok: false, error: "That version is gone." };
  const parsed = copySchema.safeParse(copy);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the text." };
  const clean = coerceCopy(parsed.data, ad.brief.goal);
  if (!clean) return { ok: false, error: "The headline and main text are needed." };
  const before = ad.versions.find((v) => v.designId === designId)?.copy ?? null;
  saveVersionCopy(designId, clean);
  // The image carries the button too; keep it saying the same thing.
  if (before && before.cta !== clean.cta) {
    try {
      await relabelAdButton(designId, ctaWords(before.cta), ctaWords(clean.cta));
    } catch (err) {
      console.error("[ads] button relabel failed:", err);
      return { ok: false, error: "The text was saved, but the button on the images could not be updated. Try another design for each size." };
    }
  }
  revalidatePath(`/content-studio/ads/${adId}`);
  return { ok: true };
}

/** Save one of a video ad's text versions. */
export async function saveVideoAdCopyAction(adId: number, index: number, copy: AdCopy): Promise<{ ok: true } | Fail> {
  await requireUser();
  const ad = getAdCreative(adId);
  if (!ad || ad.kind !== "video" || !ad.videoCopies[index]) return { ok: false, error: "That version is gone." };
  const parsed = copySchema.safeParse(copy);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the text." };
  const clean = coerceCopy(parsed.data, ad.brief.goal);
  if (!clean) return { ok: false, error: "The headline and main text are needed." };
  saveVideoCopy(adId, index, clean);
  return { ok: true };
}

export async function redesignAdImageAction(adId: number, slideId: number, note: string | null): Promise<{ ok: true } | Fail> {
  await requireUser();
  try {
    assertAiAllowed(tenantId());
    await redesignAdImage(tenantId(), adId, slideId, note);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not redesign that image." };
  }
}

export async function renameAdAction(id: number, name: string): Promise<{ ok: true }> {
  await requireUser();
  renameAdCreative(id, name.trim() || "Untitled ad");
  return { ok: true };
}

export async function setAdSavedAction(id: number, saved: boolean): Promise<{ ok: true }> {
  await requireUser();
  setAdSaved(id, saved);
  revalidatePath("/content-studio/ads");
  return { ok: true };
}

export async function deleteAdAction(id: number): Promise<{ ok: true }> {
  await requireUser();
  deleteAdCreative(id);
  revalidatePath("/content-studio");
  return { ok: true };
}
