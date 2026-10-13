import "server-only";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { campaigns } from "@/lib/db/schema";

/**
 * Ad-only offers. A campaign with an access key shows its prices and Buy
 * buttons only to a visitor who arrived with ?k=<key> (the link in the ads),
 * remembered in a cookie so the price is still there when they come back
 * from Stripe or reload. It can't stop someone forwarding the ad link; it
 * keeps the prices off the plain page address and out of search engines.
 * Ambient tenant `db`.
 */

export const ACCESS_PARAM = "k";
export const accessCookieName = (campaignId: number) => `oak_${campaignId}`;

export function getOfferAccessKey(campaignId: number): string | null {
  return db.select({ k: campaigns.offerAccessKey }).from(campaigns).where(eq(campaigns.id, campaignId)).get()?.k ?? null;
}

/** Turn ad-only on (a new key) or off (no key). Returns the key in force. */
export function setOfferAccessKey(campaignId: number, on: boolean): string | null {
  const key = on ? crypto.randomBytes(6).toString("base64url") : null;
  db.update(campaigns).set({ offerAccessKey: key }).where(eq(campaigns.id, campaignId)).run();
  return key;
}

export function hasOfferAccess(key: string | null, fromUrl: string | undefined, fromCookie: string | undefined): boolean {
  if (!key) return true;
  return safeEqual(fromUrl, key) || safeEqual(fromCookie, key);
}

function safeEqual(a: string | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
