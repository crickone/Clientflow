import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { and, eq, gt, isNotNull } from "drizzle-orm";

import { controlDb } from "@/lib/db/control";
import { siteDomains } from "@/lib/db/schema";
import { getTenantById } from "@/lib/db/tenant";
import { SITE_HOST_HEADER } from "@/lib/cms/proxyHost";
import { normalizeHost } from "@/lib/cms/resolveHost";
import { getAppBaseUrl } from "@/lib/appUrl";

/**
 * The member app on a business's own domain (www.gym.ie/app).
 *
 * A request counts as "on a business's domain" only when it came through the
 * Cloudflare Worker (the middleware sets SITE_HOST_HEADER after checking the
 * Worker's secret and strips any other copy) AND the domain is ownership-
 * verified in site_domains. Anything else -- app.adonisagent.ie, localhost, a
 * forged header -- is the platform address, where any member can sign in.
 */

function proxiedHost(): string | null {
  try {
    return normalizeHost(headers().get(SITE_HOST_HEADER));
  } catch {
    return null; // outside a request
  }
}

export const clientAppHost = cache((): { host: string; tenantId: number } | null => {
  const host = proxiedHost();
  if (!host) return null;
  const row = controlDb.select().from(siteDomains).where(eq(siteDomains.host, host)).get();
  if (!row || !row.verifiedAt) return null;
  const tenant = getTenantById(row.tenantId);
  if (!tenant || tenant.isActive === false) return null;
  return { host, tenantId: row.tenantId };
});

const lastNoted = new Map<string, number>();
const NOTE_EVERY_MS = 60 * 60 * 1000;

/**
 * Record that this request's domain reached us through the Worker, i.e. the
 * business's DNS really points here. At most once an hour per host per
 * process, so a busy site costs one small write an hour.
 */
export function noteProxiedHost(): void {
  const host = proxiedHost();
  if (!host) return;
  const now = Date.now();
  if ((lastNoted.get(host) ?? 0) > now - NOTE_EVERY_MS) return;
  lastNoted.set(host, now);
  try {
    controlDb.update(siteDomains).set({ proxiedSeenAt: new Date(now) }).where(eq(siteDomains.host, host)).run();
  } catch (err) {
    console.error("[clientAppHost] could not note proxied host", err);
  }
}

const LIVE_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Where a business's members open the app, for emailed links: its own domain
 * once that domain is verified and has been reached through the Worker in the
 * last 30 days (the primary one first), otherwise the platform address.
 */
export function clientAppBaseUrl(tenantId: number): string {
  const rows = controlDb
    .select()
    .from(siteDomains)
    .where(
      and(
        eq(siteDomains.tenantId, tenantId),
        isNotNull(siteDomains.verifiedAt),
        gt(siteDomains.proxiedSeenAt, new Date(Date.now() - LIVE_WITHIN_MS)),
      ),
    )
    .all();
  const pick = rows.find((r) => r.isPrimary) ?? [...rows].sort((a, b) => (b.proxiedSeenAt?.getTime() ?? 0) - (a.proxiedSeenAt?.getTime() ?? 0))[0];
  return pick ? `https://${pick.host}` : getAppBaseUrl();
}
