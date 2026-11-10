import "server-only";

import fs from "node:fs";
import path from "node:path";

import { resolveLogoPathForTenant } from "@/lib/branding";
import { renderTenantIcon } from "@/lib/tenantIcon";

import type { PublicSite } from "./resolveHost";
import { isSafeSiteSlug, pickSiteIconFile, siteIconHref, type SiteIconFile } from "./siteIconModel";

/** Size of the drawn fallback. Google asks for a multiple of 48px. */
const DRAWN_SIZE = 192;

function assetDir(siteSlug: string): string {
  return path.join(process.cwd(), "public", "sites", siteSlug, "assets");
}

function ownIconFile(siteSlug: string): { file: SiteIconFile; full: string; mtime: number } | null {
  if (!isSafeSiteSlug(siteSlug)) return null;
  let names: string[];
  try {
    names = fs.readdirSync(assetDir(siteSlug));
  } catch {
    return null;
  }
  const file = pickSiteIconFile(names);
  if (!file) return null;
  const full = path.join(assetDir(siteSlug), file.name);
  try {
    return { file, full, mtime: fs.statSync(full).mtimeMs };
  } catch {
    return null;
  }
}

function logoMtime(tenantId: number): number {
  const logo = resolveLogoPathForTenant(tenantId);
  if (!logo) return 0;
  try {
    return fs.statSync(logo).mtimeMs;
  } catch {
    return 0;
  }
}

/** The favicon link for a resolved site's pages. */
export function siteIconLink(site: PublicSite): string {
  const own = ownIconFile(site.site.slug);
  return siteIconHref(site.site.slug, own ? own.mtime : logoMtime(site.tenantId));
}

/** The icon itself: the site's own file, else one drawn from the business's logo. */
export async function siteIconResponse(site: PublicSite): Promise<{ body: Buffer; type: string }> {
  const own = ownIconFile(site.site.slug);
  if (own) return { body: fs.readFileSync(own.full), type: own.file.type };
  return { body: await renderTenantIcon({ tenantId: site.tenantId, size: DRAWN_SIZE }), type: "image/png" };
}
