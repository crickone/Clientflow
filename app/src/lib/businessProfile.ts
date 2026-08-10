import "server-only";

import { getCurrentTenant, getTenantById } from "@/lib/db/tenant";
import { readKey, readKeyForTenant, setKey } from "@/lib/settings";

/**
 * Editable business identity — the visible app name plus the details the AI
 * prompts reference. Stored as one JSON value in each tenant's OWN settings
 * table (per-tenant: readKey/readKeyForTenant are tenant-scoped). An un-set
 * profile falls back to the tenant's own registry name, never another tenant's
 * — see NEUTRAL_DEFAULT / resolveProfile.
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

/**
 * Neutral defaults for a tenant that has NOT filled in its business profile.
 * Everything blank except businessName, which is resolved to the tenant's OWN
 * registry name at read time (see resolveProfile). This is the tenant-isolation
 * guarantee: an un-configured tenant must NEVER inherit another tenant's
 * identity — name, phone, website, or address — anywhere the profile surfaces
 * (the chrome lockup, outbound client emails, the client app, AI content).
 */
const NEUTRAL_DEFAULT: BusinessProfile = {
  businessName: "",
  tagline: "",
  location: "",
  phone: "",
  website: "",
  email: "",
  brief: "",
  voiceNotes: "",
  marketingBrain: "",
  policies: "",
  faqs: [],
};

/**
 * Renova is the original tenant; its real details historically lived in the
 * profile default (it never explicitly saved a business_profile). Preserve them
 * as a slug-scoped base so the live clinic's identity is unchanged WITHOUT
 * writing to its DB. Anything Renova later saves in Settings → Business still
 * wins (stored is spread over this).
 */
const RENOVA_DEFAULTS: Partial<BusinessProfile> = {
  businessName: "Renova Cellular Health",
  tagline: "a recovery & wellness business",
  location: "Ard Gaoithe Business Park, Clonmel, Co. Tipperary",
  phone: "083 867 2844",
  website: "renovacellularhealth.ie",
};

/** Baseline profile for a tenant, before its stored overrides are applied. */
function baseProfile(slug: string | undefined): BusinessProfile {
  return slug === "renova" ? { ...NEUTRAL_DEFAULT, ...RENOVA_DEFAULTS } : NEUTRAL_DEFAULT;
}

/**
 * Merge stored overrides onto the baseline, then fall an unset businessName back
 * to the tenant's OWN registry name (`name`) — never a hardcoded or other
 * tenant's name. `slug`/`name` come from the control-plane tenant row.
 */
function resolveProfile(
  slug: string | undefined,
  name: string | undefined,
  stored: Partial<BusinessProfile>,
): BusinessProfile {
  const merged = { ...baseProfile(slug), ...stored };
  if (!merged.businessName) merged.businessName = name ?? "";
  return merged;
}

export function getBusinessProfile(): BusinessProfile {
  const tenant = getCurrentTenant();
  const stored = readKey<Partial<BusinessProfile>>("business_profile", {});
  return resolveProfile(tenant.slug, tenant.name, stored);
}

/** Business profile for an explicit tenant (background jobs). */
export function getBusinessProfileForTenant(tenantId: number): BusinessProfile {
  const tenant = getTenantById(tenantId);
  const stored = readKeyForTenant<Partial<BusinessProfile>>(tenantId, "business_profile", {});
  return resolveProfile(tenant?.slug, tenant?.name, stored);
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
