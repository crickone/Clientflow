"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { setBusinessProfile, type BusinessProfile } from "@/lib/businessProfile";

export async function updateBusinessProfile(profile: BusinessProfile) {
  await requireAdmin();
  const clean: BusinessProfile = {
    businessName: profile.businessName.trim(),
    tagline: profile.tagline.trim(),
    location: profile.location.trim(),
    phone: profile.phone.trim(),
    website: profile.website.trim(),
    email: profile.email.trim(),
    brief: profile.brief.trim(),
    voiceNotes: profile.voiceNotes.trim(),
    marketingBrain: profile.marketingBrain.trim(),
    policies: profile.policies.trim(),
    faqs: (profile.faqs ?? [])
      .map((f) => ({ q: f.q.trim(), a: f.a.trim() }))
      .filter((f) => f.q || f.a),
  };
  setBusinessProfile(clean);
  // Identity feeds the chrome (metadata, sidebar, login) resolved in the layout.
  revalidatePath("/", "layout");
  return { ok: true as const };
}
