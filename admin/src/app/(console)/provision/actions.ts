"use server";

import { api, ApiError } from "@/lib/api";

export type ProvisionState =
  | { ok: false; error?: string }
  | { ok: true; tenantId: number; tempPassword: string; name: string; ownerEmail: string };

interface ProvisionResponse {
  ok: true;
  tenantId: number;
  tempPassword: string;
}

/**
 * `useFormState` action: provisions a REAL tenant via the platform API (new
 * tenant DB + owner user + billing row + welcome email) — not a preview.
 */
export async function provisionGym(_prev: ProvisionState, formData: FormData): Promise<ProvisionState> {
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const venueType = String(formData.get("venueType") ?? "gym");
  const ownerEmail = String(formData.get("ownerEmail") ?? "").trim();
  const ownerName = String(formData.get("ownerName") ?? "").trim();

  if (!name) return { ok: false, error: "Name is required." };
  if (!slug) return { ok: false, error: "Slug is required." };
  if (venueType !== "gym" && venueType !== "clinic") return { ok: false, error: "Invalid venue type." };
  if (!ownerEmail) return { ok: false, error: "Owner email is required." };

  try {
    const res = await api<ProvisionResponse>("/tenants", {
      method: "POST",
      body: {
        name,
        slug,
        venueType,
        ownerEmail,
        ...(ownerName ? { ownerName } : {}),
      },
    });
    return { ok: true, tenantId: res.tenantId, tempPassword: res.tempPassword, name, ownerEmail };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "Failed to provision business." };
  }
}
