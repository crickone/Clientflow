import "server-only";

import fs from "node:fs";
import path from "node:path";

import { getAppBaseUrl } from "@/lib/appUrl";
import { resolveLogoPathForTenant } from "@/lib/branding";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { boundTenantId, getTenantById, resolveCurrentTenant } from "@/lib/db/tenant";
import { getDesignSystemForTenant } from "@/lib/design/system";

/**
 * How a business's emails look: its own uploaded logo (Settings > Branding),
 * its brand accent (the design system's accent colour) and a contact line.
 * renderEmailShell applies it to every email a business sends a customer.
 */
export interface EmailBrand {
  businessName: string;
  accent: string | null;
  logoUrl: string | null;
  contactLine: string;
}

const RASTER = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function emailBrandForTenant(tenantId: number): EmailBrand {
  const p = getBusinessProfileForTenant(tenantId);
  let accent: string | null = null;
  try {
    accent = getDesignSystemForTenant(tenantId)?.values.find((v) => v.role === "accent")?.hex ?? null;
  } catch {
    accent = null;
  }
  let logoUrl: string | null = null;
  try {
    const file = resolveLogoPathForTenant(tenantId);
    const slug = getTenantById(tenantId)?.slug;
    if (file && slug && RASTER.has(path.extname(file).toLowerCase())) {
      const v = Math.round(fs.statSync(file).mtimeMs);
      logoUrl = `${getAppBaseUrl()}/api/branding/logo/email?t=${encodeURIComponent(slug)}&v=${v}`;
    }
  } catch {
    logoUrl = null;
  }
  const site = p.website.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const contactLine = [p.businessName, p.location.trim(), p.phone.trim(), site].filter(Boolean).join(" · ");
  return { businessName: p.businessName, accent, logoUrl, contactLine };
}

/** The brand of the business this code is running for, or null outside one. Never throws. */
export function currentEmailBrand(): EmailBrand | null {
  try {
    const id = boundTenantId() ?? resolveCurrentTenant()?.id ?? null;
    return id == null ? null : emailBrandForTenant(id);
  } catch {
    return null;
  }
}
