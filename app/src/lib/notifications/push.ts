import "server-only";

import webpush from "web-push";
import { eq } from "drizzle-orm";

import { getTenantDbById } from "@/lib/db/tenant";
import { staffPushSubscriptions } from "@/lib/db/schema";
import { configureWebPush, isPushConfigured } from "@/lib/push";
import type { StaffSubscription } from "./store";

export interface StaffPushMessage {
  title: string;
  body: string;
  /** Where clicking it opens, inside the staff app. */
  url: string;
  /** Alerts with the same tag replace each other on the device. */
  tag: string;
  /** Show it even while the app is open (the "Alerts are on" test). */
  force?: boolean;
}

/** Test seam: the real sender is web-push. */
export type PushSender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>;

const realSender: PushSender = (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: "high" });

/**
 * Send one alert to the given devices. Never throws: a dead device (404/410)
 * is removed from the tenant's DB, anything else is logged. A no-op without
 * VAPID keys. The tenant id is explicit because this runs after the caller
 * has moved on (fire-and-forget), outside any request scope.
 */
export async function sendStaffPush(
  tenantId: number,
  subs: StaffSubscription[],
  msg: StaffPushMessage,
  send: PushSender = realSender,
): Promise<number> {
  if (subs.length === 0) return 0;
  if (send === realSender) {
    if (!isPushConfigured()) return 0;
    configureWebPush();
  }
  const payload = JSON.stringify(msg);
  let reached = 0;
  for (const s of subs) {
    try {
      await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      reached++;
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        try {
          getTenantDbById(tenantId).delete(staffPushSubscriptions).where(eq(staffPushSubscriptions.id, s.id)).run();
        } catch (e) {
          console.error("[notifications] could not remove a dead device", e);
        }
      } else {
        console.error("[notifications] push failed", code, (err as Error).message?.slice(0, 200));
      }
    }
  }
  return reached;
}
