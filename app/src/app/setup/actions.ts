"use server";

import { requireAdmin } from "@/lib/auth";
import { getBusinessProfile, setBusinessProfile } from "@/lib/businessProfile";
import {
  setVenueType,
  setSchedulingMode,
  type VenueType,
  type SchedulingMode,
} from "@/lib/settings";
import { ackVenue, skipStep, setSetupDismissed } from "@/lib/setup/steps";

type Res = { ok: true } | { ok: false; error: string };

/** Merges the Setup hub's "Business essentials" fields into the existing
 * profile — everything else (email/brief/voiceNotes/marketingBrain/policies/
 * faqs) is preserved untouched via the spread. */
export async function saveBusinessEssentialsAction(input: {
  businessName: string;
  tagline: string;
  location: string;
  phone: string;
  website: string;
}): Promise<Res> {
  await requireAdmin();
  const name = String(input?.businessName ?? "").trim();
  if (!name) return { ok: false, error: "Business name is required." };
  const current = getBusinessProfile();
  setBusinessProfile({
    ...current,
    businessName: name,
    tagline: String(input.tagline ?? "").trim(),
    location: String(input.location ?? "").trim(),
    phone: String(input.phone ?? "").trim(),
    website: String(input.website ?? "").trim(),
  });
  return { ok: true };
}

export async function ackVenueAction(input: {
  venue: VenueType;
  scheduling: SchedulingMode;
}): Promise<Res> {
  await requireAdmin();
  setVenueType(input.venue);
  setSchedulingMode(input.scheduling);
  ackVenue();
  return { ok: true };
}

export async function skipStepAction(id: string): Promise<Res> {
  await requireAdmin();
  try {
    skipStep(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't skip." };
  }
}

export async function dismissSetupAction(): Promise<Res> {
  await requireAdmin();
  setSetupDismissed(true);
  return { ok: true };
}
