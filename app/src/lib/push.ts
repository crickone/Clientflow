import "server-only";

import webpush from "web-push";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { pushLog, pushPrefs, pushSubscriptions } from "@/lib/db/schema";
import { DEFAULT_PREFS, type Prefs } from "@/lib/remindersModel";

/**
 * Push notifications to members' phones, for the CURRENT tenant (ambient
 * `db`; the ticker binds it). Standard Web Push with our VAPID keys
 * (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY on the server). On iPhone it works
 * once the member has added the app to their Home Screen (iOS 16.4+).
 */

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim());
}

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT?.trim() || "mailto:privacy@adonisagent.ie", process.env.VAPID_PUBLIC_KEY!.trim(), process.env.VAPID_PRIVATE_KEY!.trim());
  configured = true;
}

export function saveSubscription(clientId: number, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string | null): void {
  const row = { clientId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 300) ?? null, createdAt: Date.now() };
  db.insert(pushSubscriptions)
    .values(row)
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: row })
    .run();
}

export function removeSubscription(clientId: number, endpoint: string): void {
  db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.clientId, clientId), eq(pushSubscriptions.endpoint, endpoint))).run();
}

export function deviceCount(clientId: number): number {
  return db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.clientId, clientId)).all().length;
}

export function clientsWithPush(): number[] {
  return [...new Set(db.select({ clientId: pushSubscriptions.clientId }).from(pushSubscriptions).all().map((r) => r.clientId))];
}

export function getPrefs(clientId: number): Prefs {
  const r = db.select().from(pushPrefs).where(eq(pushPrefs.clientId, clientId)).get();
  return r ? { classes: r.classes, checkins: r.checkins, habits: r.habits } : { ...DEFAULT_PREFS };
}

export function setPrefs(clientId: number, prefs: Prefs): void {
  db.insert(pushPrefs)
    .values({ clientId, ...prefs })
    .onConflictDoUpdate({ target: pushPrefs.clientId, set: prefs })
    .run();
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping it opens, inside the app. */
  url: string;
}

/**
 * Send to every device the member has. With a `key`, at most once ever: the
 * key is claimed first so a second ticker pass can't send it again. Dead
 * devices (gone or unsubscribed) are removed. Returns devices reached.
 */
export async function sendToClient(clientId: number, msg: PushMessage, key?: string): Promise<number> {
  if (!isPushConfigured()) return 0;
  const subs = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.clientId, clientId)).all();
  if (subs.length === 0) return 0;
  if (key) {
    const claimed = db.insert(pushLog).values({ clientId, key, sentAt: Date.now() }).onConflictDoNothing().run().changes;
    if (claimed === 0) return 0;
  }
  configure();
  let reached = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 6 * 3600, urgency: "normal" });
      reached++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).run();
      else console.error("[push] send failed", code, (err as Error).message?.slice(0, 200));
    }
  }
  return reached;
}
