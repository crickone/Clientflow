import "server-only";

import { readKey, setKey } from "@/lib/settings";

/**
 * A connected Facebook Page + its linked Instagram. Stored as a single settings
 * key for now (single-tenant); shaped so the tenancy refactor can scope it
 * per-clinic without changing the call sites. The page access token is a
 * SECRET — never log it.
 */
export type SocialStatus = "connected" | "invalid";

export interface SocialConnection {
  pageId: string;
  pageName: string;
  /** Long-lived Page access token (secret). */
  pageAccessToken: string;
  igUserId: string | null;
  igUsername: string | null;
  connectedAt: string; // ISO timestamp
  status: SocialStatus;
}

const KEY = "social_connection";

export function getSocialConnection(): SocialConnection | null {
  const c = readKey<SocialConnection | null>(KEY, null);
  return c && c.pageId ? c : null;
}

export function setSocialConnection(conn: SocialConnection): void {
  setKey(KEY, conn);
}

export function clearSocialConnection(): void {
  setKey(KEY, null);
}

/** Flag the connection as needing a reconnect (e.g. token expired/revoked). */
export function markSocialInvalid(): void {
  const c = getSocialConnection();
  if (c) setKey(KEY, { ...c, status: "invalid" });
}

/** A Page is connected and the token is believed valid. */
export function isSocialConnected(): boolean {
  const c = getSocialConnection();
  return !!c && c.status === "connected";
}

/** A connected Page that also has a linked IG business account. */
export function isInstagramConnected(): boolean {
  const c = getSocialConnection();
  return !!c && c.status === "connected" && !!c.igUserId;
}
