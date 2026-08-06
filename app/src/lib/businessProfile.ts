import "server-only";

import { readKey, readKeyForTenant, setKey } from "@/lib/settings";

/**
 * Editable business identity. Replaces hardcoded "Renova" across the AI prompts
 * and the visible app name. Stored as one JSON value in the settings table
 * (single instance for now; becomes per-tenant in the tenancy phase).
 */
export interface BusinessProfile {
  businessName: string;
  /** Short descriptor, e.g. "a recovery & wellness business". */
  tagline: string;
  location: string;
  phone: string;
  website: string;
  email: string;
  /** Free-text brief: what the business does, who it serves, what's distinctive. Feeds AI content. */
  brief: string;
  /** Optional extra tone notes, layered on top of the venue-type voice. */
  voiceNotes: string;
  /**
   * The "marketing brain" — a master prompt that dictates the industry, subject
   * matter, audience, content pillars and tone for ALL AI content generation.
   * When set, it becomes the authoritative voice block (overriding the generic
   * clinic/gym voice). This is what makes a gym account generate gym + nutrition
   * content instead of the wellness-clinic baseline.
   */
  marketingBrain: string;
  /** Policies the AI may reference (cancellation, payment, etc.). */
  policies: string;
  /** Key FAQs the AI can answer directly — grounds FAQ auto-replies. */
  faqs: { q: string; a: string }[];
}

/** Defaults mirror Renova's current details, so an un-set profile == today. */
const DEFAULT_PROFILE: BusinessProfile = {
  businessName: "Renova Cellular Health",
  tagline: "a recovery & wellness business",
  location: "Ard Gaoithe Business Park, Clonmel, Co. Tipperary",
  phone: "083 867 2844",
  website: "renovacellularhealth.ie",
  email: "",
  brief: "",
  voiceNotes: "",
  marketingBrain: "",
  policies: "",
  faqs: [],
};

export function getBusinessProfile(): BusinessProfile {
  const stored = readKey<Partial<BusinessProfile>>("business_profile", {});
  return { ...DEFAULT_PROFILE, ...stored };
}

/** Business profile for an explicit tenant (background jobs). */
export function getBusinessProfileForTenant(tenantId: number): BusinessProfile {
  const stored = readKeyForTenant<Partial<BusinessProfile>>(tenantId, "business_profile", {});
  return { ...DEFAULT_PROFILE, ...stored };
}

export function setBusinessProfile(profile: BusinessProfile): void {
  setKey("business_profile", profile);
}

/**
 * The brief is "complete enough" to ground the AI inbox once the free-text
 * brief is filled. Until then, auto-reply stays disabled.
 */
export function isBriefComplete(): boolean {
  return getBusinessProfile().brief.trim().length > 0;
}
