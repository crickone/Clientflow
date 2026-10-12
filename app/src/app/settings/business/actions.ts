"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import { authDb } from "@/lib/db/control";
import { tenants } from "@/lib/db/schema";
import { getBusinessProfile, setBusinessProfile, type BusinessProfile } from "@/lib/businessProfile";

/**
 * Save ONLY the fields that changed, merged into what is stored now.
 *
 * The form used to send the whole profile, so a stale copy of the page (the
 * browser's cached one after the brand interview saved, then an autofilled
 * phone number made it "dirty") wrote its empty brief and marketing brain
 * straight over the ones just saved. A patch can't clobber a field it
 * didn't touch.
 */
export async function updateBusinessProfile(patch: Partial<BusinessProfile>) {
  await requireAdmin();
  const current = getBusinessProfile();
  const str = (k: keyof BusinessProfile) => (typeof patch[k] === "string" ? (patch[k] as string).trim() : (current[k] as string));
  const clean: BusinessProfile = {
    ...current,
    businessName: str("businessName"),
    tagline: str("tagline"),
    location: str("location"),
    phone: str("phone"),
    website: str("website"),
    email: str("email"),
    signupUrl: typeof patch.signupUrl === "string" ? patch.signupUrl.trim() : current.signupUrl ?? "",
    brief: str("brief"),
    voiceNotes: str("voiceNotes"),
    marketingBrain: str("marketingBrain"),
    policies: str("policies"),
    faqs: Array.isArray(patch.faqs)
      ? patch.faqs.map((f) => ({ q: f.q.trim(), a: f.a.trim() })).filter((f) => f.q || f.a)
      : current.faqs,
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
