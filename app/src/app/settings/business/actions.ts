"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import { authDb } from "@/lib/db/control";
import { tenants } from "@/lib/db/schema";
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

  // Keep the control-plane registry name (the account switcher + platform admin
  // read tenants.name) in sync with the business name so both match. The tenant
  // SLUG is never touched — only the display name; requireAdmin above scopes
  // this to the caller's own current tenant.
  const membership = getCurrentMembership();
  if (membership && clean.businessName) {
    authDb
      .update(tenants)
      .set({ name: clean.businessName })
      .where(eq(tenants.id, membership.tenant.id))
      .run();
  }

  // Identity feeds the chrome (metadata, sidebar, login) resolved in the layout.
  revalidatePath("/", "layout");
  return { ok: true as const };
}
