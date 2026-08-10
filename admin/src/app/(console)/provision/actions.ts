"use server";

import { api, ApiError } from "@/lib/api";

export interface ProvisionedAdmin {
  email: string;
  /** Present only for a brand-new identity — copy this to hand it over. */
  tempPassword?: string;
  /** True when this email already had a login — no password was touched. */
  existing: boolean;
  /** True for the first admin — the tenant's primary owner. */
  owner: boolean;
}

export type ProvisionState =
  | { ok: false; error?: string }
  | {
      ok: true;
      tenantId: number;
      name: string;
      admins: ProvisionedAdmin[];
      addMe: boolean;
    };

interface ProvisionResponse {
  ok: true;
  tenantId: number;
  admins: ProvisionedAdmin[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * `useFormState` action: provisions a REAL tenant via the platform API (new
 * tenant DB + one-or-more admin users + billing row + welcome emails) — not a
 * preview. Admin rows arrive as repeated same-named fields (`adminEmail` /
 * `adminName`, one pair per row, in DOM order) rather than indexed names —
 * the simplest encoding for a dynamically-sized list of rows in a plain
 * `<form>`. Blank rows are dropped; emails are validated and deduped
 * case-insensitively (first occurrence wins, so row 1 stays the owner even if
 * its email is repeated further down).
 */
export async function provisionGym(_prev: ProvisionState, formData: FormData): Promise<ProvisionState> {
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  const venueType = String(formData.get("venueType") ?? "gym");
  const addMe = formData.get("addMe") === "on";

  if (!name) return { ok: false, error: "Name is required." };
  if (!slug) return { ok: false, error: "Slug is required." };
  if (venueType !== "gym" && venueType !== "clinic") return { ok: false, error: "Invalid venue type." };

  const rawEmails = formData.getAll("adminEmail").map((v) => String(v).trim());
  const rawNames = formData.getAll("adminName").map((v) => String(v).trim());

  const seen = new Set<string>();
  const admins: Array<{ email: string; name?: string }> = [];
  for (let i = 0; i < rawEmails.length; i++) {
    const email = rawEmails[i];
    if (!email) continue; // blank row — skip silently
    if (!EMAIL_RE.test(email)) return { ok: false, error: `"${email}" isn't a valid email address.` };
    const key = email.toLowerCase();
    if (seen.has(key)) continue; // dedupe — first occurrence wins
    seen.add(key);
    const adminName = rawNames[i];
    admins.push(adminName ? { email, name: adminName } : { email });
  }
  if (admins.length === 0) return { ok: false, error: "At least one admin email is required." };

  try {
    const res = await api<ProvisionResponse>("/tenants", {
      method: "POST",
      body: { name, slug, venueType, admins, addMe },
    });
    return { ok: true, tenantId: res.tenantId, name, admins: res.admins, addMe };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "Failed to provision business." };
  }
}
