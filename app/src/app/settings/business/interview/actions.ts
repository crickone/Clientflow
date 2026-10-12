"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import { deleteKey, getVenueType, readKey, setKey } from "@/lib/settings";
import { getBusinessProfile, setBusinessProfile } from "@/lib/businessProfile";
import { AiCapError, assertAiAllowed } from "@/lib/ai/usage";
import { writeBrandProfile, type BrandDraft } from "@/lib/ai/writeBrandProfile";
import { answeredCount, answersAsText, interviewQuestions, type Answers } from "@/lib/brandInterview/questions";
import { listTherapies } from "@/lib/queries";

const KEY = "brand_interview";
type Fail = { ok: false; error: string };

function clean(answers: Answers): Answers {
  const out: Answers = {};
  for (const [id, a] of Object.entries(answers ?? {})) {
    if (!/^[a-zA-Z]{1,30}$/.test(id) || !a || typeof a !== "object") continue;
    const text = typeof a.text === "string" ? a.text.slice(0, 2000) : undefined;
    const picks = Array.isArray(a.picks) ? a.picks.filter((p) => typeof p === "string").map((p) => p.slice(0, 80)).slice(0, 20) : undefined;
    out[id] = { ...(text !== undefined ? { text } : {}), ...(picks ? { picks } : {}) };
  }
  return out;
}

/** Saved as the owner goes, so the interview can be left and picked up again. */
export async function saveInterviewAction(answers: Answers): Promise<{ ok: true }> {
  await requireAdmin();
  setKey(KEY, { answers: clean(answers), updatedAt: Date.now() });
  return { ok: true };
}

export async function writeBrandDraftAction(answers: Answers): Promise<{ ok: true; draft: BrandDraft } | Fail> {
  await requireAdmin();
  const tenantId = getCurrentMembership()!.tenant.id;
  const a = clean(answers);
  setKey(KEY, { answers: a, updatedAt: Date.now() });
  if (answeredCount(a) < 3) return { ok: false, error: "Answer at least a few questions so Adonis has something to work from." };
  try {
    assertAiAllowed(tenantId);
  } catch (err) {
    return { ok: false, error: err instanceof AiCapError ? err.message : "AI is not available right now." };
  }
  const profile = getBusinessProfile();
  const venue = getVenueType();
  const services = (await listTherapies()).map((t) => t.name);
  const questions = interviewQuestions(venue, { name: profile.businessName, town: "", services });
  try {
    const draft = await writeBrandProfile(tenantId, {
      businessName: profile.businessName,
      venue,
      location: profile.location,
      answers: answersAsText(questions, a),
    });
    return { ok: true, draft };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't write it. Try again." };
  }
}

export type ApplyInput = Partial<Pick<BrandDraft, "tagline" | "brief" | "voiceNotes" | "marketingBrain" | "imageStyle">>;

/** Save the parts the owner kept, as edited. Anything left out is untouched. */
export async function applyBrandDraftAction(input: ApplyInput): Promise<{ ok: true } | Fail> {
  await requireAdmin();
  const p = getBusinessProfile();
  const take = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : undefined);
  const next = { ...p };
  const tagline = take(input.tagline, 120);
  const brief = take(input.brief, 4000);
  const voice = take(input.voiceNotes, 2000);
  const brain = take(input.marketingBrain, 8000);
  if (tagline !== undefined) next.tagline = tagline;
  if (brief !== undefined) next.brief = brief;
  if (voice !== undefined) next.voiceNotes = voice;
  if (brain !== undefined) next.marketingBrain = brain;
  setBusinessProfile(next);
  const style = take(input.imageStyle, 600);
  if (style !== undefined) {
    if (style) setKey("brand_image_style", style);
    else deleteKey("brand_image_style");
  }
  revalidatePath("/settings/business");
  revalidatePath("/settings/branding");
  return { ok: true };
}

export async function readInterview(): Promise<Answers> {
  await requireAdmin();
  return clean(readKey<{ answers?: Answers }>(KEY, {}).answers ?? {});
}
