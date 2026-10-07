"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin, getCurrentMembership } from "@/lib/auth";
import {
  GoogleApiError,
  deleteGoogleBusinessConnection,
  listAnalyticsProperties,
  listGoogleListings,
  listSearchConsoleSites,
  setGoogleSelection,
  syncGoogleReviews,
  type ListingChoice,
} from "@/lib/google/business";

type Fail = { ok: false; error: string };
const fail = (err: unknown): Fail => ({ ok: false, error: err instanceof GoogleApiError ? err.message : "Google did not answer. Try again in a minute." });

function tenantId(): number {
  return getCurrentMembership()!.tenant.id;
}

/** Everything the signed-in Google account can pick from. Each part fails on its own. */
export async function loadGoogleChoicesAction(): Promise<{
  listings: { ok: true; items: ListingChoice[] } | Fail;
  sites: { ok: true; items: string[] } | Fail;
  properties: { ok: true; items: { property: string; name: string }[] } | Fail;
}> {
  await requireAdmin();
  const t = tenantId();
  const [listings, sites, properties] = await Promise.all([
    listGoogleListings(t).then((items) => ({ ok: true as const, items })).catch(fail),
    listSearchConsoleSites(t).then((items) => ({ ok: true as const, items })).catch(fail),
    listAnalyticsProperties(t).then((items) => ({ ok: true as const, items })).catch(fail),
  ]);
  return { listings, sites, properties };
}

const choice = z.object({
  listing: z.object({ accountName: z.string().startsWith("accounts/"), locationName: z.string().startsWith("locations/"), title: z.string().max(300) }).nullable().optional(),
  site: z.string().max(500).nullable().optional(),
  property: z.object({ property: z.string().startsWith("properties/"), name: z.string().max(300) }).nullable().optional(),
});

export async function saveGoogleChoicesAction(input: z.infer<typeof choice>): Promise<{ ok: true } | Fail> {
  await requireAdmin();
  const parsed = choice.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That choice is not valid." };
  const v = parsed.data;
  const t = tenantId();
  setGoogleSelection(t, {
    ...(v.listing !== undefined
      ? { accountName: v.listing?.accountName ?? null, locationName: v.listing?.locationName ?? null, locationTitle: v.listing?.title ?? null }
      : {}),
    ...(v.site !== undefined ? { searchConsoleSite: v.site } : {}),
    ...(v.property !== undefined ? { ga4Property: v.property?.property ?? null, ga4PropertyName: v.property?.name ?? null } : {}),
  });
  // A newly picked listing pulls its reviews straight away.
  if (v.listing) await syncGoogleReviews(t).catch(() => 0);
  revalidatePath("/settings/integrations/google");
  revalidatePath("/communication");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function disconnectGoogleAction(): Promise<{ ok: true }> {
  await requireAdmin();
  deleteGoogleBusinessConnection(tenantId());
  revalidatePath("/settings/integrations/google");
  return { ok: true };
}
